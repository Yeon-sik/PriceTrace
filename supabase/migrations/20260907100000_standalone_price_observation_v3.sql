-- Receipt-independent, user-verified price observations for OCR v3.
-- This migration is additive. Existing receipt ingestion RPCs and receipt
-- projections keep their existing contract and default to receipt_purchase.

alter table public.price_observations
  alter column receipt_item_id drop not null,
  add column observation_kind text not null default 'receipt_purchase'
    check (observation_kind in ('receipt_purchase', 'standalone_purchase')),
  add column verification_basis text
    check (verification_basis is null or verification_basis in (
      'source_evidence', 'manual_canonical_review'
    )),
  add column currency text not null default 'KRW'
    check (currency = 'KRW'),
  add column gross_price_krw integer,
  add column discount_price_krw integer,
  add column net_price_krw integer,
  add column observed_at_exact timestamptz;

alter table public.price_observations
  add constraint price_observations_standalone_contract_check
  check (
    observation_kind = 'receipt_purchase'
    or (
      receipt_item_id is null
      and verification_basis is not null
      and gross_price_krw is not null
      and gross_price_krw >= 0
      and (discount_price_krw is null or discount_price_krw >= 0)
      and (discount_price_krw is null or discount_price_krw <= gross_price_krw)
      and net_price_krw is not null
      and net_price_krw >= 0
      and gross_price_krw >= net_price_krw
      and (discount_price_krw is null or gross_price_krw - discount_price_krw = net_price_krw)
      and net_price_krw = unit_price_krw * quantity
      and observed_at_exact is not null
    )
  );

create index price_observations_standalone_idx
  on public.price_observations(user_id, observed_at desc, id desc)
  where observation_kind = 'standalone_purchase';

comment on column public.price_observations.receipt_item_id is
  'Nullable for receipt-independent observations. Receipt observations retain their existing foreign-key chain.';
comment on column public.price_observations.observation_kind is
  'receipt_purchase preserves the legacy path; standalone_purchase has no receipt or receipt item.';
comment on column public.price_observations.observed_at_exact is
  'Exact timestamp supplied by standalone v3 when available; observed_at remains the legacy date-compatible field.';

alter table public.restaurant_menu_manual_observations
  add column observation_kind text not null default 'manual_registration'
    check (observation_kind in ('manual_registration', 'standalone_purchase')),
  add column verification_basis text
    check (verification_basis is null or verification_basis in (
      'source_evidence', 'manual_canonical_review'
    )),
  add column currency text not null default 'KRW'
    check (currency = 'KRW'),
  add column gross_price_krw integer,
  add column discount_price_krw integer,
  add column net_price_krw integer,
  add column observed_at_exact timestamptz;

alter table public.restaurant_menu_manual_observations
  add constraint restaurant_menu_manual_standalone_contract_check
  check (
    observation_kind = 'manual_registration'
    or (
      verification_basis is not null
      and gross_price_krw is not null
      and gross_price_krw >= 0
      and (discount_price_krw is null or discount_price_krw >= 0)
      and (discount_price_krw is null or discount_price_krw <= gross_price_krw)
      and net_price_krw is not null
      and net_price_krw >= 0
      and gross_price_krw >= net_price_krw
      and (discount_price_krw is null or gross_price_krw - discount_price_krw = net_price_krw)
      and net_price_krw = unit_price_krw * quantity
      and observed_at_exact is not null
    )
  );

comment on table public.restaurant_menu_manual_observations is
  'Existing manual observations plus receipt-independent v3 observations. Receipt columns are intentionally absent.';

create table public.standalone_price_observation_ingestion_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  request_payload jsonb not null
    check (jsonb_typeof(request_payload) = 'object'),
  kind text not null check (kind in ('retail_purchase', 'restaurant_purchase')),
  observation_id uuid not null,
  retail_price_observation_id uuid,
  restaurant_menu_manual_observation_id uuid,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  foreign key (user_id, retail_price_observation_id)
    references public.price_observations(user_id, id) on delete restrict,
  foreign key (restaurant_menu_manual_observation_id)
    references public.restaurant_menu_manual_observations(id) on delete restrict,
  check (
    (kind = 'retail_purchase'
      and retail_price_observation_id is not null
      and restaurant_menu_manual_observation_id is null
      and observation_id = retail_price_observation_id)
    or
    (kind = 'restaurant_purchase'
      and retail_price_observation_id is null
      and restaurant_menu_manual_observation_id is not null
      and observation_id = restaurant_menu_manual_observation_id)
  )
);

comment on table public.standalone_price_observation_ingestion_requests is
  'Authenticated OCR v3 replay guard and append-only audit. It binds one opaque key and request fingerprint to one authoritative observation.';

alter table public.standalone_price_observation_ingestion_requests enable row level security;
revoke all on public.standalone_price_observation_ingestion_requests from public, anon, authenticated;
grant select on public.standalone_price_observation_ingestion_requests to authenticated;

create policy "users read own standalone observation ingestion requests"
  on public.standalone_price_observation_ingestion_requests
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.reject_standalone_price_observation_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Standalone price observation ingestion audit is append-only.'
    using errcode = '55000';
end;
$function$;

create trigger standalone_price_observation_ingestion_append_only
  before update or delete on public.standalone_price_observation_ingestion_requests
  for each row execute function public.reject_standalone_price_observation_audit_mutation();

revoke all on function public.reject_standalone_price_observation_audit_mutation()
  from public, anon, authenticated;

create or replace function public.ingest_verified_standalone_price_observation_v1(
  p_idempotency_key text,
  p_observation jsonb
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
  v_existing public.standalone_price_observation_ingestion_requests%rowtype;
  v_kind text;
  v_basis text;
  v_observed_on date;
  v_observed_at_exact timestamptz;
  v_merchant jsonb;
  v_product jsonb;
  v_item jsonb;
  v_merchant_name text;
  v_branch_name text;
  v_source_namespace text;
  v_source_code text;
  v_source_location_code text;
  v_product_name text;
  v_merchant_sku text;
  v_brand text;
  v_specification text;
  v_serving_label text;
  v_category_label text;
  v_source_url text;
  v_store_id uuid;
  v_product_id uuid;
  v_store_product_id uuid;
  v_catalog_product_id uuid;
  v_restaurant_id uuid;
  v_restaurant_location_id uuid;
  v_restaurant_menu_id uuid;
  v_standard_product_id uuid;
  v_price_observation_id uuid;
  v_manual_observation_id uuid;
  v_identity_fingerprint text;
  v_location_identity_code text;
  v_location_restaurant_id uuid;
  v_match_count integer;
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
  v_identifiers jsonb;
  v_catalog_ids uuid[] := '{}'::uuid[];
  v_response jsonb;
  v_now timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if length(v_key) not between 1 and 200 then
    raise exception 'idempotency key must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if p_observation is null or pg_catalog.jsonb_typeof(p_observation) <> 'object' then
    raise exception 'standalone price observation must be a JSON object' using errcode = '22023';
  end if;

  v_fingerprint := encode(
    extensions.digest(convert_to(p_observation::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':standalone-observation:' || v_key, 0)
  );
  select request.* into v_existing
  from public.standalone_price_observation_ingestion_requests as request
  where request.user_id = v_user_id
    and request.idempotency_key = v_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'The idempotency key was already used for another request.' using errcode = '23505';
    end if;
    return v_existing.response || jsonb_build_object('replayed', true);
  end if;

  -- The wire contract contains facts only. Any UUID-shaped value or known
  -- server identity field is rejected before it can reach an identity query.
  if p_observation::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    or p_observation::text ~* '"(id|[a-z0-9]+_id|[a-zA-Z]+Id|uuid)"[[:space:]]*:'
  then
    raise exception 'external JSON must not contain UUID or PriceTrace identity fields' using errcode = '22023';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_observation) as field_name
    where field_name not in (
      'schema_version', 'contract_version', 'kind', 'verification_basis',
      'transcription_status', 'observed_on', 'observed_at', 'currency',
      'gross_price', 'discount', 'net_price', 'quantity', 'unit_price',
      'merchant', 'product', 'item', 'source_url', 'note'
    )
  ) then
    raise exception 'standalone price observation contains unsupported fields' using errcode = '22023';
  end if;

  if coalesce(p_observation ->> 'schema_version', '') <> 'receipt-independent-price-observation.v3'
    or coalesce(p_observation ->> 'contract_version', '') <> 'price-observation.v3'
    or coalesce(p_observation ->> 'kind', '') not in ('retail_purchase', 'restaurant_purchase')
    or coalesce(p_observation ->> 'verification_basis', '') not in ('source_evidence', 'manual_canonical_review')
    or coalesce(p_observation ->> 'transcription_status', '') <> 'user_verified'
    or coalesce(p_observation ->> 'currency', '') <> 'KRW'
  then
    raise exception 'standalone v3 required contract fields are invalid' using errcode = '22023';
  end if;

  v_kind := p_observation ->> 'kind';
  v_basis := p_observation ->> 'verification_basis';
  if not (p_observation ? 'observed_on' or p_observation ? 'observed_at') then
    raise exception 'observed_on or observed_at is required' using errcode = '22023';
  end if;
  if p_observation ? 'observed_on'
    and (pg_catalog.jsonb_typeof(p_observation -> 'observed_on') is distinct from 'string'
      or p_observation ->> 'observed_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  then
    raise exception 'observed_on must be an ISO date' using errcode = '22023';
  end if;
  if p_observation ? 'observed_at'
    and (pg_catalog.jsonb_typeof(p_observation -> 'observed_at') is distinct from 'string'
      or length(pg_catalog.btrim(p_observation ->> 'observed_at')) = 0)
  then
    raise exception 'observed_at must be an ISO timestamp' using errcode = '22023';
  end if;
  if p_observation ? 'observed_on' then
    v_observed_on := (p_observation ->> 'observed_on')::date;
  end if;
  if p_observation ? 'observed_at' then
    v_observed_at_exact := (p_observation ->> 'observed_at')::timestamptz;
    if v_observed_on is null then
      v_observed_on := (v_observed_at_exact at time zone 'UTC')::date;
    elsif v_observed_on <> (v_observed_at_exact at time zone 'UTC')::date then
      raise exception 'observed_on and observed_at refer to different dates' using errcode = '22023';
    end if;
  else
    v_observed_at_exact := v_observed_on::timestamptz;
  end if;

  if p_observation -> 'merchant' is null
    or pg_catalog.jsonb_typeof(p_observation -> 'merchant') <> 'object'
  then
    raise exception 'merchant facts are required' using errcode = '22023';
  end if;
  v_merchant := p_observation -> 'merchant';
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(v_merchant) as field_name
    where field_name not in (
      'merchant_name', 'branch_name', 'source_namespace', 'source_code',
      'source_location_code', 'business_registration_number', 'address',
      'phone'
    )
  ) then
    raise exception 'merchant facts contain unsupported fields' using errcode = '22023';
  end if;
  v_merchant_name := nullif(pg_catalog.btrim(v_merchant ->> 'merchant_name'), '');
  v_branch_name := nullif(pg_catalog.btrim(v_merchant ->> 'branch_name'), '');
  v_source_namespace := nullif(pg_catalog.btrim(v_merchant ->> 'source_namespace'), '');
  v_source_code := nullif(pg_catalog.btrim(v_merchant ->> 'source_code'), '');
  v_source_location_code := nullif(pg_catalog.btrim(v_merchant ->> 'source_location_code'), '');
  if v_merchant_name is null or length(v_merchant_name) > 500 then
    raise exception 'merchant_name is required' using errcode = '22023';
  end if;
  if v_kind = 'restaurant_purchase' and v_source_location_code is not null
    and length(v_source_location_code) > 200
  then
    raise exception 'source_location_code is too long' using errcode = '22023';
  end if;

  if p_observation ? 'source_url' then
    if pg_catalog.jsonb_typeof(p_observation -> 'source_url') not in ('string', 'null') then
      raise exception 'source_url must be a string or null' using errcode = '22023';
    end if;
    v_source_url := nullif(pg_catalog.btrim(p_observation ->> 'source_url'), '');
    if v_source_url is not null and v_source_url !~ '^https?://' then
      raise exception 'source_url must be an HTTP(S) URL' using errcode = '22023';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_observation -> 'quantity') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_observation -> 'unit_price') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_observation -> 'gross_price') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_observation -> 'net_price') is distinct from 'number'
    or (p_observation ? 'discount' and pg_catalog.jsonb_typeof(p_observation -> 'discount') not in ('number', 'null'))
  then
    raise exception 'quantity, unit_price, gross_price, and net_price must be numbers; discount may be null' using errcode = '22023';
  end if;
  v_quantity := (p_observation ->> 'quantity')::numeric;
  v_unit_price := (p_observation ->> 'unit_price')::numeric;
  v_gross_price := (p_observation ->> 'gross_price')::numeric;
  v_net_price := (p_observation ->> 'net_price')::numeric;
  if p_observation ? 'discount' and pg_catalog.jsonb_typeof(p_observation -> 'discount') = 'number' then
    v_discount_price := (p_observation ->> 'discount')::numeric;
  end if;
  if v_quantity < 1 or v_quantity <> trunc(v_quantity)
    or v_unit_price < 0 or v_unit_price <> trunc(v_unit_price)
    or v_gross_price < 0 or v_gross_price <> trunc(v_gross_price)
    or v_net_price < 0 or v_net_price <> trunc(v_net_price)
    or (v_discount_price is not null and (v_discount_price < 0 or v_discount_price <> trunc(v_discount_price)))
    or v_quantity > 2147483647 or v_unit_price > 2147483647
    or v_gross_price > 2147483647 or v_net_price > 2147483647
    or (v_discount_price is not null and v_discount_price > 2147483647)
  then
    raise exception 'price facts must be non-negative integer KRW values and quantity must be positive' using errcode = '22023';
  end if;
  v_quantity_int := v_quantity::integer;
  v_unit_price_int := v_unit_price::integer;
  v_gross_price_int := v_gross_price::integer;
  v_net_price_int := v_net_price::integer;
  v_discount_price_int := v_discount_price::integer;
  if v_net_price <> v_quantity * v_unit_price then
    raise exception 'quantity multiplied by unit_price must equal net_price' using errcode = '23514';
  end if;
  if v_gross_price < v_net_price
    or (v_discount_price is not null and v_gross_price - v_discount_price <> v_net_price)
  then
    raise exception 'gross_price minus discount must equal net_price when discount is known' using errcode = '23514';
  end if;

  if v_kind = 'retail_purchase' then
    if p_observation -> 'product' is null
      or pg_catalog.jsonb_typeof(p_observation -> 'product') <> 'object'
    then
      raise exception 'retail product candidate facts are required' using errcode = '22023';
    end if;
    v_product := p_observation -> 'product';
    if exists (
      select 1 from pg_catalog.jsonb_object_keys(v_product) as field_name
      where field_name not in ('product_name', 'merchant_sku', 'brand', 'specification', 'identifiers')
    ) then
      raise exception 'retail product facts contain unsupported fields' using errcode = '22023';
    end if;
    v_product_name := nullif(pg_catalog.btrim(v_product ->> 'product_name'), '');
    v_merchant_sku := nullif(pg_catalog.btrim(v_product ->> 'merchant_sku'), '');
    v_brand := nullif(pg_catalog.btrim(v_product ->> 'brand'), '');
    v_specification := nullif(pg_catalog.btrim(v_product ->> 'specification'), '');
    if v_product_name is null or length(v_product_name) > 500 then
      raise exception 'product_name is required' using errcode = '22023';
    end if;
    v_identifiers := coalesce(v_product -> 'identifiers', '[]'::jsonb);
    if pg_catalog.jsonb_typeof(v_identifiers) <> 'array' then
      raise exception 'product identifiers must be an array' using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_identifiers) as identifier(value)
      where pg_catalog.jsonb_typeof(identifier.value) <> 'object'
        or exists (
          select 1 from pg_catalog.jsonb_object_keys(identifier.value) as field_name
          where field_name not in ('scheme', 'value')
        )
        or coalesce(identifier.value ->> 'scheme', '') not in ('ean', 'upc', 'gtin')
        or coalesce(identifier.value ->> 'value', '') !~ '^[0-9]{8,14}$'
    ) then
      raise exception 'product identifiers are invalid' using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_user_id::text || ':standalone-retail:' || v_merchant_name || ':' ||
        coalesce(v_branch_name, '') || ':' || coalesce(v_source_code, '') || ':' || v_product_name,
        0
      )
    );
    v_identity_fingerprint := encode(
      extensions.digest(
        convert_to(
          pg_catalog.concat_ws('|', 'retail', v_merchant_name, coalesce(v_branch_name, ''),
            coalesce(v_source_namespace, ''), coalesce(v_source_code, '')),
          'UTF8'
        ), 'sha256'
      ), 'hex'
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user_id::text || ':standalone-retail-store:' || v_identity_fingerprint, 0)
    );
    select count(*), min(store.id) into v_match_count, v_store_id
    from public.stores as store
    where store.user_id = v_user_id
      and coalesce(store.merchant_name, store.name) = v_merchant_name
      and coalesce(store.branch_name, '') = coalesce(v_branch_name, '')
      and coalesce(store.catalog_namespace, '') = coalesce(v_source_namespace, '')
      and coalesce(store.merchant_id, '') = coalesce(v_source_code, '');
    if v_match_count > 1 then
      raise exception 'retail merchant identity is ambiguous' using errcode = 'P0003';
    elsif v_match_count = 0 then
      insert into public.stores (
        user_id, name, merchant_name, branch_name, business_kind,
        merchant_id, catalog_namespace, identity_fingerprint
      ) values (
        v_user_id,
        v_merchant_name || case when v_branch_name is null then '' else ' - ' || v_branch_name end,
        v_merchant_name, v_branch_name, 'retail', v_source_code, v_source_namespace,
        v_identity_fingerprint
      ) returning id into v_store_id;
    end if;

    select count(*), min(product.id) into v_match_count, v_product_id
    from public.products as product
    where product.user_id = v_user_id
      and product.name = v_product_name
      and product.purchase_type = 'retail_product';
    if v_match_count > 1 then
      raise exception 'retail product identity is ambiguous' using errcode = 'P0003';
    elsif v_match_count = 0 then
      insert into public.products (user_id, name, purchase_type, category_tags)
      values (v_user_id, v_product_name, 'retail_product', array[]::text[])
      returning id into v_product_id;
    end if;

    select count(*), min(store_product.id) into v_match_count, v_store_product_id
    from public.store_products as store_product
    where store_product.user_id = v_user_id
      and store_product.store_id = v_store_id
      and store_product.product_id = v_product_id
      and store_product.store_product_code is not distinct from v_merchant_sku;
    if v_match_count > 1 then
      raise exception 'retail store product identity is ambiguous' using errcode = 'P0003';
    elsif v_match_count = 0 then
      insert into public.store_products (user_id, store_id, product_id, store_product_code)
      values (v_user_id, v_store_id, v_product_id, v_merchant_sku)
      returning id into v_store_product_id;
    end if;

    select coalesce(array_agg(distinct identifier_row.catalog_product_id order by identifier_row.catalog_product_id), '{}'::uuid[])
      into v_catalog_ids
    from pg_catalog.jsonb_array_elements(v_identifiers) as input_identifier(value)
    inner join public.catalog_product_identifiers as identifier_row
      on identifier_row.identifier_scheme = input_identifier.value ->> 'scheme'
      and identifier_row.identifier_value = input_identifier.value ->> 'value'
      and identifier_row.verification_status = 'verified'
    inner join public.catalog_products as catalog
      on catalog.id = identifier_row.catalog_product_id
      and catalog.purchase_type = 'retail_product'
      and catalog.status = 'active';
    if cardinality(v_catalog_ids) > 1 then
      raise exception 'retail product candidate resolves to ambiguous canonical identities' using errcode = 'P0003';
    elsif cardinality(v_catalog_ids) = 1 then
      v_catalog_product_id := v_catalog_ids[1];
    else
      select count(*), min(mapping.catalog_product_id) into v_match_count, v_catalog_product_id
      from public.source_product_mappings as mapping
      inner join public.catalog_products as catalog
        on catalog.id = mapping.catalog_product_id
        and catalog.purchase_type = 'retail_product'
        and catalog.status = 'active'
      where v_merchant_sku is not null
        and mapping.source_label = v_merchant_name
        and mapping.source_product_code = v_merchant_sku
        and mapping.review_status = 'verified'
        and mapping.verification_status = 'verified';
      if v_match_count > 1 then
        raise exception 'retail source mapping resolves to ambiguous canonical identities' using errcode = 'P0003';
      end if;
    end if;

    insert into public.price_observations (
      user_id, store_product_id, receipt_item_id, observed_at, unit_price_krw,
      quantity, catalog_product_id, measurement_unit, location_label, attributes,
      verification_status, verified_at, observation_kind, verification_basis,
      currency, gross_price_krw, discount_price_krw, net_price_krw, observed_at_exact
    ) values (
      v_user_id, v_store_product_id, null, v_observed_on, v_unit_price_int,
      v_quantity_int, v_catalog_product_id, 'each', v_branch_name,
      jsonb_build_object('schemaVersion', 'receipt-independent-price-observation.v3',
        'merchant', v_merchant, 'product', v_product, 'sourceUrl', v_source_url),
      'verified', v_now, 'standalone_purchase', v_basis, 'KRW', v_gross_price_int,
      v_discount_price_int, v_net_price_int, v_observed_at_exact
    ) returning id into v_price_observation_id;

    v_response := jsonb_build_object(
      'schemaVersion', 'receipt-independent-price-observation.v3',
      'kind', v_kind,
      'observationId', v_price_observation_id,
      'replayed', false,
      'authoritativeIds', jsonb_build_object(
        'storeId', v_store_id,
        'productId', v_product_id,
        'storeProductId', v_store_product_id,
        'catalogProductId', v_catalog_product_id
      )
    );
    insert into public.standalone_price_observation_ingestion_requests (
      user_id, idempotency_key, request_fingerprint, request_payload, kind,
      observation_id, retail_price_observation_id, response, created_at
    ) values (
      v_user_id, v_key, v_fingerprint, p_observation, v_kind,
      v_price_observation_id, v_price_observation_id, v_response, v_now
    );
    return v_response;
  end if;

  if p_observation -> 'item' is null
    or pg_catalog.jsonb_typeof(p_observation -> 'item') <> 'object'
  then
    raise exception 'restaurant menu item facts are required' using errcode = '22023';
  end if;
  v_item := p_observation -> 'item';
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(v_item) as field_name
    where field_name not in ('item_name', 'serving_label', 'category_label')
  ) then
    raise exception 'restaurant item facts contain unsupported fields' using errcode = '22023';
  end if;
  v_product_name := nullif(pg_catalog.btrim(v_item ->> 'item_name'), '');
  v_serving_label := coalesce(nullif(pg_catalog.btrim(v_item ->> 'serving_label'), ''), '1회 제공');
  v_category_label := nullif(pg_catalog.btrim(v_item ->> 'category_label'), '');
  if v_product_name is null or length(v_product_name) > 500 then
    raise exception 'item_name is required' using errcode = '22023';
  end if;

  v_source_namespace := coalesce(v_source_namespace, 'standalone-v3');
  v_location_identity_code := coalesce(
    v_source_location_code,
    encode(extensions.digest(convert_to(
      pg_catalog.concat_ws('|', v_merchant_name, coalesce(v_branch_name, '')),
      'UTF8'), 'sha256'), 'hex')
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text || ':standalone-restaurant:' || v_merchant_name || ':' ||
      coalesce(v_branch_name, '') || ':' || v_product_name,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      ':standalone-restaurant-location:' || v_source_namespace || ':' || v_location_identity_code,
      0
    )
  );
  select count(*), min(restaurant.id) into v_match_count, v_restaurant_id
  from public.restaurants as restaurant
  where restaurant.canonical_name = v_merchant_name
    and restaurant.status = 'active';
  if v_match_count > 1 then
    raise exception 'restaurant identity is ambiguous' using errcode = 'P0003';
  elsif v_match_count = 0 then
    insert into public.restaurants (
      canonical_name, review_status, status, verification_status, created_by
    ) values (
      v_merchant_name, 'pending', 'active', 'unverified', v_user_id
    ) returning id into v_restaurant_id;
  end if;

  select count(*), min(location.id), min(location.restaurant_id)
    into v_match_count, v_restaurant_location_id, v_location_restaurant_id
  from public.restaurant_locations as location
  where location.source_namespace = v_source_namespace
    and location.source_location_code = v_location_identity_code;
  if v_match_count > 1 then
    raise exception 'restaurant location identity is ambiguous' using errcode = 'P0003';
  elsif v_match_count = 1 then
    if v_location_restaurant_id <> v_restaurant_id then
      raise exception 'restaurant location belongs to another restaurant' using errcode = '23505';
    end if;
  else
    insert into public.restaurant_locations (
      restaurant_id, source_namespace, source_location_code, location_label,
      review_status, verification_status, created_by
    ) values (
      v_restaurant_id, v_source_namespace, v_location_identity_code, v_branch_name,
      'pending', 'unverified', v_user_id
    ) returning id into v_restaurant_location_id;
  end if;

  select count(*), min(menu.id), min(menu.catalog_product_id)
    into v_match_count, v_restaurant_menu_id, v_catalog_product_id
  from public.restaurant_menus as menu
  where menu.restaurant_id = v_restaurant_id
    and menu.canonical_name = v_product_name
    and menu.serving_label = v_serving_label
    and menu.status = 'active';
  if v_match_count > 1 then
    raise exception 'restaurant menu identity is ambiguous' using errcode = 'P0003';
  elsif v_match_count = 0 then
    insert into public.standard_products (
      purchase_type, canonical_name, product_reference_url, status,
      created_by, verification_status
    ) values (
      'menu_item', v_product_name, v_source_url, 'active', v_user_id, 'unverified'
    ) returning id into v_standard_product_id;
    insert into public.catalog_products (
      standard_product_id, purchase_type, canonical_name, brand, specification,
      specification_status, content_amount, content_unit, package_count,
      reference_unit, listing_reference_url, attributes, status, created_by,
      verification_status
    ) values (
      v_standard_product_id, 'menu_item', v_product_name, v_merchant_name,
      v_serving_label, 'placeholder', 1, 'each', 1, 100, v_source_url,
      jsonb_build_object('restaurantId', v_restaurant_id, 'registrationSource',
        'standalone_price_observation_v3'), 'active', v_user_id, 'unverified'
    ) returning id into v_catalog_product_id;
    insert into public.restaurant_menus (
      restaurant_id, catalog_product_id, canonical_name, category_label,
      serving_label, official_url, review_status, status, verification_status,
      created_by
    ) values (
      v_restaurant_id, v_catalog_product_id, v_product_name, v_category_label,
      v_serving_label, v_source_url, 'pending', 'active', 'unverified', v_user_id
    ) returning id into v_restaurant_menu_id;
  end if;

  select catalog.standard_product_id into v_standard_product_id
  from public.catalog_products as catalog
  where catalog.id = v_catalog_product_id;

  insert into public.restaurant_menu_manual_observations (
    restaurant_id, restaurant_location_id, restaurant_menu_id, observed_on,
    unit_price_krw, quantity, total_price_krw, source_url, note, source_snapshot,
    verification_status, created_by, created_at, observation_kind,
    verification_basis, currency, gross_price_krw, discount_price_krw,
    net_price_krw, observed_at_exact
  ) values (
    v_restaurant_id, v_restaurant_location_id, v_restaurant_menu_id, v_observed_on,
    v_unit_price_int, v_quantity_int, v_net_price_int, v_source_url,
    nullif(pg_catalog.btrim(p_observation ->> 'note'), ''),
    jsonb_build_object('schemaVersion', 'receipt-independent-price-observation.v3',
      'merchant', v_merchant, 'item', v_item, 'sourceUrl', v_source_url,
      'grossPrice', v_gross_price_int, 'discount', v_discount_price_int,
      'netPrice', v_net_price_int, 'currency', 'KRW'),
    'verified', v_user_id, v_now, 'standalone_purchase', v_basis, 'KRW',
    v_gross_price_int, v_discount_price_int, v_net_price_int, v_observed_at_exact
  ) returning id into v_manual_observation_id;

  v_response := jsonb_build_object(
    'schemaVersion', 'receipt-independent-price-observation.v3',
    'kind', v_kind,
    'observationId', v_manual_observation_id,
    'replayed', false,
    'authoritativeIds', jsonb_build_object(
      'restaurantId', v_restaurant_id,
      'restaurantLocationId', v_restaurant_location_id,
      'restaurantMenuId', v_restaurant_menu_id,
      'catalogProductId', v_catalog_product_id,
      'standardProductId', v_standard_product_id
    )
  );
  insert into public.standalone_price_observation_ingestion_requests (
    user_id, idempotency_key, request_fingerprint, request_payload, kind,
    observation_id, restaurant_menu_manual_observation_id, response, created_at
  ) values (
    v_user_id, v_key, v_fingerprint, p_observation, v_kind,
    v_manual_observation_id, v_manual_observation_id, v_response, v_now
  );
  return v_response;
end;
$function$;

comment on function public.ingest_verified_standalone_price_observation_v1(text, jsonb) is
  'Accepts only user-verified receipt-independent v3 facts, resolves or creates PriceTrace-owned identities, rejects external UUIDs, and returns authoritative IDs.';

revoke all on function public.ingest_verified_standalone_price_observation_v1(text, jsonb)
  from public, anon;
grant execute on function public.ingest_verified_standalone_price_observation_v1(text, jsonb)
  to authenticated;
