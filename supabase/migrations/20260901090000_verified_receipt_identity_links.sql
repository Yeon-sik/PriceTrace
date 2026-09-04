-- Additive identity completion for verified receipt.v2.
-- The previous migration remains the validation and ingestion implementation. This
-- migration wraps it so old callers keep the same RPC name and old clients do not
-- need to manufacture PriceTrace IDs.

alter table public.verified_receipt_source_lines
  add column line_ordinal integer,
  add column product_id uuid,
  add column store_product_id uuid,
  add column catalog_product_id uuid,
  add column restaurant_menu_id uuid;

alter table public.verified_receipt_source_lines
  add constraint verified_receipt_source_lines_line_ordinal_check
    check (line_ordinal is null or line_ordinal > 0),
  add constraint verified_receipt_source_lines_product_fk
    foreign key (user_id, product_id)
    references public.products(user_id, id) on delete restrict,
  add constraint verified_receipt_source_lines_store_product_fk
    foreign key (user_id, store_product_id)
    references public.store_products(user_id, id) on delete restrict,
  add constraint verified_receipt_source_lines_catalog_product_fk
    foreign key (catalog_product_id)
    references public.catalog_products(id) on delete restrict,
  add constraint verified_receipt_source_lines_restaurant_menu_fk
    foreign key (restaurant_menu_id)
    references public.restaurant_menus(id) on delete restrict;

create unique index verified_receipt_source_lines_ordinal_key
  on public.verified_receipt_source_lines(receipt_id, line_ordinal)
  where line_ordinal is not null;

create index verified_receipt_source_lines_identity_idx
  on public.verified_receipt_source_lines(user_id, product_id, store_product_id)
  where product_id is not null or store_product_id is not null;

comment on column public.verified_receipt_source_lines.line_ordinal is
  'One-based source line order assigned by the PriceTrace server. It is never supplied by OCR as an identity.';
comment on column public.verified_receipt_source_lines.product_id is
  'User-owned private product identity resolved by PriceTrace for a product/service source line.';
comment on column public.verified_receipt_source_lines.store_product_id is
  'User-owned seller-specific product identity resolved by PriceTrace for a product/service source line.';
comment on column public.verified_receipt_source_lines.catalog_product_id is
  'Optional verified shared exact-sale-variant identity resolved by PriceTrace.';
comment on column public.verified_receipt_source_lines.restaurant_menu_id is
  'Optional verified restaurant-owned exact menu identity resolved by PriceTrace.';

create or replace function public.private_enrich_verified_receipt_ingestion_v2(
  p_base_response jsonb,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_receipt_id uuid := nullif(p_base_response ->> 'receiptId', '')::uuid;
  v_store_id uuid := nullif(p_base_response ->> 'storeId', '')::uuid;
  v_business_kind text;
  v_base_line jsonb;
  v_line jsonb;
  v_line_result jsonb;
  v_line_results jsonb := '[]'::jsonb;
  v_line_id text;
  v_line_type text;
  v_description text;
  v_sku text;
  v_product_type text;
  v_product_id uuid;
  v_store_product_id uuid;
  v_receipt_item_id text;
  v_catalog_product_id uuid;
  v_restaurant_menu_id uuid;
  v_observation_id uuid;
  v_restaurant_observation_id uuid;
  v_ordinal integer;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if v_receipt_id is null then
    raise exception 'verified receipt response did not contain a receipt identity' using errcode = 'P0002';
  end if;

  if v_store_id is null then
    select receipt.store_id
      into v_store_id
    from public.receipts as receipt
    where receipt.user_id = v_user_id and receipt.id = v_receipt_id;
  end if;
  if v_store_id is null then
    raise exception 'verified receipt response did not contain a store identity' using errcode = 'P0002';
  end if;

  select store.business_kind
    into v_business_kind
  from public.stores as store
  where store.user_id = v_user_id and store.id = v_store_id;
  if not found then
    raise exception 'verified receipt store identity is not owned by the caller' using errcode = '42501';
  end if;

  for v_line, v_ordinal in
    select line.value, line.ordinality::integer
    from jsonb_array_elements(
      case when jsonb_typeof(p_receipt -> 'line_items') = 'array'
        then p_receipt -> 'line_items' else '[]'::jsonb end
    ) with ordinality as line(value, ordinality)
  loop
    v_line_id := v_line ->> 'id';
    v_line_type := v_line ->> 'type';
    v_description := nullif(pg_catalog.btrim(coalesce(v_line ->> 'description', '')), '');
    v_sku := nullif(pg_catalog.btrim(coalesce((
      select identifier ->> 'value'
      from jsonb_array_elements(coalesce(v_line -> 'identifiers', '[]'::jsonb)) as identifier
      where identifier ->> 'scheme' = 'merchant_sku'
      limit 1
    ), '')), '');

    v_base_line := null;
    select line.value
      into v_base_line
    from jsonb_array_elements(
      case when jsonb_typeof(p_base_response -> 'lines') = 'array'
        then p_base_response -> 'lines' else '[]'::jsonb end
    ) with ordinality as line(value, ordinality)
    where line.ordinality = v_ordinal;

    v_product_id := null;
    v_store_product_id := null;
    v_receipt_item_id := nullif(v_base_line ->> 'receiptItemId', '');
    v_catalog_product_id := null;
    v_restaurant_menu_id := null;
    v_observation_id := nullif(v_base_line ->> 'observationId', '')::uuid;
    v_restaurant_observation_id := nullif(v_base_line ->> 'restaurantObservationId', '')::uuid;

    select source_line.product_id, source_line.store_product_id,
           source_line.catalog_product_id, source_line.restaurant_menu_id
      into v_product_id, v_store_product_id,
           v_catalog_product_id, v_restaurant_menu_id
    from public.verified_receipt_source_lines as source_line
    where source_line.user_id = v_user_id
      and source_line.receipt_id = v_receipt_id
      and source_line.source_line_id = v_line_id;

    v_catalog_product_id := coalesce(
      v_catalog_product_id,
      nullif(v_base_line ->> 'catalogProductId', '')::uuid
    );
    v_restaurant_menu_id := coalesce(
      v_restaurant_menu_id,
      nullif(v_base_line ->> 'restaurantMenuId', '')::uuid
    );

    if v_line_type in ('product', 'service') and v_description is not null then
      v_product_type := case
        when v_line_type = 'service' then 'service'
        when v_business_kind = 'food_service' then 'menu_item'
        else 'retail_product'
      end;

      if v_receipt_item_id is not null then
        select item.store_product_id, store_product.product_id
          into v_store_product_id, v_product_id
        from public.receipt_items as item
        inner join public.store_products as store_product
          on store_product.user_id = item.user_id
          and store_product.id = item.store_product_id
        where item.user_id = v_user_id
          and item.id = v_receipt_item_id
          and item.receipt_id = v_receipt_id;
      end if;

      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          v_user_id::text || ':verified-receipt-identity:' || v_store_id::text || ':' ||
          coalesce('sku:' || v_sku, 'name:' || v_product_type || ':' || v_description),
          0
        )
      );

      if v_store_product_id is null and v_sku is not null then
        select store_product.id, store_product.product_id
          into v_store_product_id, v_product_id
        from public.store_products as store_product
        where store_product.user_id = v_user_id
          and store_product.store_id = v_store_id
          and store_product.store_product_code = v_sku
        order by store_product.id
        limit 1;
      end if;

      if v_store_product_id is null then
        if v_product_id is null then
          select product.id
            into v_product_id
          from public.products as product
          where product.user_id = v_user_id
            and product.name = v_description
            and product.purchase_type = v_product_type
          order by product.created_at, product.id
          limit 1;
          if v_product_id is null then
            insert into public.products(user_id, name, purchase_type)
            values (v_user_id, v_description, v_product_type)
            returning id into v_product_id;
          end if;
        end if;

        if v_sku is null then
          select store_product.id
            into v_store_product_id
          from public.store_products as store_product
          where store_product.user_id = v_user_id
            and store_product.store_id = v_store_id
            and store_product.product_id = v_product_id
            and store_product.store_product_code is null
          order by store_product.id
          limit 1;
        end if;

        if v_store_product_id is null then
          insert into public.store_products(user_id, store_id, product_id, store_product_code)
          values (v_user_id, v_store_id, v_product_id, v_sku)
          returning id into v_store_product_id;
        end if;
      end if;
    end if;

    update public.verified_receipt_source_lines
    set line_ordinal = v_ordinal,
        product_id = case when v_line_type in ('product', 'service') then v_product_id else null end,
        store_product_id = case when v_line_type in ('product', 'service') then v_store_product_id else null end,
        catalog_product_id = case when v_line_type in ('product', 'service') then v_catalog_product_id else null end,
        restaurant_menu_id = case when v_line_type in ('product', 'service') then v_restaurant_menu_id else null end
    where user_id = v_user_id
      and receipt_id = v_receipt_id
      and source_line_id = v_line_id;

    v_line_result := coalesce(v_base_line, '{}'::jsonb) || jsonb_build_object(
      'lineOrdinal', v_ordinal,
      'sourceLineId', v_line_id,
      'receiptItemId', v_receipt_item_id,
      'productId', case when v_line_type in ('product', 'service') then v_product_id else null end,
      'storeProductId', case when v_line_type in ('product', 'service') then v_store_product_id else null end,
      'catalogProductId', case when v_line_type in ('product', 'service') then v_catalog_product_id else null end,
      'restaurantMenuId', case when v_line_type in ('product', 'service') then v_restaurant_menu_id else null end,
      'observationId', v_observation_id,
      'restaurantObservationId', v_restaurant_observation_id,
      'resolutionStatus', case
        when v_line_type not in ('product', 'service') then 'semantic_only'
        when v_restaurant_menu_id is not null or v_catalog_product_id is not null then 'resolved'
        else 'unresolved_catalog'
      end
    );
    v_line_results := v_line_results || jsonb_build_array(v_line_result);
  end loop;

  update public.verified_receipt_ingestion_contents
  set response = coalesce(p_base_response, '{}'::jsonb) || jsonb_build_object(
    'storeId', v_store_id,
    'lines', v_line_results
  )
  where user_id = v_user_id and receipt_id = v_receipt_id;

  update public.verified_receipt_ingestion_requests
  set response = coalesce(p_base_response, '{}'::jsonb) || jsonb_build_object(
    'storeId', v_store_id,
    'lines', v_line_results
  )
  where user_id = v_user_id and receipt_id = v_receipt_id;

  return coalesce(p_base_response, '{}'::jsonb) || jsonb_build_object(
    'storeId', v_store_id,
    'lines', v_line_results
  );
end;
$function$;

alter function public.submit_verified_receipt_v2(text, jsonb)
  rename to submit_verified_receipt_v2_legacy;

revoke all on function public.submit_verified_receipt_v2_legacy(text, jsonb)
  from public, anon, authenticated;

create or replace function public.submit_verified_receipt_v2(
  p_idempotency_key text,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_base_response jsonb;
begin
  v_base_response := public.submit_verified_receipt_v2_legacy(p_idempotency_key, p_receipt);
  return public.private_enrich_verified_receipt_ingestion_v2(v_base_response, p_receipt);
end;
$function$;

comment on function public.submit_verified_receipt_v2(text, jsonb) is
  'PriceTrace-owned, idempotent verified receipt.v2 ingestion. The legacy validation and server identity resolution are retained, then every source line receives a server-owned ordinal and available private/catalog/menu identities.';
revoke all on function public.submit_verified_receipt_v2(text, jsonb)
  from public, anon;
grant execute on function public.submit_verified_receipt_v2(text, jsonb)
  to authenticated;
revoke all on function public.private_enrich_verified_receipt_ingestion_v2(jsonb, jsonb)
  from public, anon, authenticated;

create or replace function public.get_authenticated_identity_detail_v1(
  p_store_id uuid default null,
  p_store_product_id uuid default null,
  p_restaurant_menu_id uuid default null,
  p_catalog_product_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_selector_count integer;
  v_selector_type text;
  v_selector_id uuid;
  v_store_ids uuid[] := array[]::uuid[];
  v_store_product_ids uuid[] := array[]::uuid[];
  v_product_ids uuid[] := array[]::uuid[];
  v_receipt_ids uuid[] := array[]::uuid[];
  v_receipt_item_ids text[] := array[]::text[];
  v_catalog_product_ids uuid[] := array[]::uuid[];
  v_restaurant_menu_ids uuid[] := array[]::uuid[];
  v_menu_receipt_item_ids text[] := array[]::text[];
  v_store jsonb;
  v_stores jsonb;
  v_products jsonb;
  v_store_products jsonb;
  v_catalog_products jsonb;
  v_restaurant_menus jsonb;
  v_receipts jsonb;
  v_price_observations jsonb;
  v_catalog_product_id uuid;
  v_product_id uuid;
  v_store_product_id uuid;
  v_store_id uuid;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  v_selector_count :=
    (p_store_id is not null)::integer
    + (p_store_product_id is not null)::integer
    + (p_restaurant_menu_id is not null)::integer
    + (p_catalog_product_id is not null)::integer;
  if v_selector_count <> 1 then
    raise exception 'exactly one PriceTrace identity selector is required' using errcode = '22023';
  end if;

  if p_store_id is not null then
    v_selector_type := 'store';
    v_selector_id := p_store_id;
    if not exists (
      select 1 from public.stores as store
      where store.user_id = v_user_id and store.id = p_store_id
    ) then
      raise exception 'private store identity was not found' using errcode = 'P0002';
    end if;
    v_store_ids := array[p_store_id];
    select coalesce(array_agg(store_product.id), array[]::uuid[]),
           coalesce(array_agg(distinct store_product.product_id), array[]::uuid[])
      into v_store_product_ids, v_product_ids
    from public.store_products as store_product
    where store_product.user_id = v_user_id and store_product.store_id = p_store_id;
    select coalesce(array_agg(receipt.id), array[]::uuid[])
      into v_receipt_ids
    from public.receipts as receipt
    where receipt.user_id = v_user_id and receipt.store_id = p_store_id;
  elsif p_store_product_id is not null then
    v_selector_type := 'store_product';
    v_selector_id := p_store_product_id;
    select store_product.store_id, store_product.product_id
      into v_store_id, v_product_id
    from public.store_products as store_product
    where store_product.user_id = v_user_id and store_product.id = p_store_product_id;
    if not found then
      raise exception 'private store product identity was not found' using errcode = 'P0002';
    end if;
    v_store_ids := array[v_store_id];
    v_store_product_ids := array[p_store_product_id];
    v_product_ids := array[v_product_id];
    select coalesce(array_agg(receipt_item.id), array[]::text[]),
           coalesce(array_agg(distinct receipt_item.receipt_id), array[]::uuid[])
      into v_receipt_item_ids, v_receipt_ids
    from public.receipt_items as receipt_item
    where receipt_item.user_id = v_user_id
      and receipt_item.store_product_id = p_store_product_id;
  elsif p_restaurant_menu_id is not null then
    v_selector_type := 'restaurant_menu';
    v_selector_id := p_restaurant_menu_id;
    select menu.catalog_product_id
      into v_catalog_product_id
    from public.restaurant_menus as menu
    inner join public.restaurants as restaurant on restaurant.id = menu.restaurant_id
    where menu.id = p_restaurant_menu_id
      and menu.status = 'active'
      and menu.review_status = 'verified'
      and restaurant.status = 'active'
      and restaurant.review_status = 'verified';
    if not found then
      raise exception 'verified restaurant menu identity was not found' using errcode = 'P0002';
    end if;
    v_catalog_product_ids := array[v_catalog_product_id];
    v_restaurant_menu_ids := array[p_restaurant_menu_id];
    select coalesce(array_agg(distinct observation.receipt_item_id), array[]::text[]),
           coalesce(array_agg(distinct observation.receipt_id), array[]::uuid[])
      into v_receipt_item_ids, v_receipt_ids
    from public.restaurant_menu_receipt_observations as observation
    where observation.owner_user_id = v_user_id
      and observation.restaurant_menu_id = p_restaurant_menu_id;
  else
    v_selector_type := 'catalog_product';
    v_selector_id := p_catalog_product_id;
    if not exists (
      select 1 from public.catalog_products as catalog
      where catalog.id = p_catalog_product_id and catalog.status = 'active'
    ) then
      raise exception 'active catalog product identity was not found' using errcode = 'P0002';
    end if;
    v_catalog_product_ids := array[p_catalog_product_id];
    select coalesce(array_agg(distinct observation.store_product_id), array[]::uuid[]),
           coalesce(array_agg(distinct observation.receipt_item_id), array[]::text[])
      into v_store_product_ids, v_receipt_item_ids
    from public.price_observations as observation
    where observation.user_id = v_user_id
      and observation.catalog_product_id = p_catalog_product_id;
    select coalesce(array_agg(distinct menu.id), array[]::uuid[])
      into v_restaurant_menu_ids
    from public.restaurant_menus as menu
    inner join public.restaurants as restaurant on restaurant.id = menu.restaurant_id
    where menu.catalog_product_id = p_catalog_product_id
      and menu.status = 'active'
      and menu.review_status = 'verified'
      and restaurant.status = 'active'
      and restaurant.review_status = 'verified';
    select coalesce(array_agg(distinct observation.receipt_item_id), array[]::text[])
      into v_menu_receipt_item_ids
    from public.restaurant_menu_receipt_observations as observation
    inner join public.restaurant_menus as menu on menu.id = observation.restaurant_menu_id
    inner join public.restaurants as restaurant on restaurant.id = menu.restaurant_id
    where observation.owner_user_id = v_user_id
      and menu.catalog_product_id = p_catalog_product_id;
    v_receipt_item_ids := v_receipt_item_ids || v_menu_receipt_item_ids;
  end if;

  select v_receipt_ids || coalesce(array_agg(distinct source_line.receipt_id), array[]::uuid[])
    into v_receipt_ids
  from public.verified_receipt_source_lines as source_line
  where source_line.user_id = v_user_id
    and (
      source_line.store_product_id = any(v_store_product_ids)
      or source_line.catalog_product_id = any(v_catalog_product_ids)
      or source_line.restaurant_menu_id = any(v_restaurant_menu_ids)
    );

  select v_store_product_ids || coalesce(array_agg(distinct source_line.store_product_id) filter (where source_line.store_product_id is not null), array[]::uuid[])
    into v_store_product_ids
  from public.verified_receipt_source_lines as source_line
  where source_line.user_id = v_user_id
    and (
      source_line.catalog_product_id = any(v_catalog_product_ids)
      or source_line.restaurant_menu_id = any(v_restaurant_menu_ids)
      or source_line.store_product_id = any(v_store_product_ids)
    );

  select v_product_ids || coalesce(array_agg(distinct source_line.product_id) filter (where source_line.product_id is not null), array[]::uuid[])
    into v_product_ids
  from public.verified_receipt_source_lines as source_line
  where source_line.user_id = v_user_id
    and (
      source_line.catalog_product_id = any(v_catalog_product_ids)
      or source_line.restaurant_menu_id = any(v_restaurant_menu_ids)
      or source_line.store_product_id = any(v_store_product_ids)
    );

  select v_receipt_item_ids || coalesce(array_agg(distinct receipt_item.id), array[]::text[])
    into v_receipt_item_ids
  from public.receipt_items as receipt_item
  where receipt_item.user_id = v_user_id and receipt_item.receipt_id = any(v_receipt_ids);

  select v_store_product_ids || coalesce(array_agg(distinct receipt_item.store_product_id), array[]::uuid[])
    into v_store_product_ids
  from public.receipt_items as receipt_item
  where receipt_item.user_id = v_user_id and receipt_item.id = any(v_receipt_item_ids);

  select v_receipt_ids || coalesce(array_agg(distinct receipt_item.receipt_id), array[]::uuid[])
    into v_receipt_ids
  from public.receipt_items as receipt_item
  where receipt_item.user_id = v_user_id and receipt_item.id = any(v_receipt_item_ids);

  select v_store_product_ids || coalesce(array_agg(distinct observation.store_product_id), array[]::uuid[])
    into v_store_product_ids
  from public.price_observations as observation
  where observation.user_id = v_user_id and observation.receipt_item_id = any(v_receipt_item_ids);

  select v_product_ids || coalesce(array_agg(distinct store_product.product_id), array[]::uuid[])
    into v_product_ids
  from public.store_products as store_product
  where store_product.user_id = v_user_id and store_product.id = any(v_store_product_ids);

  select v_catalog_product_ids || coalesce(array_agg(distinct observation.catalog_product_id) filter (where observation.catalog_product_id is not null), array[]::uuid[])
    into v_catalog_product_ids
  from public.price_observations as observation
  where observation.user_id = v_user_id and observation.store_product_id = any(v_store_product_ids);

  select v_restaurant_menu_ids || coalesce(array_agg(distinct observation.restaurant_menu_id), array[]::uuid[])
    into v_restaurant_menu_ids
  from public.restaurant_menu_receipt_observations as observation
  where observation.owner_user_id = v_user_id and observation.receipt_item_id = any(v_receipt_item_ids);

  select v_catalog_product_ids || coalesce(array_agg(distinct menu.catalog_product_id), array[]::uuid[])
    into v_catalog_product_ids
  from public.restaurant_menus as menu
  where menu.id = any(v_restaurant_menu_ids);

  select v_store_ids || coalesce(array_agg(distinct receipt.store_id), array[]::uuid[])
    into v_store_ids
  from public.receipts as receipt
  where receipt.user_id = v_user_id and receipt.id = any(v_receipt_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', store.id,
    'name', store.name,
    'merchantName', store.merchant_name,
    'branchName', store.branch_name,
    'businessKind', store.business_kind,
    'merchantId', store.merchant_id,
    'catalogNamespace', store.catalog_namespace,
    'businessRegistrationNumber', store.business_registration_number,
    'address', store.address,
    'phone', store.phone,
    'createdAt', store.created_at
  ) order by store.name, store.id), '[]'::jsonb)
    into v_stores
  from public.stores as store
  where store.user_id = v_user_id and store.id = any(v_store_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', product.id,
    'name', product.name,
    'purchaseType', product.purchase_type,
    'categoryId', product.category_id,
    'categoryTags', product.category_tags,
    'createdAt', product.created_at
  ) order by product.name, product.id), '[]'::jsonb)
    into v_products
  from public.products as product
  where product.user_id = v_user_id and product.id = any(v_product_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', store_product.id,
    'storeId', store_product.store_id,
    'productId', store_product.product_id,
    'storeProductCode', store_product.store_product_code
  ) order by store_product.id), '[]'::jsonb)
    into v_store_products
  from public.store_products as store_product
  where store_product.user_id = v_user_id and store_product.id = any(v_store_product_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', catalog.id,
    'standardProductId', catalog.standard_product_id,
    'purchaseType', catalog.purchase_type,
    'name', catalog.canonical_name,
    'brand', catalog.brand,
    'specification', catalog.specification,
    'specificationStatus', catalog.specification_status,
    'contentAmount', catalog.content_amount,
    'contentUnit', catalog.content_unit,
    'packageCount', catalog.package_count,
    'referenceUnit', catalog.reference_unit,
    'listingReferenceUrl', catalog.listing_reference_url,
    'updatedAt', catalog.updated_at
  ) order by catalog.canonical_name, catalog.id), '[]'::jsonb)
    into v_catalog_products
  from public.catalog_products as catalog
  where catalog.status = 'active' and catalog.id = any(v_catalog_product_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', menu.id,
    'restaurantId', menu.restaurant_id,
    'restaurantName', restaurant.canonical_name,
    'catalogProductId', menu.catalog_product_id,
    'name', menu.canonical_name,
    'categoryLabel', menu.category_label,
    'servingLabel', menu.serving_label,
    'officialUrl', menu.official_url,
    'reviewStatus', menu.review_status,
    'status', menu.status,
    'updatedAt', menu.updated_at
  ) order by menu.canonical_name, menu.id), '[]'::jsonb)
    into v_restaurant_menus
  from public.restaurant_menus as menu
  inner join public.restaurants as restaurant on restaurant.id = menu.restaurant_id
  where menu.status = 'active'
    and menu.review_status = 'verified'
    and menu.id = any(v_restaurant_menu_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', observation.id,
    'storeProductId', observation.store_product_id,
    'receiptItemId', observation.receipt_item_id,
    'catalogProductId', observation.catalog_product_id,
    'observedAt', observation.observed_at,
    'unitPriceKrw', observation.unit_price_krw,
    'quantity', observation.quantity,
    'measurementUnit', observation.measurement_unit,
    'locationLabel', observation.location_label,
    'verificationStatus', observation.verification_status
  ) order by observation.observed_at desc, observation.id desc), '[]'::jsonb)
    into v_price_observations
  from public.price_observations as observation
  where observation.user_id = v_user_id
    and observation.store_product_id = any(v_store_product_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', receipt.id,
    'storeId', receipt.store_id,
    'purchasedAt', receipt.purchased_at,
    'transactionNumber', receipt.transaction_number,
    'totalPriceKrw', receipt.total_price_krw,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'lineOrdinal', coalesce(source_line.line_ordinal, item.purchase_numbers[1]),
        'sourceLineId', observation.attributes ->> 'sourceLineId',
        'productId', store_product.product_id,
        'storeProductId', item.store_product_id,
        'catalogProductId', observation.catalog_product_id,
        'restaurantMenuId', menu_observation.restaurant_menu_id,
        'unitPriceKrw', item.unit_price_krw,
        'purchasedQuantity', item.purchased_quantity,
        'totalPriceKrw', item.total_price_krw
      ) order by coalesce(source_line.line_ordinal, item.purchase_numbers[1]), item.id)
      from public.receipt_items as item
      inner join public.store_products as store_product
        on store_product.user_id = item.user_id and store_product.id = item.store_product_id
      left join public.price_observations as observation
        on observation.user_id = item.user_id and observation.receipt_item_id = item.id
      left join public.verified_receipt_source_lines as source_line
        on source_line.user_id = item.user_id
        and source_line.receipt_id = item.receipt_id
        and source_line.source_line_id = observation.attributes ->> 'sourceLineId'
      left join public.restaurant_menu_receipt_observations as menu_observation
        on menu_observation.owner_user_id = item.user_id
        and menu_observation.receipt_item_id = item.id
      where item.user_id = v_user_id and item.receipt_id = receipt.id
    ), '[]'::jsonb),
    'sourceLines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sourceLineId', source_line.source_line_id,
        'lineOrdinal', source_line.line_ordinal,
        'type', source_line.line_type,
        'description', source_line.description,
        'sourceLineReferences', source_line.source_line_references,
        'merchantSku', source_line.merchant_sku,
        'quantityValue', source_line.quantity_value,
        'quantityUnit', source_line.quantity_unit,
        'unitPriceAmountMinor', source_line.unit_price_amount_minor,
        'grossAmountMinor', source_line.gross_amount_minor,
        'discountAmountMinor', source_line.discount_amount_minor,
        'taxAmountMinor', source_line.tax_amount_minor,
        'netAmountMinor', source_line.net_amount_minor,
        'taxRatePercent', source_line.tax_rate_percent,
        'foodServiceRole', source_line.food_service_role,
        'appliesToSourceLineId', source_line.applies_to_source_line_id,
        'productId', source_line.product_id,
        'storeProductId', source_line.store_product_id,
        'catalogProductId', source_line.catalog_product_id,
        'restaurantMenuId', source_line.restaurant_menu_id
      ) order by source_line.line_ordinal nulls last, source_line.source_line_id)
      from public.verified_receipt_source_lines as source_line
      where source_line.user_id = v_user_id and source_line.receipt_id = receipt.id
    ), '[]'::jsonb)
  ) order by receipt.purchased_at desc, receipt.id desc), '[]'::jsonb)
    into v_receipts
  from public.receipts as receipt
  where receipt.user_id = v_user_id and receipt.id = any(v_receipt_ids);

  return jsonb_build_object(
    'schemaVersion', 'private-identity-read.v1',
    'namespace', 'pricetrace',
    'selector', jsonb_build_object('type', v_selector_type, 'id', v_selector_id),
    'stores', v_stores,
    'products', v_products,
    'storeProducts', v_store_products,
    'catalogProducts', v_catalog_products,
    'restaurantMenus', v_restaurant_menus,
    'receipts', v_receipts,
    'priceObservations', v_price_observations
  );
end;
$function$;

comment on function public.get_authenticated_identity_detail_v1(uuid, uuid, uuid, uuid) is
  'Authenticated scoped PriceTrace identity read. It exposes public catalog/menu metadata plus only the caller-owned store, product, store-product, receipt, source-line, and price-observation rows selected by one exact identity.';
revoke all on function public.get_authenticated_identity_detail_v1(uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.get_authenticated_identity_detail_v1(uuid, uuid, uuid, uuid)
  to authenticated;
