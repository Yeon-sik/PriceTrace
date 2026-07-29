alter table public.standard_product_coupang_prices
  add column max_bundle_quantity integer,
  add column max_bundle_listed_price_krw integer;

-- Existing quantity > 1 rows are intentionally preserved as historical bundle
-- observations. New application writes and the transactional registration
-- function below always store the required single-item offer as quantity = 1.

alter table public.standard_product_coupang_prices
  add constraint standard_product_coupang_prices_max_bundle_check
  check (
    (
      max_bundle_quantity is null
      and max_bundle_listed_price_krw is null
    )
    or (
      max_bundle_quantity is not null
      and max_bundle_quantity > 1
      and max_bundle_listed_price_krw is not null
      and max_bundle_listed_price_krw > 0
      and content_amount is not null
      and content_unit is not null
    )
  );

-- A sellable variant is unique within its standard-product family and actual
-- commercial specification. The previous global name-based identity could
-- make one package size overwrite another package size with the same name.
drop index if exists public.catalog_products_identity_idx;

create unique index catalog_products_identity_idx
  on public.catalog_products (
    standard_product_id,
    purchase_type,
    canonical_name,
    coalesce(brand, ''),
    coalesce(specification, ''),
    specification_status,
    coalesce(content_amount, -1::numeric),
    coalesce(content_unit, ''),
    package_count
  );

create function public.register_standard_product_with_coupang_price(
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
    or coalesce(p_coupang_content_amount, 0) <= 0
    or coalesce(p_coupang_content_unit, '') not in ('g', 'ml', 'each')
    or coalesce(p_coupang_product_url, '') !~ '^https?://'
  then
    raise exception 'A positive single price, content amount, content unit, and Coupang URL are required.'
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

  -- An omitted bundle keeps the latest bundle only when this observation is
  -- for the same Coupang URL and the same single-item content specification.
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

  -- Promote a placeholder once its package size is verified. Never downgrade
  -- a verified commercial variant back to a placeholder.
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
    1,
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

comment on function public.register_standard_product_with_coupang_price(
  uuid, text, text, text, text, numeric, text, integer, integer, text, text[],
  text, integer, numeric, text, integer, integer
) is
  'Atomically creates a standard-product listing, source mappings, and its single and optional maximum-bundle Coupang prices.';

revoke all on function public.register_standard_product_with_coupang_price(
  uuid, text, text, text, text, numeric, text, integer, integer, text, text[],
  text, integer, numeric, text, integer, integer
) from public;
grant execute on function public.register_standard_product_with_coupang_price(
  uuid, text, text, text, text, numeric, text, integer, integer, text, text[],
  text, integer, numeric, text, integer, integer
) to authenticated;

create function public.get_public_exact_standard_product_catalog_v2()
returns table (
  source_label text,
  source_product_code text,
  catalog_product_id uuid,
  standard_product_id uuid,
  standard_name text,
  content_amount numeric,
  content_unit text,
  package_count integer,
  reference_unit integer,
  coupang_listed_price_krw integer,
  coupang_quantity integer,
  coupang_content_amount numeric,
  coupang_content_unit text,
  coupang_max_bundle_quantity integer,
  coupang_max_bundle_listed_price_krw integer,
  coupang_product_url text,
  coupang_observed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_mappings as (
    select distinct
      mapping.source_label,
      mapping.source_product_code,
      mapping.catalog_product_id
    from public.source_product_mappings as mapping
    where mapping.review_status = 'verified'
  ),
  eligible_catalog as (
    select
      catalog.id as catalog_product_id,
      catalog.standard_product_id,
      catalog.content_amount,
      catalog.content_unit,
      catalog.package_count,
      catalog.reference_unit
    from public.catalog_products as catalog
    inner join public.standard_products as standard on standard.id = catalog.standard_product_id
    where catalog.status = 'active'
      and standard.status = 'active'
      and catalog.specification_status = 'verified'
      and catalog.content_amount is not null
      and catalog.content_amount > 0
      and catalog.content_unit in ('g', 'ml', 'each')
      and catalog.package_count > 0
  ),
  latest_coupang as (
    select distinct on (price.standard_product_id)
      price.standard_product_id,
      price.listed_price_krw,
      price.quantity,
      price.content_amount,
      price.content_unit,
      price.max_bundle_quantity,
      price.max_bundle_listed_price_krw,
      price.product_url,
      price.observed_at
    from public.standard_product_coupang_prices as price
    order by price.standard_product_id, price.observed_at desc, price.created_at desc, price.id desc
  )
  select
    mapping.source_label,
    mapping.source_product_code,
    catalog.catalog_product_id,
    standard.id as standard_product_id,
    standard.canonical_name as standard_name,
    catalog.content_amount,
    catalog.content_unit,
    catalog.package_count,
    catalog.reference_unit,
    coupang.listed_price_krw,
    coupang.quantity,
    coupang.content_amount as coupang_content_amount,
    coupang.content_unit as coupang_content_unit,
    coupang.max_bundle_quantity as coupang_max_bundle_quantity,
    coupang.max_bundle_listed_price_krw as coupang_max_bundle_listed_price_krw,
    coupang.product_url,
    coupang.observed_at
  from eligible_mappings as mapping
  inner join eligible_catalog as catalog on catalog.catalog_product_id = mapping.catalog_product_id
  inner join public.standard_products as standard on standard.id = catalog.standard_product_id
  left join latest_coupang as coupang on coupang.standard_product_id = standard.id
  order by standard.canonical_name, mapping.source_label, mapping.source_product_code;
$$;

comment on function public.get_public_exact_standard_product_catalog_v2() is
  'Returns verified standard-product mappings with the latest single and maximum-bundle Coupang prices.';

revoke all on function public.get_public_exact_standard_product_catalog_v2() from public;
grant execute on function public.get_public_exact_standard_product_catalog_v2() to anon;
grant execute on function public.get_public_exact_standard_product_catalog_v2() to authenticated;
