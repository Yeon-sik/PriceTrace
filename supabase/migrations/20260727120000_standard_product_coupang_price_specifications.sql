alter table public.standard_product_coupang_prices
  add column content_amount numeric,
  add column content_unit text;

alter table public.standard_product_coupang_prices
  add constraint standard_product_coupang_prices_content_specification_check
  check (
    (content_amount is null and content_unit is null)
    or (content_amount > 0 and content_unit in ('g', 'ml', 'each'))
  );

drop function if exists public.get_public_standard_product_catalog();

create function public.get_public_standard_product_catalog()
returns table (
  source_product_code text,
  catalog_product_id uuid,
  standard_product_id uuid,
  standard_name text,
  content_amount numeric,
  content_unit text,
  package_count integer,
  coupang_listed_price_krw integer,
  coupang_quantity integer,
  coupang_content_amount numeric,
  coupang_content_unit text,
  coupang_product_url text,
  coupang_observed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with verified_mappings as (
    select mapping.source_product_code, mapping.catalog_product_id
    from public.source_product_mappings as mapping
    where mapping.review_status = 'verified'
  ),
  unique_codes as (
    select source_product_code
    from verified_mappings
    group by source_product_code
    having count(distinct catalog_product_id) = 1
  ),
  eligible_mappings as (
    select distinct mapping.source_product_code, mapping.catalog_product_id
    from verified_mappings as mapping
    inner join unique_codes as source on source.source_product_code = mapping.source_product_code
  ),
  eligible_catalog as (
    select catalog.id as catalog_product_id, catalog.standard_product_id, catalog.content_amount, catalog.content_unit, catalog.package_count
    from public.catalog_products as catalog
    inner join public.standard_products as standard on standard.id = catalog.standard_product_id
    where catalog.status = 'active'
      and standard.status = 'active'
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
      price.product_url,
      price.observed_at
    from public.standard_product_coupang_prices as price
    order by price.standard_product_id, price.observed_at desc, price.created_at desc, price.id desc
  )
  select
    mapping.source_product_code,
    catalog.catalog_product_id,
    standard.id as standard_product_id,
    standard.canonical_name as standard_name,
    catalog.content_amount,
    catalog.content_unit,
    catalog.package_count,
    coupang.listed_price_krw,
    coupang.quantity,
    coupang.content_amount as coupang_content_amount,
    coupang.content_unit as coupang_content_unit,
    coupang.product_url,
    coupang.observed_at
  from eligible_mappings as mapping
  inner join eligible_catalog as catalog on catalog.catalog_product_id = mapping.catalog_product_id
  inner join public.standard_products as standard on standard.id = catalog.standard_product_id
  left join latest_coupang as coupang on coupang.standard_product_id = standard.id
  order by standard.canonical_name, mapping.source_product_code;
$$;

revoke all on function public.get_public_standard_product_catalog() from public;
grant execute on function public.get_public_standard_product_catalog() to anon;
grant execute on function public.get_public_standard_product_catalog() to authenticated;
