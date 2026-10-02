-- OCR V5 requires server-issued exact Restaurant/Location/Menu/Catalog
-- identity before a restaurant price observation can be published.

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

create table public.receipt_menu_identity_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id uuid not null,
  source_line_id text not null check (length(btrim(source_line_id)) > 0),
  restaurant_id uuid not null,
  restaurant_location_id uuid not null,
  menu_name text,
  serving_label text,
  category_label text,
  source_product_code_namespace text,
  source_product_code text,
  food_service_role text,
  benefit_kind text,
  reason_code text not null,
  review_status text not null default 'needs_ocr_resolution'
    check (review_status in ('needs_ocr_resolution', 'accepted')),
  matched_restaurant_menu_id uuid,
  matched_catalog_product_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, receipt_id, source_line_id),
  foreign key (user_id, receipt_id)
    references public.receipts(user_id, id) on delete cascade,
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, matched_restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict,
  foreign key (matched_catalog_product_id)
    references public.catalog_products(id) on delete restrict
);

alter table public.receipt_menu_identity_candidates enable row level security;
revoke all on public.receipt_menu_identity_candidates from public, anon, authenticated;
create index receipt_menu_identity_candidates_owner_idx
  on public.receipt_menu_identity_candidates(user_id, receipt_id, review_status);

comment on table public.receipt_menu_identity_candidates is
  'Private OCR-App resolution queue for ambiguous receipt line Menu/Catalog identity. Candidate IDs are server-issued and owner-scoped.';

create table public.standalone_ocr_identity_resolutions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  request_payload jsonb not null check (jsonb_typeof(request_payload) = 'object'),
  merchant_resolution_status text not null
    check (merchant_resolution_status in ('exact', 'needs_ocr_resolution')),
  restaurant_id uuid,
  restaurant_location_id uuid,
  menu_resolution_status text not null default 'needs_ocr_resolution'
    check (menu_resolution_status in ('exact', 'needs_ocr_resolution')),
  restaurant_menu_id uuid,
  catalog_product_id uuid,
  standard_product_id uuid,
  reason_code text not null,
  required_source_facts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_source_facts) = 'array'),
  status text not null default 'needs_ocr_resolution'
    check (status in ('needs_ocr_resolution', 'resolved')),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  resolved_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict,
  foreign key (catalog_product_id) references public.catalog_products(id) on delete restrict,
  foreign key (standard_product_id) references public.standard_products(id) on delete restrict,
  check (
    (status = 'needs_ocr_resolution' and resolved_response is null)
    or (status = 'resolved' and resolved_response is not null)
  )
);

alter table public.standalone_ocr_identity_resolutions enable row level security;
revoke all on public.standalone_ocr_identity_resolutions from public, anon, authenticated;
create index standalone_ocr_identity_resolutions_owner_idx
  on public.standalone_ocr_identity_resolutions(user_id, status, created_at desc);

comment on table public.standalone_ocr_identity_resolutions is
  'Private owner-scoped OCR-App follow-up for receipt-free restaurant identity. It stores no client-created PriceTrace UUIDs.';

-- Pending receipt-free restaurant observations have no publishable observation
-- row until all four Restaurant/Location/Menu/Catalog identities are exact.
alter table public.standalone_price_observation_ingestion_requests
  alter column observation_id drop not null;

do $migration$
declare
  v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.standalone_price_observation_ingestion_requests'::regclass
      and constraint_row.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%restaurant_purchase%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%observation_id%'
  loop
    execute pg_catalog.format(
      'alter table public.standalone_price_observation_ingestion_requests drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$migration$;

create or replace function public.resolve_ocr_standalone_restaurant_menu_v1(
  p_resolution_id uuid,
  p_merchant jsonb,
  p_item jsonb,
  p_user_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_candidate public.standalone_ocr_identity_resolutions%rowtype;
  v_request public.standalone_price_observation_ingestion_requests%rowtype;
  v_payload jsonb;
  v_identity jsonb;
  v_response jsonb;
  v_ids jsonb;
  v_observed_at_text text;
  v_observed_on date;
  v_observed_at_exact timestamptz;
  v_quantity integer;
  v_unit_price integer;
  v_gross_price integer;
  v_discount_price integer;
  v_net_price integer;
  v_manual_observation_id uuid;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if not coalesce(p_user_verified, false) then
    raise exception 'OCR source facts require explicit user verification' using errcode = '22023';
  end if;
  select candidate.* into v_candidate
  from public.standalone_ocr_identity_resolutions as candidate
  where candidate.id = p_resolution_id and candidate.user_id = v_user_id
  for update;
  if not found then
    raise exception 'OCR standalone resolution is not available to this user' using errcode = '42501';
  end if;
  if v_candidate.status = 'resolved' then
    return v_candidate.resolved_response || jsonb_build_object('replayed', true);
  end if;
  if jsonb_typeof(p_merchant) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(case when jsonb_typeof(p_merchant) = 'object' then p_merchant else '{}'::jsonb end) as field_name
      where field_name not in (
        'merchant_name', 'branch_name', 'source_namespace', 'source_code',
        'source_location_code', 'business_registration_number', 'address', 'phone'
      )
    )
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(case when jsonb_typeof(p_merchant) = 'object' then p_merchant else '{}'::jsonb end) as field_name
      where pg_catalog.jsonb_typeof(p_merchant -> field_name) not in ('string', 'null')
    )
    or jsonb_typeof(p_item) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(case when jsonb_typeof(p_item) = 'object' then p_item else '{}'::jsonb end) as field_name
      where field_name not in (
        'item_name', 'serving_label', 'category_label',
        'source_menu_code_namespace', 'source_menu_code'
      )
    )
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(case when jsonb_typeof(p_item) = 'object' then p_item else '{}'::jsonb end) as field_name
      where pg_catalog.jsonb_typeof(p_item -> field_name) not in ('string', 'null')
    )
    or nullif(pg_catalog.btrim(coalesce(p_item ->> 'item_name', '')), '') is null
  then
    raise exception 'OCR standalone resolution accepts only verified merchant and menu source facts' using errcode = '22023';
  end if;

  select request.* into v_request
  from public.standalone_price_observation_ingestion_requests as request
  where request.user_id = v_user_id
    and request.idempotency_key = v_candidate.idempotency_key
    and request.request_fingerprint = v_candidate.request_fingerprint
    and request.kind = 'restaurant_purchase';
  if not found then
    raise exception 'OCR standalone source request was not found' using errcode = 'P0002';
  end if;
  v_payload := v_candidate.request_payload;
  v_identity := public.private_resolve_ocr_standalone_identity_v1(
    v_user_id,
    v_candidate.idempotency_key,
    v_payload,
    v_candidate.id,
    p_merchant,
    p_item
  );
  if v_identity ->> 'authorityStatus' <> 'exact' then
    return v_identity || jsonb_build_object('kind', 'restaurant_purchase', 'observationId', null, 'replayed', false);
  end if;

  v_ids := v_identity -> 'authoritativeIds';
  if (v_ids ->> 'restaurantId') is null
    or (v_ids ->> 'restaurantLocationId') is null
    or (v_ids ->> 'restaurantMenuId') is null
    or (v_ids ->> 'catalogProductId') is null
  then
    raise exception 'exact restaurant authority requires Restaurant, Location, Menu, and Catalog IDs' using errcode = '23514';
  end if;

  if v_payload ? 'observed_on' then
    v_observed_on := (v_payload ->> 'observed_on')::date;
  end if;
  if v_payload ? 'observed_at' then
    v_observed_at_text := pg_catalog.btrim(v_payload ->> 'observed_at');
    v_observed_at_exact := v_observed_at_text::timestamptz;
    if v_observed_on is null then
      v_observed_on := substring(v_observed_at_text from 1 for 10)::date;
    end if;
  end if;
  v_quantity := case when v_payload -> 'quantity' is null or pg_catalog.jsonb_typeof(v_payload -> 'quantity') = 'null' then null else (v_payload ->> 'quantity')::integer end;
  v_unit_price := case when v_payload -> 'unit_price' is null or pg_catalog.jsonb_typeof(v_payload -> 'unit_price') = 'null' then null else (v_payload ->> 'unit_price')::integer end;
  v_gross_price := case when v_payload -> 'gross_price' is null or pg_catalog.jsonb_typeof(v_payload -> 'gross_price') = 'null' then null else (v_payload ->> 'gross_price')::integer end;
  v_discount_price := case when v_payload -> 'discount' is null or pg_catalog.jsonb_typeof(v_payload -> 'discount') = 'null' then null else (v_payload ->> 'discount')::integer end;
  v_net_price := case when v_payload -> 'net_price' is null or pg_catalog.jsonb_typeof(v_payload -> 'net_price') = 'null' then null else (v_payload ->> 'net_price')::integer end;

  insert into public.restaurant_menu_manual_observations (
    restaurant_id, restaurant_location_id, restaurant_menu_id, observed_on,
    unit_price_krw, quantity, total_price_krw, source_url, note, source_snapshot,
    verification_status, created_by, created_at, observation_kind,
    verification_basis, currency, gross_price_krw, discount_price_krw,
    net_price_krw, observed_at_exact
  ) values (
    (v_ids ->> 'restaurantId')::uuid,
    (v_ids ->> 'restaurantLocationId')::uuid,
    (v_ids ->> 'restaurantMenuId')::uuid,
    v_observed_on,
    v_unit_price,
    v_quantity,
    v_net_price,
    nullif(pg_catalog.btrim(coalesce(v_payload ->> 'source_url', '')), ''),
    nullif(pg_catalog.btrim(coalesce(v_payload ->> 'note', '')), ''),
    jsonb_build_object(
      'schemaVersion', 'receipt-independent-price-observation.v3',
      'merchant', coalesce(v_payload -> 'merchant', '{}'::jsonb) || coalesce(p_merchant, '{}'::jsonb),
      'item', coalesce(v_payload -> 'item', '{}'::jsonb) || coalesce(p_item, '{}'::jsonb),
      'sourceUrl', nullif(pg_catalog.btrim(coalesce(v_payload ->> 'source_url', '')), ''),
      'grossPrice', v_gross_price,
      'discount', v_discount_price,
      'netPrice', v_net_price,
      'currency', 'KRW'
    ),
    'verified', v_user_id, pg_catalog.now(), 'standalone_purchase',
    v_payload ->> 'verification_basis', 'KRW', v_gross_price,
    v_discount_price, v_net_price, v_observed_at_exact
  ) returning id into v_manual_observation_id;

  v_response := jsonb_build_object(
    'schemaVersion', 'receipt-independent-price-observation.v3',
    'kind', 'restaurant_purchase',
    'observationId', v_manual_observation_id,
    'replayed', false,
    'authorityStatus', 'exact',
    'merchantResolutionStatus', 'exact',
    'menuResolutionStatus', 'exact',
    'ocrResolution', null,
    'authoritativeIds', v_ids
  );
  update public.standalone_ocr_identity_resolutions
  set merchant_resolution_status = 'exact',
      restaurant_id = (v_ids ->> 'restaurantId')::uuid,
      restaurant_location_id = (v_ids ->> 'restaurantLocationId')::uuid,
      menu_resolution_status = 'exact',
      restaurant_menu_id = (v_ids ->> 'restaurantMenuId')::uuid,
      catalog_product_id = (v_ids ->> 'catalogProductId')::uuid,
      standard_product_id = nullif(v_ids ->> 'standardProductId', '')::uuid,
      status = 'resolved',
      response = v_response,
      resolved_response = v_response,
      updated_at = pg_catalog.now()
  where id = v_candidate.id and user_id = v_user_id and status = 'needs_ocr_resolution';
  return v_response;
end;
$function$;

comment on function public.resolve_ocr_standalone_restaurant_menu_v1(uuid, jsonb, jsonb, boolean) is
  'Owner-authenticated OCR-App follow-up for receipt-free Restaurant/Location/Menu identity. The server issues all PriceTrace IDs after validating reviewed source facts.';
revoke all on function public.resolve_ocr_standalone_restaurant_menu_v1(uuid, jsonb, jsonb, boolean)
  from public, anon;
grant execute on function public.resolve_ocr_standalone_restaurant_menu_v1(uuid, jsonb, jsonb, boolean)
  to authenticated;

-- Keep the deployed standalone validation and idempotency body; replace only
-- the restaurant-name identity block and status-less replay behavior.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_start integer;
  v_end integer;
  v_anchor_span integer[];
  v_quantity_anchor integer[];
  v_indent text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.ingest_verified_standalone_price_observation_v1(text, jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'ingest_verified_standalone_price_observation_v1 is not deployed';
  end if;
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10));

  v_old := '  v_response jsonb;';
  v_new := v_old || pg_catalog.chr(10)
    || '  v_ocr_identity jsonb;' || pg_catalog.chr(10)
    || '  v_resolved_response jsonb;' || pg_catalog.chr(10)
    || '  v_resolution_id uuid;';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'standalone identity declaration');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '    return v_existing.response || jsonb_build_object(''replayed'', true);';
  v_new := '    if v_existing.kind = ''restaurant_purchase'' then' || pg_catalog.chr(10)
    || '      select candidate.resolved_response into v_resolved_response' || pg_catalog.chr(10)
    || '      from public.standalone_ocr_identity_resolutions as candidate' || pg_catalog.chr(10)
    || '      where candidate.user_id = v_user_id and candidate.idempotency_key = v_key and candidate.status = ''resolved'';' || pg_catalog.chr(10)
    || '      if v_resolved_response is not null then' || pg_catalog.chr(10)
    || '        return v_resolved_response || jsonb_build_object(''replayed'', true);' || pg_catalog.chr(10)
    || '      end if;' || pg_catalog.chr(10)
    || '      if v_existing.response ->> ''authorityStatus'' is null' || pg_catalog.chr(10)
    || '        or coalesce(v_existing.response ->> ''merchantResolutionStatus'', '''') not in (''exact'', ''needs_ocr_resolution'')' || pg_catalog.chr(10)
    || '        or coalesce(v_existing.response ->> ''menuResolutionStatus'', '''') not in (''exact'', ''needs_ocr_resolution'') then' || pg_catalog.chr(10)
    || '        v_response := jsonb_build_object(' || pg_catalog.chr(10)
    || '          ''schemaVersion'', ''receipt-independent-price-observation.v3'', ''kind'', ''restaurant_purchase'',' || pg_catalog.chr(10)
    || '          ''observationId'', null, ''replayed'', true, ''authorityStatus'', ''needs_ocr_resolution'',' || pg_catalog.chr(10)
    || '          ''merchantResolutionStatus'', ''needs_ocr_resolution'', ''menuResolutionStatus'', ''needs_ocr_resolution'',' || pg_catalog.chr(10)
    || '          ''authoritativeIds'', jsonb_build_object(''restaurantId'', null, ''restaurantLocationId'', null, ''restaurantMenuId'', null, ''catalogProductId'', null, ''standardProductId'', null),' || pg_catalog.chr(10)
    || '          ''ocrResolution'', jsonb_build_object(''schemaVersion'', ''ocr-resolution.v1'', ''status'', ''needs_ocr_resolution'', ''resolutionId'', null,' || pg_catalog.chr(10)
    || '            ''reasonCode'', ''legacy_authority_status_missing'', ''requiredSourceFacts'', jsonb_build_array(''reverify_restaurant_location_and_menu_identity''))' || pg_catalog.chr(10)
    || '        );' || pg_catalog.chr(10)
    || '        insert into public.standalone_ocr_identity_resolutions(' || pg_catalog.chr(10)
    || '          user_id, idempotency_key, request_fingerprint, request_payload, merchant_resolution_status,' || pg_catalog.chr(10)
    || '          menu_resolution_status, reason_code, required_source_facts, response' || pg_catalog.chr(10)
    || '        ) values (v_user_id, v_key, v_fingerprint, v_existing.request_payload, ''needs_ocr_resolution'', ''needs_ocr_resolution'',' || pg_catalog.chr(10)
    || '          ''legacy_authority_status_missing'', jsonb_build_array(''reverify_restaurant_location_and_menu_identity''), v_response)' || pg_catalog.chr(10)
    || '        on conflict (user_id, idempotency_key) do nothing returning id into v_resolution_id;' || pg_catalog.chr(10)
    || '        if v_resolution_id is null then' || pg_catalog.chr(10)
    || '          select candidate.id into v_resolution_id from public.standalone_ocr_identity_resolutions as candidate where candidate.user_id = v_user_id and candidate.idempotency_key = v_key;' || pg_catalog.chr(10)
    || '        end if;' || pg_catalog.chr(10)
    || '        v_response := pg_catalog.jsonb_set(v_response, ''{ocrResolution,resolutionId}'', to_jsonb(v_resolution_id));' || pg_catalog.chr(10)
    || '        update public.standalone_ocr_identity_resolutions set response = v_response, updated_at = pg_catalog.now() where id = v_resolution_id and user_id = v_user_id;' || pg_catalog.chr(10)
    || '        return v_response;' || pg_catalog.chr(10)
    || '      end if;' || pg_catalog.chr(10)
    || '    end if;' || pg_catalog.chr(10)
    || v_old;
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'standalone legacy replay');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := 'where field_name not in (''item_name'', ''serving_label'', ''category_label'')';
  v_new := 'where field_name not in (''item_name'', ''serving_label'', ''category_label'', ''source_menu_code_namespace'', ''source_menu_code'')';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'standalone menu source fact allowlist');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '  v_source_namespace := coalesce(v_source_namespace, ''standalone-v3'');';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'standalone restaurant identity branch start');
  v_quantity_anchor := pg_temp.ocr_v5_anchor_span(
    pg_catalog.substr(v_definition, v_anchor_span[2]),
    'v_quantity_int := case when v_quantity is null then null else v_quantity::integer end;',
    'standalone quantity assignment after restaurant identity branch'
  );
  v_start := v_anchor_span[1];
  v_end := v_anchor_span[2] + v_quantity_anchor[1] - 1;
  v_indent := coalesce(
    (pg_catalog.regexp_match(pg_catalog.substr(v_definition, 1, v_end - 1), '[[:blank:]]*$'))[1],
    '  '
  );
  if v_end <= v_anchor_span[2] then
    raise exception 'standalone OCR restaurant identity block patch anchors not found';
  end if;
  v_new := '  v_ocr_identity := public.private_resolve_ocr_standalone_identity_v1(v_user_id, v_key, p_observation);' || pg_catalog.chr(10)
    || '  if v_ocr_identity ->> ''authorityStatus'' = ''needs_ocr_resolution'' then' || pg_catalog.chr(10)
    || '    v_response := v_ocr_identity || jsonb_build_object(''kind'', v_kind, ''observationId'', null, ''replayed'', false);' || pg_catalog.chr(10)
    || '    insert into public.standalone_price_observation_ingestion_requests(' || pg_catalog.chr(10)
    || '      user_id, idempotency_key, request_fingerprint, request_payload, kind, observation_id, restaurant_menu_manual_observation_id, response, created_at' || pg_catalog.chr(10)
    || '    ) values (v_user_id, v_key, v_fingerprint, p_observation, v_kind, null, null, v_response, v_now);' || pg_catalog.chr(10)
    || '    return v_response;' || pg_catalog.chr(10)
    || '  end if;' || pg_catalog.chr(10)
    || '  v_restaurant_id := (v_ocr_identity #>> ''{authoritativeIds,restaurantId}'')::uuid;' || pg_catalog.chr(10)
    || '  v_restaurant_location_id := (v_ocr_identity #>> ''{authoritativeIds,restaurantLocationId}'')::uuid;' || pg_catalog.chr(10)
    || '  v_restaurant_menu_id := (v_ocr_identity #>> ''{authoritativeIds,restaurantMenuId}'')::uuid;' || pg_catalog.chr(10)
    || '  v_catalog_product_id := (v_ocr_identity #>> ''{authoritativeIds,catalogProductId}'')::uuid;' || pg_catalog.chr(10)
    || '  v_standard_product_id := (v_ocr_identity #>> ''{authoritativeIds,standardProductId}'')::uuid;' || pg_catalog.chr(10)
    || v_indent || pg_catalog.substr(v_definition, v_end);
  v_definition := pg_catalog.substr(v_definition, 1, v_start - 1) || pg_catalog.ltrim(v_new);

  v_old := '    ''observationId'', v_manual_observation_id,' || pg_catalog.chr(10)
    || '    ''replayed'', false,';
  v_new := '    ''observationId'', v_manual_observation_id,' || pg_catalog.chr(10)
    || '    ''replayed'', false,' || pg_catalog.chr(10)
    || '    ''authorityStatus'', ''exact'',' || pg_catalog.chr(10)
    || '    ''merchantResolutionStatus'', ''exact'',' || pg_catalog.chr(10)
    || '    ''menuResolutionStatus'', ''exact'',' || pg_catalog.chr(10)
    || '    ''ocrResolution'', null,';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'standalone exact response authority');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  execute v_definition;
end;
$migration$;

create or replace function public.resolve_ocr_receipt_menu_identity_v1(
  p_resolution_id uuid,
  p_menu_facts jsonb,
  p_user_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_candidate public.receipt_menu_identity_candidates%rowtype;
  v_source_line public.verified_receipt_source_lines%rowtype;
  v_identity jsonb;
  v_response jsonb;
  v_mini_receipt jsonb;
  v_menu_name text;
  v_source_namespace text;
  v_source_code text;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if not coalesce(p_user_verified, false) then
    raise exception 'OCR menu source facts require explicit user verification' using errcode = '22023';
  end if;
  if jsonb_typeof(p_menu_facts) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(case when jsonb_typeof(p_menu_facts) = 'object' then p_menu_facts else '{}'::jsonb end) as field_name
      where field_name not in (
        'item_name', 'serving_label', 'category_label',
        'source_product_code_namespace', 'source_product_code'
      )
    )
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(case when jsonb_typeof(p_menu_facts) = 'object' then p_menu_facts else '{}'::jsonb end) as field_name
      where pg_catalog.jsonb_typeof(p_menu_facts -> field_name) not in ('string', 'null')
    )
  then
    raise exception 'OCR menu resolution accepts source facts only' using errcode = '22023';
  end if;
  v_menu_name := nullif(pg_catalog.btrim(coalesce(p_menu_facts ->> 'item_name', '')), '');
  if v_menu_name is null or length(v_menu_name) > 500 then
    raise exception 'verified item_name is required' using errcode = '22023';
  end if;

  select candidate.* into v_candidate
  from public.receipt_menu_identity_candidates as candidate
  where candidate.id = p_resolution_id
    and candidate.user_id = v_user_id
    and candidate.review_status in ('needs_ocr_resolution', 'accepted')
  for update;
  if not found then
    raise exception 'OCR menu resolution is not available to this user' using errcode = '42501';
  end if;
  if v_candidate.review_status = 'accepted' then
    select content.response into v_response
    from public.verified_receipt_ingestion_contents as content
    where content.user_id = v_user_id and content.receipt_id = v_candidate.receipt_id;
    if v_response is not null then
      return v_response;
    end if;
  end if;
  if not exists (
    select 1 from public.verified_receipt_sources as source
    where source.user_id = v_user_id and source.receipt_id = v_candidate.receipt_id
      and source.transcription_status = 'user_verified'
  ) then
    raise exception 'OCR-reviewed receipt ownership is required' using errcode = '42501';
  end if;
  select source_line.* into v_source_line
  from public.verified_receipt_source_lines as source_line
  where source_line.user_id = v_user_id
    and source_line.receipt_id = v_candidate.receipt_id
    and source_line.source_line_id = v_candidate.source_line_id
    and source_line.line_type = 'product'
    and source_line.benefit_kind is null
  for update;
  if not found then
    raise exception 'OCR menu resolution is not available for this source line' using errcode = '42501';
  end if;

  v_source_namespace := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_menu_facts ->> 'source_product_code_namespace', '')), ''),
    v_candidate.source_product_code_namespace
  );
  v_source_code := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_menu_facts ->> 'source_product_code', '')), ''),
    v_candidate.source_product_code
  );
  v_identity := public.private_resolve_ocr_receipt_menu_v1(
    v_user_id,
    v_candidate.receipt_id,
    v_candidate.source_line_id,
    v_candidate.restaurant_id,
    v_candidate.restaurant_location_id,
    v_source_line.line_type,
    v_menu_name,
    v_source_namespace,
    v_source_code,
    v_candidate.food_service_role,
    v_candidate.benefit_kind,
    v_candidate.id,
    p_menu_facts ->> 'serving_label',
    p_menu_facts ->> 'category_label'
  );
  if v_identity ->> 'status' <> 'exact' then
    return jsonb_build_object(
      'schemaVersion', 'ocr-resolution.v1',
      'status', 'needs_ocr_resolution',
      'resolutionId', v_candidate.id,
      'reasonCode', coalesce(v_identity ->> 'reasonCode', 'menu_identity_ambiguous'),
      'requiredSourceFacts', coalesce(v_identity -> 'requiredSourceFacts', '[]'::jsonb)
    );
  end if;

  select jsonb_build_object(
    'merchant', jsonb_build_object('catalog_namespace', v_candidate.source_product_code_namespace),
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
  v_response := public.private_enrich_verified_receipt_ingestion_v2(
    (select content.response
      from public.verified_receipt_ingestion_contents as content
      where content.user_id = v_user_id and content.receipt_id = v_candidate.receipt_id),
    v_mini_receipt
  );
  if v_response is null then
    raise exception 'verified receipt response was not found' using errcode = 'P0002';
  end if;
  return v_response;
end;
$function$;

comment on function public.resolve_ocr_receipt_menu_identity_v1(uuid, jsonb, boolean) is
  'Owner-authenticated OCR-App resolution for one ambiguous receipt menu line. It accepts source facts and a server-issued resolution ID, never PriceTrace identity IDs.';
revoke all on function public.resolve_ocr_receipt_menu_identity_v1(uuid, jsonb, boolean)
  from public, anon;
grant execute on function public.resolve_ocr_receipt_menu_identity_v1(uuid, jsonb, boolean)
  to authenticated;

alter table public.standalone_price_observation_ingestion_requests
  add constraint standalone_price_observation_ingestion_authority_check
  check (
    (kind = 'retail_purchase'
      and observation_id is not null
      and retail_price_observation_id is not null
      and restaurant_menu_manual_observation_id is null
      and observation_id = retail_price_observation_id)
    or
    (kind = 'restaurant_purchase'
      and (
        (observation_id is null and restaurant_menu_manual_observation_id is null)
        or (observation_id is not null
          and restaurant_menu_manual_observation_id is not null
          and observation_id = restaurant_menu_manual_observation_id)
      )
      and retail_price_observation_id is null)
  );

create or replace function public.private_resolve_ocr_menu_identity_v1(
  p_user_id uuid,
  p_restaurant_id uuid,
  p_restaurant_location_id uuid,
  p_menu_name text,
  p_serving_label text,
  p_category_label text,
  p_source_product_code_namespace text,
  p_source_product_code text,
  p_evidence jsonb,
  p_allow_create boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_menu_name text := nullif(pg_catalog.btrim(coalesce(p_menu_name, '')), '');
  v_serving_label text := nullif(pg_catalog.btrim(coalesce(p_serving_label, '')), '');
  v_category_label text := nullif(pg_catalog.btrim(coalesce(p_category_label, '')), '');
  v_source_namespace text := nullif(pg_catalog.btrim(coalesce(p_source_product_code_namespace, '')), '');
  v_source_code text := nullif(pg_catalog.btrim(coalesce(p_source_product_code, '')), '');
  v_match_count integer := 0;
  v_mapping_id uuid;
  v_menu_id uuid;
  v_catalog_id uuid;
  v_standard_id uuid;
  v_menu_verified boolean := false;
  v_evidence_fingerprint text;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or p_user_id is distinct from v_actor then
    raise exception 'authenticated OCR owner required' using errcode = '42501';
  end if;
  if p_restaurant_id is null or p_restaurant_location_id is null then
    return jsonb_build_object('status', 'needs_ocr_resolution', 'reasonCode', 'restaurant_identity_unresolved');
  end if;
  if not exists (
    select 1
    from public.restaurants as restaurant
    inner join public.restaurant_locations as location
      on location.restaurant_id = restaurant.id
    where restaurant.id = p_restaurant_id
      and location.id = p_restaurant_location_id
      and restaurant.status = 'active'
      and restaurant.review_status = 'verified'
      and restaurant.verification_status = 'verified'
      and location.review_status = 'verified'
      and location.verification_status = 'verified'
  ) then
    return jsonb_build_object('status', 'needs_ocr_resolution', 'reasonCode', 'restaurant_identity_unverified');
  end if;
  if v_menu_name is null or length(v_menu_name) > 500 then
    return jsonb_build_object(
      'status', 'needs_ocr_resolution',
      'reasonCode', 'menu_source_identity_insufficient',
      'requiredSourceFacts', jsonb_build_array('exact_menu_item_name')
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'pricetrace-ocr-menu-v1:' || p_restaurant_id::text || ':' ||
        v_menu_name || ':' || coalesce(v_serving_label, '<unspecified>'),
      0
    )
  );

  if v_source_namespace is not null and v_source_code is not null then
    select mapping.id, mapping.restaurant_menu_id, menu.catalog_product_id,
           catalog.standard_product_id,
           mapping.review_status = 'verified'
             and mapping.verification_status = 'verified'
             and menu.status = 'active'
             and menu.review_status = 'verified'
             and menu.verification_status = 'verified'
             and catalog.status = 'active'
             and catalog.purchase_type = 'menu_item'
             and catalog.verification_status = 'verified'
             and standard.status = 'active'
             and standard.purchase_type = 'menu_item'
             and standard.verification_status = 'verified'
             and menu.canonical_name = v_menu_name
             and (v_serving_label is null or menu.serving_label = v_serving_label)
      into v_mapping_id, v_menu_id, v_catalog_id, v_standard_id, v_menu_verified
    from public.restaurant_menu_source_mappings as mapping
    inner join public.restaurant_menus as menu
      on menu.restaurant_id = mapping.restaurant_id
      and menu.id = mapping.restaurant_menu_id
    inner join public.catalog_products as catalog
      on catalog.id = menu.catalog_product_id
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where mapping.restaurant_id = p_restaurant_id
      and mapping.restaurant_location_id = p_restaurant_location_id
      and mapping.source_product_code_namespace = v_source_namespace
      and mapping.source_product_code = v_source_code;
    if found then
      if v_menu_verified then
        return jsonb_build_object(
          'status', 'exact', 'restaurantMenuId', v_menu_id,
          'catalogProductId', v_catalog_id, 'standardProductId', v_standard_id,
          'sourceMenuMappingId', v_mapping_id
        );
      end if;
      return jsonb_build_object('status', 'needs_ocr_resolution', 'reasonCode', 'menu_source_mapping_unverified');
    end if;
  end if;

  if v_serving_label is null then
    select count(*) into v_match_count
    from public.restaurant_menus as menu
    where menu.restaurant_id = p_restaurant_id
      and menu.canonical_name = v_menu_name;
  else
    select count(*) into v_match_count
    from public.restaurant_menus as menu
    where menu.restaurant_id = p_restaurant_id
      and menu.canonical_name = v_menu_name
      and menu.serving_label = v_serving_label;
  end if;

  if v_match_count = 1 then
    if v_serving_label is null then
      select menu.id, menu.catalog_product_id, catalog.standard_product_id,
             menu.status = 'active'
               and menu.review_status = 'verified'
               and menu.verification_status = 'verified'
               and catalog.status = 'active'
               and catalog.purchase_type = 'menu_item'
               and catalog.verification_status = 'verified'
               and standard.status = 'active'
               and standard.purchase_type = 'menu_item'
               and standard.verification_status = 'verified'
        into v_menu_id, v_catalog_id, v_standard_id, v_menu_verified
      from public.restaurant_menus as menu
      inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id
      inner join public.standard_products as standard on standard.id = catalog.standard_product_id
      where menu.restaurant_id = p_restaurant_id and menu.canonical_name = v_menu_name;
    else
      select menu.id, menu.catalog_product_id, catalog.standard_product_id,
             menu.status = 'active'
               and menu.review_status = 'verified'
               and menu.verification_status = 'verified'
               and catalog.status = 'active'
               and catalog.purchase_type = 'menu_item'
               and catalog.verification_status = 'verified'
               and standard.status = 'active'
               and standard.purchase_type = 'menu_item'
               and standard.verification_status = 'verified'
        into v_menu_id, v_catalog_id, v_standard_id, v_menu_verified
      from public.restaurant_menus as menu
      inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id
      inner join public.standard_products as standard on standard.id = catalog.standard_product_id
      where menu.restaurant_id = p_restaurant_id
        and menu.canonical_name = v_menu_name
        and menu.serving_label = v_serving_label;
    end if;
    if v_menu_verified then
      if v_source_namespace is not null and v_source_code is not null then
        v_evidence_fingerprint := 'sha256:' || pg_catalog.encode(
          extensions.digest(coalesce(p_evidence, '{}'::jsonb)::text, 'sha256'), 'hex'
        );
        insert into public.restaurant_menu_source_mappings (
          restaurant_id, restaurant_location_id, restaurant_menu_id,
          source_product_code_namespace, source_product_code,
          evidence_fingerprint, review_status, verification_status,
          created_by, reviewed_by, reviewed_at
        ) values (
          p_restaurant_id, p_restaurant_location_id, v_menu_id,
          v_source_namespace, v_source_code, v_evidence_fingerprint,
          'verified', 'verified', v_actor, v_actor, v_now
        ) on conflict (restaurant_location_id, source_product_code_namespace, source_product_code)
          do nothing;
        select mapping.id into v_mapping_id
        from public.restaurant_menu_source_mappings as mapping
        where mapping.restaurant_location_id = p_restaurant_location_id
          and mapping.source_product_code_namespace = v_source_namespace
          and mapping.source_product_code = v_source_code
          and mapping.restaurant_menu_id = v_menu_id
          and mapping.review_status = 'verified'
          and mapping.verification_status = 'verified';
        if v_mapping_id is null then
          return jsonb_build_object('status', 'needs_ocr_resolution', 'reasonCode', 'menu_source_mapping_conflict');
        end if;
      end if;
      return jsonb_build_object(
        'status', 'exact', 'restaurantMenuId', v_menu_id,
        'catalogProductId', v_catalog_id, 'standardProductId', v_standard_id,
        'sourceMenuMappingId', v_mapping_id
      );
    end if;
    return jsonb_build_object('status', 'needs_ocr_resolution', 'reasonCode', 'menu_identity_unverified');
  elsif v_match_count > 1 then
    return jsonb_build_object(
      'status', 'needs_ocr_resolution', 'reasonCode', 'menu_identity_ambiguous',
      'requiredSourceFacts', jsonb_build_array('exact_menu_serving_label_or_source_menu_code')
    );
  end if;

  if not coalesce(p_allow_create, false) then
    return jsonb_build_object('status', 'not_applicable', 'reasonCode', 'menu_creation_not_authorized_for_line_role');
  end if;

  -- OCR-App has marked the source line user_verified, the Restaurant/Location
  -- tuple above is exact and verified, and no same-name Menu exists inside that
  -- Restaurant. Global name matching is intentionally not used.
  insert into public.standard_products (
    purchase_type, canonical_name, product_reference_url, status,
    created_by, verification_status
  ) values (
    'menu_item', v_menu_name, null, 'active', v_actor, 'verified'
  ) returning id into v_standard_id;

  insert into public.catalog_products (
    standard_product_id, purchase_type, canonical_name, brand, specification,
    specification_status, content_amount, content_unit, package_count,
    reference_unit, listing_reference_url, attributes, status, created_by,
    verification_status
  ) values (
    v_standard_id, 'menu_item', v_menu_name,
    (select restaurant.canonical_name from public.restaurants as restaurant where restaurant.id = p_restaurant_id),
    coalesce(v_serving_label, '1회 제공'), 'placeholder', 1, 'each', 1, 100,
    null,
    jsonb_build_object('restaurantId', p_restaurant_id, 'registrationSource', 'ocr_v5_user_verified_source'),
    'active', v_actor, 'verified'
  ) returning id into v_catalog_id;

  insert into public.restaurant_menus (
    restaurant_id, catalog_product_id, canonical_name, category_label,
    serving_label, official_url, review_status, status, verification_status,
    created_by, reviewed_by, reviewed_at
  ) values (
    p_restaurant_id, v_catalog_id, v_menu_name, v_category_label,
    coalesce(v_serving_label, '1회 제공'), null, 'verified', 'active', 'verified',
    v_actor, v_actor, v_now
  ) returning id into v_menu_id;

  update public.catalog_products
  set attributes = attributes || jsonb_build_object('restaurantMenuId', v_menu_id)
  where id = v_catalog_id;

  if v_source_namespace is not null and v_source_code is not null then
    v_evidence_fingerprint := 'sha256:' || pg_catalog.encode(
      extensions.digest(coalesce(p_evidence, '{}'::jsonb)::text, 'sha256'), 'hex'
    );
    insert into public.restaurant_menu_source_mappings (
      restaurant_id, restaurant_location_id, restaurant_menu_id,
      source_product_code_namespace, source_product_code,
      evidence_fingerprint, review_status, verification_status,
      created_by, reviewed_by, reviewed_at
    ) values (
      p_restaurant_id, p_restaurant_location_id, v_menu_id,
      v_source_namespace, v_source_code, v_evidence_fingerprint,
      'verified', 'verified', v_actor, v_actor, v_now
    ) returning id into v_mapping_id;
  end if;

  return jsonb_build_object(
    'status', 'exact', 'restaurantMenuId', v_menu_id,
    'catalogProductId', v_catalog_id, 'standardProductId', v_standard_id,
    'sourceMenuMappingId', v_mapping_id
  );
end;
$function$;

revoke all on function public.private_resolve_ocr_menu_identity_v1(uuid, uuid, uuid, text, text, text, text, text, jsonb, boolean)
  from public, anon, authenticated;

create or replace function public.private_resolve_ocr_receipt_menu_v1(
  p_user_id uuid,
  p_receipt_id uuid,
  p_source_line_id text,
  p_restaurant_id uuid,
  p_restaurant_location_id uuid,
  p_line_type text,
  p_menu_name text,
  p_source_namespace text,
  p_source_code text,
  p_food_service_role text,
  p_benefit_kind text,
  p_resolution_id uuid default null,
  p_serving_label text default null,
  p_category_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_identity jsonb;
  v_resolution_id uuid := p_resolution_id;
  v_reason_code text;
  v_candidate public.receipt_menu_identity_candidates%rowtype;
begin
  if v_actor is null or p_user_id is distinct from v_actor then
    raise exception 'authenticated receipt owner required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.verified_receipt_sources as source
    where source.user_id = v_actor
      and source.receipt_id = p_receipt_id
      and source.transcription_status = 'user_verified'
  ) then
    raise exception 'OCR-reviewed receipt ownership is required' using errcode = '42501';
  end if;
  if p_benefit_kind is not null then
    return jsonb_build_object('status', 'not_applicable', 'resolutionStatus', 'semantic_only');
  end if;
  if p_line_type <> 'product' or p_restaurant_id is null or p_restaurant_location_id is null then
    return jsonb_build_object('status', 'not_applicable');
  end if;

  if p_resolution_id is null then
    select candidate.* into v_candidate
    from public.receipt_menu_identity_candidates as candidate
    where candidate.user_id = v_actor
      and candidate.receipt_id = p_receipt_id
      and candidate.source_line_id = p_source_line_id
      and candidate.review_status = 'accepted';
    if found then
      v_resolution_id := v_candidate.id;
      p_menu_name := v_candidate.menu_name;
      p_serving_label := v_candidate.serving_label;
      p_category_label := v_candidate.category_label;
      p_source_namespace := v_candidate.source_product_code_namespace;
      p_source_code := v_candidate.source_product_code;
    end if;
  end if;

  if p_resolution_id is not null then
    select candidate.id into v_resolution_id
    from public.receipt_menu_identity_candidates as candidate
    where candidate.id = p_resolution_id
      and candidate.user_id = v_actor
      and candidate.receipt_id = p_receipt_id
      and candidate.source_line_id = p_source_line_id
      and candidate.review_status = 'needs_ocr_resolution'
    for update;
    if not found then
      raise exception 'OCR menu resolution is not available to this user' using errcode = '42501';
    end if;
  end if;

  v_identity := public.private_resolve_ocr_menu_identity_v1(
    v_actor, p_restaurant_id, p_restaurant_location_id, p_menu_name,
    p_serving_label, p_category_label, p_source_namespace, p_source_code,
    jsonb_build_object(
      'schemaVersion', 'receipt.v2', 'receiptId', p_receipt_id,
      'sourceLineId', p_source_line_id, 'menuName', p_menu_name,
      'sourceNamespace', p_source_namespace, 'sourceCode', p_source_code
    ),
    true
  );

  if v_identity ->> 'status' = 'exact' then
    if v_resolution_id is not null then
      update public.receipt_menu_identity_candidates
      set menu_name = p_menu_name,
          serving_label = p_serving_label,
          category_label = p_category_label,
          source_product_code_namespace = nullif(pg_catalog.btrim(coalesce(p_source_namespace, '')), ''),
          source_product_code = nullif(pg_catalog.btrim(coalesce(p_source_code, '')), ''),
          review_status = 'accepted',
          matched_restaurant_menu_id = (v_identity ->> 'restaurantMenuId')::uuid,
          matched_catalog_product_id = (v_identity ->> 'catalogProductId')::uuid,
          updated_at = pg_catalog.now()
      where id = v_resolution_id and user_id = v_actor;
    end if;
    return v_identity || jsonb_build_object('resolutionId', v_resolution_id);
  end if;
  if v_identity ->> 'status' <> 'needs_ocr_resolution' then
    return v_identity;
  end if;

  v_reason_code := coalesce(v_identity ->> 'reasonCode', 'menu_identity_ambiguous');
  if v_resolution_id is null then
    insert into public.receipt_menu_identity_candidates (
      user_id, receipt_id, source_line_id, restaurant_id, restaurant_location_id,
      menu_name, serving_label, category_label, source_product_code_namespace,
      source_product_code, food_service_role, benefit_kind, reason_code
    ) values (
      v_actor, p_receipt_id, p_source_line_id, p_restaurant_id, p_restaurant_location_id,
      nullif(pg_catalog.btrim(coalesce(p_menu_name, '')), ''), p_serving_label,
      p_category_label, nullif(pg_catalog.btrim(coalesce(p_source_namespace, '')), ''),
      nullif(pg_catalog.btrim(coalesce(p_source_code, '')), ''), p_food_service_role,
      p_benefit_kind, v_reason_code
    ) on conflict (user_id, receipt_id, source_line_id) do update
      set reason_code = excluded.reason_code,
          updated_at = pg_catalog.now()
      where public.receipt_menu_identity_candidates.review_status = 'needs_ocr_resolution'
    returning id into v_resolution_id;
    if v_resolution_id is null then
      select candidate.id into v_resolution_id
      from public.receipt_menu_identity_candidates as candidate
      where candidate.user_id = v_actor
        and candidate.receipt_id = p_receipt_id
        and candidate.source_line_id = p_source_line_id;
    end if;
  else
    update public.receipt_menu_identity_candidates
    set reason_code = v_reason_code,
        serving_label = p_serving_label,
        category_label = p_category_label,
        source_product_code_namespace = nullif(pg_catalog.btrim(coalesce(p_source_namespace, '')), ''),
        source_product_code = nullif(pg_catalog.btrim(coalesce(p_source_code, '')), ''),
        review_status = 'needs_ocr_resolution',
        updated_at = pg_catalog.now()
    where id = v_resolution_id and user_id = v_actor;
  end if;

  return v_identity || jsonb_build_object(
    'status', 'needs_ocr_resolution',
    'resolutionId', v_resolution_id,
    'requiredSourceFacts', coalesce(v_identity -> 'requiredSourceFacts',
      jsonb_build_array('exact_menu_serving_label_or_source_menu_code'))
  );
end;
$function$;

revoke all on function public.private_resolve_ocr_receipt_menu_v1(uuid, uuid, text, uuid, uuid, text, text, text, text, text, text, uuid, text, text)
  from public, anon, authenticated;

create or replace function public.private_resolve_ocr_standalone_restaurant_v1(
  p_user_id uuid,
  p_merchant jsonb,
  p_allow_create boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_name text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'merchant_name', '')), '');
  v_branch text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'branch_name', '')), '');
  v_source_namespace text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'source_namespace', '')), '');
  v_source_code text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'source_location_code', p_merchant ->> 'source_code', '')), '');
  v_bnr text := nullif(pg_catalog.regexp_replace(coalesce(p_merchant ->> 'business_registration_number', ''), '[^0-9]', '', 'g'), '');
  v_address text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'address', '')), '');
  v_phone text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'phone', '')), '');
  v_identity_namespace text;
  v_identity_code text;
  v_match_ids uuid[] := array[]::uuid[];
  v_restaurant_id uuid;
  v_location_id uuid;
  v_restaurant public.restaurants%rowtype;
  v_location public.restaurant_locations%rowtype;
  v_lock_key text;
  v_reason_code text;
begin
  if v_actor is null or p_user_id is distinct from v_actor then
    raise exception 'authenticated OCR owner required' using errcode = '42501';
  end if;
  if v_name is null or length(v_name) > 500 then
    return jsonb_build_object(
      'status', 'needs_ocr_resolution', 'reasonCode', 'restaurant_source_identity_insufficient',
      'requiredSourceFacts', jsonb_build_array('source_namespace_and_source_location_code_or_business_registration_number_or_branch_address_phone')
    );
  end if;
  if (v_source_namespace is null) <> (v_source_code is null) then
    return jsonb_build_object(
      'status', 'needs_ocr_resolution', 'reasonCode', 'restaurant_source_identity_incomplete',
      'requiredSourceFacts', jsonb_build_array('source_namespace_and_source_location_code')
    );
  end if;
  if v_bnr is not null and length(v_bnr) <> 10 then
    return jsonb_build_object(
      'status', 'needs_ocr_resolution', 'reasonCode', 'business_registration_number_invalid',
      'requiredSourceFacts', jsonb_build_array('valid_business_registration_number_or_branch_address_phone')
    );
  end if;

  if v_source_namespace is not null then
    v_identity_namespace := v_source_namespace;
    v_identity_code := v_source_code;
  elsif v_bnr is not null then
    v_identity_namespace := 'pricetrace-ocr-verified-business-registration-number-v1';
    v_identity_code := v_bnr;
  elsif v_branch is not null and v_address is not null and v_phone is not null then
    v_identity_namespace := 'pricetrace-ocr-verified-branch-contact-v1';
    v_identity_code := pg_catalog.encode(extensions.digest(jsonb_build_object(
      'merchantName', v_name, 'branchName', v_branch,
      'address', v_address, 'phone', v_phone
    )::text, 'sha256'), 'hex');
  else
    return jsonb_build_object(
      'status', 'needs_ocr_resolution', 'reasonCode', 'restaurant_source_identity_insufficient',
      'requiredSourceFacts', jsonb_build_array('source_namespace_and_source_location_code_or_business_registration_number_or_branch_address_phone')
    );
  end if;

  for v_lock_key in
    select key_value.value
    from pg_catalog.unnest(array[
      case when v_source_namespace is not null then 'source:' || v_source_namespace || ':' || v_source_code end,
      case when v_bnr is not null then 'business-number:' || v_bnr end,
      case when v_branch is not null and v_address is not null and v_phone is not null
        then 'branch-contact:' || v_name || ':' || v_branch || ':' || v_address || ':' || v_phone end
    ]) as key_value(value)
    where key_value.value is not null
    order by key_value.value
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('pricetrace-ocr-standalone-restaurant-v1:' || v_lock_key, 0)
    );
  end loop;

  select coalesce(pg_catalog.array_agg(distinct location.id), array[]::uuid[])
    into v_match_ids
  from public.restaurant_locations as location
  inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
  where (
      location.source_namespace = v_identity_namespace
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
    v_reason_code := 'restaurant_source_identity_ambiguous';
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
      or (v_bnr is not null and v_location.business_registration_number is not null
        and pg_catalog.regexp_replace(v_location.business_registration_number, '[^0-9]', '', 'g') <> v_bnr)
      or (v_branch is not null and v_location.location_label is not null and v_location.location_label <> v_branch)
      or (v_address is not null and v_location.address is not null and v_location.address <> v_address)
      or (v_phone is not null and v_location.phone is not null and v_location.phone <> v_phone)
    then
      v_reason_code := 'restaurant_source_identity_conflict';
      v_restaurant_id := null;
      v_location_id := null;
    end if;
  elsif coalesce(p_allow_create, false) then
    insert into public.restaurants(
      canonical_name, review_status, status, verification_status,
      created_by, reviewed_by, reviewed_at
    ) values (
      v_name, 'verified', 'active', 'verified', v_actor, v_actor, pg_catalog.now()
    ) returning id into v_restaurant_id;
    insert into public.restaurant_locations(
      restaurant_id, source_namespace, source_location_code, location_label,
      business_registration_number, address, phone, review_status,
      verification_status, created_by, reviewed_by, reviewed_at
    ) values (
      v_restaurant_id, v_identity_namespace, v_identity_code, v_branch,
      v_bnr, v_address, v_phone, 'verified', 'verified',
      v_actor, v_actor, pg_catalog.now()
    ) returning id into v_location_id;
  else
    v_reason_code := 'restaurant_source_identity_not_resolved';
  end if;

  if v_restaurant_id is not null and v_location_id is not null then
    return jsonb_build_object(
      'status', 'exact', 'restaurantId', v_restaurant_id,
      'restaurantLocationId', v_location_id
    );
  end if;
  return jsonb_build_object(
    'status', 'needs_ocr_resolution',
    'reasonCode', coalesce(v_reason_code, 'restaurant_source_identity_not_resolved'),
    'requiredSourceFacts', jsonb_build_array('source_namespace_and_source_location_code_or_business_registration_number_or_branch_address_phone')
  );
end;
$function$;

revoke all on function public.private_resolve_ocr_standalone_restaurant_v1(uuid, jsonb, boolean)
  from public, anon, authenticated;

create or replace function public.private_resolve_ocr_standalone_identity_v1(
  p_user_id uuid,
  p_idempotency_key text,
  p_observation jsonb,
  p_resolution_id uuid default null,
  p_merchant_override jsonb default null,
  p_item_override jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_merchant jsonb := coalesce(p_observation -> 'merchant', '{}'::jsonb) || coalesce(p_merchant_override, '{}'::jsonb);
  v_item jsonb := coalesce(p_observation -> 'item', '{}'::jsonb) || coalesce(p_item_override, '{}'::jsonb);
  v_restaurant jsonb;
  v_menu jsonb;
  v_restaurant_id uuid;
  v_location_id uuid;
  v_menu_id uuid;
  v_catalog_id uuid;
  v_standard_id uuid;
  v_resolution_id uuid := p_resolution_id;
  v_request_fingerprint text;
  v_reason_code text;
  v_required_facts jsonb;
  v_response jsonb;
  v_candidate public.standalone_ocr_identity_resolutions%rowtype;
  v_merchant_status text;
begin
  if v_actor is null or p_user_id is distinct from v_actor then
    raise exception 'authenticated OCR owner required' using errcode = '42501';
  end if;
  if p_resolution_id is not null then
    select candidate.* into v_candidate
    from public.standalone_ocr_identity_resolutions as candidate
    where candidate.id = p_resolution_id
      and candidate.user_id = v_actor
      and candidate.idempotency_key = p_idempotency_key
      and candidate.status = 'needs_ocr_resolution'
    for update;
    if not found then
      raise exception 'OCR standalone resolution is not available to this user' using errcode = '42501';
    end if;
    if v_candidate.request_payload is distinct from p_observation then
      raise exception 'OCR standalone resolution payload does not match the issued request' using errcode = '23514';
    end if;
  end if;
  if jsonb_typeof(v_merchant) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(v_merchant) as field_name
      where field_name not in (
        'merchant_name', 'branch_name', 'source_namespace', 'source_code',
        'source_location_code', 'business_registration_number', 'address', 'phone'
      )
    )
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(v_merchant) as field_name
      where pg_catalog.jsonb_typeof(v_merchant -> field_name) not in ('string', 'null')
    )
    or jsonb_typeof(v_item) is distinct from 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(v_item) as field_name
      where field_name not in (
        'item_name', 'serving_label', 'category_label',
        'source_menu_code_namespace', 'source_menu_code'
      )
    )
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(v_item) as field_name
      where pg_catalog.jsonb_typeof(v_item -> field_name) not in ('string', 'null')
    )
  then
    raise exception 'OCR standalone resolution accepts source facts only' using errcode = '22023';
  end if;

  v_restaurant := public.private_resolve_ocr_standalone_restaurant_v1(v_actor, v_merchant, true);
  v_merchant_status := v_restaurant ->> 'status';
  if v_merchant_status = 'exact' then
    v_restaurant_id := (v_restaurant ->> 'restaurantId')::uuid;
    v_location_id := (v_restaurant ->> 'restaurantLocationId')::uuid;
    if (nullif(pg_catalog.btrim(coalesce(v_item ->> 'source_menu_code_namespace', '')), '') is null)
      <> (nullif(pg_catalog.btrim(coalesce(v_item ->> 'source_menu_code', '')), '') is null)
    then
      v_menu := jsonb_build_object(
        'status', 'needs_ocr_resolution', 'reasonCode', 'menu_source_identity_incomplete',
        'requiredSourceFacts', jsonb_build_array('source_menu_code_namespace_and_source_menu_code')
      );
    else
      v_menu := public.private_resolve_ocr_menu_identity_v1(
        v_actor,
        v_restaurant_id,
        v_location_id,
        v_item ->> 'item_name',
        v_item ->> 'serving_label',
        v_item ->> 'category_label',
        v_item ->> 'source_menu_code_namespace',
        v_item ->> 'source_menu_code',
        jsonb_build_object('schemaVersion', 'receipt-independent-price-observation.v3', 'merchant', v_merchant, 'item', v_item),
        true
      );
    end if;
    if v_menu ->> 'status' = 'exact' then
      v_menu_id := (v_menu ->> 'restaurantMenuId')::uuid;
      v_catalog_id := (v_menu ->> 'catalogProductId')::uuid;
      v_standard_id := (v_menu ->> 'standardProductId')::uuid;
      return jsonb_build_object(
        'authorityStatus', 'exact',
        'merchantResolutionStatus', 'exact',
        'menuResolutionStatus', 'exact',
        'ocrResolution', null,
        'authoritativeIds', jsonb_build_object(
          'restaurantId', v_restaurant_id,
          'restaurantLocationId', v_location_id,
          'restaurantMenuId', v_menu_id,
          'catalogProductId', v_catalog_id,
          'standardProductId', v_standard_id
        )
      );
    end if;
    v_reason_code := coalesce(v_menu ->> 'reasonCode', 'menu_identity_unresolved');
    v_required_facts := coalesce(v_menu -> 'requiredSourceFacts', jsonb_build_array('exact_menu_serving_label_or_source_menu_code'));
  else
    v_reason_code := coalesce(v_restaurant ->> 'reasonCode', 'restaurant_source_identity_insufficient');
    v_required_facts := coalesce(v_restaurant -> 'requiredSourceFacts', jsonb_build_array('strong_restaurant_location_source_identity'));
  end if;

  v_restaurant_id := case when v_merchant_status = 'exact' then v_restaurant_id else null end;
  v_location_id := case when v_merchant_status = 'exact' then v_location_id else null end;
  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(convert_to(p_observation::text, 'UTF8'), 'sha256'), 'hex'
  );
  v_response := jsonb_build_object(
    'schemaVersion', 'receipt-independent-price-observation.v3',
    'kind', 'restaurant_purchase',
    'observationId', null,
    'replayed', false,
    'authorityStatus', 'needs_ocr_resolution',
    'merchantResolutionStatus', case when v_merchant_status = 'exact' then 'exact' else 'needs_ocr_resolution' end,
    'menuResolutionStatus', 'needs_ocr_resolution',
    'authoritativeIds', jsonb_build_object(
      'restaurantId', null, 'restaurantLocationId', null,
      'restaurantMenuId', null, 'catalogProductId', null, 'standardProductId', null
    ),
    'ocrResolution', jsonb_build_object(
      'schemaVersion', 'ocr-resolution.v1', 'status', 'needs_ocr_resolution',
      'resolutionId', v_resolution_id, 'reasonCode', v_reason_code,
      'requiredSourceFacts', v_required_facts
    )
  );

  if v_resolution_id is null then
    insert into public.standalone_ocr_identity_resolutions(
      user_id, idempotency_key, request_fingerprint, request_payload,
      merchant_resolution_status, restaurant_id, restaurant_location_id,
      menu_resolution_status, reason_code, required_source_facts, response
    ) values (
      v_actor, p_idempotency_key, v_request_fingerprint, p_observation,
      case when v_merchant_status = 'exact' then 'exact' else 'needs_ocr_resolution' end,
      v_restaurant_id, v_location_id, 'needs_ocr_resolution', v_reason_code,
      v_required_facts, v_response
    ) on conflict (user_id, idempotency_key) do update
      set reason_code = excluded.reason_code,
          required_source_facts = excluded.required_source_facts,
          updated_at = pg_catalog.now()
    returning id into v_resolution_id;
    if v_resolution_id is null then
      select candidate.id into v_resolution_id
      from public.standalone_ocr_identity_resolutions as candidate
      where candidate.user_id = v_actor and candidate.idempotency_key = p_idempotency_key;
    end if;
  else
    v_resolution_id := v_candidate.id;
  end if;

  v_response := pg_catalog.jsonb_set(v_response, '{ocrResolution,resolutionId}', to_jsonb(v_resolution_id));
  if p_resolution_id is null then
    update public.standalone_ocr_identity_resolutions
    set response = v_response,
        merchant_resolution_status = case when v_merchant_status = 'exact' then 'exact' else 'needs_ocr_resolution' end,
        restaurant_id = v_restaurant_id,
        restaurant_location_id = v_location_id,
        reason_code = v_reason_code,
        required_source_facts = v_required_facts,
        updated_at = pg_catalog.now()
    where id = v_resolution_id and user_id = v_actor;
  else
    update public.standalone_ocr_identity_resolutions
    set response = v_response,
        merchant_resolution_status = case when v_merchant_status = 'exact' then 'exact' else 'needs_ocr_resolution' end,
        restaurant_id = v_restaurant_id,
        restaurant_location_id = v_location_id,
        restaurant_menu_id = null,
        catalog_product_id = null,
        standard_product_id = null,
        reason_code = v_reason_code,
        required_source_facts = v_required_facts,
        updated_at = pg_catalog.now()
    where id = v_resolution_id and user_id = v_actor and status = 'needs_ocr_resolution';
  end if;
  return v_response;
end;
$function$;

revoke all on function public.private_resolve_ocr_standalone_identity_v1(uuid, text, jsonb, uuid, jsonb, jsonb)
  from public, anon, authenticated;

create or replace function public.private_record_ocr_receipt_menu_observations_v1(
  p_response jsonb,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_receipt_id uuid := nullif(p_response ->> 'receiptId', '')::uuid;
  v_restaurant_id uuid := nullif(p_response ->> 'restaurantId', '')::uuid;
  v_location_id uuid := nullif(p_response ->> 'restaurantLocationId', '')::uuid;
  v_source_namespace text := nullif(pg_catalog.btrim(coalesce(
    p_receipt -> 'merchant' ->> 'catalog_namespace',
    p_receipt -> 'merchant' ->> 'source_namespace', ''
  )), '');
  v_observed_on date;
  v_source_line record;
  v_receipt_item_id text;
  v_price_observation_id uuid;
  v_menu_observation_id uuid;
  v_source_mapping_id uuid;
  v_unit_price integer;
  v_quantity integer;
  v_total_price integer;
  v_evidence_fingerprint text;
  v_lines jsonb;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if v_receipt_id is null or v_restaurant_id is null or v_location_id is null then
    return p_response;
  end if;

  select coalesce(source.issued_on, (source.issued_at at time zone 'Asia/Seoul')::date)
    into v_observed_on
  from public.verified_receipt_sources as source
  where source.user_id = v_user_id and source.receipt_id = v_receipt_id
    and source.transcription_status = 'user_verified';
  if v_observed_on is null then
    return p_response;
  end if;

  for v_source_line in
    select source_line.source_line_id, source_line.source_line_references,
           source_line.merchant_sku, source_line.catalog_product_id,
           source_line.restaurant_menu_id
    from public.verified_receipt_source_lines as source_line
    where source_line.user_id = v_user_id
      and source_line.receipt_id = v_receipt_id
      and source_line.line_type = 'product'
      and source_line.benefit_kind is null
      and source_line.restaurant_menu_id is not null
      and source_line.catalog_product_id is not null
    order by source_line.line_ordinal
  loop
    select line.value ->> 'receiptItemId'
      into v_receipt_item_id
    from jsonb_array_elements(coalesce(p_response -> 'lines', '[]'::jsonb)) as line(value)
    where line.value ->> 'sourceLineId' = v_source_line.source_line_id;
    if v_receipt_item_id is null then
      continue;
    end if;

    select observation.id, item.unit_price_krw, item.purchased_quantity, item.total_price_krw
      into v_price_observation_id, v_unit_price, v_quantity, v_total_price
    from public.receipt_items as item
    inner join public.price_observations as observation
      on observation.user_id = item.user_id and observation.receipt_item_id = item.id
    where item.user_id = v_user_id
      and item.receipt_id = v_receipt_id
      and item.id = v_receipt_item_id;
    if not found then
      continue;
    end if;

    update public.price_observations
    set catalog_product_id = v_source_line.catalog_product_id
    where user_id = v_user_id and id = v_price_observation_id;

    v_source_mapping_id := null;
    if v_source_line.merchant_sku is not null and v_source_namespace is not null then
      select mapping.id into v_source_mapping_id
      from public.restaurant_menu_source_mappings as mapping
      where mapping.restaurant_id = v_restaurant_id
        and mapping.restaurant_location_id = v_location_id
        and mapping.restaurant_menu_id = v_source_line.restaurant_menu_id
        and mapping.source_product_code_namespace = v_source_namespace
        and mapping.source_product_code = v_source_line.merchant_sku
        and mapping.review_status = 'verified'
        and mapping.verification_status = 'verified';
    end if;

    v_evidence_fingerprint := 'sha256:' || pg_catalog.encode(extensions.digest(jsonb_build_object(
      'receiptId', v_receipt_id,
      'lineId', v_source_line.source_line_id,
      'restaurantLocationId', v_location_id,
      'restaurantMenuId', v_source_line.restaurant_menu_id,
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
      v_restaurant_id, v_location_id, v_source_line.restaurant_menu_id, v_source_mapping_id,
      v_user_id, v_price_observation_id, v_receipt_id, v_receipt_item_id, v_observed_on,
      v_unit_price, v_quantity, v_total_price,
      jsonb_build_object(
        'schemaVersion', 'receipt.v2',
        'receiptId', v_receipt_id,
        'sourceLineId', v_source_line.source_line_id,
        'sourceLineReferences', to_jsonb(v_source_line.source_line_references)
      ),
      v_evidence_fingerprint, 'verified', v_user_id
    ) on conflict do nothing;
  end loop;

  select coalesce(jsonb_agg(
    line.value || jsonb_build_object('restaurantObservationId', menu_observation.id)
    order by line.ordinality
  ), '[]'::jsonb)
    into v_lines
  from jsonb_array_elements(coalesce(p_response -> 'lines', '[]'::jsonb))
    with ordinality as line(value, ordinality)
  left join public.restaurant_menu_receipt_observations as menu_observation
    on menu_observation.owner_user_id = v_user_id
    and menu_observation.receipt_id = v_receipt_id
    and menu_observation.receipt_item_id = line.value ->> 'receiptItemId';

  return p_response || jsonb_build_object('lines', v_lines);
end;
$function$;

revoke all on function public.private_record_ocr_receipt_menu_observations_v1(jsonb, jsonb)
  from public, anon, authenticated;

-- Patch the deployed enricher definition. This keeps the existing receipt
-- validation/idempotency body and adds only restaurant-scoped Menu authority.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_anchor_span integer[];
  v_anchor_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.private_enrich_verified_receipt_ingestion_v2(jsonb, jsonb)'::regprocedure
  ) into v_definition;
  if v_definition is null then
    raise exception 'private_enrich_verified_receipt_ingestion_v2 is not deployed';
  end if;
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10));

  v_old := '  v_restaurant_location_id uuid := nullif(p_base_response ->> ''restaurantLocationId'', '''')::uuid;';
  v_new := v_old || pg_catalog.chr(10)
    || '  v_menu_identity jsonb;' || pg_catalog.chr(10)
    || '  v_food_service_role text;' || pg_catalog.chr(10)
    || '  v_benefit_kind text;' || pg_catalog.chr(10)
    || '  v_line_ocr_resolution jsonb;' || pg_catalog.chr(10)
    || '  v_line_resolution_status text;' || pg_catalog.chr(10)
    || '  v_menu_namespace text;';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment OCR menu declaration');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '  v_sku text;' ;
  v_new := v_old || pg_catalog.chr(10) || '  v_match_count integer := 0;';
  v_anchor_count := pg_catalog.regexp_count(v_definition, 'v_match_count[[:space:]]+integer');
  if v_anchor_count > 1 then
    raise exception 'receipt enrichment menu match declaration anchor is ambiguous';
  elsif v_anchor_count = 0 then
    v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment menu match declaration');
    v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
      || pg_catalog.ltrim(v_new)
      || pg_catalog.substr(v_definition, v_anchor_span[2]);
  end if;

  v_old := '    if v_line_type in (''product'', ''service'') and v_description is not null then';
  v_new := '    v_line_ocr_resolution := null;' || pg_catalog.chr(10)
    || '    v_line_resolution_status := null;' || pg_catalog.chr(10)
    || '    v_food_service_role := null;' || pg_catalog.chr(10)
    || '    v_benefit_kind := null;' || pg_catalog.chr(10)
    || '    if v_line_type = ''product'' and v_business_kind = ''food_service'' then' || pg_catalog.chr(10)
    || '      select source_line.food_service_role, source_line.benefit_kind' || pg_catalog.chr(10)
    || '        into v_food_service_role, v_benefit_kind' || pg_catalog.chr(10)
    || '      from public.verified_receipt_source_lines as source_line' || pg_catalog.chr(10)
    || '      where source_line.user_id = v_user_id and source_line.receipt_id = v_receipt_id and source_line.source_line_id = v_line_id;' || pg_catalog.chr(10)
    || '      v_menu_namespace := nullif(pg_catalog.btrim(coalesce(p_receipt -> ''merchant'' ->> ''catalog_namespace'', p_receipt -> ''merchant'' ->> ''source_namespace'', '''')), '''');' || pg_catalog.chr(10)
    || '      if v_benefit_kind is not null then' || pg_catalog.chr(10)
    || '        v_restaurant_menu_id := null;' || pg_catalog.chr(10)
    || '        v_catalog_product_id := null;' || pg_catalog.chr(10)
    || '        v_line_resolution_status := ''semantic_only'';' || pg_catalog.chr(10)
    || '      elsif v_restaurant_id is null or v_restaurant_location_id is null then' || pg_catalog.chr(10)
    || '        v_restaurant_menu_id := null;' || pg_catalog.chr(10)
    || '        v_catalog_product_id := null;' || pg_catalog.chr(10)
    || '        v_line_resolution_status := ''needs_ocr_resolution'';' || pg_catalog.chr(10)
    || '      else' || pg_catalog.chr(10)
    || '        v_menu_identity := public.private_resolve_ocr_receipt_menu_v1(' || pg_catalog.chr(10)
    || '          v_user_id, v_receipt_id, v_line_id, v_restaurant_id, v_restaurant_location_id,' || pg_catalog.chr(10)
    || '          v_line_type, v_description, v_menu_namespace, v_sku, v_food_service_role, v_benefit_kind' || pg_catalog.chr(10)
    || '        );' || pg_catalog.chr(10)
    || '        if v_menu_identity ->> ''status'' = ''exact''' || pg_catalog.chr(10)
    || '          and nullif(v_menu_identity ->> ''restaurantMenuId'', '''') is not null' || pg_catalog.chr(10)
    || '          and nullif(v_menu_identity ->> ''catalogProductId'', '''') is not null then' || pg_catalog.chr(10)
    || '          v_restaurant_menu_id := (v_menu_identity ->> ''restaurantMenuId'')::uuid;' || pg_catalog.chr(10)
    || '          v_catalog_product_id := (v_menu_identity ->> ''catalogProductId'')::uuid;' || pg_catalog.chr(10)
    || '          v_line_resolution_status := ''resolved'';' || pg_catalog.chr(10)
    || '        else' || pg_catalog.chr(10)
    || '          v_restaurant_menu_id := null;' || pg_catalog.chr(10)
    || '          v_catalog_product_id := null;' || pg_catalog.chr(10)
    || '          v_line_resolution_status := ''needs_ocr_resolution'';' || pg_catalog.chr(10)
    || '          if v_menu_identity ->> ''status'' = ''needs_ocr_resolution'' and nullif(v_menu_identity ->> ''resolutionId'', '''') is not null then' || pg_catalog.chr(10)
    || '            v_line_ocr_resolution := jsonb_build_object(' || pg_catalog.chr(10)
    || '              ''schemaVersion'', ''ocr-resolution.v1'', ''status'', ''needs_ocr_resolution'',' || pg_catalog.chr(10)
    || '              ''resolutionId'', (v_menu_identity ->> ''resolutionId'')::uuid,' || pg_catalog.chr(10)
    || '              ''reasonCode'', v_menu_identity ->> ''reasonCode'',' || pg_catalog.chr(10)
    || '              ''requiredSourceFacts'', coalesce(v_menu_identity -> ''requiredSourceFacts'', ''[]''::jsonb)' || pg_catalog.chr(10)
    || '            );' || pg_catalog.chr(10)
    || '          end if;' || pg_catalog.chr(10)
    || '        end if;' || pg_catalog.chr(10)
    || '      end if;' || pg_catalog.chr(10)
    || '    end if;' || pg_catalog.chr(10)
    || v_old;
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment OCR menu resolution');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '        when v_restaurant_menu_id is not null or v_catalog_product_id is not null then ''resolved''';
  v_new := '        when v_line_resolution_status is not null then v_line_resolution_status' || pg_catalog.chr(10)
    || '        when v_restaurant_menu_id is not null or v_catalog_product_id is not null then ''resolved''';
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment OCR menu response status');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '    v_line_results := v_line_results || jsonb_build_array(v_line_result);';
  v_new := '    v_line_result := v_line_result || jsonb_build_object(''ocrResolution'', v_line_ocr_resolution);' || pg_catalog.chr(10)
    || v_old;
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment OCR line resolution');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  v_old := '  update public.verified_receipt_ingestion_contents';
  v_new := '  v_line_results := (public.private_record_ocr_receipt_menu_observations_v1(' || pg_catalog.chr(10)
    || '    coalesce(p_base_response, ''{}''::jsonb) || jsonb_build_object(''storeId'', v_store_id, ''lines'', v_line_results),' || pg_catalog.chr(10)
    || '    p_receipt' || pg_catalog.chr(10)
    || '  ) -> ''lines'');' || pg_catalog.chr(10)
    || v_old;
  v_anchor_span := pg_temp.ocr_v5_anchor_span(v_definition, v_old, 'receipt enrichment OCR menu observation');
  v_definition := pg_catalog.substr(v_definition, 1, v_anchor_span[1] - 1)
    || pg_catalog.ltrim(v_new)
    || pg_catalog.substr(v_definition, v_anchor_span[2]);

  execute v_definition;
end;
$migration$;

drop function pg_temp.ocr_v5_anchor_span(text, text, text);
