-- M3: user-owned relational model for receipts, price observations, and settlement.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.store_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null,
  product_id uuid not null,
  store_product_code text not null check (length(trim(store_product_code)) > 0),
  unique (user_id, id),
  unique (user_id, store_id, store_product_code),
  foreign key (user_id, store_id) references public.stores(user_id, id) on delete cascade,
  foreign key (user_id, product_id) references public.products(user_id, id) on delete cascade
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null,
  purchased_at date not null,
  transaction_number text not null,
  currency text not null default 'KRW' check (currency = 'KRW'),
  total_price_krw integer not null check (total_price_krw >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, store_id, transaction_number),
  foreign key (user_id, store_id) references public.stores(user_id, id) on delete restrict
);

create table public.receipt_items (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id uuid not null,
  store_product_id uuid not null,
  unit_price_krw integer not null check (unit_price_krw >= 0),
  purchased_quantity integer not null check (purchased_quantity > 0),
  total_price_krw integer not null check (total_price_krw = unit_price_krw * purchased_quantity),
  purchase_numbers integer[] not null check (cardinality(purchase_numbers) > 0),
  unique (user_id, id),
  foreign key (user_id, receipt_id) references public.receipts(user_id, id) on delete cascade,
  foreign key (user_id, store_product_id) references public.store_products(user_id, id) on delete restrict
);

create table public.price_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_product_id uuid not null,
  receipt_item_id text not null,
  observed_at date not null,
  unit_price_krw integer not null check (unit_price_krw >= 0),
  quantity integer not null check (quantity > 0),
  unique (user_id, receipt_item_id),
  foreign key (user_id, store_product_id) references public.store_products(user_id, id) on delete cascade,
  foreign key (user_id, receipt_item_id) references public.receipt_items(user_id, id) on delete cascade
);

create table public.recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_item_id text not null,
  recipient_id uuid not null,
  quantity integer not null check (quantity > 0),
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, receipt_item_id) references public.receipt_items(user_id, id) on delete cascade,
  foreign key (user_id, recipient_id) references public.recipients(user_id, id) on delete restrict
);

create table public.settlement_statuses (
  recipient_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivery_status text not null default '준비 중' check (delivery_status in ('준비 중', '전달 완료')),
  payment_status text not null default '미입금' check (payment_status in ('미입금', '입금 완료')),
  paid_at timestamptz,
  foreign key (user_id, recipient_id) references public.recipients(user_id, id) on delete cascade
);

create index receipts_user_purchased_at_idx on public.receipts(user_id, purchased_at desc);
create index receipt_items_user_store_product_idx on public.receipt_items(user_id, store_product_id);
create index price_observations_user_product_date_idx on public.price_observations(user_id, store_product_id, observed_at desc);
create index allocations_user_recipient_idx on public.allocations(user_id, recipient_id);

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.store_products enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.price_observations enable row level security;
alter table public.recipients enable row level security;
alter table public.allocations enable row level security;
alter table public.settlement_statuses enable row level security;

grant select, insert, update, delete on all tables in schema public to authenticated;

create policy "profiles own rows" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "stores own rows" on public.stores for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "products own rows" on public.products for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "store products own rows" on public.store_products for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "receipts own rows" on public.receipts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "receipt items own rows" on public.receipt_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "price observations own rows" on public.price_observations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "recipients own rows" on public.recipients for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "allocations own rows" on public.allocations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "settlement statuses own rows" on public.settlement_statuses for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
