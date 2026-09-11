-- Add the order-history evidence channel without rewriting the existing
-- Product Candidate storage or the legacy v1 matcher.
--
-- The canonical-v3-aware wrapper temporarily maps the new source label to the
-- legacy sanitized `ocr` label only while calling the unchanged matcher, then
-- restores the caller's exact order_history evidence in the candidate row and
-- request payload. Raw OCR/image/auth material and server identities continue
-- to be rejected by the legacy boundary before persistence.

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
  v_has_order_history boolean := false;
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

  if pg_catalog.jsonb_typeof(p_candidate -> 'evidence') = 'array' then
    v_has_order_history := exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_candidate -> 'evidence') as evidence(value)
      where evidence.value ->> 'source_type' = 'order_history'
    );
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_candidate -> 'evidence') as evidence(value)
      where evidence.value ->> 'source_type' = 'order_history'
        and coalesce(evidence.value ->> 'field', '') not in (
          'product_name', 'option_text', 'merchant_sku', 'variant', 'brand',
          'manufacturer', 'specification', 'content_amount', 'content_unit',
          'package_count'
        )
        or evidence.value ->> 'source_type' = 'order_history'
        and (
          pg_catalog.jsonb_typeof(evidence.value -> 'observed_value')
            is distinct from 'string'
          or length(pg_catalog.btrim(evidence.value ->> 'observed_value')) = 0
        )
    ) then
      raise exception 'order_history evidence must contain one observed product source fact'
        using errcode = '22023';
    end if;
  end if;

  -- A payload carrying neither the canonical-v3 fields nor the new evidence
  -- source remains byte-for-byte on the old v1 compatibility path.
  if not (p_candidate ? 'client_key'
    or p_candidate ? 'sub_brand'
    or v_has_order_history)
  then
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

  -- The existing matcher still enforces the full v1 allowlist, type checks,
  -- forbidden raw-source/identity rules, and authority matching. The internal
  -- label is only a compatibility shim; the persisted candidate restores the
  -- exact source_type and evidence supplied by the caller.
  v_legacy_candidate := p_candidate - 'client_key' - 'sub_brand';
  if v_has_order_history then
    v_legacy_candidate := jsonb_set(
      v_legacy_candidate,
      '{evidence}',
      (
        select pg_catalog.jsonb_agg(
          case
            when evidence.value ->> 'source_type' = 'order_history' then
              pg_catalog.jsonb_set(
                evidence.value,
                '{source_type}',
                to_jsonb('ocr'::text),
                false
              )
            else evidence.value
          end
          order by evidence.ordinality
        )
        from pg_catalog.jsonb_array_elements(v_legacy_candidate -> 'evidence')
          with ordinality as evidence(value, ordinality)
      ),
      true
    );
  end if;
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
        evidence = p_candidate -> 'evidence',
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
  'Canonical-v3-aware Product Candidate ingest with sanitized order_history evidence. client_key and sub_brand are source facts/local references; only PriceTrace-resolved catalog_product_reused projections may satisfy standalone retail observation prerequisites.';

revoke all on function public.submit_product_candidate_v1(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_product_candidate_v1(text, jsonb)
  to authenticated;
