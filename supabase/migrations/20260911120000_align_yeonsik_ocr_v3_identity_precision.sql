-- Align PriceTrace ingestion with the Yeonsik OCR canonical v3 boundary.
--
-- OCR/GPT sends source facts and opaque local references only. PriceTrace
-- resolves the authoritative product before a retail standalone observation
-- can be written. Existing receipt ingestion remains on its legacy path.

alter table public.product_identity_candidates
  add column client_key text,
  add column sub_brand text,
  add constraint product_identity_candidates_client_key_check
    check (client_key is null or length(btrim(client_key)) between 1 and 200),
  add constraint product_identity_candidates_sub_brand_check
    check (sub_brand is null or length(btrim(sub_brand)) between 1 and 300);

comment on column public.product_identity_candidates.client_key is
  'Opaque OCR-App local reference. It is scoped to the user and is never a merchant SKU or PriceTrace identity.';

comment on column public.product_identity_candidates.sub_brand is
  'Observed sub-brand source fact. It is private evidence and never confirms a public catalog identity by itself.';

create table public.product_candidate_authority_projections (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_key text not null
    check (length(btrim(client_key)) between 1 and 200),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_id uuid,
  resolution_status text not null
    check (resolution_status in (
      'catalog_product_reused',
      'private_unverified_candidate_created',
      'review_required'
    )),
  catalog_product_id uuid references public.catalog_products(id) on delete restrict,
  standard_product_id uuid references public.standard_products(id) on delete restrict,
  source_payload jsonb not null
    check (jsonb_typeof(source_payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, client_key),
  foreign key (user_id, candidate_id)
    references public.product_identity_candidates(user_id, id) on delete restrict,
  check (
    (
      resolution_status = 'catalog_product_reused'
      and candidate_id is null
      and catalog_product_id is not null
      and standard_product_id is not null
    )
    or
    (
      resolution_status in (
        'private_unverified_candidate_created',
        'review_required'
      )
      and candidate_id is not null
      and catalog_product_id is null
      and standard_product_id is null
    )
  )
);

comment on table public.product_candidate_authority_projections is
  'Private PriceTrace projection from an OCR local client_key to one Product Candidate resolution. Only catalog_product_reused rows are eligible for standalone retail observations.';

alter table public.product_candidate_authority_projections enable row level security;
revoke all on public.product_candidate_authority_projections from public, anon, authenticated;

alter table public.price_observations
  alter column unit_price_krw drop not null,
  alter column quantity drop not null,
  alter column measurement_unit drop not null;

alter table public.price_observations
  drop constraint if exists price_observations_standalone_contract_check;

alter table public.price_observations
  add constraint price_observations_standalone_contract_check
  check (
    (
      observation_kind = 'receipt_purchase'
      and receipt_item_id is not null
      and unit_price_krw is not null
      and quantity is not null
      and measurement_unit is not null
    )
    or (
      observation_kind = 'standalone_purchase'
      and
      receipt_item_id is null
      and verification_basis is not null
      and currency = 'KRW'
      and (quantity is null or quantity > 0)
      and (unit_price_krw is null or unit_price_krw >= 0)
      and (gross_price_krw is null or gross_price_krw >= 0)
      and (discount_price_krw is null or discount_price_krw >= 0)
      and (net_price_krw is null or net_price_krw >= 0)
      and (
        gross_price_krw is null
        or discount_price_krw is null
        or discount_price_krw <= gross_price_krw
      )
      and (
        gross_price_krw is null
        or net_price_krw is null
        or gross_price_krw >= net_price_krw
      )
      and (
        quantity is null
        or unit_price_krw is null
        or net_price_krw is null
        or net_price_krw::numeric =
          quantity::numeric * unit_price_krw::numeric
      )
      and (
        gross_price_krw is null
        or discount_price_krw is null
        or net_price_krw is null
        or gross_price_krw::numeric - discount_price_krw::numeric =
          net_price_krw::numeric
      )
      and (
        gross_price_krw is not null
        or discount_price_krw is not null
        or net_price_krw is not null
        or unit_price_krw is not null
      )
    )
  );

alter table public.restaurant_menu_manual_observations
  alter column unit_price_krw drop not null,
  alter column quantity drop not null,
  alter column total_price_krw drop not null;

alter table public.restaurant_menu_manual_observations
  drop constraint if exists restaurant_menu_manual_standalone_contract_check;

alter table public.restaurant_menu_manual_observations
  add constraint restaurant_menu_manual_standalone_contract_check
  check (
    (
      observation_kind = 'manual_registration'
      and unit_price_krw is not null
      and quantity is not null
      and total_price_krw is not null
    )
    or (
      observation_kind = 'standalone_purchase'
      and
      verification_basis is not null
      and currency = 'KRW'
      and (quantity is null or quantity > 0)
      and (unit_price_krw is null or unit_price_krw >= 0)
      and (total_price_krw is null or total_price_krw >= 0)
      and (gross_price_krw is null or gross_price_krw >= 0)
      and (discount_price_krw is null or discount_price_krw >= 0)
      and (net_price_krw is null or net_price_krw >= 0)
      and (
        gross_price_krw is null
        or discount_price_krw is null
        or discount_price_krw <= gross_price_krw
      )
      and (
        gross_price_krw is null
        or net_price_krw is null
        or gross_price_krw >= net_price_krw
      )
      and (
        quantity is null
        or unit_price_krw is null
        or total_price_krw is null
        or total_price_krw::numeric =
          quantity::numeric * unit_price_krw::numeric
      )
      and (
        total_price_krw is null
        or net_price_krw is null
        or total_price_krw = net_price_krw
      )
      and (
        gross_price_krw is not null
        or discount_price_krw is not null
        or net_price_krw is not null
        or unit_price_krw is not null
        or total_price_krw is not null
      )
    )
  );

comment on column public.price_observations.unit_price_krw is
  'Nullable for standalone observations when the source only establishes a total/final price.';

comment on column public.price_observations.quantity is
  'Nullable for standalone observations when quantity was not established by the source.';

comment on column public.price_observations.measurement_unit is
  'Nullable for standalone observations when no unit-price basis was observed; receipt rows retain each.';

comment on column public.price_observations.observed_at_exact is
  'Null when only observed_on was supplied. Explicit observed_at is stored as an instant without replacing the submitted calendar date.';

comment on column public.restaurant_menu_manual_observations.observed_at_exact is
  'Null when only observed_on was supplied. Explicit observed_at is stored as an instant without replacing the submitted calendar date.';

-- The previous v1 body remains available only as an internal compatibility
-- implementation. The public name below becomes the canonical-v3-aware
-- wrapper; callers that omit the new optional fields are delegated unchanged.
alter function public.submit_product_candidate_v1(text, jsonb)
  rename to submit_product_candidate_v1_legacy;

revoke all on function public.submit_product_candidate_v1_legacy(text, jsonb)
  from public, anon, authenticated;

create or replace function public.submit_product_candidate_v1(
  p_idempotency_key text,
  p_candidate jsonb
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
  v_existing public.product_candidate_ingestion_requests%rowtype;
  v_duplicate public.product_candidate_ingestion_contents%rowtype;
  v_projection public.product_candidate_authority_projections%rowtype;
  v_legacy_candidate jsonb;
  v_legacy_response jsonb;
  v_response jsonb;
  v_client_key text;
  v_sub_brand text;
  v_candidate_id uuid;
  v_catalog_product_id uuid;
  v_standard_product_id uuid;
  v_resolution_status text;
  v_projection_found boolean := false;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  if length(v_key) not between 1 and 200 then
    raise exception 'idempotency key must contain 1 to 200 characters'
      using errcode = '22023';
  end if;

  if p_candidate is null
    or pg_catalog.jsonb_typeof(p_candidate) <> 'object'
  then
    raise exception 'PRICETRACE_PRODUCT_CANDIDATE JSON object is required'
      using errcode = '22023';
  end if;

  if (
    p_candidate ? 'client_key'
    and pg_catalog.jsonb_typeof(p_candidate -> 'client_key')
      not in ('string', 'null')
  )
    or (
      p_candidate ? 'sub_brand'
      and pg_catalog.jsonb_typeof(p_candidate -> 'sub_brand')
        not in ('string', 'null')
    )
  then
    raise exception 'client_key and sub_brand must be strings or null'
      using errcode = '22023';
  end if;

  if p_candidate ? 'client_key'
    and length(pg_catalog.btrim(coalesce(p_candidate ->> 'client_key', ''))) = 0
  then
    raise exception 'client_key must not be blank when provided'
      using errcode = '22023';
  end if;

  v_client_key := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'client_key', '')), '');
  v_sub_brand := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'sub_brand', '')), '');
  if v_client_key is not null and length(v_client_key) > 200
    or v_sub_brand is not null and length(v_sub_brand) > 300
  then
    raise exception 'client_key or sub_brand is too long'
      using errcode = '22023';
  end if;
  if v_client_key is not null
    and v_client_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'client_key must be an opaque local reference, not a PriceTrace UUID'
      using errcode = '22023';
  end if;

  -- A payload carrying neither new field is an old v1 request. Delegating it
  -- preserves the previous idempotency/content-dedup response byte-for-byte.
  if not (p_candidate ? 'client_key' or p_candidate ? 'sub_brand') then
    return public.submit_product_candidate_v1_legacy(p_idempotency_key, p_candidate);
  end if;

  v_fingerprint := encode(
    extensions.digest(
      convert_to(p_candidate::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_fingerprint, 0)
  );

  select *
  into v_existing
  from public.product_candidate_ingestion_requests
  where user_id = v_user_id
    and idempotency_key = v_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'idempotency key was already used for another product candidate'
        using errcode = '23505';
    end if;
    return v_existing.response || jsonb_build_object(
      'clientKey', v_client_key,
      'productClientKey', v_client_key,
      'replayed', true,
      'deduplicated', true
    );
  end if;

  if v_client_key is not null then
    select *
    into v_projection
    from public.product_candidate_authority_projections as projection
    where projection.user_id = v_user_id
      and projection.client_key = v_client_key;
    v_projection_found := found;
    if v_projection_found
      and v_projection.request_fingerprint <> v_fingerprint
    then
      raise exception 'client_key was already used for another product candidate payload'
        using errcode = '23505';
    end if;
  end if;

  select *
  into v_duplicate
  from public.product_candidate_ingestion_contents
  where user_id = v_user_id
    and request_fingerprint = v_fingerprint;
  if found then
    v_response := v_duplicate.response || jsonb_build_object(
      'clientKey', v_client_key,
      'productClientKey', v_client_key,
      'replayed', false,
      'deduplicated', true
    );
    v_candidate_id := nullif(v_response ->> 'candidateId', '')::uuid;
    v_catalog_product_id := nullif(v_response ->> 'catalogProductId', '')::uuid;
    v_standard_product_id := nullif(v_response ->> 'standardProductId', '')::uuid;
    v_resolution_status := v_response ->> 'outcome';

    if v_client_key is not null and not v_projection_found then
      insert into public.product_candidate_authority_projections (
        user_id, client_key, request_fingerprint, candidate_id,
        resolution_status, catalog_product_id, standard_product_id,
        source_payload
      ) values (
        v_user_id, v_client_key, v_fingerprint, v_candidate_id,
        v_resolution_status, v_catalog_product_id, v_standard_product_id,
        p_candidate
      );
    end if;

    insert into public.product_candidate_ingestion_requests (
      user_id, idempotency_key, request_fingerprint, candidate_id, response
    ) values (
      v_user_id, v_key, v_fingerprint, v_candidate_id, v_response
    );
    return v_response;
  end if;

  -- Keep the legacy matcher as the authority resolver, but make its internal
  -- request unique for the complete new payload. The marker is restored in
  -- the candidate row immediately after the internal call, so source facts
  -- retain the caller's original provenance.
  v_legacy_candidate := p_candidate - 'client_key' - 'sub_brand';
  v_legacy_candidate := jsonb_set(
    v_legacy_candidate,
    '{provenance,source_revision}',
    to_jsonb('price-trace-canonical-v3:' || v_fingerprint),
    true
  );
  v_legacy_response := public.submit_product_candidate_v1_legacy(
    'canonical-v3:' || v_fingerprint,
    v_legacy_candidate
  );

  v_candidate_id := nullif(v_legacy_response ->> 'candidateId', '')::uuid;
  v_catalog_product_id := nullif(v_legacy_response ->> 'catalogProductId', '')::uuid;
  v_standard_product_id := nullif(v_legacy_response ->> 'standardProductId', '')::uuid;
  v_resolution_status := v_legacy_response ->> 'outcome';

  if v_candidate_id is not null then
    update public.product_identity_candidates
    set client_key = v_client_key,
        sub_brand = v_sub_brand,
        request_payload = p_candidate,
        provenance = p_candidate -> 'provenance',
        updated_at = now()
    where user_id = v_user_id
      and id = v_candidate_id;
    if not found then
      raise exception 'product candidate authority row was not found'
        using errcode = 'P0002';
    end if;
  end if;

  v_response := v_legacy_response || jsonb_build_object(
    'clientKey', v_client_key,
    'productClientKey', v_client_key,
    'replayed', false,
    'deduplicated', false
  );

  if v_client_key is not null then
    insert into public.product_candidate_authority_projections (
      user_id, client_key, request_fingerprint, candidate_id,
      resolution_status, catalog_product_id, standard_product_id,
      source_payload
    ) values (
      v_user_id, v_client_key, v_fingerprint, v_candidate_id,
      v_resolution_status, v_catalog_product_id, v_standard_product_id,
      p_candidate
    );
  end if;

  insert into public.product_candidate_ingestion_contents (
    user_id, request_fingerprint, candidate_id, response
  ) values (
    v_user_id, v_fingerprint, v_candidate_id, v_response
  );

  insert into public.product_candidate_ingestion_requests (
    user_id, idempotency_key, request_fingerprint, candidate_id, response
  ) values (
    v_user_id, v_key, v_fingerprint, v_candidate_id, v_response
  );

  return v_response;
end;
$function$;

comment on function public.submit_product_candidate_v1(text, jsonb) is
  'Canonical-v3-aware Product Candidate ingest. client_key and sub_brand are source facts/local references; only PriceTrace-resolved catalog_product_reused projections may satisfy standalone retail observation prerequisites.';

revoke all on function public.submit_product_candidate_v1(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_product_candidate_v1(text, jsonb)
  to authenticated;

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
  v_projection public.product_candidate_authority_projections%rowtype;
  v_kind text;
  v_basis text;
  v_observed_on date;
  v_observed_at_text text;
  v_observed_at_exact timestamptz;
  v_observed_at_date date;
  v_merchant jsonb;
  v_product jsonb;
  v_item jsonb;
  v_merchant_name text;
  v_branch_name text;
  v_source_namespace text;
  v_source_code text;
  v_source_location_code text;
  v_product_client_key text;
  v_product_name text;
  v_submitted_product_name text;
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
  v_has_price_fact boolean;
  v_measurement_unit text;
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

  if p_observation is null
    or pg_catalog.jsonb_typeof(p_observation) <> 'object'
  then
    raise exception 'standalone price observation must be a JSON object'
      using errcode = '22023';
  end if;

  v_fingerprint := encode(
    extensions.digest(
      convert_to(p_observation::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text || ':standalone-observation:' || v_key,
      0
    )
  );

  select request.*
  into v_existing
  from public.standalone_price_observation_ingestion_requests as request
  where request.user_id = v_user_id
    and request.idempotency_key = v_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'The idempotency key was already used for another request.'
        using errcode = '23505';
    end if;
    return v_existing.response || jsonb_build_object('replayed', true);
  end if;

  -- Identity injection is rejected before any identity query. Local keys are
  -- allowed; PriceTrace UUIDs and server identity fields are not.
  if p_observation::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    or p_observation::text ~* '"(id|[a-z0-9]+_id|[a-zA-Z]+Id|uuid)"[[:space:]]*:'
  then
    raise exception 'external JSON must not contain UUID or PriceTrace identity fields'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_observation) as field_name
    where field_name not in (
      'schema_version', 'contract_version', 'kind', 'verification_basis',
      'transcription_status', 'observed_on', 'observed_at', 'currency',
      'gross_price', 'discount', 'net_price', 'quantity', 'unit_price',
      'merchant', 'product', 'item', 'source_url', 'note'
    )
  ) then
    raise exception 'standalone price observation contains unsupported fields'
      using errcode = '22023';
  end if;

  if coalesce(p_observation ->> 'schema_version', '')
      <> 'receipt-independent-price-observation.v3'
    or coalesce(p_observation ->> 'contract_version', '')
      <> 'price-observation.v3'
    or coalesce(p_observation ->> 'kind', '')
      not in ('retail_purchase', 'restaurant_purchase')
    or coalesce(p_observation ->> 'verification_basis', '')
      not in ('source_evidence', 'manual_canonical_review')
    or coalesce(p_observation ->> 'transcription_status', '')
      <> 'user_verified'
    or coalesce(p_observation ->> 'currency', '') <> 'KRW'
  then
    raise exception 'standalone v3 required contract fields are invalid'
      using errcode = '22023';
  end if;

  v_kind := p_observation ->> 'kind';
  v_basis := p_observation ->> 'verification_basis';

  if not (p_observation ? 'observed_on' or p_observation ? 'observed_at') then
    raise exception 'observed_on or observed_at is required'
      using errcode = '22023';
  end if;

  if p_observation ? 'observed_on'
    and (
      pg_catalog.jsonb_typeof(p_observation -> 'observed_on')
        is distinct from 'string'
      or p_observation ->> 'observed_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    )
  then
    raise exception 'observed_on must be an ISO date'
      using errcode = '22023';
  end if;

  if p_observation ? 'observed_at'
    and (
      pg_catalog.jsonb_typeof(p_observation -> 'observed_at')
        is distinct from 'string'
      or length(pg_catalog.btrim(p_observation ->> 'observed_at')) = 0
      or p_observation ->> 'observed_at' !~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    )
  then
    raise exception 'observed_at must be an ISO timestamp with timezone'
      using errcode = '22023';
  end if;

  if p_observation ? 'observed_on' then
    v_observed_on := (p_observation ->> 'observed_on')::date;
  end if;
  if p_observation ? 'observed_at' then
    v_observed_at_text := pg_catalog.btrim(p_observation ->> 'observed_at');
    v_observed_at_exact := v_observed_at_text::timestamptz;
    -- Compare the calendar date written by the user, not the UTC date after
    -- timestamptz normalization. This preserves e.g. +09:00 late-night dates.
    v_observed_at_date := substring(v_observed_at_text from 1 for 10)::date;
    if v_observed_on is null then
      v_observed_on := v_observed_at_date;
    elsif v_observed_on <> v_observed_at_date then
      raise exception 'observed_on and observed_at refer to different calendar dates'
        using errcode = '22023';
    end if;
  else
    -- Date-only input has date precision only; do not manufacture midnight.
    v_observed_at_exact := null;
  end if;

  if p_observation -> 'merchant' is null
    or pg_catalog.jsonb_typeof(p_observation -> 'merchant') <> 'object'
  then
    raise exception 'merchant facts are required' using errcode = '22023';
  end if;
  v_merchant := p_observation -> 'merchant';
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_merchant) as field_name
    where field_name not in (
      'merchant_name', 'branch_name', 'source_namespace', 'source_code',
      'source_location_code', 'business_registration_number', 'address',
      'phone'
    )
  ) then
    raise exception 'merchant facts contain unsupported fields'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_merchant) as field_name
    where pg_catalog.jsonb_typeof(v_merchant -> field_name)
      not in ('string', 'null')
  ) then
    raise exception 'merchant facts must contain strings or null'
      using errcode = '22023';
  end if;
  v_merchant_name := nullif(pg_catalog.btrim(v_merchant ->> 'merchant_name'), '');
  v_branch_name := nullif(pg_catalog.btrim(v_merchant ->> 'branch_name'), '');
  v_source_namespace := nullif(pg_catalog.btrim(v_merchant ->> 'source_namespace'), '');
  v_source_code := nullif(pg_catalog.btrim(v_merchant ->> 'source_code'), '');
  v_source_location_code := nullif(
    pg_catalog.btrim(v_merchant ->> 'source_location_code'),
    ''
  );
  if v_merchant_name is null or length(v_merchant_name) > 500 then
    raise exception 'merchant_name is required' using errcode = '22023';
  end if;
  if v_kind = 'restaurant_purchase'
    and v_source_location_code is not null
    and length(v_source_location_code) > 200
  then
    raise exception 'source_location_code is too long'
      using errcode = '22023';
  end if;

  if p_observation ? 'source_url' then
    if pg_catalog.jsonb_typeof(p_observation -> 'source_url')
        not in ('string', 'null')
    then
      raise exception 'source_url must be a string or null'
        using errcode = '22023';
    end if;
    v_source_url := nullif(pg_catalog.btrim(p_observation ->> 'source_url'), '');
    if v_source_url is not null and v_source_url !~ '^https?://' then
      raise exception 'source_url must be an HTTP(S) URL'
        using errcode = '22023';
    end if;
  end if;

  -- Each price fact is nullable. Only relationships whose operands were
  -- actually supplied are checked; no missing component is filled in.
  if exists (
    select 1
    from unnest(array['quantity', 'unit_price', 'gross_price', 'discount', 'net_price'])
      as field_name
    where p_observation ? field_name
      and pg_catalog.jsonb_typeof(p_observation -> field_name)
        not in ('number', 'null')
  ) then
    raise exception 'price facts must be JSON numbers or null'
      using errcode = '22023';
  end if;

  v_quantity := case
    when not (p_observation ? 'quantity')
      or pg_catalog.jsonb_typeof(p_observation -> 'quantity') = 'null'
      then null
    else (p_observation ->> 'quantity')::numeric
  end;
  v_unit_price := case
    when not (p_observation ? 'unit_price')
      or pg_catalog.jsonb_typeof(p_observation -> 'unit_price') = 'null'
      then null
    else (p_observation ->> 'unit_price')::numeric
  end;
  v_gross_price := case
    when not (p_observation ? 'gross_price')
      or pg_catalog.jsonb_typeof(p_observation -> 'gross_price') = 'null'
      then null
    else (p_observation ->> 'gross_price')::numeric
  end;
  v_discount_price := case
    when not (p_observation ? 'discount')
      or pg_catalog.jsonb_typeof(p_observation -> 'discount') = 'null'
      then null
    else (p_observation ->> 'discount')::numeric
  end;
  v_net_price := case
    when not (p_observation ? 'net_price')
      or pg_catalog.jsonb_typeof(p_observation -> 'net_price') = 'null'
      then null
    else (p_observation ->> 'net_price')::numeric
  end;

  v_has_price_fact := v_gross_price is not null
    or v_discount_price is not null
    or v_net_price is not null
    or v_unit_price is not null;
  if not v_has_price_fact then
    raise exception 'at least one observed price fact is required'
      using errcode = '22023';
  end if;

  if v_quantity is not null
    and (
      v_quantity < 1
      or v_quantity <> trunc(v_quantity)
      or v_quantity > 2147483647
    )
  then
    raise exception 'quantity must be a positive integer when known'
      using errcode = '22023';
  end if;
  if v_unit_price is not null
    and (
      v_unit_price < 0
      or v_unit_price <> trunc(v_unit_price)
      or v_unit_price > 2147483647
    )
  then
    raise exception 'unit_price must be a non-negative integer when known'
      using errcode = '22023';
  end if;
  if v_gross_price is not null
    and (
      v_gross_price < 0
      or v_gross_price <> trunc(v_gross_price)
      or v_gross_price > 2147483647
    )
  then
    raise exception 'gross_price must be a non-negative integer when known'
      using errcode = '22023';
  end if;
  if v_discount_price is not null
    and (
      v_discount_price < 0
      or v_discount_price <> trunc(v_discount_price)
      or v_discount_price > 2147483647
    )
  then
    raise exception 'discount must be a non-negative integer when known'
      using errcode = '22023';
  end if;
  if v_net_price is not null
    and (
      v_net_price < 0
      or v_net_price <> trunc(v_net_price)
      or v_net_price > 2147483647
    )
  then
    raise exception 'net_price must be a non-negative integer when known'
      using errcode = '22023';
  end if;

  if v_quantity is not null
    and v_unit_price is not null
    and v_net_price is not null
    and v_net_price <> v_quantity * v_unit_price
  then
    raise exception 'quantity multiplied by unit_price must equal net_price when all are known'
      using errcode = '23514';
  end if;
  if v_gross_price is not null
    and v_discount_price is not null
    and v_discount_price > v_gross_price
  then
    raise exception 'discount cannot exceed gross_price when both are known'
      using errcode = '23514';
  end if;
  if v_gross_price is not null
    and v_net_price is not null
    and v_gross_price < v_net_price
  then
    raise exception 'gross_price cannot be below net_price when both are known'
      using errcode = '23514';
  end if;
  if v_gross_price is not null
    and v_discount_price is not null
    and v_net_price is not null
    and v_gross_price - v_discount_price <> v_net_price
  then
    raise exception 'gross_price minus discount must equal net_price when all are known'
      using errcode = '23514';
  end if;

  if v_kind = 'retail_purchase' then
    if p_observation ? 'item' then
      raise exception 'retail standalone observation cannot contain restaurant item facts'
        using errcode = '22023';
    end if;
    if p_observation -> 'product' is null
      or pg_catalog.jsonb_typeof(p_observation -> 'product') <> 'object'
    then
      raise exception 'retail product candidate reference is required'
        using errcode = '22023';
    end if;
    v_product := p_observation -> 'product';
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_product) as field_name
      where field_name not in (
        'product_client_key', 'merchant_sku', 'product_name', 'brand',
        'sub_brand', 'manufacturer', 'specification', 'variant', 'identifiers'
      )
    ) then
      raise exception 'retail product facts contain unsupported fields'
        using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_product -> 'product_client_key')
        is distinct from 'string'
      or length(pg_catalog.btrim(v_product ->> 'product_client_key')) = 0
    then
      raise exception 'retail product_client_key is required'
        using errcode = '22023';
    end if;
    v_product_client_key := pg_catalog.btrim(v_product ->> 'product_client_key');
    if length(v_product_client_key) > 200 then
      raise exception 'product_client_key is too long'
        using errcode = '22023';
    end if;
    if v_product ? 'merchant_sku'
      and pg_catalog.jsonb_typeof(v_product -> 'merchant_sku')
        not in ('string', 'null')
    then
      raise exception 'merchant_sku must be a string or null'
        using errcode = '22023';
    end if;
    v_merchant_sku := nullif(
      pg_catalog.btrim(v_product ->> 'merchant_sku'),
      ''
    );
    if v_merchant_sku is not null and length(v_merchant_sku) > 300 then
      raise exception 'merchant_sku is too long'
        using errcode = '22023';
    end if;
    if v_merchant_sku is not null
      and v_merchant_sku = v_product_client_key
    then
      raise exception 'merchant_sku cannot reuse product_client_key; send only a real observed SKU'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_object_keys(v_product) as field_name
      where field_name in (
        'product_name', 'brand', 'sub_brand', 'manufacturer',
        'specification', 'variant'
      )
        and pg_catalog.jsonb_typeof(v_product -> field_name)
          not in ('string', 'null')
    ) then
      raise exception 'retail product text facts must be strings or null'
        using errcode = '22023';
    end if;
    if v_product ? 'identifiers'
      and pg_catalog.jsonb_typeof(v_product -> 'identifiers')
        not in ('array', 'null')
    then
      raise exception 'retail product identifiers must be an array or null'
        using errcode = '22023';
    end if;
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when v_product -> 'identifiers' is null
            or pg_catalog.jsonb_typeof(v_product -> 'identifiers') = 'null'
            then '[]'::jsonb
          else v_product -> 'identifiers'
        end
      ) as identifier(value)
      where pg_catalog.jsonb_typeof(identifier.value) <> 'object'
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(identifier.value) as field_name
          where field_name not in ('scheme', 'value')
        )
        or coalesce(identifier.value ->> 'scheme', '') not in ('ean', 'upc', 'gtin')
        or coalesce(identifier.value ->> 'value', '') !~ '^[0-9]{8,14}$'
    ) then
      raise exception 'retail product identifiers are invalid'
        using errcode = '22023';
    end if;

    select *
    into v_projection
    from public.product_candidate_authority_projections as projection
    where projection.user_id = v_user_id
      and projection.client_key = v_product_client_key;
    if not found then
      raise exception 'retail product candidate authority projection is required before a price observation'
        using errcode = '22023';
    end if;
    if v_projection.resolution_status <> 'catalog_product_reused'
      or v_projection.catalog_product_id is null
      or v_projection.standard_product_id is null
    then
      raise exception 'retail product candidate has no authoritative verified catalog resolution'
        using errcode = '22023';
    end if;

    select count(*)
    into v_match_count
    from public.catalog_products as catalog
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where catalog.id = v_projection.catalog_product_id
      and catalog.purchase_type = 'retail_product'
      and catalog.status = 'active'
      and catalog.verification_status = 'verified'
      and catalog.specification_status = 'verified'
      and standard.id = v_projection.standard_product_id
      and standard.purchase_type = 'retail_product'
      and standard.status = 'active'
      and standard.verification_status = 'verified';
    if v_match_count <> 1 then
      raise exception 'retail product candidate authority is no longer an active verified catalog identity'
        using errcode = '22023';
    end if;

    v_catalog_product_id := v_projection.catalog_product_id;
    v_standard_product_id := v_projection.standard_product_id;
    v_product_name := nullif(
      pg_catalog.btrim(v_projection.source_payload ->> 'product_name'),
      ''
    );
    if v_product_name is null then
      raise exception 'retail product candidate authority lacks product_name'
        using errcode = '22023';
    end if;
    v_submitted_product_name := nullif(
      pg_catalog.btrim(v_product ->> 'product_name'),
      ''
    );
    if v_submitted_product_name is not null
      and pg_catalog.lower(pg_catalog.regexp_replace(
        v_submitted_product_name, '[[:space:]]+', '', 'g'
      )) <> pg_catalog.lower(pg_catalog.regexp_replace(
        v_product_name, '[[:space:]]+', '', 'g'
      ))
    then
      raise exception 'retail product facts do not match the Product Candidate projection'
        using errcode = '22023';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_user_id::text || ':standalone-retail:' || v_product_client_key,
        0
      )
    );
    v_identity_fingerprint := encode(
      extensions.digest(
        convert_to(
          pg_catalog.concat_ws(
            '|',
            'retail',
            v_merchant_name,
            coalesce(v_branch_name, ''),
            coalesce(v_source_namespace, ''),
            coalesce(v_source_code, '')
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_user_id::text || ':standalone-retail-store:' ||
          v_identity_fingerprint,
        0
      )
    );
    select count(*), min(store.id)
    into v_match_count, v_store_id
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
        v_merchant_name
          || case when v_branch_name is null then '' else ' - ' || v_branch_name end,
        v_merchant_name,
        v_branch_name,
        'retail',
        v_source_code,
        v_source_namespace,
        v_identity_fingerprint
      )
      returning id into v_store_id;
    end if;

    select count(*), min(product.id)
    into v_match_count, v_product_id
    from public.products as product
    where product.user_id = v_user_id
      and product.name = v_product_name
      and product.purchase_type = 'retail_product';
    if v_match_count > 1 then
      raise exception 'retail product identity is ambiguous' using errcode = 'P0003';
    elsif v_match_count = 0 then
      insert into public.products (
        user_id, name, purchase_type, category_tags
      ) values (
        v_user_id, v_product_name, 'retail_product', array[]::text[]
      )
      returning id into v_product_id;
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
      )
      returning id into v_store_product_id;
    end if;

    v_quantity_int := case when v_quantity is null then null else v_quantity::integer end;
    v_unit_price_int := case when v_unit_price is null then null else v_unit_price::integer end;
    v_gross_price_int := case when v_gross_price is null then null else v_gross_price::integer end;
    v_discount_price_int := case when v_discount_price is null then null else v_discount_price::integer end;
    v_net_price_int := case when v_net_price is null then null else v_net_price::integer end;
    -- The wire contract has no explicit measurement-unit fact. Do not infer
    -- one merely because quantity and unit_price happen to be present.
    v_measurement_unit := null;

    insert into public.price_observations (
      user_id, store_product_id, receipt_item_id, observed_at,
      unit_price_krw, quantity, catalog_product_id, measurement_unit,
      location_label, attributes, verification_status, verified_at,
      observation_kind, verification_basis, currency, gross_price_krw,
      discount_price_krw, net_price_krw, observed_at_exact
    ) values (
      v_user_id,
      v_store_product_id,
      null,
      v_observed_on,
      v_unit_price_int,
      v_quantity_int,
      v_catalog_product_id,
      v_measurement_unit,
      v_branch_name,
      jsonb_build_object(
        'schemaVersion', 'receipt-independent-price-observation.v3',
        'merchant', v_merchant,
        'product', v_product,
        'sourceUrl', v_source_url,
        'productCandidateClientKey', v_product_client_key,
        'productCandidateAuthority', jsonb_build_object(
          'catalogProductId', v_catalog_product_id,
          'standardProductId', v_standard_product_id
        )
      ),
      'verified',
      v_now,
      'standalone_purchase',
      v_basis,
      'KRW',
      v_gross_price_int,
      v_discount_price_int,
      v_net_price_int,
      v_observed_at_exact
    )
    returning id into v_price_observation_id;

    v_response := jsonb_build_object(
      'schemaVersion', 'receipt-independent-price-observation.v3',
      'kind', v_kind,
      'observationId', v_price_observation_id,
      'replayed', false,
      'authoritativeIds', jsonb_build_object(
        'storeId', v_store_id,
        'productId', v_product_id,
        'storeProductId', v_store_product_id,
        'catalogProductId', v_catalog_product_id,
        'standardProductId', v_standard_product_id
      ),
      'productClientKey', v_product_client_key
    );

    insert into public.standalone_price_observation_ingestion_requests (
      user_id, idempotency_key, request_fingerprint, request_payload, kind,
      observation_id, retail_price_observation_id, response, created_at
    ) values (
      v_user_id,
      v_key,
      v_fingerprint,
      p_observation,
      v_kind,
      v_price_observation_id,
      v_price_observation_id,
      v_response,
      v_now
    );
    return v_response;
  end if;

  if p_observation ? 'product' then
    raise exception 'restaurant standalone observation cannot contain retail product facts'
      using errcode = '22023';
  end if;
  if p_observation -> 'item' is null
    or pg_catalog.jsonb_typeof(p_observation -> 'item') <> 'object'
  then
    raise exception 'restaurant menu item facts are required'
      using errcode = '22023';
  end if;
  v_item := p_observation -> 'item';
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_item) as field_name
    where field_name not in ('item_name', 'serving_label', 'category_label')
  ) then
    raise exception 'restaurant item facts contain unsupported fields'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(v_item) as field_name
    where pg_catalog.jsonb_typeof(v_item -> field_name)
      not in ('string', 'null')
  ) then
    raise exception 'restaurant item facts must contain strings or null'
      using errcode = '22023';
  end if;
  v_product_name := nullif(pg_catalog.btrim(v_item ->> 'item_name'), '');
  v_serving_label := coalesce(
    nullif(pg_catalog.btrim(v_item ->> 'serving_label'), ''),
    '1회 제공'
  );
  v_category_label := nullif(
    pg_catalog.btrim(v_item ->> 'category_label'),
    ''
  );
  if v_product_name is null or length(v_product_name) > 500 then
    raise exception 'item_name is required' using errcode = '22023';
  end if;

  v_source_namespace := coalesce(v_source_namespace, 'standalone-v3');
  v_location_identity_code := coalesce(
    v_source_location_code,
    encode(
      extensions.digest(
        convert_to(
          pg_catalog.concat_ws('|', v_merchant_name, coalesce(v_branch_name, '')),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_user_id::text || ':standalone-restaurant:' ||
        v_merchant_name || ':' || coalesce(v_branch_name, '') ||
        ':' || v_product_name,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      ':standalone-restaurant-location:' || v_source_namespace ||
        ':' || v_location_identity_code,
      0
    )
  );

  select count(*), min(restaurant.id)
  into v_match_count, v_restaurant_id
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
    )
    returning id into v_restaurant_id;
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
      raise exception 'restaurant location belongs to another restaurant'
        using errcode = '23505';
    end if;
  else
    insert into public.restaurant_locations (
      restaurant_id, source_namespace, source_location_code, location_label,
      review_status, verification_status, created_by
    ) values (
      v_restaurant_id, v_source_namespace, v_location_identity_code,
      v_branch_name, 'pending', 'unverified', v_user_id
    )
    returning id into v_restaurant_location_id;
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
    )
    returning id into v_standard_product_id;

    insert into public.catalog_products (
      standard_product_id, purchase_type, canonical_name, brand, specification,
      specification_status, content_amount, content_unit, package_count,
      reference_unit, listing_reference_url, attributes, status, created_by,
      verification_status
    ) values (
      v_standard_product_id,
      'menu_item',
      v_product_name,
      v_merchant_name,
      v_serving_label,
      'placeholder',
      1,
      'each',
      1,
      100,
      v_source_url,
      jsonb_build_object(
        'restaurantId', v_restaurant_id,
        'registrationSource', 'standalone_price_observation_v3'
      ),
      'active',
      v_user_id,
      'unverified'
    )
    returning id into v_catalog_product_id;

    insert into public.restaurant_menus (
      restaurant_id, catalog_product_id, canonical_name, category_label,
      serving_label, official_url, review_status, status, verification_status,
      created_by
    ) values (
      v_restaurant_id,
      v_catalog_product_id,
      v_product_name,
      v_category_label,
      v_serving_label,
      v_source_url,
      'pending',
      'active',
      'unverified',
      v_user_id
    )
    returning id into v_restaurant_menu_id;
  end if;

  select catalog.standard_product_id
  into v_standard_product_id
  from public.catalog_products as catalog
  where catalog.id = v_catalog_product_id;

  v_quantity_int := case when v_quantity is null then null else v_quantity::integer end;
  v_unit_price_int := case when v_unit_price is null then null else v_unit_price::integer end;
  v_gross_price_int := case when v_gross_price is null then null else v_gross_price::integer end;
  v_discount_price_int := case when v_discount_price is null then null else v_discount_price::integer end;
  v_net_price_int := case when v_net_price is null then null else v_net_price::integer end;

  insert into public.restaurant_menu_manual_observations (
    restaurant_id, restaurant_location_id, restaurant_menu_id, observed_on,
    unit_price_krw, quantity, total_price_krw, source_url, note, source_snapshot,
    verification_status, created_by, created_at, observation_kind,
    verification_basis, currency, gross_price_krw, discount_price_krw,
    net_price_krw, observed_at_exact
  ) values (
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    v_observed_on,
    v_unit_price_int,
    v_quantity_int,
    v_net_price_int,
    v_source_url,
    nullif(pg_catalog.btrim(p_observation ->> 'note'), ''),
    jsonb_build_object(
      'schemaVersion', 'receipt-independent-price-observation.v3',
      'merchant', v_merchant,
      'item', v_item,
      'sourceUrl', v_source_url,
      'grossPrice', v_gross_price_int,
      'discount', v_discount_price_int,
      'netPrice', v_net_price_int,
      'currency', 'KRW'
    ),
    'verified',
    v_user_id,
    v_now,
    'standalone_purchase',
    v_basis,
    'KRW',
    v_gross_price_int,
    v_discount_price_int,
    v_net_price_int,
    v_observed_at_exact
  )
  returning id into v_manual_observation_id;

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
    v_user_id,
    v_key,
    v_fingerprint,
    p_observation,
    v_kind,
    v_manual_observation_id,
    v_manual_observation_id,
    v_response,
    v_now
  );
  return v_response;
end;
$function$;

comment on function public.ingest_verified_standalone_price_observation_v1(text, jsonb) is
  'Accepts verified receipt-independent v3 facts, requires a PriceTrace Product Candidate authority projection for retail, preserves nullable price/date precision, rejects external UUIDs, and returns server-owned IDs.';

revoke all on function public.ingest_verified_standalone_price_observation_v1(text, jsonb)
  from public, anon;
grant execute on function public.ingest_verified_standalone_price_observation_v1(text, jsonb)
  to authenticated;
