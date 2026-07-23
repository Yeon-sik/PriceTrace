-- Standard products are product families (for example, "햇반").
-- catalog_products remains the sellable variant with a verified package size.
create table public.standard_products (
  id uuid primary key default gen_random_uuid(),
  purchase_type text not null check (purchase_type in ('retail_product', 'menu_item', 'raw_material', 'property', 'service')),
  canonical_name text not null check (length(trim(canonical_name)) > 0),
  brand text,
  product_reference_url text check (product_reference_url is null or product_reference_url ~ '^https?://'),
  category_id uuid references public.catalog_categories(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_catalog_product_id uuid unique
);

create index standard_products_name_idx
  on public.standard_products(purchase_type, canonical_name, coalesce(brand, ''));
create index standard_products_category_idx
  on public.standard_products(purchase_type, category_id, status);

-- Preserve every existing catalog variant by giving it its own temporary
-- parent.  Similar names are deliberately not auto-merged.
insert into public.standard_products (
  purchase_type, canonical_name, brand, product_reference_url, category_id,
  status, created_by, created_at, updated_at, legacy_catalog_product_id
)
select purchase_type, canonical_name, brand, product_reference_url, category_id,
  status, created_by, created_at, updated_at, id
from public.catalog_products;

alter table public.catalog_products
  add column standard_product_id uuid references public.standard_products(id) on delete cascade;

update public.catalog_products as variant
set standard_product_id = standard_product.id
from public.standard_products as standard_product
where standard_product.legacy_catalog_product_id = variant.id;

alter table public.catalog_products
  alter column standard_product_id set not null;

alter table public.catalog_products
  rename column product_reference_url to listing_reference_url;

-- A variant is the actual package on the receipt or marketplace listing.
-- Existing rows without a checked package stay readable but are excluded from
-- unit-price ranking until an administrator fills in the package fields.

create index catalog_products_standard_product_idx
  on public.catalog_products(standard_product_id, status);

alter table public.standard_products
  drop column legacy_catalog_product_id;

alter table public.standard_products enable row level security;
grant select on public.standard_products to authenticated;
grant insert, update, delete on public.standard_products to authenticated;

create policy "standard products readable by signed in users"
  on public.standard_products for select to authenticated using (true);
create policy "admins manage standard products"
  on public.standard_products for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
