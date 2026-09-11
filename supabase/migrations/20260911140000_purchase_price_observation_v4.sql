-- Purchase/order price observation v4.
--
-- This migration is additive. Receipt ingestion and the receipt-independent
-- standalone v3 RPC remain unchanged. V4 keeps a private, sanitized order
-- source projection and only creates an existing PriceTrace observation for a
-- line whose seller, applicable product/menu authority, date, and item price
-- are all independently established.

create table public.purchase_price_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null
    check (schema_version = 'purchase-price-observation.v4'),
  contract_version text not null
    check (contract_version = 'purchase-price.v4'),
  source_app text not null
    check (source_app = 'pricetrace_ocr_app'),
  source_version text
    check (source_version is null or length(btrim(source_version)) between 1 and 100),
  -- `kind` keeps the legacy wire labels for callers that already adopted the
  -- first V4 draft. `purchase_kind` is the canonical V4 semantic field.
  kind text not null
    check (kind in ('retail_purchase', 'restaurant_purchase', 'other', 'unknown')),
  purchase_kind text not null
    check (purchase_kind in ('retail', 'restaurant', 'other', 'unknown')),
  platform_name text not null
    check (length(btrim(platform_name)) between 1 and 100),
  platform_code text
    check (platform_code is null or length(btrim(platform_code)) between 1 and 100),
  order_reference text
    check (order_reference is null or length(btrim(order_reference)) between 1 and 200),
  order_status text not null
    check (order_status in ('ordered', 'pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded', 'unknown')),
  ordered_on date,
  ordered_at_exact timestamptz,
  payment_status text not null
    check (payment_status in ('pending', 'paid', 'cancelled', 'refunded', 'unknown')),
  payment_method text not null
    check (payment_method in ('card', 'bank_transfer', 'mobile_payment', 'points', 'mixed', 'unknown')),
  paid_on date,
  paid_at_exact timestamptz,
  currency text not null default 'KRW'
    check (currency = 'KRW'),
  payment_total_price_krw integer
    check (payment_total_price_krw is null or payment_total_price_krw >= 0),
  payment_items_subtotal_krw integer
    check (payment_items_subtotal_krw is null or payment_items_subtotal_krw >= 0),
  payment_shipping_fee_krw integer
    check (payment_shipping_fee_krw is null or payment_shipping_fee_krw >= 0),
  payment_discount_krw integer
    check (payment_discount_krw is null or payment_discount_krw >= 0),
  seller_status text not null default 'unknown'
    check (seller_status in ('confirmed', 'unknown')),
  seller_name text
    check (seller_name is null or length(btrim(seller_name)) between 1 and 500),
  seller_branch_name text
    check (seller_branch_name is null or length(btrim(seller_branch_name)) between 1 and 300),
  seller_source_namespace text
    check (seller_source_namespace is null or length(btrim(seller_source_namespace)) between 1 and 200),
  seller_source_code text
    check (seller_source_code is null or length(btrim(seller_source_code)) between 1 and 300),
  seller_business_kind text
    check (seller_business_kind is null or seller_business_kind in (
      'retail', 'food_service', 'transport', 'accommodation', 'healthcare',
      'professional_service', 'utility', 'government', 'financial',
      'marketplace', 'other', 'unknown'
    )),
  source_url text
    check (source_url is null or source_url ~ '^https?://'),
  note text
    check (note is null or length(note) <= 1000),
  source_fingerprint text not null
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_payload jsonb not null
    check (jsonb_typeof(source_payload) = 'object'),
  transaction_state text not null
    check (transaction_state in ('settled', 'pending', 'cancelled', 'refunded', 'unknown')),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, source_fingerprint),
  check (
    (
      (purchase_kind = 'retail' and kind = 'retail_purchase')
      or (purchase_kind = 'restaurant' and kind = 'restaurant_purchase')
      or (purchase_kind in ('other', 'unknown') and kind = purchase_kind)
    )
  ),
  check (
    (
      seller_status = 'confirmed'
      and seller_name is not null
      and (seller_source_namespace is null) = (seller_source_code is null)
    )
    or (
      seller_status = 'unknown'
      and seller_name is null
      and seller_branch_name is null
      and seller_source_namespace is null
      and seller_source_code is null
      and seller_business_kind is null
    )
  )
);

comment on table public.purchase_price_sources is
  'Private sanitized v4 order/payment source. platform is evidence source metadata and is never a seller/store identity.';
comment on column public.purchase_price_sources.platform_name is
  'Order source platform such as Coupang, Naver Shopping, or a delivery app. It must not be copied into seller_name.';
comment on column public.purchase_price_sources.purchase_kind is
  'Canonical purchase semantics. Only retail and restaurant can create observations; other and unknown preserve source facts only.';
comment on column public.purchase_price_sources.seller_name is
  'Explicitly confirmed seller/merchant. NULL means seller was not established and cannot create a store observation.';
comment on column public.purchase_price_sources.ordered_on is
  'Calendar date of ordering. It is independent from paid_on and remains NULL when unknown.';
comment on column public.purchase_price_sources.paid_on is
  'Calendar date of payment. It is independent from ordered_on and remains NULL when unknown.';
comment on column public.purchase_price_sources.transaction_state is
  'Normalized settlement gate. Only settled transactions can create observations; cancelled, pending, refunded, and unknown remain source-only.';
comment on column public.purchase_price_sources.source_payload is
  'Validated source facts only. Raw OCR, images, payment instrument details, and PriceTrace identity fields are rejected by the RPC.';

create index purchase_price_sources_user_created_idx
  on public.purchase_price_sources(user_id, created_at desc, id desc);
create index purchase_price_sources_platform_idx
  on public.purchase_price_sources(user_id, platform_name, ordered_on desc, id desc);
create index purchase_price_sources_seller_idx
  on public.purchase_price_sources(user_id, seller_name, seller_branch_name, ordered_on desc)
  where seller_status = 'confirmed';

create table public.purchase_price_source_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_source_id uuid not null,
  line_ordinal integer not null check (line_ordinal between 1 and 100),
  source_line_key text not null
    check (length(btrim(source_line_key)) between 1 and 200),
  product_client_key text
    check (
      product_client_key is null
      or (
        length(btrim(product_client_key)) between 1 and 200
        and product_client_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    ),
  line_seller_status text not null default 'unknown'
    check (line_seller_status in ('confirmed', 'unknown')),
  line_seller_name text
    check (line_seller_name is null or length(btrim(line_seller_name)) between 1 and 500),
  line_seller_branch_name text
    check (line_seller_branch_name is null or length(btrim(line_seller_branch_name)) between 1 and 300),
  line_seller_source_namespace text
    check (line_seller_source_namespace is null or length(btrim(line_seller_source_namespace)) between 1 and 200),
  line_seller_source_code text
    check (line_seller_source_code is null or length(btrim(line_seller_source_code)) between 1 and 300),
  line_seller_business_kind text
    check (line_seller_business_kind is null or line_seller_business_kind in (
      'retail', 'food_service', 'transport', 'accommodation', 'healthcare',
      'professional_service', 'utility', 'government', 'financial',
      'marketplace', 'other', 'unknown'
    )),
  product_name text not null
    check (length(btrim(product_name)) between 1 and 500),
  option_text text
    check (option_text is null or length(btrim(option_text)) between 1 and 500),
  merchant_sku text
    check (merchant_sku is null or length(btrim(merchant_sku)) between 1 and 300),
  price_status text not null
    check (price_status in ('itemized', 'ambiguous', 'unknown')),
  quantity integer
    check (quantity is null or quantity > 0),
  unit_price_krw integer
    check (unit_price_krw is null or unit_price_krw >= 0),
  gross_price_krw integer
    check (gross_price_krw is null or gross_price_krw >= 0),
  discount_price_krw integer
    check (discount_price_krw is null or discount_price_krw >= 0),
  net_price_krw integer
    check (net_price_krw is null or net_price_krw >= 0),
  product_id uuid,
  store_product_id uuid,
  catalog_product_id uuid references public.catalog_products(id) on delete restrict,
  standard_product_id uuid references public.standard_products(id) on delete restrict,
  price_observation_id uuid,
  restaurant_menu_manual_observation_id uuid
    references public.restaurant_menu_manual_observations(id) on delete restrict,
  observation_status text not null
    check (observation_status in ('created', 'not_created')),
  observation_reason text
    check (observation_reason is null or length(btrim(observation_reason)) between 1 and 100),
  line_payload jsonb not null
    check (jsonb_typeof(line_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (purchase_source_id, line_ordinal),
  foreign key (user_id, purchase_source_id)
    references public.purchase_price_sources(user_id, id) on delete restrict,
  foreign key (user_id, product_id)
    references public.products(user_id, id) on delete restrict,
  foreign key (user_id, store_product_id)
    references public.store_products(user_id, id) on delete restrict,
  foreign key (user_id, price_observation_id)
    references public.price_observations(user_id, id) on delete restrict,
  check (
    quantity is null
    or unit_price_krw is null
    or net_price_krw is null
    or net_price_krw::numeric = quantity::numeric * unit_price_krw::numeric
  ),
  check (
    gross_price_krw is null
    or discount_price_krw is null
    or net_price_krw is null
    or gross_price_krw::numeric - discount_price_krw::numeric = net_price_krw::numeric
  ),
  check (
    gross_price_krw is null
    or net_price_krw is null
    or gross_price_krw >= net_price_krw
  ),
  check (
    (
      observation_status = 'created'
      and observation_reason is null
      and line_seller_status = 'confirmed'
      and line_seller_name is not null
      and (line_seller_source_namespace is null) = (line_seller_source_code is null)
      and catalog_product_id is not null
      and standard_product_id is not null
      and (
        (
          product_id is not null
          and store_product_id is not null
          and price_observation_id is not null
          and restaurant_menu_manual_observation_id is null
        )
        or (
          product_id is null
          and store_product_id is null
          and price_observation_id is null
          and restaurant_menu_manual_observation_id is not null
        )
      )
    )
    or (
      observation_status = 'not_created'
      and price_observation_id is null
      and restaurant_menu_manual_observation_id is null
      and product_id is null
      and store_product_id is null
      and catalog_product_id is null
      and standard_product_id is null
    )
  ),
  check (
    (
      line_seller_status = 'confirmed'
      and line_seller_name is not null
      and (line_seller_source_namespace is null) = (line_seller_source_code is null)
    )
    or (
      line_seller_status = 'unknown'
      and line_seller_name is null
      and line_seller_branch_name is null
      and line_seller_source_namespace is null
      and line_seller_source_code is null
      and line_seller_business_kind is null
    )
  )
);

comment on table public.purchase_price_source_lines is
  'Sanitized v4 order lines. Lines without an established seller, date, Product Candidate authority, or item price remain source evidence only.';
comment on column public.purchase_price_source_lines.product_client_key is
  'Opaque OCR-App Product Candidate reference. It is not a merchant SKU or a PriceTrace UUID.';
comment on column public.purchase_price_source_lines.line_seller_name is
  'Effective seller for this line. It uses the line seller when explicitly supplied, otherwise the top-level seller; NULL means this line cannot create an observation.';
comment on column public.purchase_price_source_lines.observation_status is
  'Only created lines are connected to a server-owned retail price observation or restaurant manual observation; payment-only and ambiguous lines are explicitly not observations.';

create index purchase_price_source_lines_source_idx
  on public.purchase_price_source_lines(purchase_source_id, line_ordinal);
create index purchase_price_source_lines_candidate_idx
  on public.purchase_price_source_lines(user_id, product_client_key)
  where product_client_key is not null;
create index purchase_price_source_lines_observation_idx
  on public.purchase_price_source_lines(user_id, price_observation_id)
  where price_observation_id is not null;
create index purchase_price_source_lines_product_idx
  on public.purchase_price_source_lines(user_id, product_id)
  where product_id is not null;
create index purchase_price_source_lines_store_product_idx
  on public.purchase_price_source_lines(user_id, store_product_id)
  where store_product_id is not null;
create index purchase_price_source_lines_manual_observation_idx
  on public.purchase_price_source_lines(user_id, restaurant_menu_manual_observation_id)
  where restaurant_menu_manual_observation_id is not null;

create table public.purchase_price_observation_ingestion_contents (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  purchase_source_id uuid not null,
  response jsonb not null
    check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, request_fingerprint),
  foreign key (user_id, purchase_source_id)
    references public.purchase_price_sources(user_id, id) on delete restrict
);

create index purchase_price_contents_source_idx
  on public.purchase_price_observation_ingestion_contents(user_id, purchase_source_id);

comment on table public.purchase_price_observation_ingestion_contents is
  'Content-level deduplication for sanitized purchase price v4 requests.';

create table public.purchase_price_observation_ingestion_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  purchase_source_id uuid not null,
  response jsonb not null
    check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  foreign key (user_id, request_fingerprint)
    references public.purchase_price_observation_ingestion_contents(user_id, request_fingerprint)
    on delete restrict,
  foreign key (user_id, purchase_source_id)
    references public.purchase_price_sources(user_id, id) on delete restrict
);

create index purchase_price_requests_source_idx
  on public.purchase_price_observation_ingestion_requests(user_id, purchase_source_id);

comment on table public.purchase_price_observation_ingestion_requests is
  'Per-user V4 replay guard. A key is bound to the complete source fingerprint and one immutable purchase source.';

alter table public.purchase_price_sources enable row level security;
alter table public.purchase_price_source_lines enable row level security;
alter table public.purchase_price_observation_ingestion_contents enable row level security;
alter table public.purchase_price_observation_ingestion_requests enable row level security;

revoke all on public.purchase_price_sources,
  public.purchase_price_source_lines,
  public.purchase_price_observation_ingestion_contents,
  public.purchase_price_observation_ingestion_requests
  from public, anon, authenticated;
grant select on public.purchase_price_sources,
  public.purchase_price_source_lines,
  public.purchase_price_observation_ingestion_contents,
  public.purchase_price_observation_ingestion_requests
  to authenticated;

create policy "users read own purchase price sources"
  on public.purchase_price_sources
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read own purchase price source lines"
  on public.purchase_price_source_lines
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read own purchase price content dedup"
  on public.purchase_price_observation_ingestion_contents
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read own purchase price request dedup"
  on public.purchase_price_observation_ingestion_requests
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.reject_purchase_price_observation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Purchase price observation v4 source and replay records are append-only.'
    using errcode = '55000';
end;
$function$;

create trigger purchase_price_sources_append_only
  before update or delete on public.purchase_price_sources
  for each row execute function public.reject_purchase_price_observation_mutation();
create trigger purchase_price_source_lines_append_only
  before update or delete on public.purchase_price_source_lines
  for each row execute function public.reject_purchase_price_observation_mutation();
create trigger purchase_price_contents_append_only
  before update or delete on public.purchase_price_observation_ingestion_contents
  for each row execute function public.reject_purchase_price_observation_mutation();
create trigger purchase_price_requests_append_only
  before update or delete on public.purchase_price_observation_ingestion_requests
  for each row execute function public.reject_purchase_price_observation_mutation();

revoke all on function public.reject_purchase_price_observation_mutation()
  from public, anon, authenticated;

create or replace function public.ingest_verified_purchase_price_observation_v1(
  p_idempotency_key text,
  p_purchase jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_key text := pg_catalog.btrim(coalesce(p_idempotency_key, ''));
  v_fingerprint text;
  v_existing public.purchase_price_observation_ingestion_requests%rowtype;
  v_duplicate public.purchase_price_observation_ingestion_contents%rowtype;
  v_kind text;
  v_purchase_kind text;
  v_legacy_kind text;
  v_transaction_state text;
  v_verification_basis text;
  v_source_version text;
  v_platform jsonb;
  v_order jsonb;
  v_payment jsonb;
  v_seller jsonb;
  v_items jsonb;
  v_platform_name text;
  v_platform_code text;
  v_order_reference text;
  v_order_status text;
  v_ordered_on date;
  v_ordered_at_text text;
  v_ordered_at_exact timestamptz;
  v_ordered_at_date date;
  v_payment_status text;
  v_payment_method text;
  v_paid_on date;
  v_paid_at_text text;
  v_paid_at_exact timestamptz;
  v_paid_at_date date;
  v_currency text;
  v_payment_total numeric;
  v_payment_items_subtotal numeric;
  v_payment_shipping_fee numeric;
  v_payment_discount numeric;
  v_payment_total_int integer;
  v_payment_items_subtotal_int integer;
  v_payment_shipping_fee_int integer;
  v_payment_discount_int integer;
  v_seller_status text := 'unknown';
  v_seller_name text;
  v_seller_branch_name text;
  v_seller_source_namespace text;
  v_seller_source_code text;
  v_seller_business_kind text;
  v_line_seller jsonb;
  v_effective_seller jsonb;
  v_effective_seller_status text;
  v_effective_seller_name text;
  v_effective_seller_branch_name text;
  v_effective_seller_source_namespace text;
  v_effective_seller_source_code text;
  v_effective_seller_business_kind text;
  v_source_url text;
  v_note text;
  v_source_id uuid;
  v_effective_observed_on date;
  v_effective_observed_at_exact timestamptz;
  v_line_entry record;
  v_line jsonb;
  v_product jsonb;
  v_line_ordinal integer;
  v_source_line_key text;
  v_product_client_key text;
  v_product_name text;
  v_authority_product_name text;
  v_option_text text;
  v_merchant_sku text;
  v_price_status text;
  v_quantity numeric;
  v_unit_price numeric;
  v_gross_price numeric;
  v_discount_price numeric;
  v_net_price numeric;
  v_quantity_int integer;
  v_unit_price_int integer;
  v_gross_price_int integer;
  v_discount_price_int integer;
  v_net_price_int integer;
  v_has_line_price boolean;
  v_line_reason text;
  v_projection public.product_candidate_authority_projections%rowtype;
  v_projection_found boolean;
  v_match_count integer;
  v_store_id uuid;
  v_product_id uuid;
  v_store_product_id uuid;
  v_restaurant_id uuid;
  v_restaurant_location_id uuid;
  v_restaurant_menu_id uuid;
  v_catalog_product_id uuid;
  v_standard_product_id uuid;
  v_price_observation_id uuid;
  v_restaurant_menu_manual_observation_id uuid;
  v_seller_identity_fingerprint text;
  v_observation_count integer := 0;
  v_observation_ids jsonb := '[]'::jsonb;
  v_line_results jsonb := '[]'::jsonb;
  v_response jsonb;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if length(v_key) not between 1 and 200 then
    raise exception 'idempotency key must contain 1 to 200 characters'
      using errcode = '22023';
  end if;
  if p_purchase is null or pg_catalog.jsonb_typeof(p_purchase) <> 'object' then
    raise exception 'purchase price observation must be a JSON object'
      using errcode = '22023';
  end if;

  v_fingerprint := encode(
    extensions.digest(convert_to(p_purchase::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text || ':purchase-price-v4:key:' || v_key,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text || ':purchase-price-v4:fingerprint:' || v_fingerprint,
      0
    )
  );

  select request.*
  into v_existing
  from public.purchase_price_observation_ingestion_requests as request
  where request.user_id = v_user_id
    and request.idempotency_key = v_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'The idempotency key was already used for another purchase request.'
        using errcode = '23505';
    end if;
    return v_existing.response || jsonb_build_object(
      'replayed', true,
      'deduplicated', false
    );
  end if;

  -- The wire contract accepts opaque local/source references only. This is
  -- deliberately checked before any identity lookup or source insert.
  if p_purchase::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    or p_purchase::text ~* '"(id|[a-z0-9]+_id|[a-zA-Z]+Id|uuid)"[[:space:]]*:'
  then
    raise exception 'external JSON must not contain UUID or PriceTrace identity fields'
      using errcode = '22023';
  end if;

  select content.*
  into v_duplicate
  from public.purchase_price_observation_ingestion_contents as content
  where content.user_id = v_user_id
    and content.request_fingerprint = v_fingerprint;
  if found then
    v_response := v_duplicate.response || jsonb_build_object(
      'replayed', false,
      'deduplicated', true
    );
    insert into public.purchase_price_observation_ingestion_requests (
      user_id, idempotency_key, request_fingerprint, purchase_source_id,
      response, created_at
    ) values (
      v_user_id, v_key, v_fingerprint, v_duplicate.purchase_source_id,
      v_duplicate.response, v_now
    );
    return v_response;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_purchase) as field_name
    where field_name not in (
      'schema_version', 'contract_version', 'source_app', 'source_version',
      'kind', 'purchase_kind', 'verification_basis', 'transcription_status', 'platform',
      'seller', 'order', 'payment', 'items', 'source_url', 'note'
    )
  ) then
    raise exception 'purchase price observation contains unsupported fields'
      using errcode = '22023';
  end if;

  if coalesce(p_purchase ->> 'schema_version', '') <> 'purchase-price-observation.v4'
    or coalesce(p_purchase ->> 'contract_version', '') <> 'purchase-price.v4'
    or coalesce(p_purchase ->> 'source_app', '') <> 'pricetrace_ocr_app'
    or coalesce(p_purchase ->> 'verification_basis', '') not in (
      'source_evidence', 'manual_canonical_review'
    )
    or coalesce(p_purchase ->> 'transcription_status', '') <> 'user_verified'
  then
    raise exception 'purchase price v4 required contract fields are invalid'
      using errcode = '22023';
  end if;

  if p_purchase ? 'purchase_kind'
    and pg_catalog.jsonb_typeof(p_purchase -> 'purchase_kind') not in ('string', 'null')
  then
    raise exception 'purchase_kind must be a string or null' using errcode = '22023';
  end if;
  if p_purchase ? 'kind'
    and pg_catalog.jsonb_typeof(p_purchase -> 'kind') not in ('string', 'null')
  then
    raise exception 'kind must be a string or null' using errcode = '22023';
  end if;
  v_purchase_kind := nullif(pg_catalog.btrim(p_purchase ->> 'purchase_kind'), '');
  v_legacy_kind := nullif(pg_catalog.btrim(p_purchase ->> 'kind'), '');
  if v_purchase_kind is not null
    and v_purchase_kind not in ('retail', 'restaurant', 'other', 'unknown')
  then
    raise exception 'purchase_kind must be retail, restaurant, other, or unknown'
      using errcode = '22023';
  end if;
  if v_legacy_kind is not null
    and v_legacy_kind not in (
      'retail_purchase', 'restaurant_purchase', 'other', 'unknown'
    )
  then
    raise exception 'kind is not a supported purchase-price v4 compatibility value'
      using errcode = '22023';
  end if;
  if v_purchase_kind is null then
    v_purchase_kind := case v_legacy_kind
      when 'retail_purchase' then 'retail'
      when 'restaurant_purchase' then 'restaurant'
      when 'other' then 'other'
      when 'unknown' then 'unknown'
      else null
    end;
  elsif v_legacy_kind is not null
    and v_legacy_kind is distinct from case v_purchase_kind
      when 'retail' then 'retail_purchase'
      when 'restaurant' then 'restaurant_purchase'
      else v_purchase_kind
    end
  then
    raise exception 'purchase_kind and kind must describe the same purchase semantics'
      using errcode = '22023';
  end if;
  if v_purchase_kind is null then
    raise exception 'purchase_kind is required' using errcode = '22023';
  end if;
  v_kind := case v_purchase_kind
    when 'retail' then 'retail_purchase'
    when 'restaurant' then 'restaurant_purchase'
    else v_purchase_kind
  end;
  v_verification_basis := p_purchase ->> 'verification_basis';
  if p_purchase ? 'source_version'
    and pg_catalog.jsonb_typeof(p_purchase -> 'source_version') not in ('string', 'null')
  then
    raise exception 'source_version must be a string or null' using errcode = '22023';
  end if;
  v_source_version := nullif(pg_catalog.btrim(p_purchase ->> 'source_version'), '');
  if v_source_version is not null and length(v_source_version) > 100 then
    raise exception 'source_version is too long' using errcode = '22023';
  end if;

  if p_purchase -> 'platform' is null
    or pg_catalog.jsonb_typeof(p_purchase -> 'platform') <> 'object'
  then
    raise exception 'platform facts are required' using errcode = '22023';
  end if;
  v_platform := p_purchase -> 'platform';
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_platform) as field_name
    where field_name not in ('name', 'code')
  ) then
    raise exception 'platform facts contain unsupported fields'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_platform) as field_name
    where pg_catalog.jsonb_typeof(v_platform -> field_name)
      not in ('string', 'null')
  ) then
    raise exception 'platform facts must contain strings or null'
      using errcode = '22023';
  end if;
  v_platform_name := nullif(pg_catalog.btrim(v_platform ->> 'name'), '');
  v_platform_code := nullif(pg_catalog.btrim(v_platform ->> 'code'), '');
  if v_platform_name is null or length(v_platform_name) > 100 then
    raise exception 'platform name is required' using errcode = '22023';
  end if;
  if v_platform_code is not null and length(v_platform_code) > 100 then
    raise exception 'platform code is too long' using errcode = '22023';
  end if;

  if p_purchase -> 'order' is null
    or pg_catalog.jsonb_typeof(p_purchase -> 'order') <> 'object'
  then
    raise exception 'order facts are required' using errcode = '22023';
  end if;
  v_order := p_purchase -> 'order';
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_order) as field_name
    where field_name not in (
      'order_reference', 'status', 'currency', 'ordered_on', 'ordered_at'
    )
  ) then
    raise exception 'order facts contain unsupported fields'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_order) as field_name
    where pg_catalog.jsonb_typeof(v_order -> field_name)
      not in ('string', 'null')
  ) then
    raise exception 'order facts must contain strings or null'
      using errcode = '22023';
  end if;
  v_order_reference := nullif(pg_catalog.btrim(v_order ->> 'order_reference'), '');
  v_order_status := coalesce(nullif(pg_catalog.btrim(v_order ->> 'status'), ''), 'unknown');
  v_currency := nullif(pg_catalog.btrim(v_order ->> 'currency'), '');
  if v_order_reference is not null and length(v_order_reference) > 200 then
    raise exception 'order_reference is too long' using errcode = '22023';
  end if;
  if v_order_status not in ('ordered', 'pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded', 'unknown') then
    raise exception 'order status is invalid' using errcode = '22023';
  end if;
  if v_currency is distinct from 'KRW' then
    raise exception 'purchase price v4 supports KRW only' using errcode = '22023';
  end if;

  if v_order ? 'ordered_on'
    and pg_catalog.jsonb_typeof(v_order -> 'ordered_on') not in ('string', 'null')
  then
    raise exception 'ordered_on must be an ISO date or null' using errcode = '22023';
  end if;
  if v_order ? 'ordered_on'
    and pg_catalog.jsonb_typeof(v_order -> 'ordered_on') = 'string'
    and v_order ->> 'ordered_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then
    raise exception 'ordered_on must be an ISO date' using errcode = '22023';
  end if;
  if v_order ? 'ordered_at'
    and pg_catalog.jsonb_typeof(v_order -> 'ordered_at') not in ('string', 'null')
  then
    raise exception 'ordered_at must be an ISO timestamp or null' using errcode = '22023';
  end if;
  if v_order ? 'ordered_at'
    and pg_catalog.jsonb_typeof(v_order -> 'ordered_at') = 'string'
    and v_order ->> 'ordered_at' !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  then
    raise exception 'ordered_at must be an ISO timestamp with timezone'
      using errcode = '22023';
  end if;
  if v_order ? 'ordered_on'
    and pg_catalog.jsonb_typeof(v_order -> 'ordered_on') = 'string'
  then
    v_ordered_on := (v_order ->> 'ordered_on')::date;
  end if;
  if v_order ? 'ordered_at'
    and pg_catalog.jsonb_typeof(v_order -> 'ordered_at') = 'string'
  then
    v_ordered_at_text := pg_catalog.btrim(v_order ->> 'ordered_at');
    v_ordered_at_exact := v_ordered_at_text::timestamptz;
    v_ordered_at_date := substring(v_ordered_at_text from 1 for 10)::date;
    if v_ordered_on is null then
      v_ordered_on := v_ordered_at_date;
    elsif v_ordered_on <> v_ordered_at_date then
      raise exception 'ordered_on and ordered_at refer to different calendar dates'
        using errcode = '22023';
    end if;
  end if;

  if p_purchase -> 'payment' is null
    or pg_catalog.jsonb_typeof(p_purchase -> 'payment') <> 'object'
  then
    raise exception 'payment facts are required' using errcode = '22023';
  end if;
  v_payment := p_purchase -> 'payment';
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_payment) as field_name
    where field_name not in (
      'status', 'method', 'paid_on', 'paid_at', 'total_price',
      'items_subtotal', 'shipping_fee', 'discount'
    )
  ) then
    raise exception 'payment facts contain unsupported fields'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_payment) as field_name
    where pg_catalog.jsonb_typeof(v_payment -> field_name)
      not in ('string', 'number', 'null')
  ) then
    raise exception 'payment facts contain unsupported value types'
      using errcode = '22023';
  end if;
  v_payment_status := coalesce(nullif(pg_catalog.btrim(v_payment ->> 'status'), ''), 'unknown');
  v_payment_method := coalesce(nullif(pg_catalog.btrim(v_payment ->> 'method'), ''), 'unknown');
  if v_payment_status not in ('pending', 'paid', 'cancelled', 'refunded', 'unknown') then
    raise exception 'payment status is invalid' using errcode = '22023';
  end if;
  if v_payment_method not in ('card', 'bank_transfer', 'mobile_payment', 'points', 'mixed', 'unknown') then
    raise exception 'payment method is invalid' using errcode = '22023';
  end if;

  if v_payment ? 'paid_on'
    and pg_catalog.jsonb_typeof(v_payment -> 'paid_on') not in ('string', 'null')
  then
    raise exception 'paid_on must be an ISO date or null' using errcode = '22023';
  end if;
  if v_payment ? 'paid_on'
    and pg_catalog.jsonb_typeof(v_payment -> 'paid_on') = 'string'
    and v_payment ->> 'paid_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then
    raise exception 'paid_on must be an ISO date' using errcode = '22023';
  end if;
  if v_payment ? 'paid_at'
    and pg_catalog.jsonb_typeof(v_payment -> 'paid_at') not in ('string', 'null')
  then
    raise exception 'paid_at must be an ISO timestamp or null' using errcode = '22023';
  end if;
  if v_payment ? 'paid_at'
    and pg_catalog.jsonb_typeof(v_payment -> 'paid_at') = 'string'
    and v_payment ->> 'paid_at' !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
  then
    raise exception 'paid_at must be an ISO timestamp with timezone'
      using errcode = '22023';
  end if;
  if v_payment ? 'paid_on'
    and pg_catalog.jsonb_typeof(v_payment -> 'paid_on') = 'string'
  then
    v_paid_on := (v_payment ->> 'paid_on')::date;
  end if;
  if v_payment ? 'paid_at'
    and pg_catalog.jsonb_typeof(v_payment -> 'paid_at') = 'string'
  then
    v_paid_at_text := pg_catalog.btrim(v_payment ->> 'paid_at');
    v_paid_at_exact := v_paid_at_text::timestamptz;
    v_paid_at_date := substring(v_paid_at_text from 1 for 10)::date;
    if v_paid_on is null then
      v_paid_on := v_paid_at_date;
    elsif v_paid_on <> v_paid_at_date then
      raise exception 'paid_on and paid_at refer to different calendar dates'
        using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1
    from unnest(array['total_price', 'items_subtotal', 'shipping_fee', 'discount']) as field_name
    where v_payment ? field_name
      and pg_catalog.jsonb_typeof(v_payment -> field_name) not in ('number', 'null')
  ) then
    raise exception 'payment amounts must be JSON numbers or null'
      using errcode = '22023';
  end if;
  v_payment_total := case
    when not (v_payment ? 'total_price')
      or pg_catalog.jsonb_typeof(v_payment -> 'total_price') = 'null' then null
    else (v_payment ->> 'total_price')::numeric
  end;
  v_payment_items_subtotal := case
    when not (v_payment ? 'items_subtotal')
      or pg_catalog.jsonb_typeof(v_payment -> 'items_subtotal') = 'null' then null
    else (v_payment ->> 'items_subtotal')::numeric
  end;
  v_payment_shipping_fee := case
    when not (v_payment ? 'shipping_fee')
      or pg_catalog.jsonb_typeof(v_payment -> 'shipping_fee') = 'null' then null
    else (v_payment ->> 'shipping_fee')::numeric
  end;
  v_payment_discount := case
    when not (v_payment ? 'discount')
      or pg_catalog.jsonb_typeof(v_payment -> 'discount') = 'null' then null
    else (v_payment ->> 'discount')::numeric
  end;
  if v_payment_total is not null
    and (v_payment_total < 0 or v_payment_total <> trunc(v_payment_total) or v_payment_total > 2147483647)
    or v_payment_items_subtotal is not null
      and (v_payment_items_subtotal < 0 or v_payment_items_subtotal <> trunc(v_payment_items_subtotal) or v_payment_items_subtotal > 2147483647)
    or v_payment_shipping_fee is not null
      and (v_payment_shipping_fee < 0 or v_payment_shipping_fee <> trunc(v_payment_shipping_fee) or v_payment_shipping_fee > 2147483647)
    or v_payment_discount is not null
      and (v_payment_discount < 0 or v_payment_discount <> trunc(v_payment_discount) or v_payment_discount > 2147483647)
  then
    raise exception 'payment amounts must be non-negative integer KRW values'
      using errcode = '22023';
  end if;
  v_payment_total_int := case when v_payment_total is null then null else v_payment_total::integer end;
  v_payment_items_subtotal_int := case when v_payment_items_subtotal is null then null else v_payment_items_subtotal::integer end;
  v_payment_shipping_fee_int := case when v_payment_shipping_fee is null then null else v_payment_shipping_fee::integer end;
  v_payment_discount_int := case when v_payment_discount is null then null else v_payment_discount::integer end;

  -- A terminal negative state wins over a positive payment signal. A paid
  -- order/payment is the minimum settlement proof; ordered/pending and
  -- unknown states remain source-only. Refunded input is deliberately not a
  -- new normal price observation.
  v_transaction_state := case
    when v_order_status = 'refunded' or v_payment_status = 'refunded' then 'refunded'
    when v_order_status = 'cancelled' or v_payment_status = 'cancelled' then 'cancelled'
    when v_order_status in ('paid', 'shipped', 'delivered')
      or v_payment_status = 'paid' then 'settled'
    when v_order_status = 'unknown' or v_payment_status = 'unknown' then 'unknown'
    else 'pending'
  end;

  if p_purchase -> 'seller' is null
    or pg_catalog.jsonb_typeof(p_purchase -> 'seller') = 'null'
  then
    v_seller_status := 'unknown';
  elsif pg_catalog.jsonb_typeof(p_purchase -> 'seller') <> 'object' then
    raise exception 'seller must be an object or null' using errcode = '22023';
  else
    v_seller := p_purchase -> 'seller';
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_seller) as field_name
      where field_name not in (
        'seller_name', 'branch_name', 'source_namespace', 'source_code',
        'business_kind'
      )
    ) then
      raise exception 'seller facts contain unsupported fields'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_seller) as field_name
      where pg_catalog.jsonb_typeof(v_seller -> field_name)
        not in ('string', 'null')
    ) then
      raise exception 'seller facts must contain strings or null'
        using errcode = '22023';
    end if;
    v_seller_name := nullif(pg_catalog.btrim(v_seller ->> 'seller_name'), '');
    v_seller_branch_name := nullif(pg_catalog.btrim(v_seller ->> 'branch_name'), '');
    v_seller_source_namespace := nullif(pg_catalog.btrim(v_seller ->> 'source_namespace'), '');
    v_seller_source_code := nullif(pg_catalog.btrim(v_seller ->> 'source_code'), '');
    v_seller_business_kind := nullif(pg_catalog.btrim(v_seller ->> 'business_kind'), '');
    if v_seller_branch_name is not null and length(v_seller_branch_name) > 300
      or v_seller_source_namespace is not null and length(v_seller_source_namespace) > 200
      or v_seller_source_code is not null and length(v_seller_source_code) > 300
    then
      raise exception 'seller identity facts are too long' using errcode = '22023';
    end if;
    if (v_seller_source_namespace is null) <> (v_seller_source_code is null) then
      raise exception 'seller source_namespace and source_code must be provided together'
        using errcode = '22023';
    end if;
    if v_seller_business_kind is not null
      and v_seller_business_kind not in (
        'retail', 'food_service', 'transport', 'accommodation', 'healthcare',
        'professional_service', 'utility', 'government', 'financial',
        'marketplace', 'other', 'unknown'
      )
    then
      raise exception 'seller business_kind is invalid' using errcode = '22023';
    end if;
    if v_seller_name is null then
      if v_seller_branch_name is not null
        or v_seller_source_namespace is not null
        or v_seller_source_code is not null
        or v_seller_business_kind is not null
      then
        raise exception 'seller facts must be complete when seller_name is unknown'
          using errcode = '22023';
      end if;
      v_seller := null;
      v_seller_status := 'unknown';
    else
      if length(v_seller_name) > 500 then
        raise exception 'confirmed seller_name is too long' using errcode = '22023';
      end if;
      v_seller_status := 'confirmed';
    end if;
  end if;

  if p_purchase ? 'source_url' then
    if pg_catalog.jsonb_typeof(p_purchase -> 'source_url') not in ('string', 'null') then
      raise exception 'source_url must be a string or null' using errcode = '22023';
    end if;
    v_source_url := nullif(pg_catalog.btrim(p_purchase ->> 'source_url'), '');
    if v_source_url is not null and v_source_url !~ '^https?://' then
      raise exception 'source_url must be an HTTP(S) URL' using errcode = '22023';
    end if;
  end if;
  if p_purchase ? 'note' then
    if pg_catalog.jsonb_typeof(p_purchase -> 'note') not in ('string', 'null') then
      raise exception 'note must be a string or null' using errcode = '22023';
    end if;
    v_note := nullif(pg_catalog.btrim(p_purchase ->> 'note'), '');
    if v_note is not null and length(v_note) > 1000 then
      raise exception 'note is too long' using errcode = '22023';
    end if;
  end if;

  if p_purchase ? 'items'
    and pg_catalog.jsonb_typeof(p_purchase -> 'items') not in ('array', 'null')
  then
    raise exception 'items must be an array or null' using errcode = '22023';
  end if;
  v_items := case
    when not (p_purchase ? 'items')
      or pg_catalog.jsonb_typeof(p_purchase -> 'items') = 'null'
      then '[]'::jsonb
    else p_purchase -> 'items'
  end;
  if pg_catalog.jsonb_array_length(v_items) > 100 then
    raise exception 'at most 100 purchase lines are supported' using errcode = '22023';
  end if;

  v_effective_observed_on := coalesce(v_ordered_on, v_paid_on);
  if v_ordered_on is not null then
    v_effective_observed_at_exact := v_ordered_at_exact;
  else
    v_effective_observed_at_exact := v_paid_at_exact;
  end if;

  insert into public.purchase_price_sources (
    user_id, schema_version, contract_version, source_app, source_version,
    kind, purchase_kind, platform_name, platform_code, order_reference, order_status,
    ordered_on, ordered_at_exact, payment_status, payment_method, paid_on,
    paid_at_exact, currency, payment_total_price_krw,
    payment_items_subtotal_krw, payment_shipping_fee_krw, payment_discount_krw,
    seller_status, seller_name, seller_branch_name, seller_source_namespace,
    seller_source_code, seller_business_kind, source_url, note,
    source_fingerprint, source_payload, transaction_state, created_at
  ) values (
    v_user_id, 'purchase-price-observation.v4', 'purchase-price.v4',
    'pricetrace_ocr_app', v_source_version, v_kind, v_purchase_kind, v_platform_name,
    v_platform_code, v_order_reference, v_order_status, v_ordered_on,
    v_ordered_at_exact, v_payment_status, v_payment_method, v_paid_on,
    v_paid_at_exact, v_currency, v_payment_total_int,
    v_payment_items_subtotal_int, v_payment_shipping_fee_int,
    v_payment_discount_int, v_seller_status, v_seller_name,
    v_seller_branch_name, v_seller_source_namespace, v_seller_source_code,
    v_seller_business_kind, v_source_url, v_note, v_fingerprint, p_purchase,
    v_transaction_state, v_now
  ) returning id into v_source_id;

  for v_line_entry in
    select value, ordinality
    from jsonb_array_elements(v_items) with ordinality as entry(value, ordinality)
  loop
    v_line := v_line_entry.value;
    v_line_ordinal := v_line_entry.ordinality::integer;
    if pg_catalog.jsonb_typeof(v_line) <> 'object' then
      raise exception 'purchase line must be a JSON object' using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_line) as field_name
      where field_name not in (
        'line_key', 'product', 'option_text', 'price_status', 'quantity',
        'unit_price', 'gross_price', 'discount', 'net_price', 'seller'
      )
    ) then
      raise exception 'purchase line contains unsupported fields'
        using errcode = '22023';
    end if;
    if v_line ? 'line_key'
      and pg_catalog.jsonb_typeof(v_line -> 'line_key') not in ('string', 'null')
    then
      raise exception 'line_key must be a string or null' using errcode = '22023';
    end if;
    if v_line ? 'option_text'
      and pg_catalog.jsonb_typeof(v_line -> 'option_text') not in ('string', 'null')
    then
      raise exception 'option_text must be a string or null' using errcode = '22023';
    end if;
    if v_line ? 'price_status'
      and pg_catalog.jsonb_typeof(v_line -> 'price_status') not in ('string', 'null')
    then
      raise exception 'price_status must be a string or null' using errcode = '22023';
    end if;
    v_source_line_key := nullif(pg_catalog.btrim(v_line ->> 'line_key'), '');
    if v_source_line_key is null or length(v_source_line_key) > 200 then
      raise exception 'line_key is required' using errcode = '22023';
    end if;

    -- A marketplace may put the merchant on each order line. A line seller
    -- overrides the top-level seller; an unknown line seller blocks only that
    -- line and never rejects the rest of the purchase source.
    v_line_seller := null;
    v_effective_seller := v_seller;
    v_effective_seller_status := v_seller_status;
    v_effective_seller_name := v_seller_name;
    v_effective_seller_branch_name := v_seller_branch_name;
    v_effective_seller_source_namespace := v_seller_source_namespace;
    v_effective_seller_source_code := v_seller_source_code;
    v_effective_seller_business_kind := v_seller_business_kind;
    if v_line ? 'seller' then
      if pg_catalog.jsonb_typeof(v_line -> 'seller') not in ('object', 'null') then
        raise exception 'line seller must be an object or null' using errcode = '22023';
      end if;
      if pg_catalog.jsonb_typeof(v_line -> 'seller') = 'null' then
        v_effective_seller := null;
        v_effective_seller_status := 'unknown';
        v_effective_seller_name := null;
        v_effective_seller_branch_name := null;
        v_effective_seller_source_namespace := null;
        v_effective_seller_source_code := null;
        v_effective_seller_business_kind := null;
      else
        v_line_seller := v_line -> 'seller';
        if exists (
          select 1
          from pg_catalog.jsonb_object_keys(v_line_seller) as field_name
          where field_name not in (
            'seller_name', 'branch_name', 'source_namespace', 'source_code',
            'business_kind'
          )
        ) then
          raise exception 'line seller facts contain unsupported fields'
            using errcode = '22023';
        end if;
        if exists (
          select 1
          from pg_catalog.jsonb_object_keys(v_line_seller) as field_name
          where pg_catalog.jsonb_typeof(v_line_seller -> field_name)
            not in ('string', 'null')
        ) then
          raise exception 'line seller facts must contain strings or null'
            using errcode = '22023';
        end if;
        v_effective_seller_name := nullif(
          pg_catalog.btrim(v_line_seller ->> 'seller_name'), ''
        );
        v_effective_seller_branch_name := nullif(
          pg_catalog.btrim(v_line_seller ->> 'branch_name'), ''
        );
        v_effective_seller_source_namespace := nullif(
          pg_catalog.btrim(v_line_seller ->> 'source_namespace'), ''
        );
        v_effective_seller_source_code := nullif(
          pg_catalog.btrim(v_line_seller ->> 'source_code'), ''
        );
        v_effective_seller_business_kind := nullif(
          pg_catalog.btrim(v_line_seller ->> 'business_kind'), ''
        );
        if v_effective_seller_branch_name is not null
            and length(v_effective_seller_branch_name) > 300
          or v_effective_seller_source_namespace is not null
            and length(v_effective_seller_source_namespace) > 200
          or v_effective_seller_source_code is not null
            and length(v_effective_seller_source_code) > 300
          or v_effective_seller_name is not null
            and length(v_effective_seller_name) > 500
        then
          raise exception 'line seller identity facts are too long' using errcode = '22023';
        end if;
        if v_effective_seller_business_kind is not null
          and v_effective_seller_business_kind not in (
            'retail', 'food_service', 'transport', 'accommodation', 'healthcare',
            'professional_service', 'utility', 'government', 'financial',
            'marketplace', 'other', 'unknown'
          )
        then
          raise exception 'line seller business_kind is invalid' using errcode = '22023';
        end if;
        if (v_effective_seller_source_namespace is null)
            <> (v_effective_seller_source_code is null)
        then
          -- A partial line seller is retained in line_payload but is not
          -- allowed to become an authority identity.
          v_effective_seller := null;
          v_effective_seller_status := 'unknown';
          v_effective_seller_name := null;
          v_effective_seller_branch_name := null;
          v_effective_seller_source_namespace := null;
          v_effective_seller_source_code := null;
          v_effective_seller_business_kind := null;
        elsif v_effective_seller_name is null then
          if v_effective_seller_branch_name is not null
            or v_effective_seller_source_namespace is not null
            or v_effective_seller_source_code is not null
            or v_effective_seller_business_kind is not null
          then
            v_effective_seller := null;
            v_effective_seller_status := 'unknown';
            v_effective_seller_name := null;
            v_effective_seller_branch_name := null;
            v_effective_seller_source_namespace := null;
            v_effective_seller_source_code := null;
            v_effective_seller_business_kind := null;
          else
            v_effective_seller := null;
            v_effective_seller_status := 'unknown';
          end if;
        else
          v_effective_seller := v_line_seller;
          v_effective_seller_status := 'confirmed';
        end if;
      end if;
    end if;
    if v_line -> 'product' is null
      or pg_catalog.jsonb_typeof(v_line -> 'product') <> 'object'
    then
      raise exception 'purchase line product facts are required' using errcode = '22023';
    end if;
    v_product := v_line -> 'product';
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_product) as field_name
      where field_name not in (
        'client_key', 'product_client_key', 'product_name', 'merchant_sku'
      )
    ) then
      raise exception 'purchase product facts contain unsupported fields'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_product) as field_name
      where pg_catalog.jsonb_typeof(v_product -> field_name)
        not in ('string', 'null')
    ) then
      raise exception 'purchase product facts must contain strings or null'
        using errcode = '22023';
    end if;
    if v_product ? 'client_key'
      and v_product ? 'product_client_key'
      and nullif(pg_catalog.btrim(v_product ->> 'client_key'), '')
        is distinct from nullif(pg_catalog.btrim(v_product ->> 'product_client_key'), '')
    then
      raise exception 'client_key and product_client_key must identify the same Product Candidate'
        using errcode = '22023';
    end if;
    v_product_client_key := coalesce(
      nullif(pg_catalog.btrim(v_product ->> 'client_key'), ''),
      nullif(pg_catalog.btrim(v_product ->> 'product_client_key'), '')
    );
    v_product_name := nullif(pg_catalog.btrim(v_product ->> 'product_name'), '');
    v_merchant_sku := nullif(pg_catalog.btrim(v_product ->> 'merchant_sku'), '');
    if v_product_name is null or length(v_product_name) > 500 then
      raise exception 'product_name is required' using errcode = '22023';
    end if;
    if v_product_client_key is not null and length(v_product_client_key) > 200 then
      raise exception 'product_client_key is too long' using errcode = '22023';
    end if;
    if v_product_client_key is not null
      and v_product_client_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      raise exception 'product_client_key must be an opaque local reference, not a PriceTrace UUID'
        using errcode = '22023';
    end if;
    if v_merchant_sku is not null and length(v_merchant_sku) > 300 then
      raise exception 'merchant_sku is too long' using errcode = '22023';
    end if;
    if v_merchant_sku is not null and v_merchant_sku = v_product_client_key then
      raise exception 'merchant_sku cannot reuse product_client_key'
        using errcode = '22023';
    end if;

    v_option_text := nullif(pg_catalog.btrim(v_line ->> 'option_text'), '');
    if v_option_text is not null and length(v_option_text) > 500 then
      raise exception 'option_text is too long' using errcode = '22023';
    end if;
    v_price_status := case
      when not (v_line ? 'price_status') then 'itemized'
      when pg_catalog.jsonb_typeof(v_line -> 'price_status') = 'null' then 'unknown'
      else pg_catalog.btrim(v_line ->> 'price_status')
    end;
    if v_price_status not in ('itemized', 'ambiguous', 'unknown') then
      raise exception 'price_status is invalid' using errcode = '22023';
    end if;
    if exists (
      select 1
      from unnest(array['quantity', 'unit_price', 'gross_price', 'discount', 'net_price']) as field_name
      where v_line ? field_name
        and pg_catalog.jsonb_typeof(v_line -> field_name) not in ('number', 'null')
    ) then
      raise exception 'line price facts must be JSON numbers or null'
        using errcode = '22023';
    end if;
    v_quantity := case
      when not (v_line ? 'quantity') or pg_catalog.jsonb_typeof(v_line -> 'quantity') = 'null' then null
      else (v_line ->> 'quantity')::numeric
    end;
    v_unit_price := case
      when not (v_line ? 'unit_price') or pg_catalog.jsonb_typeof(v_line -> 'unit_price') = 'null' then null
      else (v_line ->> 'unit_price')::numeric
    end;
    v_gross_price := case
      when not (v_line ? 'gross_price') or pg_catalog.jsonb_typeof(v_line -> 'gross_price') = 'null' then null
      else (v_line ->> 'gross_price')::numeric
    end;
    v_discount_price := case
      when not (v_line ? 'discount') or pg_catalog.jsonb_typeof(v_line -> 'discount') = 'null' then null
      else (v_line ->> 'discount')::numeric
    end;
    v_net_price := case
      when not (v_line ? 'net_price') or pg_catalog.jsonb_typeof(v_line -> 'net_price') = 'null' then null
      else (v_line ->> 'net_price')::numeric
    end;
    if v_quantity is not null
      and (v_quantity < 1 or v_quantity <> trunc(v_quantity) or v_quantity > 2147483647)
      or v_unit_price is not null
        and (v_unit_price < 0 or v_unit_price <> trunc(v_unit_price) or v_unit_price > 2147483647)
      or v_gross_price is not null
        and (v_gross_price < 0 or v_gross_price <> trunc(v_gross_price) or v_gross_price > 2147483647)
      or v_discount_price is not null
        and (v_discount_price < 0 or v_discount_price <> trunc(v_discount_price) or v_discount_price > 2147483647)
      or v_net_price is not null
        and (v_net_price < 0 or v_net_price <> trunc(v_net_price) or v_net_price > 2147483647)
    then
      raise exception 'line price facts must be non-negative integer KRW values and quantity must be positive'
        using errcode = '22023';
    end if;
    if v_quantity is not null and v_unit_price is not null and v_net_price is not null
      and v_net_price <> v_quantity * v_unit_price
    then
      raise exception 'quantity multiplied by unit_price must equal net_price'
        using errcode = '23514';
    end if;
    if v_gross_price is not null and v_discount_price is not null
      and v_discount_price > v_gross_price
    then
      raise exception 'discount cannot exceed gross_price' using errcode = '23514';
    end if;
    if v_gross_price is not null and v_net_price is not null
      and v_gross_price < v_net_price
    then
      raise exception 'gross_price cannot be below net_price' using errcode = '23514';
    end if;
    if v_gross_price is not null and v_discount_price is not null and v_net_price is not null
      and v_gross_price - v_discount_price <> v_net_price
    then
      raise exception 'gross_price minus discount must equal net_price'
        using errcode = '23514';
    end if;

    v_quantity_int := case when v_quantity is null then null else v_quantity::integer end;
    v_unit_price_int := case when v_unit_price is null then null else v_unit_price::integer end;
    v_gross_price_int := case when v_gross_price is null then null else v_gross_price::integer end;
    v_discount_price_int := case when v_discount_price is null then null else v_discount_price::integer end;
    v_net_price_int := case when v_net_price is null then null else v_net_price::integer end;
    v_has_line_price := v_unit_price is not null
      or v_gross_price is not null
      or v_net_price is not null;
    v_line_reason := null;
    v_projection_found := false;
    v_projection := null;
    v_store_id := null;
    v_product_id := null;
    v_store_product_id := null;
    v_catalog_product_id := null;
    v_standard_product_id := null;
    v_price_observation_id := null;
    v_restaurant_id := null;
    v_restaurant_location_id := null;
    v_restaurant_menu_id := null;
    v_restaurant_menu_manual_observation_id := null;

    if v_purchase_kind not in ('retail', 'restaurant') then
      v_line_reason := 'purchase_kind_not_observable';
    elsif v_transaction_state = 'refunded' then
      v_line_reason := 'transaction_refunded';
    elsif v_transaction_state = 'cancelled' then
      v_line_reason := 'transaction_cancelled';
    elsif v_transaction_state = 'pending' then
      v_line_reason := 'transaction_pending';
    elsif v_transaction_state = 'unknown' then
      v_line_reason := 'transaction_unknown';
    elsif not v_has_line_price then
      v_line_reason := 'product_price_unknown';
    elsif v_price_status <> 'itemized' then
      v_line_reason := 'product_price_ambiguous';
    elsif v_effective_seller_status <> 'confirmed' then
      v_line_reason := 'seller_unknown';
    elsif v_effective_observed_on is null then
      v_line_reason := 'order_and_payment_date_unknown';
    elsif v_purchase_kind = 'retail' and v_product_client_key is null then
      v_line_reason := 'product_candidate_client_key_missing';
    else
      if v_purchase_kind = 'retail' then
        select projection.*
        into v_projection
        from public.product_candidate_authority_projections as projection
        where projection.user_id = v_user_id
          and projection.client_key = v_product_client_key;
        v_projection_found := found;
        if not v_projection_found
          or v_projection.resolution_status <> 'catalog_product_reused'
          or v_projection.catalog_product_id is null
          or v_projection.standard_product_id is null
        then
          v_line_reason := 'product_candidate_authority_unresolved';
        else
          select count(*)
          into v_match_count
          from public.catalog_products as catalog
          inner join public.standard_products as standard
            on standard.id = catalog.standard_product_id
          where catalog.id = v_projection.catalog_product_id
            and catalog.standard_product_id = v_projection.standard_product_id
            and catalog.purchase_type = 'retail_product'
            and catalog.status = 'active'
            and catalog.verification_status = 'verified'
            and catalog.specification_status = 'verified'
            and standard.purchase_type = 'retail_product'
            and standard.status = 'active'
            and standard.verification_status = 'verified';
          if v_match_count <> 1 then
            v_line_reason := 'product_candidate_authority_inactive';
          else
            v_catalog_product_id := v_projection.catalog_product_id;
            v_standard_product_id := v_projection.standard_product_id;
            v_authority_product_name := nullif(
              pg_catalog.btrim(v_projection.source_payload ->> 'product_name'), ''
            );
            if v_authority_product_name is null
              or pg_catalog.lower(pg_catalog.regexp_replace(v_product_name, '[[:space:]]+', '', 'g'))
                <> pg_catalog.lower(pg_catalog.regexp_replace(v_authority_product_name, '[[:space:]]+', '', 'g'))
            then
              v_line_reason := 'product_candidate_name_mismatch';
              v_catalog_product_id := null;
              v_standard_product_id := null;
            end if;
          end if;
        end if;
      else
        -- Delivery-app orders use the existing exact restaurant authority.
        -- An optional source client_key is retained as evidence only; it never
        -- becomes a restaurant/menu UUID or a name-only identity shortcut.
        if v_effective_seller_source_namespace is null
          or v_effective_seller_source_code is null
        then
          v_line_reason := 'restaurant_source_identity_missing';
        else
          select count(*), min(location.id), min(location.restaurant_id)
          into v_match_count, v_restaurant_location_id, v_restaurant_id
          from public.restaurant_locations as location
          inner join public.restaurants as restaurant
            on restaurant.id = location.restaurant_id
          where location.source_namespace = v_effective_seller_source_namespace
            and location.source_location_code = v_effective_seller_source_code
            and restaurant.canonical_name = v_effective_seller_name
            and restaurant.status = 'active'
            and restaurant.review_status = 'verified'
            and restaurant.verification_status = 'verified'
            and location.review_status = 'verified'
            and location.verification_status = 'verified';
          if v_match_count <> 1 then
            v_line_reason := case
              when v_match_count > 1 then 'restaurant_authority_ambiguous'
              else 'restaurant_authority_unresolved'
            end;
          else
            select count(*), min(menu.id), min(menu.catalog_product_id)
            into v_match_count, v_restaurant_menu_id, v_catalog_product_id
            from public.restaurant_menus as menu
            inner join public.catalog_products as catalog
              on catalog.id = menu.catalog_product_id
            inner join public.standard_products as standard
              on standard.id = catalog.standard_product_id
            where menu.restaurant_id = v_restaurant_id
              and menu.canonical_name = v_product_name
              and menu.serving_label = coalesce(v_option_text, '1회 제공')
              and menu.status = 'active'
              and menu.review_status = 'verified'
              and menu.verification_status = 'verified'
              and catalog.purchase_type = 'menu_item'
              and catalog.status = 'active'
              and catalog.verification_status = 'verified'
              and standard.purchase_type = 'menu_item'
              and standard.status = 'active'
              and standard.verification_status = 'verified';
            if v_match_count <> 1 then
              v_line_reason := case
                when v_match_count > 1 then 'restaurant_menu_authority_ambiguous'
                else 'restaurant_menu_authority_unresolved'
              end;
            else
              select catalog.standard_product_id
              into v_standard_product_id
              from public.catalog_products as catalog
              where catalog.id = v_catalog_product_id;
            end if;
          end if;
        end if;
      end if;
    end if;

    if v_line_reason is null then
      if v_purchase_kind = 'retail' then
        if v_store_id is null then
          v_seller_identity_fingerprint := encode(
            extensions.digest(
              convert_to(
                pg_catalog.concat_ws(
                  '|', 'retail', v_effective_seller_name,
                  coalesce(v_effective_seller_branch_name, ''),
                  coalesce(v_effective_seller_source_namespace, ''),
                  coalesce(v_effective_seller_source_code, '')
                ),
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          );
          perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
              v_user_id::text || ':purchase-price-v4:seller:' || v_seller_identity_fingerprint,
              0
            )
          );
          select count(*), min(store.id)
          into v_match_count, v_store_id
          from public.stores as store
          where store.user_id = v_user_id
            and coalesce(store.merchant_name, store.name) = v_effective_seller_name
            and coalesce(store.branch_name, '') = coalesce(v_effective_seller_branch_name, '')
            and coalesce(store.catalog_namespace, '') = coalesce(v_effective_seller_source_namespace, '')
            and coalesce(store.merchant_id, '') = coalesce(v_effective_seller_source_code, '');
          if v_match_count > 1 then
            raise exception 'seller store identity is ambiguous' using errcode = 'P0003';
          elsif v_match_count = 0 then
            insert into public.stores (
              user_id, name, merchant_name, branch_name, business_kind,
              merchant_id, catalog_namespace, identity_fingerprint
            ) values (
              v_user_id,
              v_effective_seller_name || case when v_effective_seller_branch_name is null then '' else ' - ' || v_effective_seller_branch_name end,
              v_effective_seller_name,
              v_effective_seller_branch_name,
              coalesce(v_effective_seller_business_kind, 'unknown'),
              v_effective_seller_source_code,
              v_effective_seller_source_namespace,
              v_seller_identity_fingerprint
            ) returning id into v_store_id;
          end if;
        end if;

      select count(*), min(product.id)
      into v_match_count, v_product_id
      from public.products as product
      where product.user_id = v_user_id
        and product.name = v_authority_product_name
        and product.purchase_type = 'retail_product';
      if v_match_count > 1 then
        raise exception 'retail product identity is ambiguous' using errcode = 'P0003';
      elsif v_match_count = 0 then
        insert into public.products (
          user_id, name, purchase_type, category_tags
        ) values (
          v_user_id, v_authority_product_name, 'retail_product', array[]::text[]
        ) returning id into v_product_id;
      end if;

      select count(*), min(store_product.id)
      into v_match_count, v_store_product_id
      from public.store_products as store_product
      where store_product.user_id = v_user_id
        and store_product.store_id = v_store_id
        and store_product.product_id = v_product_id
        and store_product.store_product_code is not distinct from v_merchant_sku;
      if v_match_count > 1 then
        raise exception 'retail store product identity is ambiguous' using errcode = 'P0003';
      elsif v_match_count = 0 then
        insert into public.store_products (
          user_id, store_id, product_id, store_product_code
        ) values (
          v_user_id, v_store_id, v_product_id, v_merchant_sku
        ) returning id into v_store_product_id;
      end if;

      insert into public.price_observations (
        user_id, store_product_id, receipt_item_id, observed_at,
        unit_price_krw, quantity, catalog_product_id, measurement_unit,
        location_label, attributes, verification_status, verified_at,
        observation_kind, verification_basis, currency, gross_price_krw,
        discount_price_krw, net_price_krw, observed_at_exact
      ) values (
        v_user_id, v_store_product_id, null, v_effective_observed_on,
        v_unit_price_int, v_quantity_int, v_catalog_product_id, null,
        v_effective_seller_branch_name,
        jsonb_build_object(
          'schemaVersion', 'purchase-price-observation.v4',
          'platform', v_platform,
          'seller', v_effective_seller,
          'order', v_order,
          'payment', v_payment,
          'purchaseSourceId', v_source_id,
          'purchaseLineOrdinal', v_line_ordinal,
          'productCandidateClientKey', v_product_client_key,
          'standardProductId', v_standard_product_id
        ),
        'verified', v_now, 'standalone_purchase', v_verification_basis,
        'KRW', v_gross_price_int, v_discount_price_int, v_net_price_int,
        v_effective_observed_at_exact
      ) returning id into v_price_observation_id;
      v_observation_count := v_observation_count + 1;
      v_observation_ids := v_observation_ids || jsonb_build_array(v_price_observation_id);
      else
        insert into public.restaurant_menu_manual_observations (
          restaurant_id, restaurant_location_id, restaurant_menu_id, observed_on,
          unit_price_krw, quantity, total_price_krw, source_url, note,
          source_snapshot, verification_status, created_by, created_at,
          observation_kind, verification_basis, currency, gross_price_krw,
          discount_price_krw, net_price_krw, observed_at_exact
        ) values (
          v_restaurant_id, v_restaurant_location_id, v_restaurant_menu_id,
          v_effective_observed_on, v_unit_price_int, v_quantity_int,
          v_net_price_int, v_source_url, v_note,
          jsonb_build_object(
            'schemaVersion', 'purchase-price-observation.v4',
            'platform', v_platform,
            'seller', v_effective_seller,
            'order', v_order,
            'payment', v_payment,
            'line', v_line,
            'purchaseSourceId', v_source_id,
            'purchaseLineOrdinal', v_line_ordinal,
            'productCandidateClientKey', v_product_client_key,
            'catalogProductId', v_catalog_product_id,
            'standardProductId', v_standard_product_id
          ),
          'verified', v_user_id, v_now, 'standalone_purchase',
          v_verification_basis, 'KRW', v_gross_price_int,
          v_discount_price_int, v_net_price_int, v_effective_observed_at_exact
        ) returning id into v_restaurant_menu_manual_observation_id;
        v_observation_count := v_observation_count + 1;
        v_observation_ids := v_observation_ids || jsonb_build_array(v_restaurant_menu_manual_observation_id);
      end if;
    end if;

    if v_line_reason is null then
      insert into public.purchase_price_source_lines (
        user_id, purchase_source_id, line_ordinal, source_line_key,
        line_seller_status, line_seller_name, line_seller_branch_name,
        line_seller_source_namespace, line_seller_source_code,
        line_seller_business_kind,
        product_client_key, product_name, option_text, merchant_sku,
        price_status, quantity, unit_price_krw, gross_price_krw,
        discount_price_krw, net_price_krw, product_id, store_product_id,
        catalog_product_id, standard_product_id, price_observation_id,
        restaurant_menu_manual_observation_id,
        observation_status, observation_reason, line_payload, created_at
      ) values (
        v_user_id, v_source_id, v_line_ordinal, v_source_line_key,
        v_effective_seller_status, v_effective_seller_name,
        v_effective_seller_branch_name, v_effective_seller_source_namespace,
        v_effective_seller_source_code, v_effective_seller_business_kind,
        v_product_client_key, v_product_name, v_option_text, v_merchant_sku,
        v_price_status, v_quantity_int, v_unit_price_int, v_gross_price_int,
        v_discount_price_int, v_net_price_int, v_product_id,
        v_store_product_id, v_catalog_product_id, v_standard_product_id,
        v_price_observation_id, v_restaurant_menu_manual_observation_id,
        'created', null, v_line, v_now
      );
      v_line_results := v_line_results || jsonb_build_array(jsonb_build_object(
        'lineOrdinal', v_line_ordinal,
        'lineKey', v_source_line_key,
        'seller', v_effective_seller_name,
        'sellerConfirmed', v_effective_seller_status = 'confirmed',
        'observationCreated', true,
        'observationId', coalesce(v_price_observation_id, v_restaurant_menu_manual_observation_id),
        'observationType', case
          when v_purchase_kind = 'retail' then 'price_observation'
          else 'restaurant_menu_manual_observation'
        end
      ));
    else
      insert into public.purchase_price_source_lines (
        user_id, purchase_source_id, line_ordinal, source_line_key,
        line_seller_status, line_seller_name, line_seller_branch_name,
        line_seller_source_namespace, line_seller_source_code,
        line_seller_business_kind,
        product_client_key, product_name, option_text, merchant_sku,
        price_status, quantity, unit_price_krw, gross_price_krw,
        discount_price_krw, net_price_krw, observation_status,
        observation_reason, line_payload, created_at
      ) values (
        v_user_id, v_source_id, v_line_ordinal, v_source_line_key,
        v_effective_seller_status, v_effective_seller_name,
        v_effective_seller_branch_name, v_effective_seller_source_namespace,
        v_effective_seller_source_code, v_effective_seller_business_kind,
        v_product_client_key, v_product_name, v_option_text, v_merchant_sku,
        v_price_status, v_quantity_int, v_unit_price_int, v_gross_price_int,
        v_discount_price_int, v_net_price_int, 'not_created', v_line_reason,
        v_line, v_now
      );
      v_line_results := v_line_results || jsonb_build_array(jsonb_build_object(
        'lineOrdinal', v_line_ordinal,
        'lineKey', v_source_line_key,
        'seller', v_effective_seller_name,
        'sellerConfirmed', v_effective_seller_status = 'confirmed',
        'observationCreated', false,
        'reason', v_line_reason
      ));
    end if;
  end loop;

  v_response := jsonb_build_object(
    'schemaVersion', 'purchase-price-observation.v4',
    'contractVersion', 'purchase-price.v4',
    'kind', v_kind,
    'purchaseKind', v_purchase_kind,
    'transactionState', v_transaction_state,
    'purchaseSourceId', v_source_id,
    'platform', v_platform_name,
    'seller', v_seller_name,
    'sellerConfirmed', v_seller_status = 'confirmed',
    'orderedOn', v_ordered_on,
    'orderedAt', v_ordered_at_text,
    'paidOn', v_paid_on,
    'paidAt', v_paid_at_text,
    'observationCreated', v_observation_count > 0,
    'observationIds', v_observation_ids,
    'lineResults', v_line_results,
    'replayed', false,
    'deduplicated', false
  );

  insert into public.purchase_price_observation_ingestion_contents (
    user_id, request_fingerprint, purchase_source_id, response, created_at
  ) values (
    v_user_id, v_fingerprint, v_source_id, v_response, v_now
  );
  insert into public.purchase_price_observation_ingestion_requests (
    user_id, idempotency_key, request_fingerprint, purchase_source_id,
    response, created_at
  ) values (
    v_user_id, v_key, v_fingerprint, v_source_id, v_response, v_now
  );
  return v_response;
end;
$function$;

comment on function public.ingest_verified_purchase_price_observation_v1(text, jsonb) is
  'Authenticated purchase/order v4 ingest. It separates platform from confirmed seller, preserves unknown order/payment dates as NULL, never uses payment totals to create line observations, and resolves retail Product Candidate client_key values server-side.';

revoke all on function public.ingest_verified_purchase_price_observation_v1(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_verified_purchase_price_observation_v1(text, jsonb)
  to authenticated;
