-- Preserve the actual immediate parent identity even when the direct brand is archived.
-- Public names still require active direct and parent brands; v1-v4 stay untouched.
create or replace function public.get_public_exact_standard_product_catalog_v5()
returns table (
  source_label text, source_product_code text, catalog_product_id uuid,
  standard_product_id uuid, standard_name text, brand_name text,
  standard_category_id uuid, standard_category_slug text, standard_category_name text,
  content_amount numeric, content_unit text, package_count integer, reference_unit integer,
  coupang_listed_price_krw integer, coupang_quantity integer, coupang_content_amount numeric,
  coupang_content_unit text, coupang_max_bundle_quantity integer,
  coupang_max_bundle_listed_price_krw integer, coupang_product_url text,
  coupang_observed_at timestamptz,
  brand_id uuid, parent_brand_id uuid, parent_brand_name text
)
language sql stable security definer set search_path = '' as $$
  select catalog.*, standard.brand_id, brand.parent_brand_id, parent.canonical_name
  from public.get_public_exact_standard_product_catalog_v4() catalog
  join public.standard_products standard on standard.id = catalog.standard_product_id
  left join public.brands brand on brand.id = standard.brand_id
  left join public.brands parent on parent.id = brand.parent_brand_id and parent.status = 'active' and brand.status = 'active'
  order by catalog.standard_name, catalog.source_label, catalog.source_product_code, catalog.catalog_product_id;
$$;
revoke all on function public.get_public_exact_standard_product_catalog_v5() from public;
grant execute on function public.get_public_exact_standard_product_catalog_v5() to anon, authenticated;
