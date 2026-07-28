create function public.register_standard_product_with_coupang_offer(
  p_standard_product_id uuid,
  p_standard_name text,
  p_product_reference_url text,
  p_listing_name text,
  p_specification_status text,
  p_content_amount numeric,
  p_content_unit text,
  p_package_count integer,
  p_reference_unit integer,
  p_source_product_code text,
  p_source_labels text[],
  p_coupang_product_url text,
  p_coupang_listed_price_krw integer,
  p_coupang_quantity integer,
  p_coupang_content_amount numeric,
  p_coupang_content_unit text,
  p_coupang_max_bundle_quantity integer,
  p_coupang_max_bundle_listed_price_krw integer
)
returns table (
  standard_product_id uuid,
  catalog_product_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_standard_product_id uuid := p_standard_product_id;
  v_catalog_product_id uuid;
  v_observed_at timestamptz := now();
  v_max_bundle_quantity integer := p_coupang_max_bundle_quantity;
  v_max_bundle_listed_price_krw integer := p_coupang_max_bundle_listed_price_krw;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if coalesce(length(btrim(p_listing_name)), 0) = 0
    or coalesce(length(btrim(p_source_product_code)), 0) = 0
    or coalesce(p_product_reference_url, '') !~ '^https?://'
    or not exists (
      select 1
      from unnest(p_source_labels) as source(source_label)
      where length(btrim(source.source_label)) > 0
    )
  then
    raise exception 'A listing name, reference URL, source product code, and source label are required.'
      using errcode = '23514';
  end if;

  if coalesce(p_specification_status, '') not in ('verified', 'placeholder')
  then
    raise exception 'The catalog specification status is invalid.'
      using errcode = '23514';
  end if;

  if p_specification_status = 'verified'
    and (
      coalesce(p_content_amount, 0) <= 0
      or coalesce(p_content_unit, '') not in ('g', 'ml', 'each')
      or coalesce(p_package_count, 0) <= 0
    )
  then
    raise exception 'A verified catalog specification requires a positive amount, unit, and package count.'
      using errcode = '23514';
  end if;

  if (v_max_bundle_quantity is null) <> (v_max_bundle_listed_price_krw is null)
  then
    raise exception 'Maximum bundle quantity and price must be provided together.'
      using errcode = '23514';
  end if;

  if coalesce(p_coupang_listed_price_krw, 0) <= 0
    or coalesce(p_coupang_quantity, 0) <= 0
    or coalesce(p_coupang_content_amount, 0) <= 0
    or coalesce(p_coupang_content_unit, '') not in ('g', 'ml', 'each')
    or coalesce(p_coupang_product_url, '') !~ '^https?://'
  then
    raise exception 'A positive required price, quantity, content amount, content unit, and Coupang URL are required.'
      using errcode = '23514';
  end if;

  if v_max_bundle_quantity is not null
    and (
      v_max_bundle_quantity <= 1
      or coalesce(v_max_bundle_listed_price_krw, 0) <= 0
    )
  then
    raise exception 'Maximum bundle quantity and price must be positive.'
      using errcode = '23514';
  end if;

  if v_standard_product_id is null
  then
    if coalesce(length(btrim(p_standard_name)), 0) = 0
    then
      raise exception 'A standard product name is required.'
        using errcode = '23514';
    end if;

    insert into public.standard_products (
      purchase_type,
      canonical_name,
      product_reference_url,
      created_by
    )
    values (
      'retail_product',
      btrim(p_standard_name),
      p_product_reference_url,
      v_user_id
    )
    returning id into v_standard_product_id;
  else
    perform 1
    from public.standard_products as standard
    where standard.id = v_standard_product_id
      and standard.status = 'active'
      and standard.purchase_type = 'retail_product';

    if not found
    then
      raise exception 'The selected standard product does not exist.'
        using errcode = '23503';
    end if;
  end if;

  -- An omitted maximum bundle keeps the latest one only for the same Coupang
  -- URL and the same per-item content specification.
  if v_max_bundle_quantity is null
  then
    select
      price.max_bundle_quantity,
      price.max_bundle_listed_price_krw
    into
      v_max_bundle_quantity,
      v_max_bundle_listed_price_krw
    from public.standard_product_coupang_prices as price
    where price.standard_product_id = v_standard_product_id
      and price.product_url = p_coupang_product_url
      and price.content_amount is not distinct from p_coupang_content_amount
      and price.content_unit is not distinct from p_coupang_content_unit
      and price.max_bundle_quantity is not null
      and price.max_bundle_listed_price_krw is not null
    order by price.observed_at desc, price.created_at desc, price.id desc
    limit 1;
  end if;

  -- Reuse only an exact commercial variant. Equal listing names with
  -- different package sizes remain separate catalog products.
  select catalog.id
  into v_catalog_product_id
  from public.catalog_products as catalog
  where catalog.standard_product_id = v_standard_product_id
    and catalog.purchase_type = 'retail_product'
    and catalog.canonical_name = btrim(p_listing_name)
    and coalesce(catalog.brand, '') = ''
    and coalesce(catalog.specification, '') = ''
    and catalog.specification_status = p_specification_status
    and catalog.content_amount is not distinct from p_content_amount
    and catalog.content_unit is not distinct from p_content_unit
    and catalog.package_count = p_package_count
  order by catalog.created_at, catalog.id
  limit 1;

  -- Promote a placeholder only when the same source item was already mapped
  -- to it. This prevents an equal name at another seller from being changed.
  if v_catalog_product_id is null
    and p_specification_status = 'verified'
  then
    select catalog.id
    into v_catalog_product_id
    from public.catalog_products as catalog
    where catalog.standard_product_id = v_standard_product_id
      and catalog.purchase_type = 'retail_product'
      and catalog.canonical_name = btrim(p_listing_name)
      and coalesce(catalog.brand, '') = ''
      and coalesce(catalog.specification, '') = ''
      and catalog.specification_status = 'placeholder'
      and exists (
        select 1
        from public.source_product_mappings as mapping
        inner join unnest(p_source_labels) as source(source_label)
          on mapping.source_label = btrim(source.source_label)
        where mapping.catalog_product_id = catalog.id
          and mapping.source_product_code = btrim(p_source_product_code)
      )
    order by catalog.created_at, catalog.id
    limit 1
    for update;

    if v_catalog_product_id is not null
    then
      update public.catalog_products as catalog
      set
        specification_status = p_specification_status,
        content_amount = p_content_amount,
        content_unit = p_content_unit,
        package_count = p_package_count,
        reference_unit = p_reference_unit,
        listing_reference_url = p_product_reference_url,
        status = 'active',
        updated_at = v_observed_at
      where catalog.id = v_catalog_product_id;
    else
      -- A concurrent registration may have promoted the placeholder while
      -- this transaction waited for its row lock.
      select catalog.id
      into v_catalog_product_id
      from public.catalog_products as catalog
      where catalog.standard_product_id = v_standard_product_id
        and catalog.purchase_type = 'retail_product'
        and catalog.canonical_name = btrim(p_listing_name)
        and coalesce(catalog.brand, '') = ''
        and coalesce(catalog.specification, '') = ''
        and catalog.specification_status = p_specification_status
        and catalog.content_amount is not distinct from p_content_amount
        and catalog.content_unit is not distinct from p_content_unit
        and catalog.package_count = p_package_count
      order by catalog.created_at, catalog.id
      limit 1;
    end if;
  end if;

  if v_catalog_product_id is null
  then
    insert into public.catalog_products (
      standard_product_id,
      purchase_type,
      canonical_name,
      specification_status,
      content_amount,
      content_unit,
      package_count,
      reference_unit,
      listing_reference_url,
      created_by
    )
    values (
      v_standard_product_id,
      'retail_product',
      btrim(p_listing_name),
      p_specification_status,
      p_content_amount,
      p_content_unit,
      p_package_count,
      p_reference_unit,
      p_product_reference_url,
      v_user_id
    )
    on conflict do nothing
    returning id into v_catalog_product_id;

    if v_catalog_product_id is null
    then
      -- If an equal variant was inserted concurrently, reuse it instead of
      -- failing the whole atomic registration with a uniqueness error.
      select catalog.id
      into v_catalog_product_id
      from public.catalog_products as catalog
      where catalog.standard_product_id = v_standard_product_id
        and catalog.purchase_type = 'retail_product'
        and catalog.canonical_name = btrim(p_listing_name)
        and coalesce(catalog.brand, '') = ''
        and coalesce(catalog.specification, '') = ''
        and catalog.specification_status = p_specification_status
        and catalog.content_amount is not distinct from p_content_amount
        and catalog.content_unit is not distinct from p_content_unit
        and catalog.package_count = p_package_count
      order by catalog.created_at, catalog.id
      limit 1;

      if v_catalog_product_id is null
      then
        raise exception 'The catalog variant could not be created or reused.'
          using errcode = '40001';
      end if;
    end if;
  else
    update public.catalog_products as catalog
    set
      reference_unit = p_reference_unit,
      listing_reference_url = p_product_reference_url,
      status = 'active',
      updated_at = v_observed_at
    where catalog.id = v_catalog_product_id;
  end if;

  insert into public.source_product_mappings (
    source_label,
    source_product_code,
    catalog_product_id,
    matching_method,
    confidence,
    review_status,
    created_by,
    reviewed_by,
    reviewed_at
  )
  select distinct
    btrim(source.source_label),
    btrim(p_source_product_code),
    v_catalog_product_id,
    'manual',
    1,
    'verified',
    v_user_id,
    v_user_id,
    v_observed_at
  from unnest(p_source_labels) as source(source_label)
  where length(btrim(source.source_label)) > 0
  on conflict (source_label, source_product_code)
  do update set
    catalog_product_id = excluded.catalog_product_id,
    matching_method = excluded.matching_method,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = v_observed_at;

  insert into public.standard_product_coupang_prices (
    standard_product_id,
    product_url,
    listed_price_krw,
    quantity,
    content_amount,
    content_unit,
    max_bundle_quantity,
    max_bundle_listed_price_krw,
    observed_at,
    created_by
  )
  values (
    v_standard_product_id,
    p_coupang_product_url,
    p_coupang_listed_price_krw,
    p_coupang_quantity,
    p_coupang_content_amount,
    p_coupang_content_unit,
    v_max_bundle_quantity,
    v_max_bundle_listed_price_krw,
    v_observed_at,
    v_user_id
  );

  return query
  select v_standard_product_id, v_catalog_product_id;
end;
$$;

comment on function public.register_standard_product_with_coupang_offer(
  uuid, text, text, text, text, numeric, text, integer, integer, text, text[],
  text, integer, integer, numeric, text, integer, integer
) is
  'Atomically creates a standard-product listing, source mappings, and required and optional maximum-bundle Coupang offers.';

revoke all on function public.register_standard_product_with_coupang_offer(
  uuid, text, text, text, text, numeric, text, integer, integer, text, text[],
  text, integer, integer, numeric, text, integer, integer
) from public;

grant execute on function public.register_standard_product_with_coupang_offer(
  uuid, text, text, text, text, numeric, text, integer, integer, text, text[],
  text, integer, integer, numeric, text, integer, integer
) to authenticated;
