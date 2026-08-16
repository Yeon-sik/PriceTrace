-- Admin-only manual registration for data that has no receipt evidence.
-- These rows are deliberately marked unverified and are excluded from the
-- existing verified public projections until a separate review promotes them.

alter table public.standard_products
  add column verification_status text not null default 'verified'
    check (verification_status in ('verified', 'unverified'));

alter table public.catalog_products
  add column verification_status text not null default 'verified'
    check (verification_status in ('verified', 'unverified'));

alter table public.source_product_mappings
  add column verification_status text not null default 'verified'
    check (verification_status in ('verified', 'unverified'));

alter table public.market_price_observations
  drop constraint if exists market_price_observations_verification_status_check;

alter table public.market_price_observations
  add constraint market_price_observations_verification_status_check
    check (verification_status in ('pending', 'verified', 'unverified', 'rejected')),
  add column source_product_code text,
  add constraint market_price_observations_source_product_code_check
    check (source_product_code is null or length(btrim(source_product_code)) > 0);

alter table public.restaurants
  add column verification_status text not null default 'verified'
    check (verification_status in ('verified', 'unverified'));

alter table public.restaurant_locations
  add column verification_status text not null default 'verified'
    check (verification_status in ('verified', 'unverified'));

alter table public.restaurant_menus
  add column verification_status text not null default 'verified'
    check (verification_status in ('verified', 'unverified'));

alter table public.restaurant_menu_source_mappings
  add column verification_status text not null default 'verified'
    check (verification_status in ('verified', 'unverified'));

alter table public.source_product_mappings
  add constraint source_product_mappings_unverified_review_check
  check (verification_status = 'verified' or review_status <> 'verified');

alter table public.restaurants
  add constraint restaurants_unverified_review_check
  check (verification_status = 'verified' or review_status <> 'verified');

alter table public.restaurant_locations
  add constraint restaurant_locations_unverified_review_check
  check (verification_status = 'verified' or review_status <> 'verified');

alter table public.restaurant_menus
  add constraint restaurant_menus_unverified_review_check
  check (verification_status = 'verified' or review_status <> 'verified');

alter table public.restaurant_menu_source_mappings
  add constraint restaurant_menu_source_mappings_unverified_review_check
  check (verification_status = 'verified' or review_status <> 'verified');

comment on column public.standard_products.verification_status is
  'Evidence status for the standard product identity. Admin manual registration starts as unverified.';
comment on column public.catalog_products.verification_status is
  'Evidence status for the exact sellable variant. Admin manual registration starts as unverified.';
comment on column public.market_price_observations.verification_status is
  'Receipt or source verification status. Manual admin observations are always unverified at creation.';
comment on column public.restaurants.verification_status is
  'Evidence status for the restaurant identity. Admin manual registration starts as unverified.';
comment on column public.restaurant_menus.verification_status is
  'Evidence status for the exact menu identity. Admin manual registration starts as unverified.';

create index market_price_observations_unverified_idx
  on public.market_price_observations(catalog_product_id, observed_at desc)
  where verification_status = 'unverified';

create table public.restaurant_menu_manual_observations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  restaurant_location_id uuid not null,
  restaurant_menu_id uuid not null,
  observed_on date not null,
  unit_price_krw integer not null check (unit_price_krw >= 0),
  quantity integer not null check (quantity > 0),
  total_price_krw integer not null
    check (total_price_krw = unit_price_krw * quantity),
  source_url text check (source_url is null or source_url ~ '^https?://'),
  note text,
  source_snapshot jsonb not null,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'rejected')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict
);

create index restaurant_menu_manual_observations_menu_idx
  on public.restaurant_menu_manual_observations(restaurant_menu_id, observed_on desc, id desc);

create table public.admin_unverified_product_sale_registrations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 1 and 200),
  request_payload jsonb not null,
  standard_product_id uuid not null references public.standard_products(id) on delete restrict,
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  market_price_observation_id uuid not null unique
    references public.market_price_observations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.restaurant_menu_manual_registration_executions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 1 and 200),
  request_payload jsonb not null,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  restaurant_location_id uuid not null,
  restaurant_menu_id uuid not null,
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  manual_observation_id uuid not null unique
    references public.restaurant_menu_manual_observations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict
);

alter table public.restaurant_menu_manual_observations enable row level security;
alter table public.admin_unverified_product_sale_registrations enable row level security;
alter table public.restaurant_menu_manual_registration_executions enable row level security;

revoke all on public.restaurant_menu_manual_observations,
  public.admin_unverified_product_sale_registrations,
  public.restaurant_menu_manual_registration_executions
from public, anon, authenticated;

grant select on public.restaurant_menu_manual_observations,
  public.admin_unverified_product_sale_registrations,
  public.restaurant_menu_manual_registration_executions
to authenticated;

create policy "admins read unverified restaurant menu observations"
  on public.restaurant_menu_manual_observations for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins read unverified product registrations"
  on public.admin_unverified_product_sale_registrations for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins read unverified restaurant menu registrations"
  on public.restaurant_menu_manual_registration_executions for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "standard products readable by signed in users"
  on public.standard_products;
create policy "verified standard products readable by signed in users"
  on public.standard_products for select to authenticated
  using (
    verification_status = 'verified'
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "catalog products readable by signed in users"
  on public.catalog_products;
create policy "verified catalog products readable by signed in users"
  on public.catalog_products for select to authenticated
  using (
    verification_status = 'verified'
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "verified source mappings readable by signed in users"
  on public.source_product_mappings;
create policy "verified source mappings readable by signed in users"
  on public.source_product_mappings for select to authenticated
  using (
    (review_status = 'verified' and verification_status = 'verified')
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create function public.reject_unverified_manual_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Manual unverified observations and registration executions are append-only.'
    using errcode = '55000';
end;
$function$;

create trigger restaurant_menu_manual_observations_append_only
before update or delete on public.restaurant_menu_manual_observations
for each row execute function public.reject_unverified_manual_mutation();

create trigger restaurant_menu_manual_registration_executions_append_only
before update or delete on public.restaurant_menu_manual_registration_executions
for each row execute function public.reject_unverified_manual_mutation();

revoke all on function public.reject_unverified_manual_mutation()
  from public, anon, authenticated;

create or replace function public.admin_register_unverified_product_sale_v1(
  p_idempotency_key text,
  p_catalog_product_id uuid,
  p_standard_name text,
  p_brand_name text,
  p_listing_name text,
  p_specification text,
  p_content_amount numeric,
  p_content_unit text,
  p_package_count integer,
  p_reference_unit integer,
  p_listing_reference_url text,
  p_seller_name text,
  p_source_product_code text,
  p_product_url text,
  p_listed_price_krw integer,
  p_shipping_fee_krw integer,
  p_minimum_order_quantity integer,
  p_observed_at timestamptz
)
returns table (
  standard_product_id uuid,
  catalog_product_id uuid,
  market_price_observation_id uuid,
  verification_status text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_standard_product_id uuid;
  v_catalog_product_id uuid := p_catalog_product_id;
  v_market_price_observation_id uuid;
  v_request jsonb;
  v_execution public.admin_unverified_product_sale_registrations%rowtype;
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_idempotency_key, ''))) not between 1 and 200
    or length(btrim(coalesce(p_seller_name, ''))) = 0
    or p_product_url is null
    or p_product_url !~ '^https?://'
    or p_listed_price_krw is null
    or p_listed_price_krw < 0
    or p_shipping_fee_krw is null
    or p_shipping_fee_krw < 0
    or p_minimum_order_quantity is null
    or p_minimum_order_quantity < 1
    or p_observed_at is null
  then
    raise exception '판매처, URL, 가격, 수량, 관측 시점은 필수입니다.'
      using errcode = '23514';
  end if;

  if p_source_product_code is not null
    and length(btrim(p_source_product_code)) = 0
  then
    raise exception '판매처 상품 코드는 비어 있을 수 없습니다.' using errcode = '23514';
  end if;

  if p_listing_reference_url is not null
    and p_listing_reference_url !~ '^https?://'
  then
    raise exception '상품 확인 URL은 HTTP(S) 주소여야 합니다.' using errcode = '23514';
  end if;

  v_request := jsonb_build_object(
    'catalogProductId', p_catalog_product_id,
    'standardName', nullif(btrim(p_standard_name), ''),
    'brandName', nullif(btrim(p_brand_name), ''),
    'listingName', nullif(btrim(p_listing_name), ''),
    'specification', nullif(btrim(p_specification), ''),
    'contentAmount', p_content_amount,
    'contentUnit', p_content_unit,
    'packageCount', p_package_count,
    'referenceUnit', p_reference_unit,
    'listingReferenceUrl', nullif(btrim(p_listing_reference_url), ''),
    'sellerName', btrim(p_seller_name),
    'sourceProductCode', nullif(btrim(p_source_product_code), ''),
    'productUrl', btrim(p_product_url),
    'listedPriceKrw', p_listed_price_krw,
    'shippingFeeKrw', p_shipping_fee_krw,
    'minimumOrderQuantity', p_minimum_order_quantity,
    'observedAt', p_observed_at
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(btrim(p_idempotency_key), 0)
  );

  select execution.*
  into v_execution
  from public.admin_unverified_product_sale_registrations as execution
  where execution.idempotency_key = btrim(p_idempotency_key);

  if found then
    if v_execution.request_payload <> v_request then
      raise exception 'The idempotency key was already used for another request.'
        using errcode = '23505';
    end if;

    return query
    select
      v_execution.standard_product_id,
      v_execution.catalog_product_id,
      v_execution.market_price_observation_id,
      'unverified'::text,
      true;
    return;
  end if;

  if v_catalog_product_id is null then
    if length(btrim(coalesce(p_standard_name, ''))) = 0
      or length(btrim(coalesce(p_listing_name, ''))) = 0
      or p_content_amount is null
      or p_content_amount <= 0
      or coalesce(p_content_unit, '') not in ('g', 'ml', 'each')
      or p_package_count is null
      or p_package_count < 1
      or coalesce(p_reference_unit, 0) not in (10, 100, 1000)
      or (p_content_unit = 'each' and p_reference_unit <> 100)
      or p_listing_reference_url is null
      or p_listing_reference_url !~ '^https?://'
    then
      raise exception '새 상품은 이름, 정확한 규격, 상품 확인 URL이 필요합니다.'
        using errcode = '23514';
    end if;

    insert into public.standard_products (
      purchase_type,
      canonical_name,
      brand,
      product_reference_url,
      status,
      created_by,
      verification_status
    ) values (
      'retail_product',
      btrim(p_standard_name),
      nullif(btrim(p_brand_name), ''),
      nullif(btrim(p_listing_reference_url), ''),
      'active',
      v_user_id,
      'unverified'
    ) returning id into v_standard_product_id;

    insert into public.catalog_products (
      standard_product_id,
      purchase_type,
      canonical_name,
      brand,
      specification,
      specification_status,
      content_amount,
      content_unit,
      package_count,
      reference_unit,
      listing_reference_url,
      attributes,
      status,
      created_by,
      verification_status
    ) values (
      v_standard_product_id,
      'retail_product',
      btrim(p_listing_name),
      nullif(btrim(p_brand_name), ''),
      nullif(btrim(p_specification), ''),
      'verified',
      p_content_amount,
      p_content_unit,
      p_package_count,
      p_reference_unit,
      btrim(p_listing_reference_url),
      jsonb_build_object('registrationSource', 'admin_manual_unverified'),
      'active',
      v_user_id,
      'unverified'
    ) returning id into v_catalog_product_id;
  else
    select catalog.standard_product_id
    into v_standard_product_id
    from public.catalog_products as catalog
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where catalog.id = v_catalog_product_id
      and catalog.status = 'active'
      and standard.status = 'active'
      and catalog.purchase_type = 'retail_product'
      and standard.purchase_type = 'retail_product'
    for update;

    if not found then
      raise exception '선택한 정확한 판매 규격을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.market_price_observations (
    catalog_product_id,
    seller_name,
    source_product_code,
    product_url,
    listed_price_krw,
    shipping_fee_krw,
    minimum_order_quantity,
    observed_at,
    verification_status,
    verified_by,
    verified_at
  ) values (
    v_catalog_product_id,
    btrim(p_seller_name),
    nullif(btrim(p_source_product_code), ''),
    btrim(p_product_url),
    p_listed_price_krw,
    p_shipping_fee_krw,
    p_minimum_order_quantity,
    p_observed_at,
    'unverified',
    null,
    null
  ) returning id into v_market_price_observation_id;

  insert into public.admin_unverified_product_sale_registrations (
    idempotency_key,
    request_payload,
    standard_product_id,
    catalog_product_id,
    market_price_observation_id,
    created_by,
    created_at
  ) values (
    btrim(p_idempotency_key),
    v_request,
    v_standard_product_id,
    v_catalog_product_id,
    v_market_price_observation_id,
    v_user_id,
    v_now
  );

  return query
  select
    v_standard_product_id,
    v_catalog_product_id,
    v_market_price_observation_id,
    'unverified'::text,
    false;
end;
$function$;

comment on function public.admin_register_unverified_product_sale_v1(
  text, uuid, text, text, text, text, numeric, text, integer, integer, text,
  text, text, text, integer, integer, integer, timestamptz
) is
  'Admin-only manual product sale registration. It creates or targets an explicit exact catalog product and always writes an unverified market observation without receipt evidence.';

revoke all on function public.admin_register_unverified_product_sale_v1(
  text, uuid, text, text, text, text, numeric, text, integer, integer, text,
  text, text, text, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.admin_register_unverified_product_sale_v1(
  text, uuid, text, text, text, text, numeric, text, integer, integer, text,
  text, text, text, integer, integer, integer, timestamptz
) to authenticated;

create or replace function public.admin_register_unverified_restaurant_menu_v1(
  p_idempotency_key text,
  p_restaurant_id uuid,
  p_restaurant_name text,
  p_restaurant_legal_name text,
  p_cuisine_type text,
  p_restaurant_official_site_url text,
  p_source_namespace text,
  p_source_location_code text,
  p_location_label text,
  p_location_official_url text,
  p_restaurant_menu_id uuid,
  p_menu_name text,
  p_menu_category_label text,
  p_serving_label text,
  p_menu_official_url text,
  p_unit_price_krw integer,
  p_quantity integer,
  p_observed_on date,
  p_source_url text,
  p_note text
)
returns table (
  restaurant_id uuid,
  restaurant_location_id uuid,
  restaurant_menu_id uuid,
  catalog_product_id uuid,
  manual_observation_id uuid,
  verification_status text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_restaurant_id uuid := p_restaurant_id;
  v_restaurant_location_id uuid;
  v_source_restaurant_id uuid;
  v_restaurant_menu_id uuid := p_restaurant_menu_id;
  v_menu_restaurant_id uuid;
  v_catalog_product_id uuid;
  v_standard_product_id uuid;
  v_manual_observation_id uuid;
  v_request jsonb;
  v_execution public.restaurant_menu_manual_registration_executions%rowtype;
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_idempotency_key, ''))) not between 1 and 200
    or length(btrim(coalesce(p_restaurant_name, ''))) = 0
    or length(btrim(coalesce(p_source_namespace, ''))) = 0
    or length(btrim(coalesce(p_source_location_code, ''))) = 0
    or length(btrim(coalesce(p_menu_name, ''))) = 0
    or length(btrim(coalesce(p_serving_label, ''))) = 0
    or p_unit_price_krw is null
    or p_unit_price_krw < 0
    or p_quantity is null
    or p_quantity < 1
    or p_observed_on is null
  then
    raise exception '음식점, 지점 source identity, 메뉴, 가격, 관측일은 필수입니다.'
      using errcode = '23514';
  end if;

  if btrim(p_source_namespace) <> 'admin-manual' then
    raise exception '미인증 음식점 등록은 admin-manual source namespace만 사용할 수 있습니다.'
      using errcode = '23514';
  end if;

  if (p_restaurant_official_site_url is not null and p_restaurant_official_site_url !~ '^https?://')
    or (p_location_official_url is not null and p_location_official_url !~ '^https?://')
    or (p_menu_official_url is not null and p_menu_official_url !~ '^https?://')
    or (p_source_url is not null and p_source_url !~ '^https?://')
  then
    raise exception '음식점·메뉴 출처 URL은 HTTP(S) 주소여야 합니다.' using errcode = '23514';
  end if;

  v_request := jsonb_build_object(
    'restaurantId', p_restaurant_id,
    'restaurantName', btrim(p_restaurant_name),
    'restaurantLegalName', nullif(btrim(p_restaurant_legal_name), ''),
    'cuisineType', nullif(btrim(p_cuisine_type), ''),
    'restaurantOfficialSiteUrl', nullif(btrim(p_restaurant_official_site_url), ''),
    'sourceNamespace', btrim(p_source_namespace),
    'sourceLocationCode', btrim(p_source_location_code),
    'locationLabel', nullif(btrim(p_location_label), ''),
    'locationOfficialUrl', nullif(btrim(p_location_official_url), ''),
    'restaurantMenuId', p_restaurant_menu_id,
    'menuName', btrim(p_menu_name),
    'menuCategoryLabel', nullif(btrim(p_menu_category_label), ''),
    'servingLabel', btrim(p_serving_label),
    'menuOfficialUrl', nullif(btrim(p_menu_official_url), ''),
    'unitPriceKrw', p_unit_price_krw,
    'quantity', p_quantity,
    'observedOn', p_observed_on,
    'sourceUrl', nullif(btrim(p_source_url), ''),
    'note', nullif(btrim(p_note), '')
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(btrim(p_idempotency_key), 0)
  );

  select execution.*
  into v_execution
  from public.restaurant_menu_manual_registration_executions as execution
  where execution.idempotency_key = btrim(p_idempotency_key);

  if found then
    if v_execution.request_payload <> v_request then
      raise exception 'The idempotency key was already used for another request.'
        using errcode = '23505';
    end if;

    return query
    select
      v_execution.restaurant_id,
      v_execution.restaurant_location_id,
      v_execution.restaurant_menu_id,
      v_execution.catalog_product_id,
      v_execution.manual_observation_id,
      'unverified'::text,
      true;
    return;
  end if;

  if v_restaurant_id is not null then
    perform 1
    from public.restaurants as restaurant
    where restaurant.id = v_restaurant_id
      and restaurant.status = 'active'
    for update;
    if not found then
      raise exception '선택한 음식점을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      btrim(p_source_namespace) || ':' || btrim(p_source_location_code),
      0
    )
  );

  select location.restaurant_id, location.id
  into v_source_restaurant_id, v_restaurant_location_id
  from public.restaurant_locations as location
  where location.source_namespace = btrim(p_source_namespace)
    and location.source_location_code = btrim(p_source_location_code)
  for update;

  if v_source_restaurant_id is not null then
    if v_restaurant_id is not null and v_restaurant_id <> v_source_restaurant_id then
      raise exception '해당 지점 source identity가 다른 음식점에 이미 연결되어 있습니다.'
        using errcode = '23505';
    end if;
    v_restaurant_id := v_source_restaurant_id;
  end if;

  if v_restaurant_id is null then
    insert into public.restaurants (
      canonical_name,
      legal_name,
      cuisine_type,
      official_site_url,
      review_status,
      status,
      verification_status,
      created_by
    ) values (
      btrim(p_restaurant_name),
      nullif(btrim(p_restaurant_legal_name), ''),
      nullif(btrim(p_cuisine_type), ''),
      nullif(btrim(p_restaurant_official_site_url), ''),
      'pending',
      'active',
      'unverified',
      v_user_id
    ) returning id into v_restaurant_id;
  else
    if not exists (
      select 1
      from public.restaurants as restaurant
      where restaurant.id = v_restaurant_id
        and restaurant.canonical_name = btrim(p_restaurant_name)
    ) then
      raise exception '선택한 음식점 identity와 입력한 이름이 다릅니다.' using errcode = '23514';
    end if;
  end if;

  if v_restaurant_location_id is null then
    insert into public.restaurant_locations (
      restaurant_id,
      source_namespace,
      source_location_code,
      location_label,
      official_url,
      review_status,
      verification_status,
      created_by
    ) values (
      v_restaurant_id,
      btrim(p_source_namespace),
      btrim(p_source_location_code),
      nullif(btrim(p_location_label), ''),
      nullif(btrim(p_location_official_url), ''),
      'pending',
      'unverified',
      v_user_id
    ) returning id into v_restaurant_location_id;
  end if;

  if v_restaurant_menu_id is not null then
    select menu.restaurant_id, menu.catalog_product_id
    into v_menu_restaurant_id, v_catalog_product_id
    from public.restaurant_menus as menu
    where menu.id = v_restaurant_menu_id
      and menu.status = 'active'
      and menu.canonical_name = btrim(p_menu_name)
    for update;

    if not found or v_menu_restaurant_id <> v_restaurant_id then
      raise exception '선택한 메뉴 identity가 음식점과 일치하지 않습니다.' using errcode = '23514';
    end if;
  else
    select menu.id, menu.catalog_product_id
    into v_restaurant_menu_id, v_catalog_product_id
    from public.restaurant_menus as menu
    where menu.restaurant_id = v_restaurant_id
      and menu.status = 'active'
      and menu.canonical_name = btrim(p_menu_name)
      and menu.serving_label = btrim(p_serving_label)
    for update;

    if not found then
      insert into public.standard_products (
      purchase_type,
      canonical_name,
      product_reference_url,
      status,
      created_by,
      verification_status
    ) values (
      'menu_item',
      btrim(p_menu_name),
      coalesce(nullif(btrim(p_menu_official_url), ''), nullif(btrim(p_restaurant_official_site_url), '')),
      'active',
      v_user_id,
      'unverified'
    ) returning id into v_standard_product_id;

    insert into public.catalog_products (
      standard_product_id,
      purchase_type,
      canonical_name,
      brand,
      specification,
      specification_status,
      content_amount,
      content_unit,
      package_count,
      reference_unit,
      listing_reference_url,
      attributes,
      status,
      created_by,
      verification_status
    ) values (
      v_standard_product_id,
      'menu_item',
      btrim(p_menu_name),
      btrim(p_restaurant_name),
      btrim(p_serving_label),
      'placeholder',
      1,
      'each',
      1,
      100,
      nullif(btrim(p_menu_official_url), ''),
      jsonb_build_object('restaurantId', v_restaurant_id, 'registrationSource', 'admin_manual_unverified'),
      'active',
      v_user_id,
      'unverified'
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
      verification_status,
      created_by
    ) values (
      v_restaurant_id,
      v_catalog_product_id,
      btrim(p_menu_name),
      nullif(btrim(p_menu_category_label), ''),
      btrim(p_serving_label),
      nullif(btrim(p_menu_official_url), ''),
      'pending',
      'active',
      'unverified',
      v_user_id
    ) returning id into v_restaurant_menu_id;

      update public.catalog_products
      set attributes = attributes || jsonb_build_object('restaurantMenuId', v_restaurant_menu_id)
      where id = v_catalog_product_id;
    end if;
  end if;

  insert into public.restaurant_menu_manual_observations (
    restaurant_id,
    restaurant_location_id,
    restaurant_menu_id,
    observed_on,
    unit_price_krw,
    quantity,
    total_price_krw,
    source_url,
    note,
    source_snapshot,
    verification_status,
    created_by,
    created_at
  ) values (
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    p_observed_on,
    p_unit_price_krw,
    p_quantity,
    p_unit_price_krw * p_quantity,
    nullif(btrim(p_source_url), ''),
    nullif(btrim(p_note), ''),
    jsonb_build_object(
      'schemaVersion', 'restaurant-menu-manual-evidence.v1',
      'restaurantName', btrim(p_restaurant_name),
      'sourceNamespace', btrim(p_source_namespace),
      'sourceLocationCode', btrim(p_source_location_code),
      'menuName', btrim(p_menu_name),
      'unitPriceKrw', p_unit_price_krw,
      'quantity', p_quantity,
      'observedOn', p_observed_on,
      'sourceUrl', nullif(btrim(p_source_url), ''),
      'note', nullif(btrim(p_note), '')
    ),
    'unverified',
    v_user_id,
    v_now
  ) returning id into v_manual_observation_id;

  insert into public.restaurant_menu_manual_registration_executions (
    idempotency_key,
    request_payload,
    restaurant_id,
    restaurant_location_id,
    restaurant_menu_id,
    catalog_product_id,
    manual_observation_id,
    created_by,
    created_at
  ) values (
    btrim(p_idempotency_key),
    v_request,
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    v_catalog_product_id,
    v_manual_observation_id,
    v_user_id,
    v_now
  );

  return query
  select
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    v_catalog_product_id,
    v_manual_observation_id,
    'unverified'::text,
    false;
end;
$function$;

comment on function public.admin_register_unverified_restaurant_menu_v1(
  text, uuid, text, text, text, text, text, text, text, text, uuid, text,
  text, text, text, integer, integer, date, text, text
) is
  'Admin-only manual restaurant menu registration. It creates an explicit pending menu identity and a manual price observation that is always unverified and has no receipt foreign key.';

revoke all on function public.admin_register_unverified_restaurant_menu_v1(
  text, uuid, text, text, text, text, text, text, text, text, uuid, text,
  text, text, text, integer, integer, date, text, text
) from public, anon, authenticated;
grant execute on function public.admin_register_unverified_restaurant_menu_v1(
  text, uuid, text, text, text, text, text, text, text, text, uuid, text,
  text, text, text, integer, integer, date, text, text
) to authenticated;

-- Keep all existing public projections inside the verified evidence boundary.
-- The manual rows remain available to the admin UI through the admin policies.
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
      and catalog.verification_status = 'verified'
      and standard.verification_status = 'verified'
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
      and mapping.verification_status = 'verified'
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
grant execute on function public.get_product_read_v1(uuid, text, integer) to anon, authenticated;

-- The existing restaurant read function is intentionally left as the verified
-- public contract. Its new verification_status columns are checked by future
-- review/promotion migrations before a manual row can enter that projection.
