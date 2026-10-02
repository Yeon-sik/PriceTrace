-- OCR-App owns human source review for verified receipt ingestion. PriceTrace
-- continues to validate domain facts and issue canonical Restaurant/Location IDs.

-- Keep pg_get_functiondef patch anchors insensitive to formatting while
-- requiring each semantic anchor to be unique. This helper lives only for the
-- migration session and is removed at the end of the migration.
create or replace function pg_temp.ocr_v5_anchor_span(
  p_definition text,
  p_anchor text,
  p_context text
)
returns integer[]
language plpgsql
as $function$
declare
  v_pattern text := pg_catalog.btrim(p_anchor);
  v_meta text;
  v_match_count integer;
  v_start integer;
  v_end integer;
begin
  if v_pattern is null or v_pattern = '' then
    raise exception 'OCR V5 patch anchor % is empty', p_context;
  end if;

  v_pattern := pg_catalog.replace(v_pattern, pg_catalog.chr(92), pg_catalog.chr(92) || pg_catalog.chr(92));
  foreach v_meta in array array['.', '^', '$', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}'] loop
    v_pattern := pg_catalog.replace(v_pattern, v_meta, pg_catalog.chr(92) || v_meta);
  end loop;
  v_pattern := pg_catalog.regexp_replace(v_pattern, '[[:space:]]+', '[[:space:]]+', 'g');

  v_match_count := pg_catalog.regexp_count(p_definition, v_pattern);
  if v_match_count <> 1 then
    raise exception 'OCR V5 patch anchor % matched % times', p_context, v_match_count;
  end if;

  v_start := pg_catalog.regexp_instr(p_definition, v_pattern, 1, 1, 0);
  v_end := pg_catalog.regexp_instr(p_definition, v_pattern, 1, 1, 1);
  return array[v_start, v_end];
end;
$function$;

alter table public.merchant_identity_candidates
  drop constraint merchant_identity_candidates_review_status_check,
  add constraint merchant_identity_candidates_review_status_check
    check (review_status in ('pending', 'accepted', 'rejected', 'needs_ocr_resolution')),
  add column receipt_id uuid;

alter table public.merchant_identity_candidates
  add constraint merchant_identity_candidates_receipt_owner_fk
    foreign key (user_id, receipt_id)
    references public.receipts(user_id, id) on delete cascade;

create index merchant_identity_candidates_receipt_idx
  on public.merchant_identity_candidates(user_id, receipt_id)
  where receipt_id is not null;

comment on column public.merchant_identity_candidates.receipt_id is
  'Receipt-backed OCR resolution link. The UUID is issued by PriceTrace and can only be resolved by its authenticated owner.';

comment on table public.merchant_identity_candidates is
  'User-confirmed sanitized merchant facts. Receipt-ingestion ambiguity is returned to OCR-App as needs_ocr_resolution; pending remains reserved for legacy merchant-only administrator review.';

create or replace function public.private_resolve_verified_receipt_merchant_v2(
  p_user_id uuid,
  p_source_fingerprint text,
  p_idempotency_key text,
  p_merchant jsonb,
  p_resolution_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_name text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'name', p_merchant ->> 'merchant_name', '')), '');
  v_branch text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'branch_name', '')), '');
  v_kind text := coalesce(p_merchant ->> 'business_kind', '');
  v_namespace text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'catalog_namespace', p_merchant ->> 'source_namespace', '')), '');
  v_code text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'merchant_id', p_merchant ->> 'source_location_code', '')), '');
  v_bnr text := nullif(pg_catalog.regexp_replace(coalesce(p_merchant ->> 'business_registration_number', ''), '[^0-9]', '', 'g'), '');
  v_address text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'address', '')), '');
  v_phone text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'phone', '')), '');
  v_identity_namespace text;
  v_identity_code text;
  v_lock_key text;
  v_match_ids uuid[] := array[]::uuid[];
  v_restaurant_id uuid;
  v_location_id uuid;
  v_candidate_id uuid := p_resolution_id;
  v_candidate public.merchant_identity_candidates%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_location public.restaurant_locations%rowtype;
  v_reason_code text;
begin
  if v_actor is null or p_user_id is distinct from v_actor then
    raise exception 'authenticated receipt owner required' using errcode = '42501';
  end if;
  if p_resolution_id is not null then
    select candidate.* into v_candidate
    from public.merchant_identity_candidates as candidate
    where candidate.id = p_resolution_id
      and candidate.user_id = v_actor
      and candidate.origin = 'receipt_ingestion'
      and candidate.review_status = 'needs_ocr_resolution'
    for update;
    if not found then
      raise exception 'OCR merchant resolution is not available to this user' using errcode = '42501';
    end if;
    if p_source_fingerprint is distinct from v_candidate.source_fingerprint then
      raise exception 'OCR merchant resolution source fingerprint does not match' using errcode = '23514';
    end if;
  end if;

  if jsonb_typeof(p_merchant) is distinct from 'object'
    or exists (
      select 1
      from jsonb_object_keys(case when jsonb_typeof(p_merchant) = 'object' then p_merchant else '{}'::jsonb end) as field_name
      where field_name not in (
        'name', 'merchant_name', 'branch_name', 'business_kind', 'retail_channel',
        'catalog_namespace', 'merchant_id', 'source_namespace', 'source_location_code',
        'business_registration_number', 'address', 'phone'
      )
    )
    or v_name is null
    or v_kind <> 'food_service'
    or (v_namespace is null) <> (v_code is null)
  then
    raise exception 'OCR merchant resolution accepts only verified source facts' using errcode = '22023';
  end if;

  if v_namespace is not null then
    v_identity_namespace := v_namespace;
    v_identity_code := v_code;
  elsif v_bnr is not null then
    v_identity_namespace := 'pricetrace-verified-business-registration-number-v1';
    v_identity_code := v_bnr;
  elsif v_branch is not null and v_address is not null and v_phone is not null then
    v_identity_namespace := 'pricetrace-verified-branch-contact-v1';
    v_identity_code := pg_catalog.encode(extensions.digest(jsonb_build_object(
      'merchantName', v_name, 'branchName', v_branch,
      'address', v_address, 'phone', v_phone
    )::text, 'sha256'), 'hex');
  end if;

  -- Lock every supplied identity signal in stable order so concurrent receipts
  -- cannot create duplicate locations from the same source evidence.
  for v_lock_key in
    select lock_keys.value
    from pg_catalog.unnest(array[
      case when v_namespace is not null then 'restaurant-source:' || v_namespace || ':' || v_code end,
      case when v_bnr is not null then 'restaurant-business-number:' || v_bnr end,
      case when v_branch is not null and v_address is not null and v_phone is not null
        then 'restaurant-contact:' || v_name || ':' || v_branch || ':' || v_address || ':' || v_phone end
    ]) as lock_keys(value)
    where lock_keys.value is not null
    order by lock_keys.value
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_key, 0));
  end loop;

  select coalesce(pg_catalog.array_agg(distinct location.id), array[]::uuid[])
    into v_match_ids
  from public.restaurant_locations as location
  inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
  where (
      v_identity_namespace is not null
      and location.source_namespace = v_identity_namespace
      and location.source_location_code = v_identity_code
    )
    or (
      v_bnr is not null
      and pg_catalog.regexp_replace(coalesce(location.business_registration_number, ''), '[^0-9]', '', 'g') = v_bnr
    )
    or (
      v_branch is not null and v_address is not null and v_phone is not null
      and restaurant.canonical_name = v_name
      and location.location_label = v_branch
      and location.address = v_address
      and location.phone = v_phone
    );

  if cardinality(v_match_ids) > 1 then
    v_reason_code := 'source_identity_ambiguous';
  elsif cardinality(v_match_ids) = 1 then
    v_location_id := v_match_ids[1];
    select location.*
      into v_location
    from public.restaurant_locations as location
    where location.id = v_location_id;

    select restaurant.*
      into v_restaurant
    from public.restaurants as restaurant
    where restaurant.id = v_location.restaurant_id;

    v_restaurant_id := v_restaurant.id;
    if v_restaurant.status <> 'active'
      or v_restaurant.review_status <> 'verified'
      or v_restaurant.verification_status <> 'verified'
      or v_location.review_status <> 'verified'
      or v_location.verification_status <> 'verified'
      or (v_branch is not null and v_location.location_label is not null and v_location.location_label <> v_branch)
      or (v_address is not null and v_location.address is not null and v_location.address <> v_address)
      or (v_phone is not null and v_location.phone is not null and v_location.phone <> v_phone)
    then
      v_reason_code := 'source_identity_conflict';
      v_restaurant_id := null;
      v_location_id := null;
    end if;
  elsif v_identity_namespace is not null and v_identity_code is not null then
    insert into public.restaurants(
      canonical_name, review_status, status, verification_status,
      created_by, reviewed_by, reviewed_at
    ) values (
      v_name, 'verified', 'active', 'verified', v_actor, v_actor, pg_catalog.now()
    ) returning id into v_restaurant_id;

    insert into public.restaurant_locations(
      restaurant_id, source_namespace, source_location_code, location_label,
      business_registration_number, address, phone,
      review_status, verification_status, created_by, reviewed_by, reviewed_at
    ) values (
      v_restaurant_id, v_identity_namespace, v_identity_code, v_branch,
      v_bnr, v_address, v_phone,
      'verified', 'verified', v_actor, v_actor, pg_catalog.now()
    ) returning id into v_location_id;
  else
    v_reason_code := 'source_identity_insufficient';
  end if;

  if v_restaurant_id is not null and v_location_id is not null then
    if p_resolution_id is not null then
      update public.merchant_identity_candidates
      set merchant_name = v_name,
          branch_name = v_branch,
          business_registration_number = v_bnr,
          address = v_address,
          phone = v_phone,
          business_kind = v_kind,
          source_namespace = v_identity_namespace,
          source_code = v_identity_code,
          review_status = 'accepted',
          matched_restaurant_id = v_restaurant_id,
          matched_restaurant_location_id = v_location_id,
          updated_at = pg_catalog.now()
      where id = p_resolution_id and user_id = v_actor and receipt_id is not null;
    end if;
    return jsonb_build_object(
      'status', 'exact', 'restaurantId', v_restaurant_id,
      'restaurantLocationId', v_location_id, 'resolutionId', v_candidate_id
    );
  end if;

  if p_resolution_id is null then
    insert into public.merchant_identity_candidates(
      user_id, origin, source_fingerprint, merchant_name, branch_name,
      business_registration_number, address, phone, business_kind,
      source_namespace, source_code, idempotency_key, user_verified,
      review_status
    ) values (
      v_actor, 'receipt_ingestion', p_source_fingerprint, v_name, v_branch,
      v_bnr, v_address, v_phone, v_kind,
      v_namespace, v_code, p_idempotency_key, true, 'needs_ocr_resolution'
    )
    on conflict (user_id, origin, source_fingerprint) do update
      set review_status = case
            when public.merchant_identity_candidates.review_status = 'pending' then 'needs_ocr_resolution'
            else public.merchant_identity_candidates.review_status
          end,
          updated_at = pg_catalog.now()
    returning id into v_candidate_id;
    if v_candidate_id is null then
      select candidate.id into v_candidate_id
      from public.merchant_identity_candidates as candidate
      where candidate.user_id = v_actor
        and candidate.origin = 'receipt_ingestion'
        and candidate.source_fingerprint = p_source_fingerprint;
    end if;
  else
    update public.merchant_identity_candidates
    set merchant_name = v_name,
        branch_name = v_branch,
        business_registration_number = v_bnr,
        address = v_address,
        phone = v_phone,
        business_kind = v_kind,
        source_namespace = v_namespace,
        source_code = v_code,
        review_status = 'needs_ocr_resolution',
        matched_restaurant_id = null,
        matched_restaurant_location_id = null,
        updated_at = pg_catalog.now()
    where id = p_resolution_id and user_id = v_actor and receipt_id is not null;
  end if;

  return jsonb_build_object(
    'status', 'needs_ocr_resolution', 'restaurantId', null,
    'restaurantLocationId', null, 'resolutionId', v_candidate_id,
    'reasonCode', coalesce(v_reason_code, 'source_identity_insufficient'),
    'requiredSourceFacts', jsonb_build_array(
      'source_namespace_and_source_location_code',
      'business_registration_number',
      'exact_branch_name_address_and_phone'
    )
  );
end;
$function$;

revoke all on function public.private_resolve_verified_receipt_merchant_v2(uuid, text, text, jsonb, uuid)
  from public, anon, authenticated;

-- Replace only the merchant-resolution section of the deployed receipt writer.
-- Its validation, idempotency, receipt storage, monetary reconciliation, and
-- existing restaurant/menu observation flow remain the implementation source.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_anchor_span integer[];
  v_receipt_anchor integer[];
  v_source_anchor integer[];
  v_branch_prefix text;
  v_receipt_gap text;
  v_receipt_indent text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_verified_receipt_v2_legacy(text, jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'submit_verified_receipt_v2_legacy is not deployed';
  end if;
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10));

  v_old := '  v_phone text;' || pg_catalog.chr(10)
    || '  v_purchased_at date;';
  v_new := '  v_phone text;' || pg_catalog.chr(10)
    || '  v_merchant_identity jsonb;' || pg_catalog.chr(10)
    || '  v_purchased_at date;';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt merchant identity declaration');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_anchor_span := pg_temp.ocr_v5_anchor_span(
    v_definition,
    'if v_business_kind = ''food_service'' then',
    'receipt merchant identity branch start'
  );
  v_receipt_anchor := pg_temp.ocr_v5_anchor_span(
    v_definition,
    'insert into public.receipts',
    'receipt row insert after merchant identity branch'
  );
  v_branch_prefix := pg_catalog.substr(v_definition, 1, v_receipt_anchor[1] - 1);
  if pg_catalog.regexp_count(v_branch_prefix, 'end[[:space:]]+if[[:space:]]*;[[:space:]]*$') <> 1
    or pg_catalog.regexp_instr(v_branch_prefix, 'end[[:space:]]+if[[:space:]]*;[[:space:]]*$') < v_anchor_span[1]
  then
    raise exception 'receipt merchant identity branch end anchor is missing or ambiguous';
  end if;
  v_receipt_indent := coalesce(
    (pg_catalog.regexp_match(v_branch_prefix, '[[:blank:]]*$'))[1],
    '  '
  );
  v_new := 'if v_business_kind = ''food_service'' then' || pg_catalog.chr(10)
    || '    v_merchant_identity := public.private_resolve_verified_receipt_merchant_v2(' || pg_catalog.chr(10)
    || '      v_user_id, v_fingerprint, v_key, v_merchant, null' || pg_catalog.chr(10)
    || '    );' || pg_catalog.chr(10)
    || '    v_restaurant_id := nullif(v_merchant_identity ->> ''restaurantId'', '''')::uuid;' || pg_catalog.chr(10)
    || '    v_restaurant_location_id := nullif(v_merchant_identity ->> ''restaurantLocationId'', '''')::uuid;' || pg_catalog.chr(10)
    || '    v_candidate_id := nullif(v_merchant_identity ->> ''resolutionId'', '''')::uuid;' || pg_catalog.chr(10)
    || '  end if;';
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new) || pg_catalog.chr(10) || pg_catalog.chr(10) || v_receipt_indent
    || pg_catalog.substr(v_definition, v_receipt_anchor[1]);

  v_anchor_span := pg_temp.ocr_v5_anchor_span(
    v_definition,
    'returning id into v_receipt_id;',
    'receipt id return token'
  );
  v_source_anchor := pg_temp.ocr_v5_anchor_span(
    v_definition,
    'insert into public.verified_receipt_sources',
    'verified receipt source insert token'
  );
  if v_source_anchor[1] <= v_anchor_span[2]
    or pg_catalog.substr(v_definition, v_anchor_span[2], v_source_anchor[1] - v_anchor_span[2]) !~ '^[[:space:]]*$'
    or pg_catalog.substr(v_definition, v_source_anchor[2]) !~ '^[[:space:]]*[(]'
  then
    raise exception 'receipt candidate receipt-link semantic anchors are not adjacent';
  end if;
  v_receipt_gap := pg_catalog.substr(v_definition, v_anchor_span[2], v_source_anchor[1] - v_anchor_span[2]);
  v_receipt_indent := coalesce(
    (pg_catalog.regexp_match(v_receipt_gap, '[[:blank:]]*$'))[1],
    '  '
  );
  v_new := 'if v_candidate_id is not null then' || pg_catalog.chr(10)
    || '    update public.merchant_identity_candidates' || pg_catalog.chr(10)
    || '    set receipt_id = v_receipt_id,' || pg_catalog.chr(10)
    || '        review_status = ''needs_ocr_resolution'',' || pg_catalog.chr(10)
    || '        updated_at = pg_catalog.now()' || pg_catalog.chr(10)
    || '    where id = v_candidate_id and user_id = v_user_id and origin = ''receipt_ingestion'';' || pg_catalog.chr(10)
    || '  end if;';
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[2] - 1)
    || pg_catalog.chr(10) || v_receipt_indent || v_new || v_receipt_gap
    || pg_catalog.substr(v_definition, v_source_anchor[1]);

  v_old := '    ''merchantResolutionStatus'', case when v_restaurant_id is not null then ''exact'' when v_candidate_id is not null then ''needs_user_selection'' else ''not_applicable'' end,' || pg_catalog.chr(10)
    || '    ''merchantCandidateId'', v_candidate_id, ''observationIds'', v_observation_ids, ''lines'', v_line_results';
  v_new := '    ''merchantResolutionStatus'', coalesce(v_merchant_identity ->> ''status'', ''not_applicable''),' || pg_catalog.chr(10)
    || '    ''merchantCandidateId'', v_candidate_id,' || pg_catalog.chr(10)
    || '    ''ocrResolution'', case when v_merchant_identity ->> ''status'' = ''needs_ocr_resolution'' then jsonb_build_object(' || pg_catalog.chr(10)
    || '      ''schemaVersion'', ''ocr-resolution.v1'', ''status'', ''needs_ocr_resolution'',' || pg_catalog.chr(10)
    || '      ''resolutionId'', v_candidate_id,' || pg_catalog.chr(10)
    || '      ''reasonCode'', v_merchant_identity ->> ''reasonCode'',' || pg_catalog.chr(10)
    || '      ''requiredSourceFacts'', v_merchant_identity -> ''requiredSourceFacts''' || pg_catalog.chr(10)
    || '    ) else null end,' || pg_catalog.chr(10)
    || '    ''observationIds'', v_observation_ids, ''lines'', v_line_results';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt response authority');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  execute v_definition;
end;
$migration$;

-- Old pending receipt candidates move to the OCR-owned resolution state. The
-- legacy merchant-only admin workflow continues to use review_status=pending.
update public.merchant_identity_candidates as candidate
set review_status = 'needs_ocr_resolution',
    receipt_id = content.receipt_id,
    updated_at = pg_catalog.now()
from public.verified_receipt_ingestion_contents as content
where candidate.user_id = content.user_id
  and candidate.source_fingerprint = content.request_fingerprint
  and candidate.origin = 'receipt_ingestion'
  and candidate.review_status = 'pending'
  and content.response ->> 'merchantCandidateId' = candidate.id::text;

update public.verified_receipt_ingestion_contents as content
set response = content.response || jsonb_build_object(
  'merchantResolutionStatus', 'needs_ocr_resolution',
  'ocrResolution', jsonb_build_object(
    'schemaVersion', 'ocr-resolution.v1',
    'status', 'needs_ocr_resolution',
    'resolutionId', content.response ->> 'merchantCandidateId',
    'reasonCode', 'legacy_source_identity_unresolved',
    'requiredSourceFacts', jsonb_build_array(
      'source_namespace_and_source_location_code',
      'business_registration_number',
      'exact_branch_name_address_and_phone'
    )
  )
)
where content.response ->> 'merchantResolutionStatus' = 'needs_user_selection';

update public.verified_receipt_ingestion_requests as request
set response = content.response
from public.verified_receipt_ingestion_contents as content
where content.user_id = request.user_id
  and content.request_fingerprint = request.request_fingerprint
  and request.response ->> 'merchantResolutionStatus' = 'needs_user_selection';

-- The private response enricher also resolves exact menu IDs after an OCR
-- owner supplies the missing restaurant source facts. Name matching remains
-- exact and is accepted only when one verified menu exists in that restaurant.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_anchor_span integer[];
begin
  select pg_catalog.pg_get_functiondef(
    'public.private_enrich_verified_receipt_ingestion_v2(jsonb, jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'private_enrich_verified_receipt_ingestion_v2 is not deployed';
  end if;
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10));

  v_old := '  v_business_kind text;' ;
  v_new := v_old || pg_catalog.chr(10)
    || '  v_restaurant_id uuid := nullif(p_base_response ->> ''restaurantId'', '''')::uuid;' || pg_catalog.chr(10)
    || '  v_restaurant_location_id uuid := nullif(p_base_response ->> ''restaurantLocationId'', '''')::uuid;';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment restaurant identity declaration');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '  v_sku text;';
  v_new := v_old || pg_catalog.chr(10)
    || '  v_match_count integer := 0;';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment menu match declaration');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '    v_restaurant_menu_id := coalesce(' || pg_catalog.chr(10)
    || '      v_restaurant_menu_id,' || pg_catalog.chr(10)
    || '      nullif(v_base_line ->> ''restaurantMenuId'', '''')::uuid' || pg_catalog.chr(10)
    || '    );';
  v_new := v_old || pg_catalog.chr(10)
    || '    if v_line_type = ''product'' and v_business_kind = ''food_service''' || pg_catalog.chr(10)
    || '      and v_restaurant_id is not null and v_restaurant_location_id is not null' || pg_catalog.chr(10)
    || '      and v_restaurant_menu_id is null then' || pg_catalog.chr(10)
    || '      if v_sku is not null and nullif(pg_catalog.btrim(coalesce(p_receipt -> ''merchant'' ->> ''catalog_namespace'', '''')), '''') is not null then' || pg_catalog.chr(10)
    || '        select mapping.restaurant_menu_id, menu.catalog_product_id' || pg_catalog.chr(10)
    || '          into v_restaurant_menu_id, v_catalog_product_id' || pg_catalog.chr(10)
    || '        from public.restaurant_menu_source_mappings as mapping' || pg_catalog.chr(10)
    || '        inner join public.restaurant_menus as menu on menu.restaurant_id = mapping.restaurant_id and menu.id = mapping.restaurant_menu_id' || pg_catalog.chr(10)
    || '        inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id' || pg_catalog.chr(10)
    || '        where mapping.restaurant_id = v_restaurant_id' || pg_catalog.chr(10)
    || '          and mapping.restaurant_location_id = v_restaurant_location_id' || pg_catalog.chr(10)
    || '          and mapping.source_product_code_namespace = nullif(pg_catalog.btrim(p_receipt -> ''merchant'' ->> ''catalog_namespace''), '''')' || pg_catalog.chr(10)
    || '          and mapping.source_product_code = v_sku' || pg_catalog.chr(10)
    || '          and mapping.review_status = ''verified'' and mapping.verification_status = ''verified''' || pg_catalog.chr(10)
    || '          and menu.status = ''active'' and menu.review_status = ''verified'' and menu.verification_status = ''verified''' || pg_catalog.chr(10)
    || '          and catalog.status = ''active'' and catalog.verification_status = ''verified'' and catalog.purchase_type = ''menu_item'';' || pg_catalog.chr(10)
    || '      end if;' || pg_catalog.chr(10)
    || '      if v_restaurant_menu_id is null then' || pg_catalog.chr(10)
    || '        select count(*) into v_match_count' || pg_catalog.chr(10)
    || '        from public.restaurant_menus as menu' || pg_catalog.chr(10)
    || '        inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id' || pg_catalog.chr(10)
    || '        where menu.restaurant_id = v_restaurant_id and menu.canonical_name = v_description' || pg_catalog.chr(10)
    || '          and menu.status = ''active'' and menu.review_status = ''verified'' and menu.verification_status = ''verified''' || pg_catalog.chr(10)
    || '          and catalog.status = ''active'' and catalog.verification_status = ''verified'' and catalog.purchase_type = ''menu_item'';' || pg_catalog.chr(10)
    || '        if v_match_count = 1 then' || pg_catalog.chr(10)
    || '          select menu.id, menu.catalog_product_id into v_restaurant_menu_id, v_catalog_product_id' || pg_catalog.chr(10)
    || '          from public.restaurant_menus as menu' || pg_catalog.chr(10)
    || '          inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id' || pg_catalog.chr(10)
    || '          where menu.restaurant_id = v_restaurant_id and menu.canonical_name = v_description' || pg_catalog.chr(10)
    || '            and menu.status = ''active'' and menu.review_status = ''verified'' and menu.verification_status = ''verified''' || pg_catalog.chr(10)
    || '            and catalog.status = ''active'' and catalog.verification_status = ''verified'' and catalog.purchase_type = ''menu_item'';' || pg_catalog.chr(10)
    || '        end if;' || pg_catalog.chr(10)
    || '      end if;' || pg_catalog.chr(10)
    || '    end if;';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment exact menu resolution');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '        else ''unresolved_catalog''' || pg_catalog.chr(10)
    || '      end';
  v_new := '        else case' || pg_catalog.chr(10)
    || '          when v_business_kind = ''food_service'' and v_restaurant_id is null then ''needs_ocr_resolution''' || pg_catalog.chr(10)
    || '          else ''unresolved_catalog''' || pg_catalog.chr(10)
    || '        end' || pg_catalog.chr(10)
    || '      end';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment OCR resolution status');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  execute v_definition;
end;
$migration$;

create or replace function public.resolve_ocr_merchant_identity_v1(
  p_resolution_id uuid,
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
  v_candidate public.merchant_identity_candidates%rowtype;
  v_identity jsonb;
  v_response jsonb;
  v_mini_receipt jsonb;
  v_line record;
  v_receipt_item_id text;
  v_price_observation_id uuid;
  v_source_menu_mapping_id uuid;
  v_restaurant_id uuid;
  v_restaurant_location_id uuid;
  v_observed_on date;
  v_unit_price integer;
  v_quantity integer;
  v_total_price integer;
  v_evidence_fingerprint text;
  v_response_lines jsonb;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if not coalesce(p_user_verified, false) then
    raise exception 'OCR source facts require explicit user verification' using errcode = '22023';
  end if;

  select candidate.* into v_candidate
  from public.merchant_identity_candidates as candidate
  where candidate.id = p_resolution_id
    and candidate.user_id = v_user_id
    and candidate.origin = 'receipt_ingestion'
    and candidate.review_status = 'needs_ocr_resolution'
  for update;
  if not found or v_candidate.receipt_id is null then
    raise exception 'OCR merchant resolution is not available to this user' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.receipts as receipt
    where receipt.user_id = v_user_id and receipt.id = v_candidate.receipt_id
  ) then
    raise exception 'receipt is not owned by the authenticated user' using errcode = '42501';
  end if;

  v_identity := public.private_resolve_verified_receipt_merchant_v2(
    v_user_id,
    v_candidate.source_fingerprint,
    coalesce(v_candidate.idempotency_key, 'ocr-resolution:' || v_candidate.id::text),
    p_merchant,
    v_candidate.id
  );

  select content.response into v_response
  from public.verified_receipt_ingestion_contents as content
  where content.user_id = v_user_id and content.receipt_id = v_candidate.receipt_id;
  if v_response is null then
    raise exception 'verified receipt response was not found' using errcode = 'P0002';
  end if;

  v_response := v_response || jsonb_build_object(
    'restaurantId', nullif(v_identity ->> 'restaurantId', '')::uuid,
    'restaurantLocationId', nullif(v_identity ->> 'restaurantLocationId', '')::uuid,
    'merchantResolutionStatus', v_identity ->> 'status',
    'ocrResolution', jsonb_build_object(
      'schemaVersion', 'ocr-resolution.v1',
      'status', case when v_identity ->> 'status' = 'exact' then 'resolved' else 'needs_ocr_resolution' end,
      'resolutionId', v_candidate.id,
      'reasonCode', v_identity ->> 'reasonCode',
      'requiredSourceFacts', coalesce(v_identity -> 'requiredSourceFacts', '[]'::jsonb)
    )
  );

  if v_identity ->> 'status' = 'exact' then
    select jsonb_build_object(
      'merchant', jsonb_build_object(
        'catalog_namespace', coalesce(p_merchant ->> 'catalog_namespace', p_merchant ->> 'source_namespace'),
        'merchant_id', coalesce(p_merchant ->> 'merchant_id', p_merchant ->> 'source_location_code')
      ),
      'line_items', coalesce(jsonb_agg(jsonb_build_object(
        'id', source_line.source_line_id,
        'type', source_line.line_type,
        'description', source_line.description,
        'identifiers', case when source_line.merchant_sku is null then '[]'::jsonb else
          jsonb_build_array(jsonb_build_object('scheme', 'merchant_sku', 'value', source_line.merchant_sku)) end
      ) order by source_line.line_ordinal), '[]'::jsonb)
    ) into v_mini_receipt
    from public.verified_receipt_source_lines as source_line
    where source_line.user_id = v_user_id and source_line.receipt_id = v_candidate.receipt_id;
    v_response := public.private_enrich_verified_receipt_ingestion_v2(v_response, v_mini_receipt);

    v_restaurant_id := nullif(v_response ->> 'restaurantId', '')::uuid;
    v_restaurant_location_id := nullif(v_response ->> 'restaurantLocationId', '')::uuid;
    select source.issued_on into v_observed_on
    from public.verified_receipt_sources as source
    where source.user_id = v_user_id and source.receipt_id = v_candidate.receipt_id;
    if v_observed_on is null then
      select ((source.issued_at at time zone 'Asia/Seoul')::date) into v_observed_on
      from public.verified_receipt_sources as source
      where source.user_id = v_user_id and source.receipt_id = v_candidate.receipt_id;
    end if;

    for v_line in
      select source_line.source_line_id, source_line.catalog_product_id,
             source_line.restaurant_menu_id, source_line.merchant_sku,
             source_line.source_line_references
      from public.verified_receipt_source_lines as source_line
      where source_line.user_id = v_user_id
        and source_line.receipt_id = v_candidate.receipt_id
        and source_line.line_type = 'product'
        and source_line.benefit_kind is null
        and source_line.catalog_product_id is not null
        and source_line.restaurant_menu_id is not null
      order by source_line.line_ordinal
    loop
      select line.value ->> 'receiptItemId'
        into v_receipt_item_id
      from jsonb_array_elements(v_response -> 'lines') as line(value)
      where line.value ->> 'sourceLineId' = v_line.source_line_id;
      if v_receipt_item_id is null then
        continue;
      end if;

      select observation.id, item.unit_price_krw, item.purchased_quantity, item.total_price_krw
        into v_price_observation_id, v_unit_price, v_quantity, v_total_price
      from public.receipt_items as item
      inner join public.price_observations as observation
        on observation.user_id = item.user_id and observation.receipt_item_id = item.id
      where item.user_id = v_user_id
        and item.receipt_id = v_candidate.receipt_id
        and item.id = v_receipt_item_id;
      if not found then
        continue;
      end if;

      update public.price_observations
      set catalog_product_id = v_line.catalog_product_id
      where user_id = v_user_id and id = v_price_observation_id;

      v_source_menu_mapping_id := null;
      if v_line.merchant_sku is not null then
        select mapping.id into v_source_menu_mapping_id
        from public.restaurant_menu_source_mappings as mapping
        where mapping.restaurant_id = v_restaurant_id
          and mapping.restaurant_location_id = v_restaurant_location_id
          and mapping.restaurant_menu_id = v_line.restaurant_menu_id
          and mapping.source_product_code_namespace = coalesce(
            nullif(pg_catalog.btrim(p_merchant ->> 'catalog_namespace'), ''),
            nullif(pg_catalog.btrim(p_merchant ->> 'source_namespace'), '')
          )
          and mapping.source_product_code = v_line.merchant_sku
          and mapping.review_status = 'verified'
          and mapping.verification_status = 'verified';
      end if;

      v_evidence_fingerprint := 'sha256:' || pg_catalog.encode(extensions.digest(jsonb_build_object(
        'receiptId', v_candidate.receipt_id,
        'lineId', v_line.source_line_id,
        'restaurantLocationId', v_restaurant_location_id,
        'restaurantMenuId', v_line.restaurant_menu_id,
        'unitPriceKrw', v_unit_price,
        'quantity', v_quantity,
        'totalPriceKrw', v_total_price
      )::text, 'sha256'), 'hex');

      insert into public.restaurant_menu_receipt_observations(
        restaurant_id, restaurant_location_id, restaurant_menu_id, source_menu_mapping_id,
        owner_user_id, price_observation_id, receipt_id, receipt_item_id, observed_on,
        unit_price_krw, quantity, total_price_krw, evidence_snapshot, evidence_fingerprint,
        verification_status, verified_by
      ) values (
        v_restaurant_id, v_restaurant_location_id, v_line.restaurant_menu_id, v_source_menu_mapping_id,
        v_user_id, v_price_observation_id, v_candidate.receipt_id, v_receipt_item_id,
        coalesce(v_observed_on, current_date), v_unit_price, v_quantity, v_total_price,
        jsonb_build_object(
          'schemaVersion', 'receipt.v2',
          'receiptId', v_candidate.receipt_id,
          'sourceLineId', v_line.source_line_id,
          'sourceLineReferences', to_jsonb(v_line.source_line_references)
        ),
        v_evidence_fingerprint, 'verified', v_user_id
      ) on conflict (evidence_fingerprint) do nothing;
    end loop;

    select coalesce(jsonb_agg(
      line.value || jsonb_build_object('restaurantObservationId', observation.id)
      order by line.ordinality
    ), '[]'::jsonb) into v_response_lines
    from jsonb_array_elements(v_response -> 'lines') with ordinality as line(value, ordinality)
    left join public.restaurant_menu_receipt_observations as observation
      on observation.owner_user_id = v_user_id
      and observation.receipt_id = v_candidate.receipt_id
      and observation.receipt_item_id = line.value ->> 'receiptItemId';
    v_response := v_response || jsonb_build_object('lines', v_response_lines);
    update public.verified_receipt_ingestion_contents
    set response = v_response
    where user_id = v_user_id and receipt_id = v_candidate.receipt_id;
    update public.verified_receipt_ingestion_requests
    set response = v_response
    where user_id = v_user_id and receipt_id = v_candidate.receipt_id;
  else
    update public.verified_receipt_ingestion_contents
    set response = v_response
    where user_id = v_user_id and receipt_id = v_candidate.receipt_id;
    update public.verified_receipt_ingestion_requests
    set response = v_response
    where user_id = v_user_id and receipt_id = v_candidate.receipt_id;
  end if;

  return v_response;
end;
$function$;

comment on function public.resolve_ocr_merchant_identity_v1(uuid, jsonb, boolean) is
  'Resolves an OCR-App-owned merchant source review using only authenticated owner supplied facts. The resolution ID must be issued by PriceTrace; canonical restaurant UUIDs are never accepted from the client.';
revoke all on function public.resolve_ocr_merchant_identity_v1(uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.resolve_ocr_merchant_identity_v1(uuid, jsonb, boolean)
  to authenticated;

drop function pg_temp.ocr_v5_anchor_span(text, text, text);
