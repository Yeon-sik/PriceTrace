-- Accepted purchase facts remain append-only. Reviewed identity/observations
-- live separately and are overlaid on owner checkpoint reads.
create table public.purchase_restaurant_line_resolutions (
  purchase_source_line_id uuid primary key,
  user_id uuid not null references auth.users(id),
  restaurant_menu_manual_observation_id uuid not null references public.restaurant_menu_manual_observations(id),
  reviewed_merchant jsonb not null check (jsonb_typeof(reviewed_merchant) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (user_id, purchase_source_line_id) references public.purchase_price_source_lines(user_id, id)
);
alter table public.purchase_restaurant_line_resolutions enable row level security;
revoke all on public.purchase_restaurant_line_resolutions from public, anon, authenticated;
create policy purchase_restaurant_resolution_owner_read on public.purchase_restaurant_line_resolutions
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.purchase_restaurant_line_resolutions to authenticated;
create trigger purchase_restaurant_resolution_immutable before update or delete
  on public.purchase_restaurant_line_resolutions for each row
  execute function public.reject_purchase_price_observation_mutation();

alter function public.private_purchase_price_line_response_v1(uuid, jsonb)
  rename to private_purchase_price_line_base_response_v1;

create function public.private_purchase_price_line_response_v1(p_purchase_source_id uuid, p_base_response jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_response jsonb; v_rows jsonb := '[]'; v_row jsonb; v_line public.purchase_price_source_lines%rowtype;
  v_observation public.restaurant_menu_manual_observations%rowtype;
  v_menu public.restaurant_menus%rowtype; v_catalog public.catalog_products%rowtype;
  v_ids jsonb := '[]'; v_resolved boolean;
begin
  v_response := public.private_purchase_price_line_base_response_v1(p_purchase_source_id, p_base_response);
  for v_row in select value from jsonb_array_elements(v_response -> 'lineResults') loop
    select line.* into strict v_line from public.purchase_price_source_lines line
      where line.purchase_source_id = p_purchase_source_id and line.user_id = (select auth.uid())
        and line.source_line_key = v_row ->> 'lineKey' and line.line_ordinal::text = v_row ->> 'lineOrdinal';
    select observation.* into v_observation
      from public.purchase_restaurant_line_resolutions resolution
      join public.restaurant_menu_manual_observations observation on observation.id = resolution.restaurant_menu_manual_observation_id
      where resolution.purchase_source_line_id = v_line.id and resolution.user_id = (select auth.uid())
        and observation.created_by = (select auth.uid()) and observation.observation_kind = 'standalone_purchase'
        and observation.verification_status = 'verified';
    v_resolved := found;
    if v_resolved then
      select menu.* into strict v_menu from public.restaurant_menus menu where menu.id = v_observation.restaurant_menu_id;
      select catalog.* into strict v_catalog from public.catalog_products catalog where catalog.id = v_menu.catalog_product_id;
      if not exists (select 1 from public.restaurants restaurant
          join public.restaurant_locations location on location.restaurant_id = restaurant.id
          join public.standard_products standard on standard.id = v_catalog.standard_product_id
          where restaurant.id = v_observation.restaurant_id and location.id = v_observation.restaurant_location_id
            and restaurant.status = 'active' and restaurant.review_status = 'verified' and restaurant.verification_status = 'verified'
            and location.review_status = 'verified' and location.verification_status = 'verified'
            and v_menu.status = 'active' and v_menu.review_status = 'verified' and v_menu.verification_status = 'verified'
            and v_menu.restaurant_id = restaurant.id and v_catalog.status = 'active' and v_catalog.verification_status = 'verified'
            and standard.status = 'active' and standard.verification_status = 'verified') then
        v_row := v_row || jsonb_build_object('authorityStatus', 'needs_review', 'reasonCode', 'purchase_resolved_identity_unverified',
          'authoritativeIds', null, 'observationCreated', false, 'observationStatus', 'not_created');
      else
        v_row := v_row || jsonb_build_object('observationCreated', true, 'observationStatus', 'created',
          'observationId', v_observation.id, 'observationType', 'restaurant_menu_manual_observation',
          'reason', null, 'reasonCode', null, 'authorityStatus', 'exact', 'merchantResolutionStatus', 'exact', 'menuResolutionStatus', 'exact',
          'authoritativeIds', jsonb_build_object('restaurantId', v_observation.restaurant_id,
            'restaurantLocationId', v_observation.restaurant_location_id, 'restaurantMenuId', v_menu.id,
            'catalogProductId', v_catalog.id, 'standardProductId', v_catalog.standard_product_id));
      end if;
    end if;
    if v_row ->> 'observationCreated' = 'true' then
      v_ids := v_ids || jsonb_build_array(v_row -> 'observationId');
    end if;
    v_rows := v_rows || jsonb_build_array(v_row);
  end loop;
  return v_response || jsonb_build_object('lineResults', v_rows, 'observationIds', v_ids,
    'observationCount', jsonb_array_length(v_ids), 'observationCreated', jsonb_array_length(v_ids) > 0);
end;
$function$;
revoke all on function public.private_purchase_price_line_response_v1(uuid, jsonb) from public, anon, authenticated;

create function public.resolve_ocr_purchase_restaurant_line_v1(
  p_purchase_source_id uuid, p_line_key text, p_user_verified boolean, p_merchant jsonb default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid := (select auth.uid()); v_source public.purchase_price_sources%rowtype;
  v_line public.purchase_price_source_lines%rowtype; v_merchant jsonb; v_restaurant jsonb; v_menu jsonb;
  v_observation_id uuid; v_response jsonb; v_reason text; v_previous jsonb;
begin
  if v_actor is null then raise exception 'authenticated purchase owner required' using errcode = '42501'; end if;
  if p_user_verified is distinct from true then raise exception 'purchase identity review required' using errcode = '22023'; end if;
  select source.* into v_source from public.purchase_price_sources source
    where source.id = p_purchase_source_id and source.user_id = v_actor;
  if not found then raise exception 'purchase source not available to this user' using errcode = '42501'; end if;
  select line.* into v_line from public.purchase_price_source_lines line
    where line.purchase_source_id = v_source.id and line.source_line_key = p_line_key and line.user_id = v_actor for update;
  if not found then raise exception 'purchase line not available to this user' using errcode = '42501'; end if;
  if (select count(*) from public.purchase_price_source_lines line where line.purchase_source_id = v_source.id
      and line.source_line_key = p_line_key) <> 1 then
    raise exception 'purchase line key is ambiguous' using errcode = '22023';
  end if;
  -- Never turn a payment total, cancelled purchase, unknown seller or ambiguous price into an observation.
  if v_source.purchase_kind <> 'restaurant' or v_source.transaction_state <> 'settled'
    or v_line.line_seller_status <> 'confirmed' or v_line.price_status <> 'itemized'
    or coalesce(v_source.ordered_on, v_source.paid_on) is null
    or coalesce(v_line.unit_price_krw, v_line.gross_price_krw, v_line.net_price_krw) is null then
    raise exception 'purchase line is not eligible for identity recovery' using errcode = '22023';
  end if;
  v_merchant := jsonb_build_object('merchant_name', v_line.line_seller_name, 'branch_name', v_line.line_seller_branch_name,
    'source_namespace', v_line.line_seller_source_namespace, 'source_location_code', v_line.line_seller_source_code);
  if p_merchant is not null then
    if jsonb_typeof(p_merchant) <> 'object' or exists (select 1 from jsonb_object_keys(p_merchant) key
      where key not in ('merchant_name', 'branch_name', 'source_namespace', 'source_location_code', 'business_registration_number', 'address', 'phone'))
      or (p_merchant ? 'merchant_name' and p_merchant ->> 'merchant_name' is distinct from v_line.line_seller_name)
      or (p_merchant ? 'branch_name' and p_merchant ->> 'branch_name' is distinct from v_line.line_seller_branch_name)
      or (v_line.line_seller_source_namespace is not null and p_merchant ? 'source_namespace'
        and p_merchant ->> 'source_namespace' is distinct from v_line.line_seller_source_namespace)
      or (v_line.line_seller_source_code is not null and p_merchant ? 'source_location_code'
        and p_merchant ->> 'source_location_code' is distinct from v_line.line_seller_source_code) then
      raise exception 'purchase resolution accepts matching merchant source facts only' using errcode = '22023';
    end if;
    v_merchant := v_merchant || p_merchant;
  end if;
  v_response := public.get_purchase_price_ingestion_response_v1(v_source.id);
  select r.reviewed_merchant into v_previous from public.purchase_restaurant_line_resolutions r where r.purchase_source_line_id = v_line.id;
  if found and p_merchant is not null and exists (select 1 from jsonb_each(p_merchant) field
      where field.value is distinct from v_previous -> field.key) then
    raise exception 'purchase resolution identity conflicts with accepted review' using errcode = '23514';
  end if;
  if v_line.observation_status = 'created' or v_previous is not null then
    return v_response;
  end if;
  if v_line.option_text is null then return v_response; end if;
  v_restaurant := public.private_resolve_ocr_standalone_restaurant_v1(v_actor, v_merchant, true);
  if v_restaurant ->> 'status' = 'exact' and not exists (
      select 1 from public.restaurants r join public.restaurant_locations l on l.restaurant_id = r.id
      where r.id = (v_restaurant ->> 'restaurantId')::uuid and l.id = (v_restaurant ->> 'restaurantLocationId')::uuid
        and r.canonical_name = v_line.line_seller_name
        and (v_line.line_seller_branch_name is null or l.location_label = v_line.line_seller_branch_name)) then
    v_restaurant := jsonb_build_object('status', 'needs_ocr_resolution', 'reasonCode', 'restaurant_source_identity_conflict');
  end if;
  if v_restaurant ->> 'status' = 'exact' then
    v_menu := public.private_resolve_ocr_menu_identity_v1(v_actor, (v_restaurant ->> 'restaurantId')::uuid,
      (v_restaurant ->> 'restaurantLocationId')::uuid, v_line.product_name, v_line.option_text, null, null, null,
      jsonb_build_object('purchaseSourceId', v_source.id, 'lineKey', v_line.source_line_key), true);
  end if;
  if v_restaurant ->> 'status' <> 'exact' or v_menu ->> 'status' is distinct from 'exact' then
    v_reason := coalesce(v_menu ->> 'reasonCode', v_restaurant ->> 'reasonCode');
    -- Returning the owner checkpoint retains every line and every private source fact.
    select jsonb_agg(case when row ->> 'lineKey' = p_line_key then row || jsonb_build_object(
      'reason', v_reason, 'reasonCode', v_reason, 'requiredSourceFacts',
      coalesce(v_menu -> 'requiredSourceFacts', v_restaurant -> 'requiredSourceFacts')) else row end order by ordinal)
      into v_menu from jsonb_array_elements(v_response -> 'lineResults') with ordinality rows(row, ordinal);
    return v_response || jsonb_build_object('lineResults', v_menu);
  end if;
  insert into public.restaurant_menu_manual_observations (
    restaurant_id, restaurant_location_id, restaurant_menu_id, observed_on, unit_price_krw, quantity, total_price_krw,
    source_url, note, source_snapshot, verification_status, created_by, observation_kind, verification_basis,
    currency, gross_price_krw, discount_price_krw, net_price_krw, observed_at_exact
  ) values (
    (v_restaurant ->> 'restaurantId')::uuid, (v_restaurant ->> 'restaurantLocationId')::uuid,
    (v_menu ->> 'restaurantMenuId')::uuid, coalesce(v_source.ordered_on, v_source.paid_on),
    v_line.unit_price_krw, v_line.quantity, v_line.net_price_krw, v_source.source_url, v_source.note,
    jsonb_build_object('schemaVersion', 'purchase-price-observation.v4', 'purchaseSourceId', v_source.id,
      'purchaseLineOrdinal', v_line.line_ordinal, 'line', v_line.line_payload, 'seller', v_merchant,
      'catalogProductId', v_menu -> 'catalogProductId', 'standardProductId', v_menu -> 'standardProductId'),
    'verified', v_actor, 'standalone_purchase', v_source.source_payload ->> 'verification_basis', 'KRW',
    v_line.gross_price_krw, v_line.discount_price_krw, v_line.net_price_krw,
    case when v_source.ordered_on is not null then v_source.ordered_at_exact else v_source.paid_at_exact end
  ) returning id into v_observation_id;
  insert into public.purchase_restaurant_line_resolutions(purchase_source_line_id, user_id, restaurant_menu_manual_observation_id, reviewed_merchant)
    values(v_line.id, v_actor, v_observation_id, v_merchant);
  return public.get_purchase_price_ingestion_response_v1(v_source.id);
end;
$function$;
revoke all on function public.resolve_ocr_purchase_restaurant_line_v1(uuid, text, boolean, jsonb) from public, anon;
grant execute on function public.resolve_ocr_purchase_restaurant_line_v1(uuid, text, boolean, jsonb) to authenticated;
-- Invalidate cached callers after the helper rename, including pooled sessions.
do $migration$
begin
  execute pg_catalog.pg_get_functiondef('public.get_purchase_price_ingestion_response_v1(uuid)'::regprocedure);
  execute pg_catalog.pg_get_functiondef('public.ingest_verified_purchase_price_observation_v1(text,jsonb)'::regprocedure);
end;
$migration$;
notify pgrst, 'reload schema';
