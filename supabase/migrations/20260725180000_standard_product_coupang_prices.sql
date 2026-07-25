-- A Coupang price belongs to the standard product as a whole (the family
-- of sub-items share one common online reference price), not to any single
-- catalog_product variant/spec.
create table public.standard_product_coupang_prices (
  id uuid primary key default gen_random_uuid(),
  standard_product_id uuid not null references public.standard_products(id) on delete cascade,
  product_url text not null check (product_url ~ '^https?://'),
  listed_price_krw integer not null check (listed_price_krw >= 0),
  quantity integer not null default 1 check (quantity > 0),
  observed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index standard_product_coupang_prices_standard_idx
  on public.standard_product_coupang_prices(standard_product_id, observed_at desc);

alter table public.standard_product_coupang_prices enable row level security;
grant select on public.standard_product_coupang_prices to authenticated;
grant insert, update, delete on public.standard_product_coupang_prices to authenticated;

create policy "coupang prices readable by signed in users"
  on public.standard_product_coupang_prices for select to authenticated using (true);

create policy "admins manage coupang prices"
  on public.standard_product_coupang_prices for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
