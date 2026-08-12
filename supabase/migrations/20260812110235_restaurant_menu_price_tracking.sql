-- Restaurant and menu identity is shared catalog data. Price observations are
-- derived only from an existing PriceTrace database receipt chain. Raw receipt
-- values are checked by the server and are never accepted from the browser.

alter table public.catalog_products
  drop constraint catalog_products_content_specification_check;

alter table public.catalog_products
  add constraint catalog_products_content_specification_check check (
    (content_amount is null and content_unit is null)
    or (
      content_amount is not null
      and content_amount > 0
      and content_unit in ('g', 'ml', 'each')
      and (
        (
          listing_reference_url is not null
          and listing_reference_url ~ '^https?://'
        )
        or (
          purchase_type = 'menu_item'
          and specification_status = 'placeholder'
        )
      )
    )
  );

comment on constraint catalog_products_content_specification_check
  on public.catalog_products is
  'Retail specifications require a reference URL. A menu_item placeholder keeps the existing 1 each sentinel until serving weight is verified.';

alter table public.price_observations
  add constraint price_observations_user_id_id_key unique (user_id, id);

-- A receipt may not print a merchant SKU. Preserve that absence as NULL
-- instead of inventing an identity from a name or receipt line ID.
alter table public.store_products
  drop constraint store_products_store_product_code_check,
  drop constraint store_products_user_id_store_id_store_product_code_key,
  alter column store_product_code drop not null;

alter table public.store_products
  add constraint store_products_store_product_code_check check (
    store_product_code is null or length(btrim(store_product_code)) > 0
  );

create unique index store_products_exact_source_code_key
  on public.store_products(user_id, store_id, store_product_code)
  where store_product_code is not null;

comment on column public.store_products.store_product_code is
  'Exact merchant SKU when printed by the source. NULL means unavailable and must not be replaced by a name or synthetic code.';

alter table public.stores
  add column merchant_name text,
  add column branch_name text,
  add column business_kind text not null default 'unknown'
    check (business_kind in (
      'retail', 'food_service', 'transport', 'accommodation', 'healthcare',
      'professional_service', 'utility', 'government', 'financial',
      'marketplace', 'other', 'unknown'
    ));

update public.stores
set merchant_name = name
where merchant_name is null;

alter table public.stores
  add constraint stores_merchant_name_check
  check (merchant_name is null or length(btrim(merchant_name)) > 0);

comment on column public.stores.merchant_name is
  'Merchant or restaurant Brand name without an optional branch suffix.';
comment on column public.stores.branch_name is
  'Optional source branch label, kept separate from merchant identity.';

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null check (length(btrim(canonical_name)) > 0),
  brand_id uuid references public.brands(id) on delete restrict,
  legal_name text check (legal_name is null or length(btrim(legal_name)) > 0),
  cuisine_type text check (cuisine_type is null or length(btrim(cuisine_type)) > 0),
  official_site_url text check (official_site_url is null or official_site_url ~ '^https?://'),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'verified', 'rejected')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (review_status = 'verified' and reviewed_by is not null and reviewed_at is not null)
    or review_status <> 'verified'
  )
);

comment on table public.restaurants is
  'Canonical restaurant profiles. Names and optional retail brand associations are display metadata, not source identity.';

create table public.restaurant_locations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  source_namespace text not null check (length(btrim(source_namespace)) > 0),
  source_location_code text not null check (length(btrim(source_location_code)) > 0),
  location_label text check (location_label is null or length(btrim(location_label)) > 0),
  official_url text check (official_url is null or official_url ~ '^https?://'),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'verified', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_namespace, source_location_code),
  unique (restaurant_id, id),
  check (
    (review_status = 'verified' and reviewed_by is not null and reviewed_at is not null)
    or review_status <> 'verified'
  )
);

comment on table public.restaurant_locations is
  'Exact restaurant or branch identity from a verified source namespace and location code.';

create table public.restaurant_menus (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  catalog_product_id uuid not null unique references public.catalog_products(id) on delete restrict,
  canonical_name text not null check (length(btrim(canonical_name)) > 0),
  category_label text check (category_label is null or length(btrim(category_label)) > 0),
  serving_label text not null default '1회 제공' check (length(btrim(serving_label)) > 0),
  official_url text check (official_url is null or official_url ~ '^https?://'),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'verified', 'rejected')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, id),
  check (
    (review_status = 'verified' and reviewed_by is not null and reviewed_at is not null)
    or review_status <> 'verified'
  )
);

comment on table public.restaurant_menus is
  'A restaurant-owned exact menu identity. catalog_product_id is the PriceTrace key used by Fitness Nutrition links.';

create table public.restaurant_menu_source_mappings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  restaurant_location_id uuid not null,
  restaurant_menu_id uuid not null,
  source_product_code_namespace text not null
    check (length(btrim(source_product_code_namespace)) > 0),
  source_product_code text not null check (length(btrim(source_product_code)) > 0),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'verified', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict,
  unique (
    restaurant_location_id,
    source_product_code_namespace,
    source_product_code
  ),
  unique (restaurant_id, id),
  unique (restaurant_id, restaurant_location_id, restaurant_menu_id, id),
  check (
    (review_status = 'verified' and reviewed_by is not null and reviewed_at is not null)
    or review_status <> 'verified'
  )
);

comment on table public.restaurant_menu_source_mappings is
  'Optional exact POS or seller code mapping. A mapping is not created when the source receipt has no real product code.';

create table public.restaurant_menu_receipt_observations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  restaurant_location_id uuid not null,
  restaurant_menu_id uuid not null,
  source_menu_mapping_id uuid,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  price_observation_id uuid not null,
  receipt_id uuid not null,
  receipt_item_id text not null,
  observed_on date not null,
  time_precision text not null default 'date' check (time_precision = 'date'),
  unit_price_krw integer not null check (unit_price_krw >= 0),
  quantity integer not null check (quantity > 0),
  total_price_krw integer not null
    check (total_price_krw = unit_price_krw * quantity),
  source_type text not null default 'database_receipt' check (source_type = 'database_receipt'),
  evidence_snapshot jsonb not null,
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  verification_status text not null default 'verified' check (verification_status = 'verified'),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict,
  foreign key (
    restaurant_id,
    restaurant_location_id,
    restaurant_menu_id,
    source_menu_mapping_id
  ) references public.restaurant_menu_source_mappings(
    restaurant_id,
    restaurant_location_id,
    restaurant_menu_id,
    id
  ) on delete restrict,
  foreign key (owner_user_id, price_observation_id)
    references public.price_observations(user_id, id) on delete restrict,
  foreign key (owner_user_id, receipt_id)
    references public.receipts(user_id, id) on delete restrict,
  foreign key (owner_user_id, receipt_item_id)
    references public.receipt_items(user_id, id) on delete restrict,
  unique (price_observation_id),
  unique (owner_user_id, receipt_id, receipt_item_id),
  unique (evidence_fingerprint)
);

comment on table public.restaurant_menu_receipt_observations is
  'Append-only projection of an existing database receipt observation. Price, quantity, date, store, product, and receipt chain are server-verified.';

create table public.restaurant_menu_registration_executions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 1 and 200),
  request_payload jsonb not null,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  restaurant_location_id uuid not null,
  restaurant_menu_id uuid not null,
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  receipt_observation_id uuid not null unique
    references public.restaurant_menu_receipt_observations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict
);

comment on table public.restaurant_menu_registration_executions is
  'Append-only, idempotent audit record for an admin registration from an existing PriceTrace database receipt observation.';

create index restaurants_brand_idx on public.restaurants(brand_id, status, review_status);
create index restaurant_locations_restaurant_idx
  on public.restaurant_locations(restaurant_id, review_status, id);
create index restaurant_menus_restaurant_idx
  on public.restaurant_menus(restaurant_id, status, review_status, canonical_name, id);
create index restaurant_menu_source_menu_idx
  on public.restaurant_menu_source_mappings(restaurant_menu_id, review_status, id);
create index restaurant_menu_receipts_menu_idx
  on public.restaurant_menu_receipt_observations(
    restaurant_menu_id,
    observed_on desc,
    id desc
  );
create index restaurant_menu_receipts_location_idx
  on public.restaurant_menu_receipt_observations(
    restaurant_location_id,
    observed_on desc,
    id desc
  );
create index restaurant_menu_receipts_owner_idx
  on public.restaurant_menu_receipt_observations(owner_user_id, created_at desc);
create index restaurant_menu_receipts_receipt_item_idx
  on public.restaurant_menu_receipt_observations(owner_user_id, receipt_item_id);
create index restaurant_menu_executions_target_idx
  on public.restaurant_menu_registration_executions(
    restaurant_id,
    restaurant_location_id,
    restaurant_menu_id
  );
create index restaurant_menu_executions_menu_idx
  on public.restaurant_menu_registration_executions(restaurant_id, restaurant_menu_id);
create index restaurant_menu_executions_catalog_idx
  on public.restaurant_menu_registration_executions(catalog_product_id);

create function public.validate_restaurant_menu_catalog_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.catalog_products as catalog
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where catalog.id = new.catalog_product_id
      and catalog.purchase_type = 'menu_item'
      and standard.purchase_type = 'menu_item'
  )
  then
    raise exception 'Restaurant menus require an exact menu_item catalog and standard identity.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_restaurant_menu_catalog_identity
before insert or update of catalog_product_id
on public.restaurant_menus
for each row execute function public.validate_restaurant_menu_catalog_identity();

revoke all on function public.validate_restaurant_menu_catalog_identity()
  from public, anon, authenticated;

create function public.reject_restaurant_menu_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Restaurant menu receipt observations and executions are append-only.'
    using errcode = '55000';
end;
$$;

create trigger restaurant_menu_receipt_observations_append_only
before update or delete on public.restaurant_menu_receipt_observations
for each row execute function public.reject_restaurant_menu_append_only_mutation();

create trigger restaurant_menu_registration_executions_append_only
before update or delete on public.restaurant_menu_registration_executions
for each row execute function public.reject_restaurant_menu_append_only_mutation();

revoke all on function public.reject_restaurant_menu_append_only_mutation()
  from public, anon, authenticated;

alter table public.restaurants enable row level security;
alter table public.restaurant_locations enable row level security;
alter table public.restaurant_menus enable row level security;
alter table public.restaurant_menu_source_mappings enable row level security;
alter table public.restaurant_menu_receipt_observations enable row level security;
alter table public.restaurant_menu_registration_executions enable row level security;

revoke all on public.restaurants,
  public.restaurant_locations,
  public.restaurant_menus,
  public.restaurant_menu_source_mappings,
  public.restaurant_menu_receipt_observations,
  public.restaurant_menu_registration_executions
from public, anon, authenticated;

grant select on public.restaurants,
  public.restaurant_locations,
  public.restaurant_menus,
  public.restaurant_menu_source_mappings,
  public.restaurant_menu_receipt_observations,
  public.restaurant_menu_registration_executions
to authenticated;

create policy "admins read restaurants"
  on public.restaurants for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admins read restaurant locations"
  on public.restaurant_locations for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admins read restaurant menus"
  on public.restaurant_menus for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admins read restaurant menu mappings"
  on public.restaurant_menu_source_mappings for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admins read restaurant menu receipt observations"
  on public.restaurant_menu_receipt_observations for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
create policy "admins read restaurant menu executions"
  on public.restaurant_menu_registration_executions for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop function if exists public.get_restaurant_menu_read_v1(uuid, uuid, text, integer);

create function public.get_restaurant_menu_read_v1(
  p_restaurant_id uuid default null,
  p_catalog_product_id uuid default null,
  p_query text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with eligible_menus as (
    select
      restaurant.id as restaurant_id,
      restaurant.canonical_name as restaurant_name,
      restaurant.legal_name,
      restaurant.cuisine_type,
      restaurant.official_site_url,
      restaurant.updated_at as restaurant_updated_at,
      restaurant.brand_id,
      menu.id as restaurant_menu_id,
      menu.catalog_product_id,
      catalog.standard_product_id,
      menu.canonical_name as menu_name,
      menu.category_label,
      menu.serving_label,
      menu.official_url as menu_official_url,
      menu.updated_at as menu_updated_at
    from public.restaurant_menus as menu
    inner join public.restaurants as restaurant
      on restaurant.id = menu.restaurant_id
    inner join public.catalog_products as catalog
      on catalog.id = menu.catalog_product_id
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where restaurant.status = 'active'
      and restaurant.review_status = 'verified'
      and menu.status = 'active'
      and menu.review_status = 'verified'
      and catalog.status = 'active'
      and catalog.purchase_type = 'menu_item'
      and standard.status = 'active'
      and standard.purchase_type = 'menu_item'
      and (p_restaurant_id is null or restaurant.id = p_restaurant_id)
      and (p_catalog_product_id is null or menu.catalog_product_id = p_catalog_product_id)
      and (
        nullif(btrim(p_query), '') is null
        or restaurant.canonical_name ilike '%' || btrim(p_query) || '%'
        or coalesce(restaurant.legal_name, '') ilike '%' || btrim(p_query) || '%'
        or menu.canonical_name ilike '%' || btrim(p_query) || '%'
        or coalesce(menu.category_label, '') ilike '%' || btrim(p_query) || '%'
        or exists (
          select 1
          from public.restaurant_locations as search_location
          where search_location.restaurant_id = restaurant.id
            and search_location.review_status = 'verified'
            and coalesce(search_location.location_label, '') ilike '%' || btrim(p_query) || '%'
        )
      )
    order by restaurant.canonical_name, menu.canonical_name, menu.id
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  ),
  eligible_restaurants as (
    select distinct menu.restaurant_id
    from eligible_menus as menu
  ),
  location_documents as (
    select
      location.restaurant_id,
      jsonb_agg(
        jsonb_build_object(
          'id', location.id,
          'sourceLabel', location.source_namespace,
          'sourceRestaurantCode', location.source_location_code,
          'locationLabel', location.location_label,
          'sourceUrl', location.official_url
        )
        order by location.location_label nulls last, location.id
      ) as documents
    from public.restaurant_locations as location
    inner join eligible_restaurants as eligible
      on eligible.restaurant_id = location.restaurant_id
    where location.review_status = 'verified'
    group by location.restaurant_id
  ),
  observation_documents as (
    select
      observation.restaurant_menu_id,
      jsonb_agg(
        jsonb_build_object(
          'id', observation.id,
          'restaurantSourceId', location.id,
          'locationLabel', location.location_label,
          'unitPriceKrw', observation.unit_price_krw,
          'quantity', observation.quantity,
          'totalPriceKrw', observation.total_price_krw,
          'observedAt', (observation.observed_on::text || 'T00:00:00+00:00'),
          'sourceType', 'database_receipt',
          'receiptReference', null,
          'sourceUrl', null,
          'verifiedAt', observation.verified_at
        )
        order by observation.observed_on desc, observation.created_at desc, observation.id desc
      ) as documents
    from public.restaurant_menu_receipt_observations as observation
    inner join eligible_menus as menu
      on menu.restaurant_menu_id = observation.restaurant_menu_id
      and menu.restaurant_id = observation.restaurant_id
    inner join public.restaurant_locations as location
      on location.id = observation.restaurant_location_id
      and location.restaurant_id = observation.restaurant_id
      and location.review_status = 'verified'
    where observation.verification_status = 'verified'
    group by observation.restaurant_menu_id
  ),
  base_menu_documents as (
    select
      menu.restaurant_id,
      menu.restaurant_menu_id,
      jsonb_build_object(
        'id', menu.restaurant_menu_id,
        'catalogProductId', menu.catalog_product_id,
        'standardProductId', menu.standard_product_id,
        'name', menu.menu_name,
        'categoryLabel', menu.category_label,
        'servingLabel', menu.serving_label,
        'officialUrl', menu.menu_official_url,
        'updatedAt', menu.menu_updated_at,
        'observations', coalesce(observation.documents, '[]'::jsonb)
      ) as document
    from eligible_menus as menu
    left join observation_documents as observation
      on observation.restaurant_menu_id = menu.restaurant_menu_id
  ),
  menu_documents as (
    select
      menu.restaurant_id,
      menu.restaurant_menu_id,
      jsonb_set(
        menu.document,
        '{revision}',
        to_jsonb(
          'sha256:' || encode(
            extensions.digest(pg_catalog.convert_to(menu.document::text, 'UTF8'), 'sha256'),
            'hex'
          )
        ),
        true
      ) as document
    from base_menu_documents as menu
  ),
  menus_by_restaurant as (
    select
      menu.restaurant_id,
      jsonb_agg(menu.document order by menu.restaurant_menu_id) as documents
    from menu_documents as menu
    group by menu.restaurant_id
  ),
  restaurant_rows as (
    select distinct on (menu.restaurant_id)
      menu.restaurant_id,
      menu.restaurant_name,
      menu.legal_name,
      menu.cuisine_type,
      menu.official_site_url,
      menu.restaurant_updated_at,
      menu.brand_id
    from eligible_menus as menu
    order by menu.restaurant_id, menu.restaurant_menu_id
  ),
  base_restaurant_documents as (
    select
      restaurant.restaurant_id,
      jsonb_build_object(
        'restaurant', jsonb_build_object(
          'id', restaurant.restaurant_id,
          'brandId', restaurant.brand_id,
          'brand', restaurant.restaurant_name,
          'legalName', restaurant.legal_name,
          'cuisineType', restaurant.cuisine_type,
          'officialSiteUrl', restaurant.official_site_url,
          'updatedAt', restaurant.restaurant_updated_at
        ),
        'locations', coalesce(location.documents, '[]'::jsonb),
        'menus', menu.documents
      ) as document
    from restaurant_rows as restaurant
    inner join menus_by_restaurant as menu
      on menu.restaurant_id = restaurant.restaurant_id
    left join location_documents as location
      on location.restaurant_id = restaurant.restaurant_id
  ),
  restaurant_documents as (
    select
      restaurant.restaurant_id,
      jsonb_set(
        restaurant.document,
        '{revision}',
        to_jsonb(
          'sha256:' || encode(
            extensions.digest(pg_catalog.convert_to(restaurant.document::text, 'UTF8'), 'sha256'),
            'hex'
          )
        ),
        true
      ) as document
    from base_restaurant_documents as restaurant
  ),
  restaurant_array as (
    select coalesce(
      jsonb_agg(restaurant.document order by restaurant.restaurant_id),
      '[]'::jsonb
    ) as documents
    from restaurant_documents as restaurant
  )
  select jsonb_build_object(
    'schemaVersion', 'restaurant-menu-read.v1',
    'namespace', 'pricetrace',
    'revision',
      'sha256:' || encode(
        extensions.digest(
          pg_catalog.convert_to(restaurant_array.documents::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
    'restaurants', restaurant_array.documents
  )
  from restaurant_array;
$function$;

comment on function public.get_restaurant_menu_read_v1(uuid, uuid, text, integer) is
  'restaurant-menu-read.v1: verified restaurant display data, exact menu catalog IDs, non-PII locations, and server-verified receipt prices. Raw evidence is excluded.';

revoke all on function public.get_restaurant_menu_read_v1(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_menu_read_v1(uuid, uuid, text, integer) to anon;
grant execute on function public.get_restaurant_menu_read_v1(uuid, uuid, text, integer) to authenticated;

create function public.get_admin_restaurant_menu_receipt_candidates_v1()
returns table (
  price_observation_id uuid,
  store_id uuid,
  store_name text,
  location_label text,
  store_product_id uuid,
  store_product_code text,
  product_name text,
  receipt_id uuid,
  receipt_item_id text,
  observed_on date,
  unit_price_krw integer,
  quantity integer,
  total_price_krw integer
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  return query
  select
    observation.id,
    store.id,
    coalesce(store.merchant_name, store.name),
    store.branch_name,
    store_product.id,
    store_product.store_product_code,
    product.name,
    receipt.id,
    item.id,
    observation.observed_at,
    item.unit_price_krw,
    item.purchased_quantity,
    item.total_price_krw
  from public.price_observations as observation
  inner join public.receipt_items as item
    on item.user_id = observation.user_id
    and item.id = observation.receipt_item_id
    and item.store_product_id = observation.store_product_id
  inner join public.receipts as receipt
    on receipt.user_id = item.user_id
    and receipt.id = item.receipt_id
  inner join public.store_products as store_product
    on store_product.user_id = item.user_id
    and store_product.id = item.store_product_id
    and store_product.store_id = receipt.store_id
  inner join public.stores as store
    on store.user_id = receipt.user_id
    and store.id = receipt.store_id
  inner join public.products as product
    on product.user_id = store_product.user_id
    and product.id = store_product.product_id
  where store.business_kind = 'food_service'
    and product.purchase_type = 'menu_item'
    and observation.verification_status = 'verified'
    and observation.verified_at is not null
    and observation.observed_at = receipt.purchased_at
    and observation.unit_price_krw = item.unit_price_krw
    and observation.quantity = item.purchased_quantity
    and item.total_price_krw = item.unit_price_krw * item.purchased_quantity
    and not exists (
      select 1
      from public.restaurant_menu_receipt_observations as registered
      where registered.price_observation_id = observation.id
    )
  order by observation.observed_at desc, store.name, product.name, observation.id;
end;
$function$;

comment on function public.get_admin_restaurant_menu_receipt_candidates_v1() is
  'Admin-only candidates backed by a complete menu_item database receipt chain and not yet registered as a restaurant menu observation.';

revoke all on function public.get_admin_restaurant_menu_receipt_candidates_v1()
  from public, anon, authenticated;
grant execute on function public.get_admin_restaurant_menu_receipt_candidates_v1() to authenticated;

create function public.admin_register_restaurant_menu_from_receipt_v1(
  p_idempotency_key text,
  p_price_observation_id uuid,
  p_restaurant_id uuid,
  p_restaurant_name text,
  p_restaurant_legal_name text,
  p_cuisine_type text,
  p_restaurant_official_site_url text,
  p_restaurant_source_namespace text,
  p_restaurant_source_code text,
  p_location_label text,
  p_location_official_url text,
  p_restaurant_menu_id uuid,
  p_menu_name text,
  p_menu_category_label text,
  p_serving_label text,
  p_menu_official_url text
)
returns table (
  restaurant_id uuid,
  restaurant_location_id uuid,
  restaurant_menu_id uuid,
  catalog_product_id uuid,
  receipt_observation_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_owner_user_id uuid;
  v_receipt_id uuid;
  v_receipt_item_id text;
  v_store_id uuid;
  v_store_name text;
  v_store_branch_name text;
  v_store_product_id uuid;
  v_store_product_code text;
  v_product_name text;
  v_observed_on date;
  v_unit_price_krw integer;
  v_quantity integer;
  v_total_price_krw integer;
  v_restaurant_id uuid := p_restaurant_id;
  v_restaurant_location_id uuid;
  v_source_restaurant_id uuid;
  v_restaurant_menu_id uuid := p_restaurant_menu_id;
  v_menu_restaurant_id uuid;
  v_catalog_product_id uuid;
  v_standard_product_id uuid;
  v_source_menu_mapping_id uuid;
  v_source_mapping_menu_id uuid;
  v_receipt_observation_id uuid;
  v_evidence_snapshot jsonb;
  v_evidence_fingerprint text;
  v_request jsonb;
  v_execution public.restaurant_menu_registration_executions%rowtype;
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_idempotency_key, ''))) not between 1 and 200
    or p_price_observation_id is null
    or length(btrim(coalesce(p_restaurant_name, ''))) = 0
    or length(btrim(coalesce(p_restaurant_source_namespace, ''))) = 0
    or length(btrim(coalesce(p_restaurant_source_code, ''))) = 0
    or length(btrim(coalesce(p_menu_name, ''))) = 0
    or length(btrim(coalesce(p_serving_label, ''))) = 0
  then
    raise exception 'An exact receipt observation, source identity, restaurant, and menu are required.'
      using errcode = '23514';
  end if;

  if (p_restaurant_official_site_url is not null and p_restaurant_official_site_url !~ '^https?://')
    or (p_location_official_url is not null and p_location_official_url !~ '^https?://')
    or (p_menu_official_url is not null and p_menu_official_url !~ '^https?://')
  then
    raise exception 'Restaurant and menu URLs must be HTTP(S) URLs.'
      using errcode = '23514';
  end if;

  v_request := jsonb_build_object(
    'priceObservationId', p_price_observation_id,
    'restaurantId', p_restaurant_id,
    'restaurantName', btrim(p_restaurant_name),
    'restaurantLegalName', nullif(btrim(p_restaurant_legal_name), ''),
    'cuisineType', nullif(btrim(p_cuisine_type), ''),
    'restaurantOfficialSiteUrl', nullif(btrim(p_restaurant_official_site_url), ''),
    'restaurantSourceNamespace', btrim(p_restaurant_source_namespace),
    'restaurantSourceCode', btrim(p_restaurant_source_code),
    'locationLabel', nullif(btrim(p_location_label), ''),
    'locationOfficialUrl', nullif(btrim(p_location_official_url), ''),
    'restaurantMenuId', p_restaurant_menu_id,
    'menuName', btrim(p_menu_name),
    'menuCategoryLabel', nullif(btrim(p_menu_category_label), ''),
    'servingLabel', btrim(p_serving_label),
    'menuOfficialUrl', nullif(btrim(p_menu_official_url), '')
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(btrim(p_idempotency_key), 0)
  );

  select execution.*
  into v_execution
  from public.restaurant_menu_registration_executions as execution
  where execution.idempotency_key = btrim(p_idempotency_key);

  if found
  then
    if v_execution.request_payload <> v_request
    then
      raise exception 'The idempotency key was already used for another request.'
        using errcode = '23505';
    end if;

    return query
    select
      v_execution.restaurant_id,
      v_execution.restaurant_location_id,
      v_execution.restaurant_menu_id,
      v_execution.catalog_product_id,
      v_execution.receipt_observation_id,
      true;
    return;
  end if;

  select
    observation.user_id,
    item.receipt_id,
    item.id,
    receipt.store_id,
    coalesce(store.merchant_name, store.name),
    store.branch_name,
    item.store_product_id,
    store_product.store_product_code,
    product.name,
    observation.observed_at,
    item.unit_price_krw,
    item.purchased_quantity,
    item.total_price_krw
  into
    v_owner_user_id,
    v_receipt_id,
    v_receipt_item_id,
    v_store_id,
    v_store_name,
    v_store_branch_name,
    v_store_product_id,
    v_store_product_code,
    v_product_name,
    v_observed_on,
    v_unit_price_krw,
    v_quantity,
    v_total_price_krw
  from public.price_observations as observation
  inner join public.receipt_items as item
    on item.user_id = observation.user_id
    and item.id = observation.receipt_item_id
    and item.store_product_id = observation.store_product_id
  inner join public.receipts as receipt
    on receipt.user_id = item.user_id
    and receipt.id = item.receipt_id
  inner join public.store_products as store_product
    on store_product.user_id = item.user_id
    and store_product.id = item.store_product_id
    and store_product.store_id = receipt.store_id
  inner join public.stores as store
    on store.user_id = receipt.user_id
    and store.id = receipt.store_id
  inner join public.products as product
    on product.user_id = store_product.user_id
    and product.id = store_product.product_id
  where observation.id = p_price_observation_id
    and store.business_kind = 'food_service'
    and observation.verification_status = 'verified'
    and observation.verified_at is not null
    and observation.observed_at = receipt.purchased_at
    and observation.unit_price_krw = item.unit_price_krw
    and observation.quantity = item.purchased_quantity
    and product.purchase_type = 'menu_item'
  for update of observation, item, receipt, store_product, store, product;

  if not found
  then
    raise exception 'The selected observation is not a complete menu_item database receipt chain.'
      using errcode = 'P0002';
  end if;

  if v_total_price_krw <> v_unit_price_krw * v_quantity
  then
    raise exception 'The receipt price conservation rule failed.' using errcode = '23514';
  end if;

  if btrim(v_store_name) <> btrim(p_restaurant_name)
    or btrim(v_product_name) <> btrim(p_menu_name)
  then
    raise exception 'The selected receipt store and menu names differ from the reviewed target.'
      using errcode = '23514';
  end if;

  if btrim(p_restaurant_source_namespace) <> 'pricetrace-db-store'
    or btrim(p_restaurant_source_code) <> v_store_id::text
  then
    raise exception 'The restaurant source identity must be the selected PriceTrace database store.'
      using errcode = '23514';
  end if;

  v_evidence_snapshot := jsonb_build_object(
    'schemaVersion', 'restaurant-menu-db-receipt-evidence.v1',
    'priceObservationId', p_price_observation_id,
    'ownerUserId', v_owner_user_id,
    'receiptId', v_receipt_id,
    'receiptItemId', v_receipt_item_id,
    'storeId', v_store_id,
    'storeName', v_store_name,
    'storeBranchName', v_store_branch_name,
    'storeProductId', v_store_product_id,
    'storeProductCode', v_store_product_code,
    'productName', v_product_name,
    'observedOn', v_observed_on,
    'unitPriceKrw', v_unit_price_krw,
    'quantity', v_quantity,
    'totalPriceKrw', v_total_price_krw
  );
  v_evidence_fingerprint :=
    'sha256:' || encode(
      extensions.digest(
        pg_catalog.convert_to(v_evidence_snapshot::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      btrim(p_restaurant_source_namespace) || ':' || btrim(p_restaurant_source_code),
      0
    )
  );

  select location.restaurant_id, location.id
  into v_source_restaurant_id, v_restaurant_location_id
  from public.restaurant_locations as location
  where location.source_namespace = btrim(p_restaurant_source_namespace)
    and location.source_location_code = btrim(p_restaurant_source_code)
  for update;

  if v_restaurant_id is null and v_source_restaurant_id is not null
  then
    v_restaurant_id := v_source_restaurant_id;
  end if;

  if v_restaurant_id is null
  then
    insert into public.restaurants (
      canonical_name,
      legal_name,
      cuisine_type,
      official_site_url,
      review_status,
      status,
      created_by,
      reviewed_by,
      reviewed_at
    ) values (
      btrim(p_restaurant_name),
      nullif(btrim(p_restaurant_legal_name), ''),
      nullif(btrim(p_cuisine_type), ''),
      nullif(btrim(p_restaurant_official_site_url), ''),
      'verified',
      'active',
      v_user_id,
      v_user_id,
      v_now
    ) returning id into v_restaurant_id;
  elsif not exists (
    select 1
    from public.restaurants as restaurant
    where restaurant.id = v_restaurant_id
      and restaurant.status = 'active'
      and restaurant.review_status = 'verified'
      and restaurant.canonical_name = btrim(p_restaurant_name)
  )
  then
    raise exception 'The selected restaurant identity does not match the reviewed receipt target.'
      using errcode = '23514';
  end if;

  if v_source_restaurant_id is not null and v_source_restaurant_id <> v_restaurant_id
  then
    raise exception 'The exact store source identity belongs to another restaurant.'
      using errcode = '23505';
  end if;

  if v_restaurant_location_id is null
  then
    insert into public.restaurant_locations (
      restaurant_id,
      source_namespace,
      source_location_code,
      location_label,
      official_url,
      review_status,
      created_by,
      reviewed_by,
      reviewed_at
    ) values (
      v_restaurant_id,
      btrim(p_restaurant_source_namespace),
      btrim(p_restaurant_source_code),
      coalesce(nullif(btrim(p_location_label), ''), v_store_branch_name),
      nullif(btrim(p_location_official_url), ''),
      'verified',
      v_user_id,
      v_user_id,
      v_now
    ) returning id into v_restaurant_location_id;
  end if;

  -- A prior mapping is exact source identity, not a name match. Reuse it so
  -- later receipts extend the same menu's price history without creating a
  -- second standard/catalog/menu row.
  if v_store_product_code is not null
  then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'pricetrace-db-store-product:' || v_store_product_id::text,
        0
      )
    );

    select mapping.restaurant_menu_id, mapping.id
    into v_source_mapping_menu_id, v_source_menu_mapping_id
    from public.restaurant_menu_source_mappings as mapping
    where mapping.restaurant_location_id = v_restaurant_location_id
      and mapping.source_product_code_namespace = 'pricetrace-db-store-product'
      and mapping.source_product_code = v_store_product_id::text
    for update;

    if v_source_mapping_menu_id is not null
      and v_restaurant_menu_id is not null
      and v_source_mapping_menu_id <> v_restaurant_menu_id
    then
      raise exception 'The exact store product identity belongs to another menu.'
        using errcode = '23505';
    end if;

    if v_restaurant_menu_id is null and v_source_mapping_menu_id is not null
    then
      v_restaurant_menu_id := v_source_mapping_menu_id;
    end if;
  end if;

  if v_restaurant_menu_id is not null
  then
    select menu.restaurant_id, menu.catalog_product_id
    into v_menu_restaurant_id, v_catalog_product_id
    from public.restaurant_menus as menu
    where menu.id = v_restaurant_menu_id
      and menu.status = 'active'
      and menu.review_status = 'verified'
      and menu.canonical_name = btrim(p_menu_name)
    for update;

    if not found or v_menu_restaurant_id <> v_restaurant_id
    then
      raise exception 'The selected menu identity does not match this restaurant and receipt target.'
        using errcode = '23514';
    end if;
  else
    insert into public.standard_products (
      purchase_type,
      canonical_name,
      product_reference_url,
      status,
      created_by
    ) values (
      'menu_item',
      btrim(p_menu_name),
      coalesce(
        nullif(btrim(p_menu_official_url), ''),
        nullif(btrim(p_restaurant_official_site_url), '')
      ),
      'active',
      v_user_id
    ) returning id into v_standard_product_id;

    insert into public.catalog_products (
      standard_product_id,
      purchase_type,
      canonical_name,
      specification,
      specification_status,
      content_amount,
      content_unit,
      package_count,
      reference_unit,
      listing_reference_url,
      attributes,
      status,
      created_by
    ) values (
      v_standard_product_id,
      'menu_item',
      btrim(p_menu_name),
      btrim(p_serving_label),
      'placeholder',
      1,
      'each',
      1,
      100,
      nullif(btrim(p_menu_official_url), ''),
      jsonb_build_object('restaurantId', v_restaurant_id),
      'active',
      v_user_id
    ) returning id into v_catalog_product_id;

    insert into public.restaurant_menus (
      restaurant_id,
      catalog_product_id,
      canonical_name,
      category_label,
      serving_label,
      official_url,
      review_status,
      status,
      created_by,
      reviewed_by,
      reviewed_at
    ) values (
      v_restaurant_id,
      v_catalog_product_id,
      btrim(p_menu_name),
      nullif(btrim(p_menu_category_label), ''),
      btrim(p_serving_label),
      nullif(btrim(p_menu_official_url), ''),
      'verified',
      'active',
      v_user_id,
      v_user_id,
      v_now
    ) returning id into v_restaurant_menu_id;

    update public.catalog_products
    set attributes = attributes || jsonb_build_object(
      'restaurantMenuId', v_restaurant_menu_id
    )
    where id = v_catalog_product_id;
  end if;

  if v_store_product_code is not null
    and v_source_menu_mapping_id is null
  then
    insert into public.restaurant_menu_source_mappings (
      restaurant_id,
      restaurant_location_id,
      restaurant_menu_id,
      source_product_code_namespace,
      source_product_code,
      evidence_fingerprint,
      review_status,
      created_by,
      reviewed_by,
      reviewed_at
    ) values (
      v_restaurant_id,
      v_restaurant_location_id,
      v_restaurant_menu_id,
      'pricetrace-db-store-product',
      v_store_product_id::text,
      v_evidence_fingerprint,
      'verified',
      v_user_id,
      v_user_id,
      v_now
    ) returning id into v_source_menu_mapping_id;
  end if;

  insert into public.restaurant_menu_receipt_observations (
    restaurant_id,
    restaurant_location_id,
    restaurant_menu_id,
    source_menu_mapping_id,
    owner_user_id,
    price_observation_id,
    receipt_id,
    receipt_item_id,
    observed_on,
    unit_price_krw,
    quantity,
    total_price_krw,
    evidence_snapshot,
    evidence_fingerprint,
    verified_by,
    verified_at
  ) values (
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    v_source_menu_mapping_id,
    v_owner_user_id,
    p_price_observation_id,
    v_receipt_id,
    v_receipt_item_id,
    v_observed_on,
    v_unit_price_krw,
    v_quantity,
    v_total_price_krw,
    v_evidence_snapshot,
    v_evidence_fingerprint,
    v_user_id,
    v_now
  ) returning id into v_receipt_observation_id;

  insert into public.restaurant_menu_registration_executions (
    idempotency_key,
    request_payload,
    restaurant_id,
    restaurant_location_id,
    restaurant_menu_id,
    catalog_product_id,
    receipt_observation_id,
    created_by
  ) values (
    btrim(p_idempotency_key),
    v_request,
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    v_catalog_product_id,
    v_receipt_observation_id,
    v_user_id
  );

  return query
  select
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    v_catalog_product_id,
    v_receipt_observation_id,
    false;
end;
$function$;

comment on function public.admin_register_restaurant_menu_from_receipt_v1(
  text, uuid, uuid, text, text, text, text, text, text, text, text, uuid,
  text, text, text, text
) is
  'Admin-only, idempotent registration from an existing locked PriceTrace database receipt observation. Exact source mappings are reused; browser-supplied price and receipt facts are not accepted.';

revoke all on function public.admin_register_restaurant_menu_from_receipt_v1(
  text, uuid, uuid, text, text, text, text, text, text, text, text, uuid,
  text, text, text, text
) from public, anon, authenticated;

grant execute on function public.admin_register_restaurant_menu_from_receipt_v1(
  text, uuid, uuid, text, text, text, text, text, text, text, text, uuid,
  text, text, text, text
) to authenticated;

-- product-read.v1 is the retail-product contract. Menu items have their own
-- restaurant-menu-read.v1 projection even after a serving specification is verified.
create or replace function public.get_product_read_v1(
  p_catalog_product_id uuid default null,
  p_query text default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with eligible_products as (
    select
      catalog.id as catalog_product_id,
      catalog.canonical_name as catalog_name,
      catalog.specification as specification_text,
      catalog.content_amount,
      catalog.content_unit,
      catalog.package_count,
      catalog.reference_unit,
      catalog.listing_reference_url,
      catalog.updated_at as catalog_updated_at,
      standard.id as standard_product_id,
      standard.canonical_name as standard_name,
      standard.brand,
      standard.updated_at as standard_updated_at
    from public.catalog_products as catalog
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where catalog.status = 'active'
      and standard.status = 'active'
      and catalog.purchase_type = 'retail_product'
      and standard.purchase_type = 'retail_product'
      and catalog.specification_status = 'verified'
      and catalog.content_amount is not null
      and catalog.content_amount > 0
      and catalog.content_unit in ('g', 'ml', 'each')
      and catalog.package_count > 0
      and (p_catalog_product_id is null or catalog.id = p_catalog_product_id)
      and (
        nullif(btrim(p_query), '') is null
        or standard.canonical_name ilike '%' || btrim(p_query) || '%'
        or catalog.canonical_name ilike '%' || btrim(p_query) || '%'
        or coalesce(standard.brand, '') ilike '%' || btrim(p_query) || '%'
      )
    order by standard.canonical_name, catalog.canonical_name, catalog.id
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ),
  seller_products as (
    select
      mapping.catalog_product_id,
      jsonb_agg(
        jsonb_build_object(
          'sellerLabel', mapping.source_label,
          'sourceProductCode', mapping.source_product_code
        )
        order by mapping.source_label, mapping.source_product_code
      ) as documents
    from public.source_product_mappings as mapping
    inner join eligible_products as product
      on product.catalog_product_id = mapping.catalog_product_id
    where mapping.review_status = 'verified'
    group by mapping.catalog_product_id
  ),
  latest_verified_market_observations as (
    select distinct on (observation.catalog_product_id, lower(btrim(observation.seller_name)))
      observation.id,
      observation.catalog_product_id,
      observation.seller_name,
      observation.product_url,
      observation.listed_price_krw,
      observation.shipping_fee_krw,
      observation.minimum_order_quantity,
      observation.observed_at,
      observation.created_at
    from public.market_price_observations as observation
    inner join eligible_products as product
      on product.catalog_product_id = observation.catalog_product_id
    where observation.verification_status = 'verified'
    order by observation.catalog_product_id, lower(btrim(observation.seller_name)),
      observation.observed_at desc, observation.created_at desc, observation.id desc
  ),
  market_observations as (
    select
      observation.catalog_product_id,
      jsonb_agg(
        jsonb_build_object(
          'observationId', observation.id,
          'sellerLabel', observation.seller_name,
          'listedPriceKrw', observation.listed_price_krw,
          'shippingFeeKrw', observation.shipping_fee_krw,
          'minimumOrderQuantity', observation.minimum_order_quantity,
          'checkoutPriceKrw', observation.listed_price_krw::bigint
            * observation.minimum_order_quantity::bigint
            + observation.shipping_fee_krw::bigint,
          'observedAt', observation.observed_at,
          'productUrl', observation.product_url,
          'source', 'verified-market-observation'
        )
        order by observation.observed_at desc, observation.seller_name, observation.id
      ) as documents
    from latest_verified_market_observations as observation
    group by observation.catalog_product_id
  ),
  base_product_documents as (
    select
      product.standard_product_id,
      product.catalog_product_id,
      jsonb_build_object(
        'standardProduct', jsonb_build_object(
          'id', product.standard_product_id,
          'name', product.standard_name,
          'brand', product.brand,
          'updatedAt', product.standard_updated_at
        ),
        'catalogProduct', jsonb_build_object(
          'id', product.catalog_product_id,
          'name', product.catalog_name,
          'specificationText', product.specification_text,
          'contentAmount', product.content_amount,
          'contentUnit', product.content_unit,
          'packageCount', product.package_count,
          'referenceUnit', product.reference_unit,
          'listingReferenceUrl', product.listing_reference_url,
          'updatedAt', product.catalog_updated_at
        ),
        'sellerProducts', coalesce(seller.documents, '[]'::jsonb),
        'observations', coalesce(observation.documents, '[]'::jsonb)
      ) as document
    from eligible_products as product
    left join seller_products as seller
      on seller.catalog_product_id = product.catalog_product_id
    left join market_observations as observation
      on observation.catalog_product_id = product.catalog_product_id
  ),
  product_documents as (
    select
      base.standard_product_id,
      base.catalog_product_id,
      jsonb_set(
        base.document,
        '{revision}',
        to_jsonb(
          'sha256:' || encode(
            extensions.digest(pg_catalog.convert_to(base.document::text, 'UTF8'), 'sha256'),
            'hex'
          )
        ),
        true
      ) as document
    from base_product_documents as base
  ),
  product_array as (
    select coalesce(
      jsonb_agg(product.document order by product.standard_product_id, product.catalog_product_id),
      '[]'::jsonb
    ) as documents
    from product_documents as product
  )
  select jsonb_build_object(
    'schemaVersion', 'product-read.v1',
    'namespace', 'pricetrace',
    'revision', 'sha256:' || encode(
      extensions.digest(pg_catalog.convert_to(product_array.documents::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    'products', product_array.documents
  )
  from product_array;
$function$;

revoke all on function public.get_product_read_v1(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_product_read_v1(uuid, text, integer) to anon;
grant execute on function public.get_product_read_v1(uuid, text, integer) to authenticated;
