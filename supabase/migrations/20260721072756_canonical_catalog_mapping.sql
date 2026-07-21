-- Shared canonical products are separate from user-owned, store-specific products.
create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  purchase_type text not null check (purchase_type in ('retail_product', 'menu_item', 'raw_material', 'property', 'service')),
  canonical_name text not null check (length(trim(canonical_name)) > 0),
  brand text,
  specification text,
  category_id uuid references public.catalog_categories(id) on delete set null,
  attributes jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index catalog_products_identity_idx
  on public.catalog_products(purchase_type, canonical_name, coalesce(brand, ''), coalesce(specification, ''));
create index catalog_products_category_idx on public.catalog_products(purchase_type, category_id, status);

create table public.source_product_mappings (
  id uuid primary key default gen_random_uuid(),
  source_label text not null check (length(trim(source_label)) > 0),
  source_product_code text not null check (length(trim(source_product_code)) > 0),
  catalog_product_id uuid not null references public.catalog_products(id) on delete cascade,
  matching_method text not null default 'manual' check (matching_method in ('manual', 'barcode', 'import')),
  confidence numeric(3,2) not null default 1.00 check (confidence >= 0 and confidence <= 1),
  review_status text not null default 'verified' check (review_status in ('pending', 'verified', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_label, source_product_code)
);

create index source_product_mappings_catalog_idx on public.source_product_mappings(catalog_product_id, review_status);

alter table public.price_observations
  add column catalog_product_id uuid references public.catalog_products(id) on delete set null;
create index price_observations_catalog_product_idx
  on public.price_observations(user_id, catalog_product_id, observed_at desc)
  where catalog_product_id is not null;

alter table public.catalog_products enable row level security;
alter table public.source_product_mappings enable row level security;
grant select on public.catalog_products, public.source_product_mappings to authenticated;
grant insert, update, delete on public.catalog_products, public.source_product_mappings to authenticated;

create policy "catalog products readable by signed in users"
  on public.catalog_products for select to authenticated using (true);
create policy "admins manage catalog products"
  on public.catalog_products for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "verified source mappings readable by signed in users"
  on public.source_product_mappings for select to authenticated
  using (review_status = 'verified' or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admins manage source mappings"
  on public.source_product_mappings for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
