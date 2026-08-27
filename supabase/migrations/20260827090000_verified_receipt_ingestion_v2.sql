-- PriceTrace-owned ingestion boundary for the verified receipt.v2 source.
-- This is additive: submit_restaurant_receipt_v1 remains available for old
-- clients, while new clients must use the generic v2 RPC below.

alter table public.stores
  add column merchant_id text,
  add column catalog_namespace text,
  add column business_registration_number text,
  add column address text,
  add column phone text,
  add column identity_fingerprint text
    check (identity_fingerprint is null or identity_fingerprint ~ '^[0-9a-f]{64}$');

alter table public.stores
  add constraint stores_user_identity_fingerprint_key
  unique (user_id, identity_fingerprint);

comment on column public.stores.identity_fingerprint is
  'Server-derived private seller identity fingerprint. It is never supplied as a catalog identity by OCR.';

create table public.verified_receipt_sources (
  receipt_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null default 'receipt.v2' check (schema_version = 'receipt.v2'),
  document_id text,
  document_type text not null,
  document_status text not null,
  issued_on date,
  issued_at timestamptz,
  fulfillment_type text not null,
  fulfillment_evidence text not null,
  capture_method text not null,
  transcription_status text not null check (transcription_status = 'user_verified'),
  merchant_name text not null,
  branch_name text,
  business_kind text not null,
  retail_channel text not null,
  catalog_namespace text,
  merchant_id text,
  business_registration_number text,
  address text,
  phone text,
  items_gross_amount_minor integer not null,
  discount_amount_minor integer not null,
  tax_amount_minor integer not null,
  fee_amount_minor integer not null,
  tip_amount_minor integer not null,
  rounding_amount_minor integer not null,
  grand_total_amount_minor integer not null,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (user_id, receipt_id),
  unique (user_id, source_fingerprint),
  foreign key (user_id, receipt_id) references public.receipts(user_id, id) on delete cascade,
  check (issued_on is not null or issued_at is not null),
  check (length(btrim(merchant_name)) > 0)
);

comment on table public.verified_receipt_sources is
  'Sanitized user-verified receipt.v2 source projection. It deliberately excludes source images, raw OCR text, payments, and payment references.';

create table public.verified_receipt_source_lines (
  receipt_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_line_id text not null,
  line_type text not null check (line_type in ('product', 'service', 'discount', 'fee', 'tax', 'tip', 'refund', 'rounding', 'other')),
  description text,
  source_line_references text[] not null,
  merchant_sku text,
  quantity_value numeric,
  quantity_unit text,
  unit_price_amount_minor integer,
  gross_amount_minor integer not null,
  discount_amount_minor integer not null,
  tax_amount_minor integer not null,
  net_amount_minor integer,
  tax_rate_percent numeric,
  food_service_role text check (food_service_role in ('main', 'option', 'side')),
  applies_to_source_line_id text,
  created_at timestamptz not null default now(),
  primary key (receipt_id, source_line_id),
  foreign key (user_id, receipt_id) references public.receipts(user_id, id) on delete cascade,
  check (cardinality(source_line_references) > 0),
  check (gross_amount_minor >= 0),
  check (discount_amount_minor >= 0),
  check (tax_amount_minor >= 0),
  check (quantity_value is null or quantity_value > 0),
  check (merchant_sku is null or length(btrim(merchant_sku)) > 0),
  check (
    (food_service_role = 'option' and applies_to_source_line_id is not null)
    or (food_service_role is distinct from 'option' and applies_to_source_line_id is null)
  )
);

comment on table public.verified_receipt_source_lines is
  'Sanitized line semantics from receipt.v2, including discounts, taxes, fees, tips, refunds, rounding, source references, and optional menu option links.';

create table public.verified_receipt_ingestion_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  receipt_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  unique (user_id, request_fingerprint),
  foreign key (user_id, receipt_id) references public.receipts(user_id, id) on delete restrict
);

comment on table public.verified_receipt_ingestion_requests is
  'Per-user replay guard for verified receipt.v2. It stores only a one-way fingerprint, the server receipt ID, and the sanitized response.';

create table public.merchant_identity_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  origin text not null check (origin in ('receipt_ingestion', 'merchant_only')),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  merchant_name text not null check (length(btrim(merchant_name)) > 0),
  branch_name text,
  business_registration_number text,
  address text,
  phone text,
  business_kind text not null,
  source_namespace text,
  source_code text,
  idempotency_key text,
  user_verified boolean not null default true check (user_verified),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  matched_restaurant_id uuid references public.restaurants(id) on delete restrict,
  matched_restaurant_location_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, origin, source_fingerprint),
  check ((source_namespace is null) = (source_code is null))
);

comment on table public.merchant_identity_candidates is
  'User-confirmed, sanitized merchant facts awaiting exact identity selection or administrator registration. GPT output alone cannot enter this table.';

alter table public.verified_receipt_sources enable row level security;
alter table public.verified_receipt_source_lines enable row level security;
alter table public.verified_receipt_ingestion_requests enable row level security;
alter table public.merchant_identity_candidates enable row level security;
revoke all on public.verified_receipt_sources, public.verified_receipt_source_lines,
  public.verified_receipt_ingestion_requests, public.merchant_identity_candidates
  from public, anon, authenticated;

create index merchant_identity_candidates_review_idx
  on public.merchant_identity_candidates(review_status, created_at desc);

create unique index merchant_identity_candidates_idempotency_key_idx
  on public.merchant_identity_candidates(user_id, origin, idempotency_key)
  where idempotency_key is not null;

create or replace function public.submit_verified_receipt_v2(
  p_idempotency_key text,
  p_receipt jsonb
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
  v_existing public.verified_receipt_ingestion_requests%rowtype;
  v_duplicate public.verified_receipt_ingestion_requests%rowtype;
  v_receipt_id uuid;
  v_store_id uuid;
  v_candidate_id uuid;
  v_restaurant_id uuid;
  v_restaurant_location_id uuid;
  v_match_count integer := 0;
  v_source jsonb;
  v_merchant jsonb;
  v_totals jsonb;
  v_merchant_name text;
  v_branch_name text;
  v_business_kind text;
  v_catalog_namespace text;
  v_merchant_id text;
  v_bnr text;
  v_address text;
  v_phone text;
  v_purchased_at date;
  v_store_fingerprint text;
  v_line jsonb;
  v_line_id text;
  v_line_type text;
  v_description text;
  v_sku text;
  v_quantity numeric;
  v_unit text;
  v_net integer;
  v_product_type text;
  v_product_id uuid;
  v_store_product_id uuid;
  v_receipt_item_id text;
  v_price_observation_id uuid;
  v_restaurant_menu_id uuid;
  v_source_menu_mapping_id uuid;
  v_catalog_product_id uuid;
  v_menu_match_count integer;
  v_observation_id uuid;
  v_observation_fingerprint text;
  v_line_results jsonb := '[]'::jsonb;
  v_observation_ids jsonb := '[]'::jsonb;
  v_response jsonb;
  v_index integer := 0;
  v_parent_receipt_item_id text;
  v_food_service jsonb;
  v_gross integer;
  v_discount integer;
  v_tax integer;
  v_refund integer;
  v_expected integer;
  v_items_gross integer;
  v_total_discount integer;
  v_total_tax integer;
  v_total_fee integer;
  v_total_tip integer;
  v_total_rounding integer;
  v_grand_total integer;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if length(v_key) not between 1 and 200 then
    raise exception 'idempotency key must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if p_receipt is null or jsonb_typeof(p_receipt) <> 'object'
    or p_receipt ->> 'schema_version' <> 'receipt.v2'
  then
    raise exception 'receipt.v2 JSON object is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_receipt) as field_name
    where field_name not in ('schema_version', 'document', 'merchant', 'line_items', 'totals', 'payments')
  )
    or exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(p_receipt -> 'document') = 'object' then p_receipt -> 'document' else '{}'::jsonb end
      ) as field_name
      where field_name not in ('id', 'type', 'status', 'issued_on', 'issued_at', 'currency', 'fulfillment', 'source')
    )
    or exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(p_receipt -> 'merchant') = 'object' then p_receipt -> 'merchant' else '{}'::jsonb end
      ) as field_name
      where field_name not in ('name', 'branch_name', 'business_kind', 'retail_channel', 'catalog_namespace', 'merchant_id', 'business_registration_number', 'address', 'phone')
    )
    or exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(p_receipt -> 'totals') = 'object' then p_receipt -> 'totals' else '{}'::jsonb end
      ) as field_name
      where field_name not in ('items_gross_amount_minor', 'discount_amount_minor', 'tax_amount_minor', 'fee_amount_minor', 'tip_amount_minor', 'rounding_amount_minor', 'grand_total_amount_minor')
    )
    or exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(p_receipt -> 'payments') = 'object' then p_receipt -> 'payments' else '{}'::jsonb end
      ) as field_name
      where field_name not in ('method', 'amount_minor', 'status', 'reference')
    )
    or exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(p_receipt -> 'document' -> 'source') = 'object' then p_receipt -> 'document' -> 'source' else '{}'::jsonb end
      ) as field_name
      where field_name not in ('capture_method', 'original_document_id', 'source_images', 'transcription_status', 'notes', 'raw_text')
    )
    or exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(p_receipt -> 'document' -> 'fulfillment') = 'object' then p_receipt -> 'document' -> 'fulfillment' else '{}'::jsonb end
      ) as field_name
      where field_name not in ('type', 'evidence')
    )
    or exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(p_receipt -> 'payments') = 'array' then p_receipt -> 'payments' else '[]'::jsonb end
      ) as payment(value)
      where jsonb_typeof(payment.value) is distinct from 'object'
        or exists (
          select 1 from jsonb_object_keys(
            case when jsonb_typeof(payment.value) = 'object' then payment.value else '{}'::jsonb end
          ) as field_name
          where field_name not in ('method', 'amount_minor', 'status', 'reference')
        )
    )
  then
    raise exception 'receipt.v2 contains unsupported identity or source fields' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_key, 0)
  );

  v_fingerprint := encode(extensions.digest(p_receipt::text, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_fingerprint, 0)
  );
  select * into v_existing
  from public.verified_receipt_ingestion_requests
  where user_id = v_user_id and idempotency_key = v_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'idempotency key was already used for another receipt' using errcode = '23505';
    end if;
    return v_existing.response || jsonb_build_object('replayed', true, 'deduplicated', true);
  end if;

  select * into v_duplicate
  from public.verified_receipt_ingestion_requests
  where user_id = v_user_id and request_fingerprint = v_fingerprint;
  if found then
    return v_duplicate.response || jsonb_build_object('replayed', false, 'deduplicated', true);
  end if;

  v_source := p_receipt -> 'document' -> 'source';
  v_merchant := p_receipt -> 'merchant';
  v_totals := p_receipt -> 'totals';
  if jsonb_typeof(p_receipt -> 'document') is distinct from 'object'
    or jsonb_typeof(v_source) is distinct from 'object'
    or jsonb_typeof(v_merchant) is distinct from 'object'
    or jsonb_typeof(v_totals) is distinct from 'object'
    or p_receipt -> 'document' ->> 'currency' is distinct from 'KRW'
    or v_source ->> 'transcription_status' is distinct from 'user_verified'
    or jsonb_typeof(v_source -> 'source_images') is distinct from 'array'
    or jsonb_array_length(case when jsonb_typeof(v_source -> 'source_images') = 'array' then v_source -> 'source_images' else '[]'::jsonb end) <> 0
    or v_source -> 'raw_text' is distinct from 'null'::jsonb
    or jsonb_typeof(p_receipt -> 'payments') is distinct from 'array'
    or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_receipt -> 'payments') = 'array' then p_receipt -> 'payments' else '[]'::jsonb end) as payment where payment -> 'reference' is distinct from 'null'::jsonb)
  then
    raise exception 'only privacy-sanitized user_verified receipt.v2 is accepted' using errcode = '22023';
  end if;

  v_merchant_name := pg_catalog.btrim(coalesce(v_merchant ->> 'name', ''));
  v_branch_name := nullif(pg_catalog.btrim(coalesce(v_merchant ->> 'branch_name', '')), '');
  v_business_kind := coalesce(v_merchant ->> 'business_kind', 'unknown');
  v_catalog_namespace := nullif(pg_catalog.btrim(coalesce(v_merchant ->> 'catalog_namespace', '')), '');
  v_merchant_id := nullif(pg_catalog.btrim(coalesce(v_merchant ->> 'merchant_id', '')), '');
  v_bnr := nullif(pg_catalog.regexp_replace(coalesce(v_merchant ->> 'business_registration_number', ''), '[^0-9]', '', 'g'), '');
  v_address := nullif(pg_catalog.btrim(coalesce(v_merchant ->> 'address', '')), '');
  v_phone := nullif(pg_catalog.btrim(coalesce(v_merchant ->> 'phone', '')), '');
  if length(v_merchant_name) = 0 or v_merchant ->> 'business_kind' is null
    or (v_merchant ->> 'business_kind') not in ('retail', 'food_service', 'transport', 'accommodation', 'healthcare', 'professional_service', 'utility', 'government', 'financial', 'marketplace', 'other', 'unknown')
    or (p_receipt -> 'document' ->> 'issued_on' is null and p_receipt -> 'document' ->> 'issued_at' is null)
  then
    raise exception 'merchant, business kind, and local purchase date/time are required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_receipt -> 'line_items') <> 'array'
    or jsonb_array_length(case when jsonb_typeof(p_receipt -> 'line_items') = 'array' then p_receipt -> 'line_items' else '[]'::jsonb end) < 1
    or jsonb_array_length(case when jsonb_typeof(p_receipt -> 'line_items') = 'array' then p_receipt -> 'line_items' else '[]'::jsonb end) > 500
    or (select count(*) from jsonb_array_elements(case when jsonb_typeof(p_receipt -> 'line_items') = 'array' then p_receipt -> 'line_items' else '[]'::jsonb end) as line) <> (select count(distinct line ->> 'id') from jsonb_array_elements(case when jsonb_typeof(p_receipt -> 'line_items') = 'array' then p_receipt -> 'line_items' else '[]'::jsonb end) as line)
  then
    raise exception 'receipt.v2 line items must have 1 to 500 unique IDs' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_receipt -> 'line_items') as line(value)
    where jsonb_typeof(line.value) is distinct from 'object'
      or exists (
        select 1 from jsonb_object_keys(
          case when jsonb_typeof(line.value) = 'object' then line.value else '{}'::jsonb end
        ) as field_name
        where field_name not in ('id', 'type', 'description', 'source_line_references', 'identifiers', 'quantity', 'unit_price_amount_minor', 'gross_amount_minor', 'discount_amount_minor', 'tax_amount_minor', 'net_amount_minor', 'confidence', 'tax_rate_percent', 'food_service')
      )
      or exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(line.value -> 'identifiers') = 'array' then line.value -> 'identifiers' else '[]'::jsonb end
        ) as identifier(value)
        where jsonb_typeof(identifier.value) is distinct from 'object'
          or exists (
            select 1 from jsonb_object_keys(
              case when jsonb_typeof(identifier.value) = 'object' then identifier.value else '{}'::jsonb end
            ) as field_name
            where field_name not in ('scheme', 'value')
          )
      )
      or exists (
        select 1 from jsonb_object_keys(
          case when jsonb_typeof(line.value -> 'quantity') = 'object' then line.value -> 'quantity' else '{}'::jsonb end
        ) as field_name
        where field_name not in ('value', 'unit')
      )
      or exists (
        select 1 from jsonb_object_keys(
          case when jsonb_typeof(line.value -> 'food_service') = 'object' then line.value -> 'food_service' else '{}'::jsonb end
        ) as field_name
        where field_name not in ('role', 'applies_to_line_id')
      )
  ) then
    raise exception 'receipt.v2 line items contain unsupported identity fields' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_receipt -> 'line_items') as line
    where jsonb_typeof(line -> 'source_line_references') <> 'array'
      or jsonb_array_length(case when jsonb_typeof(line -> 'source_line_references') = 'array' then line -> 'source_line_references' else '[]'::jsonb end) = 0
      or (line ->> 'type') is null
      or (line ->> 'type') not in ('product', 'service', 'discount', 'fee', 'tax', 'tip', 'refund', 'rounding', 'other')
      or jsonb_typeof(line -> 'gross_amount_minor') is distinct from 'number'
      or jsonb_typeof(line -> 'discount_amount_minor') is distinct from 'number'
      or jsonb_typeof(line -> 'tax_amount_minor') is distinct from 'number'
      or (line ->> 'gross_amount_minor')::integer < 0
      or (line ->> 'discount_amount_minor')::integer < 0
      or (line ->> 'tax_amount_minor')::integer < 0
      or jsonb_typeof(line -> 'identifiers') is distinct from 'array'
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(line -> 'identifiers') = 'array' then line -> 'identifiers' else '[]'::jsonb end) as identifier where identifier ->> 'scheme' is distinct from 'merchant_sku' or length(pg_catalog.btrim(coalesce(identifier ->> 'value', ''))) = 0)
      or (select count(*) from jsonb_array_elements(case when jsonb_typeof(coalesce(line -> 'identifiers', '[]'::jsonb)) = 'array' then coalesce(line -> 'identifiers', '[]'::jsonb) else '[]'::jsonb end) as identifier where identifier ->> 'scheme' = 'merchant_sku') > 1
  ) then
    raise exception 'receipt.v2 line semantics or identifiers are invalid' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_receipt -> 'line_items') as line
    where line -> 'food_service' is not null
      and line -> 'food_service' <> 'null'::jsonb
      and (
        v_business_kind <> 'food_service'
        or line ->> 'type' <> 'product'
        or (line -> 'food_service' ->> 'role') not in ('main', 'option', 'side')
        or ((line -> 'food_service' ->> 'role') = 'option' and not exists (
          select 1 from jsonb_array_elements(p_receipt -> 'line_items') as parent
          where parent ->> 'id' = line -> 'food_service' ->> 'applies_to_line_id'
            and parent -> 'food_service' ->> 'role' = 'main'
        ))
        or ((line -> 'food_service' ->> 'role') <> 'option' and line -> 'food_service' ->> 'applies_to_line_id' is not null)
      )
  ) then
    raise exception 'food_service line option semantics are invalid' using errcode = '22023';
  end if;

  if jsonb_typeof(v_totals -> 'items_gross_amount_minor') is distinct from 'number'
    or jsonb_typeof(v_totals -> 'discount_amount_minor') is distinct from 'number'
    or jsonb_typeof(v_totals -> 'tax_amount_minor') is distinct from 'number'
    or jsonb_typeof(v_totals -> 'fee_amount_minor') is distinct from 'number'
    or jsonb_typeof(v_totals -> 'tip_amount_minor') is distinct from 'number'
    or jsonb_typeof(v_totals -> 'rounding_amount_minor') is distinct from 'number'
    or jsonb_typeof(v_totals -> 'grand_total_amount_minor') is distinct from 'number'
  then
    raise exception 'complete monetary totals are required for reconciliation' using errcode = '22023';
  end if;

  select
    coalesce(sum(case when line_type in ('product', 'service') then coalesce(gross_amount_minor, 0) else 0 end), 0),
    coalesce(sum(coalesce(discount_amount_minor, 0)), 0),
    coalesce(sum(coalesce(tax_amount_minor, 0)), 0),
    coalesce(sum(case when line_type = 'refund' then coalesce(net_amount_minor, 0) else 0 end), 0)
  into v_gross, v_discount, v_tax, v_refund
  from jsonb_to_recordset(p_receipt -> 'line_items') as line(
    line_type text, gross_amount_minor integer, discount_amount_minor integer,
    tax_amount_minor integer, net_amount_minor integer
  );
  v_items_gross := (v_totals ->> 'items_gross_amount_minor')::integer;
  v_total_discount := (v_totals ->> 'discount_amount_minor')::integer;
  v_total_tax := (v_totals ->> 'tax_amount_minor')::integer;
  v_total_fee := (v_totals ->> 'fee_amount_minor')::integer;
  v_total_tip := (v_totals ->> 'tip_amount_minor')::integer;
  v_total_rounding := (v_totals ->> 'rounding_amount_minor')::integer;
  v_grand_total := (v_totals ->> 'grand_total_amount_minor')::integer;
  v_expected := v_items_gross - v_total_discount + v_total_tax + v_total_fee + v_total_tip + v_total_rounding + v_refund;
  if v_gross <> v_items_gross or v_discount <> v_total_discount or v_tax <> v_total_tax or v_expected <> v_grand_total then
    raise exception 'receipt.v2 totals reconciliation failed' using errcode = '23514';
  end if;

  v_purchased_at := coalesce(
    nullif(p_receipt -> 'document' ->> 'issued_on', '')::date,
    ((p_receipt -> 'document' ->> 'issued_at')::timestamptz at time zone 'Asia/Seoul')::date
  );
  v_store_fingerprint := encode(extensions.digest(jsonb_build_object(
    'merchantName', v_merchant_name, 'branchName', v_branch_name,
    'businessKind', v_business_kind, 'merchantId', v_merchant_id,
    'catalogNamespace', v_catalog_namespace, 'businessRegistrationNumber', v_bnr,
    'address', v_address, 'phone', v_phone
  )::text, 'sha256'), 'hex');
  select id into v_store_id
  from public.stores
  where user_id = v_user_id and identity_fingerprint = v_store_fingerprint;
  if v_store_id is null then
    insert into public.stores (
      user_id, name, merchant_name, branch_name, business_kind, merchant_id,
      catalog_namespace, business_registration_number, address, phone, identity_fingerprint
    ) values (
      v_user_id, v_merchant_name, v_merchant_name, v_branch_name, v_business_kind,
      v_merchant_id, v_catalog_namespace, v_bnr, v_address, v_phone, v_store_fingerprint
    ) on conflict (user_id, identity_fingerprint) do update set
      merchant_name = excluded.merchant_name,
      branch_name = excluded.branch_name,
      business_kind = excluded.business_kind,
      merchant_id = excluded.merchant_id,
      catalog_namespace = excluded.catalog_namespace,
      business_registration_number = excluded.business_registration_number,
      address = excluded.address,
      phone = excluded.phone
    returning id into v_store_id;
  end if;

  if v_business_kind = 'food_service' then
    if v_catalog_namespace is not null and v_merchant_id is not null then
      select count(*) into v_match_count
      from public.restaurant_locations as location
      inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
      where location.source_namespace = v_catalog_namespace
        and location.source_location_code = v_merchant_id
        and location.review_status = 'verified'
        and restaurant.status = 'active' and restaurant.review_status = 'verified';
      if v_match_count = 1 then
        select restaurant.id, location.id into v_restaurant_id, v_restaurant_location_id
        from public.restaurant_locations as location
        inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
        where location.source_namespace = v_catalog_namespace
          and location.source_location_code = v_merchant_id
          and location.review_status = 'verified'
          and restaurant.status = 'active' and restaurant.review_status = 'verified';
      end if;
    end if;
    if v_restaurant_id is null and v_bnr is not null then
      select count(*) into v_match_count
      from public.restaurant_locations as location
      inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
      where pg_catalog.regexp_replace(coalesce(location.business_registration_number, ''), '[^0-9]', '', 'g') = v_bnr
        and restaurant.status = 'active' and restaurant.review_status = 'verified'
        and location.review_status = 'verified';
      if v_match_count = 1 then
        select restaurant.id, location.id into v_restaurant_id, v_restaurant_location_id
        from public.restaurant_locations as location
        inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
        where pg_catalog.regexp_replace(coalesce(location.business_registration_number, ''), '[^0-9]', '', 'g') = v_bnr
          and restaurant.status = 'active' and restaurant.review_status = 'verified'
          and location.review_status = 'verified';
      end if;
    end if;
    if v_restaurant_id is null and v_branch_name is not null then
      select count(*) into v_match_count
      from public.restaurant_locations as location
      inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
      where restaurant.canonical_name = v_merchant_name
        and location.location_label = v_branch_name
        and restaurant.status = 'active' and restaurant.review_status = 'verified'
        and location.review_status = 'verified'
        and (v_address is null or location.address = v_address)
        and (v_phone is null or location.phone = v_phone);
      if v_match_count = 1 then
        select restaurant.id, location.id into v_restaurant_id, v_restaurant_location_id
        from public.restaurant_locations as location
        inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
        where restaurant.canonical_name = v_merchant_name and location.location_label = v_branch_name
          and restaurant.status = 'active' and restaurant.review_status = 'verified'
          and location.review_status = 'verified'
          and (v_address is null or location.address = v_address)
          and (v_phone is null or location.phone = v_phone);
      end if;
    end if;
    if v_restaurant_id is null then
      insert into public.merchant_identity_candidates (
        user_id, origin, source_fingerprint, merchant_name, branch_name,
        business_registration_number, address, phone, business_kind,
        source_namespace, source_code
      ) values (
        v_user_id, 'receipt_ingestion', v_fingerprint, v_merchant_name, v_branch_name,
        v_bnr, v_address, v_phone, v_business_kind, v_catalog_namespace, v_merchant_id
      ) on conflict (user_id, origin, source_fingerprint) do update set updated_at = now()
      returning id into v_candidate_id;
      if v_candidate_id is null then
        select id into v_candidate_id from public.merchant_identity_candidates
        where user_id = v_user_id and origin = 'receipt_ingestion' and source_fingerprint = v_fingerprint;
      end if;
    end if;
  end if;

  insert into public.receipts(user_id, store_id, purchased_at, transaction_number, currency, total_price_krw)
  values (v_user_id, v_store_id, v_purchased_at, 'ocr-v2:' || v_key, 'KRW', v_grand_total)
  returning id into v_receipt_id;

  insert into public.verified_receipt_sources (
    receipt_id, user_id, document_id, document_type, document_status, issued_on, issued_at,
    fulfillment_type, fulfillment_evidence, capture_method, transcription_status,
    merchant_name, branch_name, business_kind, retail_channel, catalog_namespace, merchant_id,
    business_registration_number, address, phone, items_gross_amount_minor, discount_amount_minor,
    tax_amount_minor, fee_amount_minor, tip_amount_minor, rounding_amount_minor,
    grand_total_amount_minor, source_fingerprint
  ) values (
    v_receipt_id, v_user_id, nullif(p_receipt -> 'document' ->> 'id', ''),
    p_receipt -> 'document' ->> 'type', p_receipt -> 'document' ->> 'status',
    nullif(p_receipt -> 'document' ->> 'issued_on', '')::date,
    nullif(p_receipt -> 'document' ->> 'issued_at', '')::timestamptz,
    p_receipt -> 'document' -> 'fulfillment' ->> 'type', p_receipt -> 'document' -> 'fulfillment' ->> 'evidence',
    v_source ->> 'capture_method', 'user_verified', v_merchant_name, v_branch_name, v_business_kind,
    coalesce(v_merchant ->> 'retail_channel', 'unknown'), v_catalog_namespace, v_merchant_id,
    v_bnr, v_address, v_phone, v_items_gross, v_total_discount, v_total_tax, v_total_fee,
    v_total_tip, v_total_rounding, v_grand_total, v_fingerprint
  );

  for v_line in select value from jsonb_array_elements(p_receipt -> 'line_items') as lines(value) loop
    v_index := v_index + 1;
    v_line_id := v_line ->> 'id';
    v_line_type := v_line ->> 'type';
    v_description := nullif(pg_catalog.btrim(coalesce(v_line ->> 'description', '')), '');
    v_sku := nullif(pg_catalog.btrim(coalesce((select identifier ->> 'value' from jsonb_array_elements(coalesce(v_line -> 'identifiers', '[]'::jsonb)) as identifier where identifier ->> 'scheme' = 'merchant_sku' limit 1), '')), '');
    v_quantity := case when v_line -> 'quantity' is null or v_line -> 'quantity' = 'null'::jsonb then null else (v_line -> 'quantity' ->> 'value')::numeric end;
    v_unit := case when v_line -> 'quantity' is null or v_line -> 'quantity' = 'null'::jsonb then null else v_line -> 'quantity' ->> 'unit' end;
    v_net := nullif(v_line ->> 'net_amount_minor', '')::integer;
    v_food_service := case when v_line -> 'food_service' is null or v_line -> 'food_service' = 'null'::jsonb then null else v_line -> 'food_service' end;
    v_product_id := null;
    v_store_product_id := null;
    v_receipt_item_id := null;
    v_price_observation_id := null;
    v_restaurant_menu_id := null;
    v_source_menu_mapping_id := null;
    v_catalog_product_id := null;
    v_observation_id := null;
    v_menu_match_count := 0;
    if v_description is not null and v_line_type in ('product', 'service') then
      v_product_type := case when v_line_type = 'service' then 'service' when v_business_kind = 'food_service' then 'menu_item' else 'retail_product' end;
        if v_line_type = 'product' and v_business_kind = 'food_service' and v_restaurant_id is not null and v_restaurant_location_id is not null and v_sku is not null and v_catalog_namespace is not null then
        select mapping.id, mapping.restaurant_menu_id, menu.catalog_product_id
        into v_source_menu_mapping_id, v_restaurant_menu_id, v_catalog_product_id
        from public.restaurant_menu_source_mappings as mapping
        inner join public.restaurant_menus as menu on menu.restaurant_id = mapping.restaurant_id and menu.id = mapping.restaurant_menu_id
        inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id
        where mapping.restaurant_id = v_restaurant_id and mapping.restaurant_location_id = v_restaurant_location_id
          and mapping.source_product_code_namespace = v_catalog_namespace
          and mapping.source_product_code = v_sku
          and mapping.review_status = 'verified'
          and menu.status = 'active' and menu.review_status = 'verified'
          and catalog.status = 'active' and catalog.purchase_type = 'menu_item';
      end if;
      if v_line_type = 'product' and v_business_kind = 'food_service' and v_restaurant_id is not null and v_restaurant_menu_id is null then
        select count(*) into v_menu_match_count
        from public.restaurant_menus as menu
        inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id
        where menu.restaurant_id = v_restaurant_id and menu.canonical_name = v_description
          and menu.status = 'active' and menu.review_status = 'verified'
          and catalog.status = 'active' and catalog.purchase_type = 'menu_item';
        if v_menu_match_count = 1 then
          select menu.id, menu.catalog_product_id into v_restaurant_menu_id, v_catalog_product_id
          from public.restaurant_menus as menu
          inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id
          where menu.restaurant_id = v_restaurant_id and menu.canonical_name = v_description
            and menu.status = 'active' and menu.review_status = 'verified'
            and catalog.status = 'active' and catalog.purchase_type = 'menu_item';
        end if;
      end if;
      if v_business_kind <> 'food_service' and v_sku is not null and v_catalog_namespace is not null then
        select mapping.catalog_product_id into v_catalog_product_id
        from public.source_product_mappings as mapping
        inner join public.catalog_products as catalog on catalog.id = mapping.catalog_product_id
        where mapping.source_label = v_catalog_namespace and mapping.source_product_code = v_sku
          and mapping.review_status = 'verified'
          and catalog.status = 'active' and catalog.purchase_type = v_product_type;
      end if;
      if v_quantity is not null and v_unit = 'each' and v_quantity = trunc(v_quantity)
        and v_quantity > 0 and v_net is not null and v_net >= 0
        and v_net % v_quantity::integer = 0
      then
        select id into v_product_id from public.products
        where user_id = v_user_id and name = v_description and purchase_type = v_product_type
        order by created_at, id limit 1;
        if v_product_id is null then
          insert into public.products(user_id, name, purchase_type)
          values (v_user_id, v_description, v_product_type)
          returning id into v_product_id;
        end if;
        if v_sku is not null then
          select id, product_id into v_store_product_id, v_product_id
          from public.store_products
          where user_id = v_user_id and store_id = v_store_id and store_product_code = v_sku
          limit 1;
        end if;
        if v_store_product_id is null then
          select id into v_store_product_id from public.store_products
          where user_id = v_user_id and store_id = v_store_id and product_id = v_product_id and store_product_code is null
          limit 1;
        end if;
        if v_store_product_id is null then
          insert into public.store_products(user_id, store_id, product_id, store_product_code)
          values (v_user_id, v_store_id, v_product_id, v_sku)
          returning id into v_store_product_id;
        end if;
        v_receipt_item_id := encode(extensions.digest(v_receipt_id::text || ':' || v_line_id, 'sha256'), 'hex');
        insert into public.receipt_items(
          id, user_id, receipt_id, store_product_id, unit_price_krw,
          purchased_quantity, total_price_krw, purchase_numbers
        ) values (
          v_receipt_item_id, v_user_id, v_receipt_id, v_store_product_id,
          v_net / v_quantity::integer, v_quantity::integer, v_net, array[v_index]
        );
        insert into public.price_observations(
          user_id, store_product_id, receipt_item_id, observed_at, unit_price_krw,
          quantity, catalog_product_id, measurement_unit, location_label, attributes,
          verification_status, verified_at
        ) values (
          v_user_id, v_store_product_id, v_receipt_item_id, v_purchased_at,
          v_net / v_quantity::integer, v_quantity::integer, v_catalog_product_id,
          'each', v_branch_name, jsonb_build_object('schemaVersion', 'receipt.v2', 'sourceLineId', v_line_id),
          'verified', now()
        ) returning id into v_price_observation_id;
        v_observation_ids := v_observation_ids || jsonb_build_array(v_price_observation_id);
        if v_restaurant_menu_id is not null and v_restaurant_location_id is not null then
          v_observation_fingerprint := 'sha256:' || encode(extensions.digest(jsonb_build_object(
            'receiptId', v_receipt_id, 'lineId', v_line_id, 'restaurantLocationId', v_restaurant_location_id,
            'restaurantMenuId', v_restaurant_menu_id, 'unitPriceKrw', v_net / v_quantity::integer,
            'quantity', v_quantity::integer, 'totalPriceKrw', v_net
          )::text, 'sha256'), 'hex');
          insert into public.restaurant_menu_receipt_observations(
            restaurant_id, restaurant_location_id, restaurant_menu_id, source_menu_mapping_id,
            owner_user_id, price_observation_id, receipt_id, receipt_item_id, observed_on,
            unit_price_krw, quantity, total_price_krw, evidence_snapshot, evidence_fingerprint,
            verification_status, verified_by
          ) values (
            v_restaurant_id, v_restaurant_location_id, v_restaurant_menu_id, v_source_menu_mapping_id,
            v_user_id, v_price_observation_id, v_receipt_id, v_receipt_item_id, v_purchased_at,
            v_net / v_quantity::integer, v_quantity::integer, v_net,
            jsonb_build_object('schemaVersion', 'receipt.v2', 'receiptId', v_receipt_id, 'sourceLineId', v_line_id, 'sourceLineReferences', v_line -> 'source_line_references'),
            v_observation_fingerprint, 'verified', v_user_id
          ) returning id into v_observation_id;
          v_observation_ids := v_observation_ids || jsonb_build_array(v_observation_id);
        end if;
      end if;
    end if;
    insert into public.verified_receipt_source_lines(
      receipt_id, user_id, source_line_id, line_type, description, source_line_references,
      merchant_sku, quantity_value, quantity_unit, unit_price_amount_minor, gross_amount_minor,
      discount_amount_minor, tax_amount_minor, net_amount_minor, tax_rate_percent,
      food_service_role, applies_to_source_line_id
    ) values (
      v_receipt_id, v_user_id, v_line_id, v_line_type, v_description,
      (select array_agg(reference) from jsonb_array_elements_text(v_line -> 'source_line_references') as reference),
      v_sku, v_quantity, v_unit, nullif(v_line ->> 'unit_price_amount_minor', '')::integer,
      (v_line ->> 'gross_amount_minor')::integer, (v_line ->> 'discount_amount_minor')::integer,
      (v_line ->> 'tax_amount_minor')::integer, v_net, nullif(v_line ->> 'tax_rate_percent', '')::numeric,
      v_food_service ->> 'role', v_food_service ->> 'applies_to_line_id'
    );
    v_line_results := v_line_results || jsonb_build_array(jsonb_build_object(
      'sourceLineId', v_line_id, 'receiptItemId', v_receipt_item_id,
      'observationId', v_price_observation_id, 'restaurantObservationId', v_observation_id,
      'restaurantMenuId', v_restaurant_menu_id, 'catalogProductId', v_catalog_product_id,
      'resolutionStatus', case when v_line_type not in ('product', 'service') then 'semantic_only' when v_restaurant_menu_id is not null or v_catalog_product_id is not null then 'resolved' else 'unresolved_catalog' end
    ));
  end loop;

  for v_line in select value from jsonb_array_elements(p_receipt -> 'line_items') as lines(value) loop
    if v_line -> 'food_service' ->> 'role' = 'option' and v_line -> 'food_service' ->> 'applies_to_line_id' is not null then
      v_receipt_item_id := encode(extensions.digest(v_receipt_id::text || ':' || (v_line ->> 'id'), 'sha256'), 'hex');
      v_parent_receipt_item_id := encode(extensions.digest(v_receipt_id::text || ':' || (v_line -> 'food_service' ->> 'applies_to_line_id'), 'sha256'), 'hex');
      if exists (select 1 from public.receipt_items where user_id = v_user_id and id = v_receipt_item_id)
        and exists (select 1 from public.receipt_items where user_id = v_user_id and id = v_parent_receipt_item_id)
      then
        insert into public.receipt_item_menu_option_sources(option_receipt_item_id, user_id, receipt_id, parent_receipt_item_id, source)
        values (v_receipt_item_id, v_user_id, v_receipt_id, v_parent_receipt_item_id, 'receipt_v2')
        on conflict (option_receipt_item_id) do update set parent_receipt_item_id = excluded.parent_receipt_item_id, updated_at = now();
      end if;
    end if;
  end loop;
  if v_restaurant_id is not null then
    perform public.auto_link_restaurant_menu_options_for_receipt(v_restaurant_id, v_receipt_id, v_user_id);
  end if;

  v_response := jsonb_build_object(
    'schemaVersion', 'verified-receipt-ingestion.v2',
    'replayed', false, 'deduplicated', false, 'receiptId', v_receipt_id,
    'storeId', v_store_id, 'restaurantId', v_restaurant_id,
    'restaurantLocationId', v_restaurant_location_id,
    'merchantResolutionStatus', case when v_restaurant_id is not null then 'exact' when v_candidate_id is not null then 'needs_user_selection' else 'not_applicable' end,
    'merchantCandidateId', v_candidate_id, 'observationIds', v_observation_ids, 'lines', v_line_results
  );
  insert into public.verified_receipt_ingestion_requests(user_id, idempotency_key, request_fingerprint, receipt_id, response)
  values (v_user_id, v_key, v_fingerprint, v_receipt_id, v_response);
  return v_response;
end;
$function$;

comment on function public.submit_verified_receipt_v2(text, jsonb) is
  'PriceTrace-owned, idempotent ingestion of a privacy-sanitized user_verified receipt.v2. Catalog and restaurant UUIDs are resolved only from verified server rows.';
revoke all on function public.submit_verified_receipt_v2(text, jsonb) from public, anon;
grant execute on function public.submit_verified_receipt_v2(text, jsonb) to authenticated;

create or replace function public.submit_merchant_identity_candidate_v1(
  p_idempotency_key text,
  p_merchant jsonb,
  p_user_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_name text := pg_catalog.btrim(coalesce(p_merchant ->> 'merchant_name', ''));
  v_branch text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'branch_name', '')), '');
  v_kind text := coalesce(p_merchant ->> 'business_kind', 'unknown');
  v_namespace text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'source_namespace', '')), '');
  v_code text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'source_location_code', '')), '');
  v_bnr text := nullif(pg_catalog.regexp_replace(coalesce(p_merchant ->> 'business_registration_number', ''), '[^0-9]', '', 'g'), '');
  v_address text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'address', '')), '');
  v_phone text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'phone', '')), '');
  v_fingerprint text;
  v_key text := pg_catalog.btrim(coalesce(p_idempotency_key, ''));
  v_existing_fingerprint text;
  v_candidate_id uuid;
  v_restaurant_id uuid;
  v_location_id uuid;
  v_count integer;
begin
  if v_user_id is null then raise exception 'authenticated user required' using errcode = '42501'; end if;
  if length(v_key) not between 1 and 200 then raise exception 'idempotency key must contain 1 to 200 characters' using errcode = '22023'; end if;
  if not coalesce(p_user_verified, false) then raise exception 'merchant facts require explicit user verification' using errcode = '22023'; end if;
  if jsonb_typeof(p_merchant) is distinct from 'object'
    or exists (
      select 1 from jsonb_object_keys(
        case when jsonb_typeof(p_merchant) = 'object' then p_merchant else '{}'::jsonb end
      ) as field_name
      where field_name not in ('merchant_name', 'branch_name', 'business_kind', 'business_registration_number', 'address', 'phone', 'source_namespace', 'source_location_code')
    )
  then
    raise exception 'merchant profile contains unsupported identity fields' using errcode = '22023';
  end if;
  if length(v_name) = 0 or v_kind not in ('retail', 'food_service', 'transport', 'accommodation', 'healthcare', 'professional_service', 'utility', 'government', 'financial', 'marketplace', 'other', 'unknown') then
    raise exception 'merchant name and business kind are required' using errcode = '22023';
  end if;
  if p_merchant ->> 'business_kind' is null then raise exception 'merchant name and business kind are required' using errcode = '22023'; end if;
  if (v_namespace is null) <> (v_code is null) then raise exception 'source namespace and source code must be supplied together' using errcode = '22023'; end if;
  v_fingerprint := encode(extensions.digest(jsonb_build_object('merchantName', v_name, 'branchName', v_branch, 'businessKind', v_kind, 'businessRegistrationNumber', v_bnr, 'address', v_address, 'phone', v_phone, 'sourceNamespace', v_namespace, 'sourceCode', v_code)::text, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text || ':merchant:' || v_key, 0));
  select source_fingerprint, id, matched_restaurant_id, matched_restaurant_location_id
  into v_existing_fingerprint, v_candidate_id, v_restaurant_id, v_location_id
  from public.merchant_identity_candidates
  where user_id = v_user_id and origin = 'merchant_only' and idempotency_key = v_key;
  if found then
    if v_existing_fingerprint <> v_fingerprint then raise exception 'idempotency key was already used for another merchant candidate' using errcode = '23505'; end if;
    return jsonb_build_object('schemaVersion', 'merchant-only-candidate.v1', 'candidateId', v_candidate_id, 'reviewStatus', (select review_status from public.merchant_identity_candidates where id = v_candidate_id), 'resolutionStatus', case when v_restaurant_id is null then 'needs_user_selection' else 'exact' end, 'restaurantId', v_restaurant_id, 'restaurantLocationId', v_location_id);
  end if;
  if v_kind = 'food_service' and v_namespace is not null then
    select count(*) into v_count from public.restaurant_locations as location inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id where location.source_namespace = v_namespace and location.source_location_code = v_code and location.review_status = 'verified' and restaurant.status = 'active' and restaurant.review_status = 'verified';
     if v_count = 1 then select restaurant.id, location.id into v_restaurant_id, v_location_id from public.restaurant_locations as location inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id where location.source_namespace = v_namespace and location.source_location_code = v_code and location.review_status = 'verified' and restaurant.status = 'active' and restaurant.review_status = 'verified'; end if;
  end if;
  if v_kind = 'food_service' and v_restaurant_id is null and v_bnr is not null then
    select count(*) into v_count from public.restaurant_locations as location inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id where pg_catalog.regexp_replace(coalesce(location.business_registration_number, ''), '[^0-9]', '', 'g') = v_bnr and location.review_status = 'verified' and restaurant.status = 'active' and restaurant.review_status = 'verified';
    if v_count = 1 then select restaurant.id, location.id into v_restaurant_id, v_location_id from public.restaurant_locations as location inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id where pg_catalog.regexp_replace(coalesce(location.business_registration_number, ''), '[^0-9]', '', 'g') = v_bnr and location.review_status = 'verified' and restaurant.status = 'active' and restaurant.review_status = 'verified'; end if;
  end if;
  if v_kind = 'food_service' and v_restaurant_id is null and v_branch is not null then
    select count(*) into v_count from public.restaurant_locations as location inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id where restaurant.canonical_name = v_name and location.location_label = v_branch and location.review_status = 'verified' and restaurant.status = 'active' and restaurant.review_status = 'verified' and (v_address is null or location.address = v_address) and (v_phone is null or location.phone = v_phone);
    if v_count = 1 then select restaurant.id, location.id into v_restaurant_id, v_location_id from public.restaurant_locations as location inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id where restaurant.canonical_name = v_name and location.location_label = v_branch and location.review_status = 'verified' and restaurant.status = 'active' and restaurant.review_status = 'verified' and (v_address is null or location.address = v_address) and (v_phone is null or location.phone = v_phone); end if;
  end if;
  insert into public.merchant_identity_candidates(user_id, origin, source_fingerprint, merchant_name, branch_name, business_registration_number, address, phone, business_kind, source_namespace, source_code, idempotency_key, user_verified, matched_restaurant_id, matched_restaurant_location_id)
  values (v_user_id, 'merchant_only', v_fingerprint, v_name, v_branch, v_bnr, v_address, v_phone, v_kind, v_namespace, v_code, v_key, true, v_restaurant_id, v_location_id)
  on conflict (user_id, origin, source_fingerprint) do update set updated_at = now()
  returning id into v_candidate_id;
  if v_candidate_id is null then select id into v_candidate_id from public.merchant_identity_candidates where user_id = v_user_id and origin = 'merchant_only' and source_fingerprint = v_fingerprint; end if;
  return jsonb_build_object('schemaVersion', 'merchant-only-candidate.v1', 'candidateId', v_candidate_id, 'reviewStatus', 'pending', 'resolutionStatus', case when v_restaurant_id is null then 'needs_user_selection' else 'exact' end, 'restaurantId', v_restaurant_id, 'restaurantLocationId', v_location_id);
end;
$function$;

comment on function public.submit_merchant_identity_candidate_v1(text, jsonb, boolean) is
  'Stores only explicitly user-verified, sanitized merchant facts as a review candidate; it never auto-creates a canonical restaurant.';
revoke all on function public.submit_merchant_identity_candidate_v1(text, jsonb, boolean) from public, anon;
grant execute on function public.submit_merchant_identity_candidate_v1(text, jsonb, boolean) to authenticated;

create or replace function public.admin_resolve_merchant_identity_candidate_v1(
  p_candidate_id uuid,
  p_restaurant_id uuid,
  p_restaurant_location_id uuid,
  p_decision text
)
returns table(candidate_id uuid, review_status text, restaurant_id uuid, restaurant_location_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.merchant_identity_candidates%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then raise exception 'Administrator authentication is required.' using errcode = '42501'; end if;
  if p_decision not in ('accept', 'reject') then raise exception 'candidate decision must be accept or reject' using errcode = '22023'; end if;
  if p_decision = 'accept' and (p_restaurant_id is null or (p_restaurant_location_id is not null and not exists (select 1 from public.restaurant_locations where id = p_restaurant_location_id and restaurant_id = p_restaurant_id))) then raise exception 'accepted candidate requires an exact restaurant identity' using errcode = '23514'; end if;
  update public.merchant_identity_candidates
  set review_status = case when p_decision = 'accept' then 'accepted' else 'rejected' end,
      matched_restaurant_id = case when p_decision = 'accept' then p_restaurant_id else null end,
      matched_restaurant_location_id = case when p_decision = 'accept' then p_restaurant_location_id else null end,
      updated_at = now()
  where id = p_candidate_id and review_status = 'pending';
  if not found then
    select * into v_existing
    from public.merchant_identity_candidates
    where id = p_candidate_id;
    if not found then raise exception 'pending merchant identity candidate not found' using errcode = 'P0002'; end if;
    if (p_decision = 'accept' and v_existing.review_status = 'accepted' and v_existing.matched_restaurant_id = p_restaurant_id and v_existing.matched_restaurant_location_id is not distinct from p_restaurant_location_id)
      or (p_decision = 'reject' and v_existing.review_status = 'rejected')
    then
      return query select v_existing.id, v_existing.review_status, v_existing.matched_restaurant_id, v_existing.matched_restaurant_location_id;
      return;
    end if;
    raise exception 'merchant identity candidate was already resolved' using errcode = '23514';
  end if;
  return query select id, review_status, matched_restaurant_id, matched_restaurant_location_id from public.merchant_identity_candidates where id = p_candidate_id;
end;
$function$;

revoke all on function public.admin_resolve_merchant_identity_candidate_v1(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_resolve_merchant_identity_candidate_v1(uuid, uuid, uuid, text) to authenticated;

create or replace function public.admin_register_restaurant_from_merchant_candidate_v1(
  p_candidate_id uuid
)
returns table(candidate_id uuid, restaurant_id uuid, restaurant_location_id uuid, review_status text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_candidate public.merchant_identity_candidates%rowtype;
  v_restaurant_id uuid;
  v_location_id uuid;
  v_digits text;
begin
  if v_actor is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then raise exception 'Administrator authentication is required.' using errcode = '42501'; end if;
  select * into v_candidate from public.merchant_identity_candidates where id = p_candidate_id for update;
  if not found then raise exception 'pending merchant identity candidate not found' using errcode = 'P0002'; end if;
  if v_candidate.review_status = 'accepted' then
    return query select p_candidate_id, v_candidate.matched_restaurant_id, v_candidate.matched_restaurant_location_id, v_candidate.review_status;
    return;
  end if;
  if v_candidate.review_status <> 'pending' then raise exception 'merchant identity candidate is not pending' using errcode = '23514'; end if;
  if v_candidate.business_kind <> 'food_service' then raise exception 'restaurant registration requires a food_service candidate' using errcode = '23514'; end if;
  insert into public.restaurants(canonical_name, review_status, status, created_by)
  values (v_candidate.merchant_name, 'pending', 'active', v_actor)
  returning id into v_restaurant_id;
  if v_candidate.source_namespace is not null then
    v_digits := nullif(pg_catalog.regexp_replace(coalesce(v_candidate.business_registration_number, ''), '[^0-9]', '', 'g'), '');
    insert into public.restaurant_locations(
      restaurant_id, source_namespace, source_location_code, location_label,
      business_registration_number, address, phone, review_status, created_by
    ) values (
      v_restaurant_id, v_candidate.source_namespace, v_candidate.source_code,
      v_candidate.branch_name,
      case when length(v_digits) = 10 then substr(v_digits, 1, 3) || '-' || substr(v_digits, 4, 2) || '-' || substr(v_digits, 6, 5) else null end,
      v_candidate.address, v_candidate.phone, 'pending', v_actor
    ) returning id into v_location_id;
  end if;
  update public.merchant_identity_candidates
  set review_status = 'accepted', matched_restaurant_id = v_restaurant_id,
      matched_restaurant_location_id = v_location_id, updated_at = now()
  where id = p_candidate_id;
  return query select p_candidate_id, v_restaurant_id, v_location_id, 'accepted'::text;
end;
$function$;

comment on function public.admin_register_restaurant_from_merchant_candidate_v1(uuid) is
  'Admin-only creation of a pending restaurant identity from an explicitly user-verified merchant candidate. It never creates a verified identity automatically.';
revoke all on function public.admin_register_restaurant_from_merchant_candidate_v1(uuid) from public, anon, authenticated;
grant execute on function public.admin_register_restaurant_from_merchant_candidate_v1(uuid) to authenticated;
