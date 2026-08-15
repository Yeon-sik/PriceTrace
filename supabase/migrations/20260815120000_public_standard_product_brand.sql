-- Expose the canonical standard-product brand alongside the family name.
-- The existing v2 RPC shape is preserved for older clients.
create function public.get_public_exact_standard_product_catalog_v3()
returns table (
  source_label text,
  source_product_code text,
  catalog_product_id uuid,
  standard_product_id uuid,
  standard_name text,
  brand_name text,
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
  select
    catalog.source_label,
    catalog.source_product_code,
    catalog.catalog_product_id,
    catalog.standard_product_id,
    catalog.standard_name,
    brand.canonical_name as brand_name,
    catalog.content_amount,
    catalog.content_unit,
    catalog.package_count,
    catalog.reference_unit,
    catalog.coupang_listed_price_krw,
    catalog.coupang_quantity,
    catalog.coupang_content_amount,
    catalog.coupang_content_unit,
    catalog.coupang_max_bundle_quantity,
    catalog.coupang_max_bundle_listed_price_krw,
    catalog.coupang_product_url,
    catalog.coupang_observed_at
  from public.get_public_exact_standard_product_catalog_v2() as catalog
  inner join public.standard_products as standard
    on standard.id = catalog.standard_product_id
  left join public.brands as brand
    on brand.id = standard.brand_id
    and brand.status = 'active'
  order by catalog.standard_name, catalog.source_label, catalog.source_product_code;
$$;

comment on function public.get_public_exact_standard_product_catalog_v3() is
  'Returns the public exact standard-product catalog with its canonical brand name.';

revoke all on function public.get_public_exact_standard_product_catalog_v3() from public;
grant execute on function public.get_public_exact_standard_product_catalog_v3() to anon, authenticated;
