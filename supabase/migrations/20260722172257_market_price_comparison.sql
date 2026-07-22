-- A catalog product is an exact purchasable variant.  Receipt JSON remains
-- immutable; its store item is linked to this verified specification instead.
alter table public.catalog_products
  add column content_amount numeric(12,3),
  add column content_unit text,
  add column package_count integer not null default 1 check (package_count > 0),
  add column product_reference_url text;

alter table public.catalog_products
  add constraint catalog_products_content_specification_check check (
    (content_amount is null and content_unit is null)
    or (
      content_amount is not null
      and content_amount > 0
      and content_unit in ('g', 'ml', 'each')
      and product_reference_url is not null
      and product_reference_url ~ '^https?://'
    )
  );

alter table public.catalog_products
  add constraint catalog_products_reference_url_check check (
    product_reference_url is null or product_reference_url ~ '^https?://'
  );

-- These are manually verified market observations, not claims about the
-- entire market.  Delivery is kept separate so the effective checkout amount
-- can be derived rather than edited as another source of truth.
create table public.market_price_observations (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null references public.catalog_products(id) on delete cascade,
  seller_name text not null check (length(trim(seller_name)) > 0),
  product_url text not null check (product_url ~ '^https?://'),
  listed_price_krw integer not null check (listed_price_krw >= 0),
  shipping_fee_krw integer not null default 0 check (shipping_fee_krw >= 0),
  minimum_order_quantity integer not null default 1 check (minimum_order_quantity > 0),
  observed_at timestamptz not null,
  verification_status text not null default 'verified' check (verification_status in ('pending', 'verified', 'rejected')),
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index market_price_observations_catalog_verified_idx
  on public.market_price_observations(catalog_product_id, observed_at desc)
  where verification_status = 'verified';

alter table public.market_price_observations enable row level security;
grant select on public.market_price_observations to authenticated;
grant insert, update, delete on public.market_price_observations to authenticated;

create policy "verified market observations readable by signed in users"
  on public.market_price_observations for select to authenticated
  using (verification_status = 'verified' or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins manage market observations"
  on public.market_price_observations for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
