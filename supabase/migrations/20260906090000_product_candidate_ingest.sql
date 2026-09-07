-- PriceTrace-owned product identity candidate ingestion from the OCR App.
-- This migration is additive: it does not create a public standard/catalog row
-- from OCR/GPT facts and does not write to RestaurantMenu or Fitness Nutrition.

create table public.catalog_product_identifiers (
  id uuid primary key default gen_random_uuid(),
  catalog_product_id uuid not null
    references public.catalog_products(id) on delete restrict,
  identifier_scheme text not null
    check (identifier_scheme in ('ean', 'upc', 'gtin')),
  identifier_value text not null
    check (identifier_value ~ '^[0-9]{8,14}$'),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected')),
  provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provenance) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (identifier_scheme = 'ean' and length(identifier_value) in (8, 13))
    or (identifier_scheme = 'upc' and length(identifier_value) = 12)
    or (identifier_scheme = 'gtin' and length(identifier_value) in (8, 12, 13, 14))
  ),
  unique (identifier_scheme, identifier_value)
);

comment on table public.catalog_product_identifiers is
  'PriceTrace-owned identifiers for exact catalog variants. Only verified rows may resolve an OCR product candidate.';

comment on column public.catalog_product_identifiers.provenance is
  'Evidence for the identifier; OCR/GPT input is never promoted here automatically.';

create index catalog_product_identifiers_catalog_idx
  on public.catalog_product_identifiers(catalog_product_id, verification_status);

alter table public.catalog_product_identifiers enable row level security;
revoke all on public.catalog_product_identifiers from public, anon, authenticated;
grant select, insert, update, delete on public.catalog_product_identifiers to authenticated;

create policy "verified catalog identifiers readable by signed in users"
  on public.catalog_product_identifiers for select to authenticated
  using (
    verification_status = 'verified'
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy "admins manage catalog identifiers"
  on public.catalog_product_identifiers for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table public.product_identity_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null
    check (schema_version = 'PRICETRACE_PRODUCT_CANDIDATE'),
  contract_version text not null
    check (contract_version = 'product-candidate.v1'),
  source_app text not null
    check (source_app = 'pricetrace_ocr_app'),
  source_version text,
  candidate_type text not null
    check (candidate_type in ('retail_product', 'complimentary_side', 'meal_component_estimate')),
  product_name text not null check (length(btrim(product_name)) > 0),
  brand text,
  manufacturer text,
  specification text,
  content_amount numeric(12, 3),
  content_unit text check (content_unit is null or content_unit in ('g', 'ml', 'each')),
  package_count integer check (package_count is null or package_count > 0),
  variant text,
  identifiers jsonb not null check (jsonb_typeof(identifiers) = 'array'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'array'),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'review_required', 'accepted', 'rejected')),
  review_reasons text[] not null default '{}'::text[],
  possible_catalog_product_ids uuid[] not null default '{}'::uuid[],
  verification_status text not null default 'unverified'
    check (verification_status = 'unverified'),
  visibility text not null default 'private'
    check (visibility = 'private'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  check (
    (review_status = 'review_required' and cardinality(review_reasons) > 0)
    or review_status <> 'review_required'
  ),
  check (
    (content_amount is null and content_unit is null)
    or (content_amount is not null and content_amount > 0 and content_unit is not null)
  )
);

comment on table public.product_identity_candidates is
  'Private, unverified product identity facts submitted by the OCR App. It is not a public standard product or catalog variant.';

comment on column public.product_identity_candidates.manufacturer is
  'Observed manufacturer provenance, not an automatic canonical brand or product identity.';

comment on column public.product_identity_candidates.request_payload is
  'The accepted, privacy-sanitized PRICETRACE_PRODUCT_CANDIDATE payload for audit and replay inspection.';

create index product_identity_candidates_user_review_idx
  on public.product_identity_candidates(user_id, review_status, created_at desc);

create index product_identity_candidates_identifier_idx
  on public.product_identity_candidates using gin (identifiers);

alter table public.product_identity_candidates enable row level security;
revoke all on public.product_identity_candidates from public, anon, authenticated;
grant select on public.product_identity_candidates to authenticated;

create policy "users read own product identity candidates"
  on public.product_identity_candidates for select to authenticated
  using ((select auth.uid()) = user_id);

create table public.product_candidate_ingestion_contents (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_id uuid,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, request_fingerprint),
  foreign key (user_id, candidate_id)
    references public.product_identity_candidates(user_id, id) on delete restrict
);

comment on table public.product_candidate_ingestion_contents is
  'Content-level deduplication for PRICETRACE_PRODUCT_CANDIDATE. A reused catalog result has a null candidate_id.';

create table public.product_candidate_ingestion_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null
    check (length(btrim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  candidate_id uuid,
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key),
  foreign key (user_id, request_fingerprint)
    references public.product_candidate_ingestion_contents(user_id, request_fingerprint)
    on delete restrict,
  foreign key (user_id, candidate_id)
    references public.product_identity_candidates(user_id, id) on delete restrict
);

comment on table public.product_candidate_ingestion_requests is
  'Per-user idempotency bindings for PRICETRACE_PRODUCT_CANDIDATE. It never trusts a client-supplied PriceTrace UUID.';

alter table public.product_candidate_ingestion_contents enable row level security;
alter table public.product_candidate_ingestion_requests enable row level security;
revoke all on public.product_candidate_ingestion_contents,
  public.product_candidate_ingestion_requests from public, anon, authenticated;
grant select on public.product_candidate_ingestion_contents,
  public.product_candidate_ingestion_requests to authenticated;

create policy "users read own product candidate content dedup"
  on public.product_candidate_ingestion_contents for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read own product candidate request dedup"
  on public.product_candidate_ingestion_requests for select to authenticated
  using ((select auth.uid()) = user_id);

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
  v_candidate_id uuid;
  v_catalog_product_id uuid;
  v_standard_product_id uuid;
  v_nutrition_food_id text;
  v_source_version text;
  v_candidate_type text;
  v_product_name text;
  v_brand text;
  v_manufacturer text;
  v_specification text;
  v_content_amount numeric;
  v_content_unit text;
  v_package_count integer;
  v_variant text;
  v_identifiers jsonb;
  v_evidence jsonb;
  v_provenance jsonb;
  v_identifier_matches uuid[] := '{}'::uuid[];
  v_exact_matches uuid[] := '{}'::uuid[];
  v_possible_catalog_product_ids uuid[] := '{}'::uuid[];
  v_review_reasons text[] := '{}'::text[];
  v_outcome text;
  v_review_status text;
  v_verification_status text;
  v_response jsonb;
  v_matched_catalog_name text;
  v_matched_standard_name text;
  v_matched_catalog_brand text;
  v_matched_standard_brand text;
  v_matched_specification text;
  v_matched_content_amount numeric;
  v_matched_content_unit text;
  v_matched_package_count integer;
  v_name_matches boolean;
  v_brand_matches boolean;
  v_specification_matches boolean;
  v_content_matches boolean;
  v_package_matches boolean;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  if length(v_key) not between 1 and 200 then
    raise exception 'idempotency key must contain 1 to 200 characters'
      using errcode = '22023';
  end if;

  if p_candidate is null or pg_catalog.jsonb_typeof(p_candidate) <> 'object' then
    raise exception 'PRICETRACE_PRODUCT_CANDIDATE JSON object is required'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_candidate) as field_name
    where field_name not in (
      'schema_version', 'contract_version', 'source_app', 'source_version',
      'candidate_type', 'product_name', 'brand', 'manufacturer',
      'specification', 'content_amount', 'content_unit', 'package_count',
      'variant', 'identifiers', 'evidence', 'provenance', 'nutrition_food_id'
    )
  ) then
    raise exception 'PRICETRACE_PRODUCT_CANDIDATE contains unsupported identity fields'
      using errcode = '22023';
  end if;

  if coalesce(p_candidate ->> 'schema_version', '') <> 'PRICETRACE_PRODUCT_CANDIDATE'
    or coalesce(p_candidate ->> 'contract_version', '') <> 'product-candidate.v1'
    or coalesce(p_candidate ->> 'source_app', '') <> 'pricetrace_ocr_app'
    or pg_catalog.jsonb_typeof(p_candidate -> 'product_name') is distinct from 'string'
    or length(pg_catalog.btrim(coalesce(p_candidate ->> 'product_name', ''))) = 0
    or length(pg_catalog.btrim(coalesce(p_candidate ->> 'product_name', ''))) > 300
    or coalesce(p_candidate ->> 'candidate_type', '') not in (
      'retail_product', 'complimentary_side', 'meal_component_estimate'
    )
    or pg_catalog.jsonb_typeof(p_candidate -> 'identifiers') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_candidate -> 'evidence') is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_candidate -> 'provenance') is distinct from 'object'
  then
    raise exception 'PRICETRACE_PRODUCT_CANDIDATE required fields are invalid'
      using errcode = '22023';
  end if;

  if (
    p_candidate ? 'source_version'
    and pg_catalog.jsonb_typeof(p_candidate -> 'source_version') not in ('string', 'null')
  )
    or (
      p_candidate ? 'brand'
      and pg_catalog.jsonb_typeof(p_candidate -> 'brand') not in ('string', 'null')
    )
    or (
      p_candidate ? 'manufacturer'
      and pg_catalog.jsonb_typeof(p_candidate -> 'manufacturer') not in ('string', 'null')
    )
    or (
      p_candidate ? 'specification'
      and pg_catalog.jsonb_typeof(p_candidate -> 'specification') not in ('string', 'null')
    )
    or (
      p_candidate ? 'content_unit'
      and pg_catalog.jsonb_typeof(p_candidate -> 'content_unit') not in ('string', 'null')
    )
    or (
      p_candidate ? 'variant'
      and pg_catalog.jsonb_typeof(p_candidate -> 'variant') not in ('string', 'null')
    )
    or (
      p_candidate ? 'nutrition_food_id'
      and pg_catalog.jsonb_typeof(p_candidate -> 'nutrition_food_id') not in ('string', 'null')
    )
  then
    raise exception 'PRICETRACE_PRODUCT_CANDIDATE text fields must be strings or null'
      using errcode = '22023';
  end if;

  -- A client cannot smuggle a PriceTrace/Nutrition identity, raw OCR, image
  -- material, or authentication material through evidence/provenance JSON.
  if p_candidate::text ~* '"(raw_text|raw_ocr|image_path|image_uri|image_base64|access_token|refresh_token|user_verified|standard_product_id|catalog_product_id|restaurant_menu_id)"'
  then
    raise exception 'PRICETRACE_PRODUCT_CANDIDATE contains forbidden source or identity material'
      using errcode = '22023';
  end if;

  v_source_version := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'source_version', '')), '');
  if v_source_version is not null and length(v_source_version) > 100 then
    raise exception 'source_version must contain at most 100 characters'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_candidate -> 'provenance') as field_name
    where field_name not in (
      'capture_id', 'capture_content_hash', 'extraction_method',
      'extractor', 'extractor_version', 'observed_at', 'source_revision'
    )
  )
    or coalesce(p_candidate -> 'provenance' ->> 'extraction_method', '') not in (
      'ocr', 'gpt_vision', 'manual', 'mixed'
    )
  then
    raise exception 'provenance must use the product-candidate.v1 allowlist'
      using errcode = '22023';
  end if;

  if p_candidate -> 'provenance' ->> 'capture_content_hash' is not null
    and p_candidate -> 'provenance' ->> 'capture_content_hash'
      !~ '^sha256:[a-f0-9]{64}$'
  then
    raise exception 'capture_content_hash must be a sha256 revision'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_candidate -> 'evidence') not between 1 and 20
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_candidate -> 'evidence') as evidence(value)
      where pg_catalog.jsonb_typeof(evidence.value) is distinct from 'object'
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(evidence.value) as field_name
          where field_name not in (
            'source_type', 'source_ref', 'field', 'observed_value', 'content_hash'
          )
        )
        or coalesce(evidence.value ->> 'source_type', '') not in (
          'product_photo', 'package_label', 'receipt', 'official_listing',
          'manufacturer', 'user_statement', 'ocr'
        )
        or length(pg_catalog.btrim(coalesce(evidence.value ->> 'source_ref', ''))) = 0
        or length(pg_catalog.btrim(coalesce(evidence.value ->> 'source_ref', ''))) > 500
        or length(pg_catalog.btrim(coalesce(evidence.value ->> 'field', ''))) = 0
        or length(pg_catalog.btrim(coalesce(evidence.value ->> 'field', ''))) > 100
        or (
          evidence.value ? 'observed_value'
          and pg_catalog.jsonb_typeof(evidence.value -> 'observed_value')
            not in ('string', 'null')
        )
        or (
          evidence.value ->> 'content_hash' is not null
          and evidence.value ->> 'content_hash' !~ '^sha256:[a-f0-9]{64}$'
        )
    )
  then
    raise exception 'evidence must contain 1 to 20 sanitized source facts'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_candidate -> 'identifiers') > 8
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_candidate -> 'identifiers') as identifier(value)
      where pg_catalog.jsonb_typeof(identifier.value) is distinct from 'object'
        or exists (
          select 1
          from pg_catalog.jsonb_object_keys(identifier.value) as field_name
          where field_name not in ('scheme', 'value')
        )
        or coalesce(identifier.value ->> 'scheme', '') not in ('ean', 'upc', 'gtin')
        or pg_catalog.jsonb_typeof(identifier.value -> 'value') is distinct from 'string'
        or pg_catalog.btrim(identifier.value ->> 'value') !~ '^[0-9 -]+$'
        or length(pg_catalog.regexp_replace(pg_catalog.btrim(identifier.value ->> 'value'), '[ -]', '', 'g')) not between 8 and 14
        or (
          identifier.value ->> 'scheme' = 'ean'
          and length(pg_catalog.regexp_replace(pg_catalog.btrim(identifier.value ->> 'value'), '[ -]', '', 'g')) not in (8, 13)
        )
        or (
          identifier.value ->> 'scheme' = 'upc'
          and length(pg_catalog.regexp_replace(pg_catalog.btrim(identifier.value ->> 'value'), '[ -]', '', 'g')) <> 12
        )
        or (
          identifier.value ->> 'scheme' = 'gtin'
          and length(pg_catalog.regexp_replace(pg_catalog.btrim(identifier.value ->> 'value'), '[ -]', '', 'g')) not in (8, 12, 13, 14)
        )
    )
  then
    raise exception 'identifiers must contain valid EAN, UPC, or GTIN values'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from pg_catalog.jsonb_array_elements(p_candidate -> 'identifiers') as identifier(value)
  ) <> (
    select count(distinct identifier.value ->> 'scheme' || ':' || pg_catalog.regexp_replace(
      pg_catalog.btrim(identifier.value ->> 'value'), '[ -]', '', 'g'
    ))
    from pg_catalog.jsonb_array_elements(p_candidate -> 'identifiers') as identifier(value)
  ) then
    raise exception 'identifiers must not contain duplicate scheme/value pairs'
      using errcode = '22023';
  end if;

  if p_candidate ? 'content_amount'
    and pg_catalog.jsonb_typeof(p_candidate -> 'content_amount')
      not in ('number', 'null')
  then
    raise exception 'content_amount must be a JSON number or null'
      using errcode = '22023';
  end if;
  if p_candidate ? 'package_count'
    and pg_catalog.jsonb_typeof(p_candidate -> 'package_count')
      not in ('number', 'null')
  then
    raise exception 'package_count must be a JSON integer or null'
      using errcode = '22023';
  end if;

  v_candidate_type := p_candidate ->> 'candidate_type';
  v_product_name := pg_catalog.btrim(p_candidate ->> 'product_name');
  v_brand := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'brand', '')), '');
  v_manufacturer := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'manufacturer', '')), '');
  v_specification := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'specification', '')), '');
  v_variant := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'variant', '')), '');
  v_content_unit := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'content_unit', '')), '');
  v_nutrition_food_id := nullif(pg_catalog.btrim(coalesce(p_candidate ->> 'nutrition_food_id', '')), '');
  v_identifiers := p_candidate -> 'identifiers';
  v_evidence := p_candidate -> 'evidence';
  v_provenance := p_candidate -> 'provenance';

  if v_brand is not null and length(v_brand) > 300
    or v_manufacturer is not null and length(v_manufacturer) > 300
    or v_specification is not null and length(v_specification) > 500
    or v_variant is not null and length(v_variant) > 300
    or v_nutrition_food_id is not null and length(v_nutrition_food_id) > 200
    or v_content_unit is not null and v_content_unit not in ('g', 'ml', 'each')
  then
    raise exception 'product candidate text or content fields are invalid'
      using errcode = '22023';
  end if;

  v_content_amount := case
    when p_candidate -> 'content_amount' is null
      or pg_catalog.jsonb_typeof(p_candidate -> 'content_amount') = 'null'
      then null
    else (p_candidate ->> 'content_amount')::numeric
  end;
  v_package_count := case
    when p_candidate -> 'package_count' is null
      or pg_catalog.jsonb_typeof(p_candidate -> 'package_count') = 'null'
      then null
    else (p_candidate ->> 'package_count')::numeric::integer
  end;

  if v_content_amount is not null and v_content_amount <= 0
    or v_package_count is not null and v_package_count <= 0
    or (v_content_amount is null) <> (v_content_unit is null)
    or (
      v_package_count is not null
      and (p_candidate ->> 'package_count')::numeric <> v_package_count
    )
  then
    raise exception 'content amount/unit and package count must be positive and internally consistent'
      using errcode = '22023';
  end if;

  v_fingerprint := encode(extensions.digest(p_candidate::text, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_key, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || v_fingerprint, 0)
  );

  select *
  into v_existing
  from public.product_candidate_ingestion_requests
  where user_id = v_user_id and idempotency_key = v_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'idempotency key was already used for another product candidate'
        using errcode = '23505';
    end if;
    return v_existing.response || jsonb_build_object(
      'replayed', true,
      'deduplicated', true
    );
  end if;

  select *
  into v_duplicate
  from public.product_candidate_ingestion_contents
  where user_id = v_user_id and request_fingerprint = v_fingerprint;
  if found then
    insert into public.product_candidate_ingestion_requests(
      user_id, idempotency_key, request_fingerprint, candidate_id, response
    ) values (
      v_user_id, v_key, v_fingerprint, v_duplicate.candidate_id, v_duplicate.response
    );
    return v_duplicate.response || jsonb_build_object(
      'replayed', false,
      'deduplicated', true
    );
  end if;

  if v_candidate_type = 'retail_product' then
    select coalesce(
      array_agg(distinct identifier.catalog_product_id order by identifier.catalog_product_id),
      '{}'::uuid[]
    )
    into v_identifier_matches
    from public.catalog_product_identifiers as identifier
    inner join public.catalog_products as catalog
      on catalog.id = identifier.catalog_product_id
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where identifier.verification_status = 'verified'
      and catalog.status = 'active'
      and standard.status = 'active'
      and catalog.verification_status = 'verified'
      and standard.verification_status = 'verified'
      and catalog.specification_status = 'verified'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(v_identifiers) as candidate_identifier(value)
        where candidate_identifier.value ->> 'scheme' = identifier.identifier_scheme
          and identifier.identifier_value = pg_catalog.regexp_replace(
            pg_catalog.btrim(candidate_identifier.value ->> 'value'), '[ -]', '', 'g'
          )
      );

    v_possible_catalog_product_ids := v_identifier_matches;

    if cardinality(v_identifier_matches) = 1 then
      select
        catalog.canonical_name,
        standard.canonical_name,
        catalog.brand,
        standard.brand,
        catalog.specification,
        catalog.content_amount,
        catalog.content_unit,
        catalog.package_count,
        catalog.id,
        catalog.standard_product_id
      into
        v_matched_catalog_name,
        v_matched_standard_name,
        v_matched_catalog_brand,
        v_matched_standard_brand,
        v_matched_specification,
        v_matched_content_amount,
        v_matched_content_unit,
        v_matched_package_count,
        v_catalog_product_id,
        v_standard_product_id
      from public.catalog_products as catalog
      inner join public.standard_products as standard
        on standard.id = catalog.standard_product_id
      where catalog.id = v_identifier_matches[1];

      v_name_matches := pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(v_matched_catalog_name), '[[:space:]]+', '', 'g'
        )
      ) = pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(coalesce(v_variant, v_product_name)), '[[:space:]]+', '', 'g'
        )
      )
      or (
        v_variant is not null
        and pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.btrim(v_matched_standard_name), '[[:space:]]+', '', 'g'
        )) = pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.btrim(v_product_name), '[[:space:]]+', '', 'g'
        ))
        and pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.btrim(v_matched_catalog_name), '[[:space:]]+', '', 'g'
        )) = pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.btrim(v_variant), '[[:space:]]+', '', 'g'
        ))
      );
      v_brand_matches := v_brand is null
        or pg_catalog.lower(pg_catalog.btrim(coalesce(v_matched_catalog_brand, '')))
          = pg_catalog.lower(v_brand)
        or pg_catalog.lower(pg_catalog.btrim(coalesce(v_matched_standard_brand, '')))
          = pg_catalog.lower(v_brand);
      v_specification_matches := v_specification is null
        or pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.btrim(coalesce(v_matched_specification, '')), '[[:space:]]+', '', 'g'
        )) = pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.btrim(v_specification), '[[:space:]]+', '', 'g'
        ));
      v_content_matches := v_content_amount is null
        or (
          v_matched_content_amount = v_content_amount
          and v_matched_content_unit = v_content_unit
        );
      v_package_matches := v_package_count is null
        or v_matched_package_count = v_package_count;

      if v_name_matches and v_brand_matches and v_specification_matches
        and v_content_matches and v_package_matches
      then
        v_outcome := 'catalog_product_reused';
      else
        v_outcome := 'review_required';
        if not v_name_matches then
          v_review_reasons := array_append(v_review_reasons, 'identifier_name_conflict');
        end if;
        if not v_brand_matches then
          v_review_reasons := array_append(v_review_reasons, 'identifier_brand_conflict');
        end if;
        if not v_specification_matches then
          v_review_reasons := array_append(v_review_reasons, 'identifier_specification_conflict');
        end if;
        if not v_content_matches then
          v_review_reasons := array_append(v_review_reasons, 'identifier_content_conflict');
        end if;
        if not v_package_matches then
          v_review_reasons := array_append(v_review_reasons, 'identifier_package_count_conflict');
        end if;
        v_catalog_product_id := null;
        v_standard_product_id := null;
      end if;
    elsif cardinality(v_identifier_matches) > 1 then
      v_outcome := 'review_required';
      v_review_reasons := array_append(
        v_review_reasons, 'identifier_matches_multiple_catalog_products'
      );
    end if;

    if v_outcome is null
      and v_brand is not null
      and v_content_amount is not null
      and v_content_unit is not null
      and v_package_count is not null
    then
      select coalesce(
        array_agg(catalog.id order by catalog.id),
        '{}'::uuid[]
      )
      into v_exact_matches
      from public.catalog_products as catalog
      inner join public.standard_products as standard
        on standard.id = catalog.standard_product_id
      where catalog.purchase_type = 'retail_product'
        and standard.purchase_type = 'retail_product'
        and catalog.status = 'active'
        and standard.status = 'active'
        and catalog.verification_status = 'verified'
        and standard.verification_status = 'verified'
        and catalog.specification_status = 'verified'
        and catalog.content_amount = v_content_amount
        and catalog.content_unit = v_content_unit
        and catalog.package_count = v_package_count
        and (
          pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.btrim(catalog.canonical_name), '[[:space:]]+', '', 'g'
          )) = pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(v_variant, v_product_name)), '[[:space:]]+', '', 'g'
          ))
          or (
            v_variant is not null
            and pg_catalog.lower(pg_catalog.regexp_replace(
              pg_catalog.btrim(standard.canonical_name), '[[:space:]]+', '', 'g'
            )) = pg_catalog.lower(pg_catalog.regexp_replace(
              pg_catalog.btrim(v_product_name), '[[:space:]]+', '', 'g'
            ))
            and pg_catalog.lower(pg_catalog.regexp_replace(
              pg_catalog.btrim(catalog.canonical_name), '[[:space:]]+', '', 'g'
            )) = pg_catalog.lower(pg_catalog.regexp_replace(
              pg_catalog.btrim(v_variant), '[[:space:]]+', '', 'g'
            ))
          )
        )
        and (
          pg_catalog.lower(pg_catalog.btrim(coalesce(catalog.brand, '')))
            = pg_catalog.lower(v_brand)
          or pg_catalog.lower(pg_catalog.btrim(coalesce(standard.brand, '')))
            = pg_catalog.lower(v_brand)
        )
        and (
          v_specification is null
          or pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.btrim(coalesce(catalog.specification, '')), '[[:space:]]+', '', 'g'
          )) = pg_catalog.lower(pg_catalog.regexp_replace(
            pg_catalog.btrim(v_specification), '[[:space:]]+', '', 'g'
          ))
        );

      if cardinality(v_exact_matches) = 1 then
        select catalog.id, catalog.standard_product_id
        into v_catalog_product_id, v_standard_product_id
        from public.catalog_products as catalog
        where catalog.id = v_exact_matches[1];
        v_possible_catalog_product_ids := v_exact_matches;
        v_outcome := 'catalog_product_reused';
      elsif cardinality(v_exact_matches) > 1 then
        v_possible_catalog_product_ids := v_exact_matches;
        v_outcome := 'review_required';
        v_review_reasons := array_append(
          v_review_reasons, 'exact_identity_matches_multiple_catalog_products'
        );
      end if;
    end if;

    if v_outcome is null then
      v_outcome := 'private_unverified_candidate_created';
    end if;
  else
    -- These semantic labels are preserved as private review evidence only.
    -- They must never be projected into restaurant_menus by this RPC.
    v_outcome := 'review_required';
    v_review_reasons := array_append(
      v_review_reasons, 'semantic_candidate_is_not_a_retail_product'
    );
  end if;

  if v_outcome in ('private_unverified_candidate_created', 'review_required') then
    v_review_status := case
      when v_outcome = 'review_required' then 'review_required'
      else 'pending'
    end;
    insert into public.product_identity_candidates (
      user_id,
      schema_version,
      contract_version,
      source_app,
      source_version,
      candidate_type,
      product_name,
      brand,
      manufacturer,
      specification,
      content_amount,
      content_unit,
      package_count,
      variant,
      identifiers,
      evidence,
      provenance,
      request_payload,
      review_status,
      review_reasons,
      possible_catalog_product_ids
    ) values (
      v_user_id,
      'PRICETRACE_PRODUCT_CANDIDATE',
      'product-candidate.v1',
      'pricetrace_ocr_app',
      v_source_version,
      v_candidate_type,
      v_product_name,
      v_brand,
      v_manufacturer,
      v_specification,
      v_content_amount,
      v_content_unit,
      v_package_count,
      v_variant,
      v_identifiers,
      v_evidence,
      v_provenance,
      p_candidate,
      v_review_status,
      v_review_reasons,
      v_possible_catalog_product_ids
    ) returning id into v_candidate_id;
    v_catalog_product_id := null;
    v_standard_product_id := null;
  end if;

  v_verification_status := case
    when v_outcome = 'catalog_product_reused' then 'verified'
    else 'unverified'
  end;

  v_response := jsonb_build_object(
    'schemaVersion', 'product-candidate.v1',
    'contract', 'PRICETRACE_PRODUCT_CANDIDATE',
    'outcome', v_outcome,
    'catalogProductId', v_catalog_product_id,
    'standardProductId', v_standard_product_id,
    'candidateId', v_candidate_id,
    'verificationStatus', v_verification_status,
    'reviewStatus', case
      when v_outcome = 'catalog_product_reused' then 'not_required'
      else v_review_status
    end,
    'reviewReasons', to_jsonb(v_review_reasons),
    'possibleCatalogProductIds', to_jsonb(v_possible_catalog_product_ids),
    'restaurantMenuCandidateCreated', false,
    'nutritionHandoff', jsonb_build_object(
      'status', case
        when v_catalog_product_id is null then 'blocked_until_catalog_product'
        when v_nutrition_food_id is null then 'awaiting_nutrition_food_id'
        else 'ready_for_existing_proposal_flow'
      end,
      'namespace', 'pricetrace',
      'catalogProductId', v_catalog_product_id,
      'nutritionFoodId', v_nutrition_food_id,
      'proposalRpc', 'propose_product_nutrition_link_v1',
      'requiresProductReadRevision', true
    ),
    'replayed', false,
    'deduplicated', false
  );

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
  'PriceTrace-owned PRICETRACE_PRODUCT_CANDIDATE ingestion. It reuses only one active verified exact catalog identity, otherwise stores a private unverified candidate or review-required evidence. It never creates a public standard product, catalog product, RestaurantMenu, or Fitness Nutrition link.';

revoke all on function public.submit_product_candidate_v1(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_product_candidate_v1(text, jsonb)
  to authenticated;
