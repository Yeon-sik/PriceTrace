-- Register an independently reviewed receipt/official link without inventing
-- a Coupang observation. Apparel size is stored as typed catalog metadata,
-- while the sellable quantity remains one each.

create function public.approve_and_register_standard_product_link_only_v1(
  p_idempotency_key text,
  p_case_id text,
  p_input_fingerprint text,
  p_target_fingerprint text,
  p_input_canonical_json text,
  p_target_canonical_json text,
  p_approval_statement text,
  p_receipt_id text,
  p_receipt_item_id text,
  p_receipt_observed_at timestamptz,
  p_standard_product_id uuid,
  p_catalog_product_id uuid,
  p_standard_name text,
  p_brand_name text,
  p_receipt_brand_name text,
  p_official_brand_name text,
  p_official_brand_source_label text,
  p_product_reference_url text,
  p_listing_name text,
  p_receipt_product_name text,
  p_specification_status text,
  p_content_amount numeric,
  p_content_unit text,
  p_package_count integer,
  p_reference_unit integer,
  p_source_product_code text,
  p_source_labels text[],
  p_specification text,
  p_apparel_size jsonb
)
returns table (
  execution_id uuid,
  standard_product_id uuid,
  catalog_product_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_input jsonb;
  v_target jsonb;
  v_receipt jsonb;
  v_official jsonb;
  v_rule jsonb;
  v_identity jsonb;
  v_brand_evidence jsonb;
  v_decision jsonb;
  v_specification_check jsonb;
  v_representative_image jsonb;
  v_expected_action text;
  v_expected_effects jsonb := '[]'::jsonb;
  v_expected_approval_statement text;
  v_effect_text text;
  v_official_source_id text;
  v_receipt_source_id text;
  v_specification_match text[];
  v_parsed_amount numeric;
  v_parsed_unit text;
  v_execution_id uuid;
  v_execution public.standard_product_link_executions%rowtype;
  v_approval public.standard_product_link_approvals%rowtype;
  v_approval_id uuid;
  v_standard_product_id uuid := p_standard_product_id;
  v_catalog_product_id uuid := p_catalog_product_id;
  v_brand_id uuid;
  v_brand_status text;
  v_existing_standard_name text;
  v_existing_standard_brand_id uuid;
  v_existing_catalog public.catalog_products%rowtype;
  v_collision_id uuid;
  v_mapping_id uuid;
  v_mapping_catalog_product_id uuid;
  v_source_label text;
  v_official_link_id uuid;
  v_existing_official_catalog_id uuid;
  v_existing_image public.standard_product_images%rowtype;
  v_image_result jsonb;
  v_observed_at timestamptz := now();
  v_normalized_brand_name text := public.normalize_brand_name(p_brand_name);
  v_normalized_standard_name text := pg_catalog.regexp_replace(
    coalesce(p_standard_name, ''), '[[:space:]]+', '', 'g'
  );
  v_normalized_listing_name text := pg_catalog.regexp_replace(
    coalesce(p_listing_name, ''), '[[:space:]]+', '', 'g'
  );
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  begin
    v_input := p_input_canonical_json::jsonb;
    v_target := p_target_canonical_json::jsonb;
  exception when others then
    raise exception 'Canonical proposal JSON is invalid.' using errcode = '22023';
  end;

  if public.canonical_jsonb_text(v_input) <> p_input_canonical_json
    or public.canonical_jsonb_text(v_target) <> p_target_canonical_json
    or 'sha256:' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_input_canonical_json, 'UTF8'), 'sha256'),
      'hex'
    ) <> p_input_fingerprint
    or 'sha256:' || pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(p_target_canonical_json, 'UTF8'), 'sha256'),
      'hex'
    ) <> p_target_fingerprint
    or btrim(p_idempotency_key)
      <> 'standard-product-link:' || pg_catalog.substr(p_target_fingerprint, 8)
  then
    raise exception 'Canonical proposal or fingerprint validation failed.'
      using errcode = '23514';
  end if;

  v_receipt := v_input -> 'receipt';
  v_official := v_input -> 'officialListing';
  v_rule := v_target -> 'sameChannelNameRule';
  v_identity := v_target -> 'normalizedIdentity';
  v_brand_evidence := v_target -> 'brandEvidence';
  v_decision := v_target -> 'decision';
  v_specification_check := v_target -> 'officialSpecificationCheck';
  v_representative_image := v_target -> 'representativeImage';
  v_receipt_source_id := coalesce(v_receipt ->> 'receiptId', '') || ':'
    || coalesce(v_receipt ->> 'receiptItemId', '');
  v_official_source_id := coalesce(v_official ->> 'channelId', '') || ':'
    || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
    || coalesce(v_official ->> 'sourceProductCode', '');

  if coalesce(v_target ->> 'executionMode', '') <> 'link_only_v1'
    or v_target -> 'coupangOffer' <> 'null'::jsonb
    or v_target ->> 'caseId' <> btrim(p_case_id)
    or v_target ->> 'inputFingerprint' <> p_input_fingerprint
    or coalesce(v_receipt ->> 'receiptId', '') <> btrim(p_receipt_id)
    or coalesce(v_receipt ->> 'receiptItemId', '') <> btrim(p_receipt_item_id)
    or coalesce(v_receipt ->> 'receiptRevision', '') = ''
    or (v_receipt ->> 'observedAt')::timestamptz <> p_receipt_observed_at
    or coalesce(v_receipt ->> 'sourceLabel', '') <> btrim(p_source_labels[1])
    or coalesce(v_receipt ->> 'sourceProductCode', '') <> btrim(p_source_product_code)
    or coalesce(v_receipt ->> 'sourceNameRaw', '') <> p_receipt_product_name
    or (v_receipt ->> 'unitPriceKrw')::integer < 0
    or (v_receipt ->> 'quantity')::integer <= 0
    or coalesce(v_receipt ->> 'sourceCatalogNamespace', '')
      <> coalesce(v_official ->> 'channelId', '')
    or coalesce(v_official ->> 'channelId', '') = ''
    or coalesce(v_official ->> 'sourceProductCodeNamespace', '') = ''
    or coalesce(v_official ->> 'sourceProductCode', '') = ''
    or coalesce(v_official ->> 'snapshotId', '')
      !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or coalesce(v_official ->> 'snapshotHash', '') !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(v_official ->> 'sourceNameRaw', '') = ''
    or coalesce(v_official ->> 'specificationTextRaw', '') = ''
    or pg_catalog.jsonb_typeof(v_official -> 'sourceRefs') <> 'array'
    or pg_catalog.jsonb_array_length(v_official -> 'sourceRefs') = 0
  then
    raise exception 'Frozen receipt or official listing does not match the requested write.'
      using errcode = '23514';
  end if;

  if not (
    (
      pg_catalog.regexp_replace(v_receipt ->> 'sourceNameRaw', '[[:space:]]+', '', 'g')
        = pg_catalog.regexp_replace(v_official ->> 'sourceNameRaw', '[[:space:]]+', '', 'g')
      and v_rule ->> 'outcome' = 'apply_official_identity'
      and (v_rule ->> 'exactNameMatch')::boolean is true
    )
    or public.is_verified_single_codepoint_name_equivalence(
      v_target,
      v_receipt ->> 'sourceNameRaw',
      v_official ->> 'sourceNameRaw',
      v_official_source_id
    )
    or public.is_verified_official_name_containment(
      v_target,
      v_receipt ->> 'sourceNameRaw',
      v_official ->> 'sourceNameRaw',
      v_receipt_source_id,
      (v_receipt ->> 'unitPriceKrw')::integer,
      v_official -> 'officialPrice',
      v_official_source_id
    )
  )
    or v_rule ->> 'normalization' <> 'remove_unicode_whitespace_only'
    or (v_rule ->> 'sameChannel')::boolean is not true
    or v_rule ->> 'normalizedReceiptName'
      <> pg_catalog.regexp_replace(v_receipt ->> 'sourceNameRaw', '[[:space:]]+', '', 'g')
    or v_rule ->> 'normalizedOfficialName'
      <> pg_catalog.regexp_replace(v_official ->> 'sourceNameRaw', '[[:space:]]+', '', 'g')
  then
    raise exception 'The reviewed same-channel name rule is invalid.' using errcode = '23514';
  end if;

  if p_catalog_product_id is not null then
    v_expected_action := 'reuse_variant';
  elsif p_standard_product_id is not null then
    v_expected_action := 'create_variant';
  else
    v_expected_action := 'create_family_and_variant';
  end if;
  v_expected_effects := v_expected_effects || pg_catalog.jsonb_build_array(
    case when p_standard_product_id is null
      then 'create_standard_family' else 'reuse_standard_family' end
  );
  v_expected_effects := v_expected_effects || pg_catalog.jsonb_build_array(
    case when p_catalog_product_id is null
      then 'create_catalog_variant' else 'reuse_catalog_variant' end
  );
  v_expected_effects := v_expected_effects || '[
    "link_official_listing",
    "verify_receipt_mapping",
    "update_representative_image"
  ]'::jsonb;

  if p_standard_product_id is null and p_catalog_product_id is not null
    or coalesce(length(btrim(p_standard_name)), 0) = 0
    or coalesce(length(btrim(p_listing_name)), 0) = 0
    or coalesce(length(btrim(p_brand_name)), 0) = 0
    or coalesce(length(btrim(p_official_brand_name)), 0) = 0
    or coalesce(length(btrim(p_official_brand_source_label)), 0) = 0
    or coalesce(length(btrim(p_receipt_product_name)), 0) = 0
    or coalesce(length(btrim(p_source_product_code)), 0) = 0
    or coalesce(p_product_reference_url, '') !~ '^https?://'
    or p_specification_status <> 'verified'
    or coalesce(p_content_amount, 0) <= 0
    or coalesce(p_content_unit, '') not in ('g', 'ml', 'each')
    or coalesce(p_package_count, 0) <= 0
    or coalesce(p_reference_unit, 0) not in (10, 100, 1000)
    or (p_content_unit = 'each' and p_reference_unit <> 100)
    or not exists (
      select 1 from pg_catalog.unnest(p_source_labels) as source(source_label)
      where length(btrim(source.source_label)) > 0
    )
  then
    raise exception 'A complete link-only family and variant target is required.'
      using errcode = '23514';
  end if;

  if p_apparel_size is not null
  then
    if pg_catalog.jsonb_typeof(p_apparel_size) <> 'object'
      or p_apparel_size not in (
        '{"alpha":"S","kr":90,"label":"S(90)"}'::jsonb,
        '{"alpha":"M","kr":95,"label":"M(95)"}'::jsonb,
        '{"alpha":"L","kr":100,"label":"L(100)"}'::jsonb,
        '{"alpha":"XL","kr":105,"label":"XL(105)"}'::jsonb,
        '{"alpha":"XXL","kr":110,"label":"XXL(110)"}'::jsonb,
        '{"alpha":"XXXL","kr":115,"label":"XXXL(115)"}'::jsonb
      )
      or p_content_amount <> 1
      or p_content_unit <> 'each'
      or p_package_count <> 1
      or p_reference_unit <> 100
      or p_specification <> p_apparel_size ->> 'kr' || '호'
      or pg_catalog.regexp_replace(
        v_official ->> 'specificationTextRaw', '[^0-9]', '', 'g'
      ) <> p_apparel_size ->> 'kr'
      or v_specification_check ->> 'kind' <> 'apparel_size'
      or v_specification_check -> 'parsedApparelSize' <> p_apparel_size
      or not (v_rule -> 'importedOfficialFields' ? 'apparelSize')
    then
      raise exception 'The official apparel size does not match the typed target.'
        using errcode = '23514';
    end if;
  else
    v_specification_match := pg_catalog.regexp_match(
      btrim(v_official ->> 'specificationTextRaw'),
      '^(\d+(?:\.\d+)?)\s*(kg|g|ml|each|개|입)$',
      'i'
    );
    if v_specification_match is null then
      raise exception 'The official content specification is invalid.' using errcode = '23514';
    end if;
    v_parsed_amount := v_specification_match[1]::numeric;
    v_parsed_unit := lower(v_specification_match[2]);
    if v_parsed_unit = 'kg' then
      v_parsed_amount := v_parsed_amount * 1000;
      v_parsed_unit := 'g';
    elsif v_parsed_unit in ('개', '입', 'each') then
      v_parsed_unit := 'each';
    end if;
    if v_specification_check ->> 'kind' <> 'content'
      or (v_specification_check ->> 'parsedContentAmount')::numeric <> v_parsed_amount
      or v_specification_check ->> 'parsedContentUnit' <> v_parsed_unit
      or (v_specification_check ->> 'parsedContentAmount')::numeric <> p_content_amount
      or v_specification_check ->> 'parsedContentUnit' <> p_content_unit
      or (v_specification_check ->> 'parsedPackageCount')::integer <> p_package_count
      or p_specification <> v_official ->> 'specificationTextRaw'
      or not (v_rule -> 'importedOfficialFields' ? 'contentAmount')
      or not (v_rule -> 'importedOfficialFields' ? 'contentUnit')
    then
      raise exception 'The official content specification does not match the target.'
        using errcode = '23514';
    end if;
  end if;

  if coalesce(v_identity ->> 'brand', '') <> btrim(p_brand_name)
    or coalesce(v_identity ->> 'productFamilyName', '') <> btrim(p_standard_name)
    or coalesce(v_identity ->> 'variantName', '') <> btrim(p_listing_name)
    or v_identity ->> 'specificationStatus' <> p_specification_status
    or (v_identity ->> 'contentAmount')::numeric is distinct from p_content_amount
    or v_identity ->> 'contentUnit' <> p_content_unit
    or (v_identity ->> 'packageCount')::integer is distinct from p_package_count
    or (v_identity ->> 'referenceUnit')::integer is distinct from p_reference_unit
    or v_identity -> 'apparelSize' is distinct from coalesce(p_apparel_size, 'null'::jsonb)
    or v_identity -> 'gtin' <> 'null'::jsonb
    or v_brand_evidence ->> 'canonicalName' <> btrim(p_brand_name)
    or v_brand_evidence ->> 'receiptObservedName'
      is distinct from nullif(btrim(p_receipt_brand_name), '')
    or v_brand_evidence ->> 'officialObservedName' <> btrim(p_official_brand_name)
    or coalesce(v_brand_evidence ->> 'officialObservedName', '') = ''
    or v_brand_evidence ->> 'officialSourceLabel' <> btrim(p_official_brand_source_label)
    or coalesce(v_brand_evidence ->> 'officialSourceLabel', '') = ''
    or v_brand_evidence ->> 'productReferenceUrl' <> p_product_reference_url
    or v_decision ->> 'action' <> v_expected_action
    or v_decision ->> 'standardProductId' is distinct from p_standard_product_id::text
    or v_decision ->> 'catalogProductId' is distinct from p_catalog_product_id::text
    or v_decision ->> 'proposedStandardName' is distinct from (
      case when p_standard_product_id is null then btrim(p_standard_name) else null end
    )
    or v_decision ->> 'proposedVariantName' is distinct from (
      case when p_catalog_product_id is null then btrim(p_listing_name) else null end
    )
    or v_decision ->> 'confidence' <> 'high'
    or pg_catalog.jsonb_array_length(v_decision -> 'matchedFields') = 0
    or v_decision -> 'conflictingFields' <> '[]'::jsonb
    or v_decision -> 'missingFields' <> '[]'::jsonb
    or v_target -> 'plannedEffects' <> v_expected_effects
    or v_target -> 'review' ->> 'verdict' <> 'approve'
    or v_target -> 'review' ->> 'reviewerAgent' <> 'pricetrace_independent_reviewer'
    or v_target -> 'review' ->> 'evidenceQuality' <> 'sufficient'
    or v_target -> 'review' -> 'conflicts' <> '[]'::jsonb
    or not exists (
      select 1 from pg_catalog.jsonb_array_elements(v_target -> 'evidence') as evidence(item)
      where evidence.item ->> 'sourceType' = 'receipt'
        and evidence.item ->> 'authority' = 'transactional'
        and evidence.item ->> 'sourceId' = v_receipt_source_id
    )
    or not exists (
      select 1 from pg_catalog.jsonb_array_elements(v_target -> 'evidence') as evidence(item)
      where evidence.item ->> 'sourceType' = 'official_channel'
        and evidence.item ->> 'authority' = 'primary'
        and evidence.item ->> 'sourceId' = v_official_source_id
    )
  then
    raise exception 'The independently reviewed target does not match the requested effects.'
      using errcode = '23514';
  end if;

  if v_representative_image ->> 'scope' <> 'standard_product_family'
    or v_representative_image ->> 'sourceType' <> 'external_url'
    or v_representative_image ->> 'imageUrl' <> v_official -> 'image' ->> 'url'
    or v_representative_image ->> 'contentHash' <> v_official -> 'image' ->> 'contentHash'
    or v_representative_image ->> 'mediaType' <> v_official -> 'image' ->> 'mediaType'
    or (v_representative_image ->> 'byteLength')::integer
      <> (v_official -> 'image' ->> 'byteLength')::integer
    or coalesce(v_representative_image ->> 'imageUrl', '') !~ '^https://'
  then
    raise exception 'The representative image does not match the frozen official image.'
      using errcode = '23514';
  end if;

  select pg_catalog.string_agg(effect.value, ',' order by effect.ordinality)
  into v_effect_text
  from pg_catalog.jsonb_array_elements_text(v_expected_effects)
    with ordinality as effect(value, ordinality);
  v_expected_approval_statement := '영수증 '
    || (v_receipt ->> 'sourceLabel') || '/' || (v_receipt ->> 'sourceProductCode')
    || ' · 공식 ' || (v_official ->> 'channelId') || '/'
    || (v_official ->> 'sourceProductCodeNamespace') || ':'
    || (v_official ->> 'sourceProductCode')
    || ' · ' || btrim(p_brand_name) || ' ' || btrim(p_standard_name)
    || ' / ' || btrim(p_listing_name)
    || ' · ' || v_effect_text || ' 연결을 승인합니다. [' || p_target_fingerprint || ']';
  if p_approval_statement <> v_expected_approval_statement then
    raise exception 'An explicit item-specific approval statement is required.'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('standard-link-approval:' || p_target_fingerprint, 0)
  );
  select * into v_approval
  from public.standard_product_link_approvals as approval
  where approval.target_fingerprint = p_target_fingerprint
  for update;
  if found then
    if v_approval.case_id <> btrim(p_case_id)
      or v_approval.input_fingerprint <> p_input_fingerprint
      or v_approval.proposal_input <> v_input
      or v_approval.proposal_target <> v_target
      or v_approval.approved_by <> v_user_id
      or v_approval.user_approval_text is distinct from p_approval_statement
    then
      raise exception 'The target fingerprint belongs to another approval.'
        using errcode = '23505';
    end if;
    v_approval_id := v_approval.id;
  else
    insert into public.standard_product_link_approvals (
      case_id, input_fingerprint, target_fingerprint, approval_statement,
      approval_policy, proposal_input, proposal_target, approved_by,
      user_approval_text
    ) values (
      btrim(p_case_id), p_input_fingerprint, p_target_fingerprint,
      p_approval_statement, 'authenticated_admin_explicit_second_step',
      v_input, v_target, v_user_id, p_approval_statement
    ) returning id into v_approval_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('standard-link-execution:' || btrim(p_idempotency_key), 0)
  );
  select * into v_execution
  from public.standard_product_link_executions as execution
  where execution.idempotency_key = btrim(p_idempotency_key)
  for update;
  if found then
    if v_execution.case_id <> btrim(p_case_id)
      or v_execution.input_fingerprint <> p_input_fingerprint
      or v_execution.target_fingerprint <> p_target_fingerprint
      or v_execution.proposal_input <> v_input
      or v_execution.proposal_target <> v_target
      or v_execution.status <> 'applied'
      or v_execution.standard_product_id is null
      or v_execution.catalog_product_id is null
      or v_approval.consumed_execution_id is distinct from v_execution.id
    then
      raise exception 'The previous execution has no matching applied result.'
        using errcode = '40001';
    end if;
    return query select v_execution.id, v_execution.standard_product_id,
      v_execution.catalog_product_id, true;
    return;
  end if;

  insert into public.standard_product_link_executions (
    idempotency_key, case_id, input_fingerprint, target_fingerprint, status,
    proposal_input, proposal_target, created_by
  ) values (
    btrim(p_idempotency_key), btrim(p_case_id), p_input_fingerprint,
    p_target_fingerprint, 'in_progress', v_input, v_target, v_user_id
  ) returning id into v_execution_id;

  if length(v_normalized_brand_name) > 0 then
    select candidate.brand_id into v_brand_id
    from (
      select brand.id as brand_id, 0 as priority from public.brands as brand
      where brand.normalized_name = v_normalized_brand_name
      union all
      select alias.brand_id, 1 as priority from public.brand_aliases as alias
      where alias.normalized_alias = v_normalized_brand_name
    ) as candidate order by candidate.priority limit 1;
    if v_brand_id is null then
      insert into public.brands (canonical_name, created_by)
      values (btrim(p_brand_name), v_user_id) returning id into v_brand_id;
    else
      select brand.status into v_brand_status from public.brands as brand
      where brand.id = v_brand_id for update;
      if v_brand_status <> 'active' then
        raise exception 'The matching brand is not active.' using errcode = '23514';
      end if;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('standard-link-family:' || v_normalized_standard_name, 0)
  );
  if v_standard_product_id is null then
    select standard.id into v_collision_id from public.standard_products as standard
    where standard.purchase_type = 'retail_product'
      and pg_catalog.regexp_replace(standard.canonical_name, '[[:space:]]+', '', 'g')
        = v_normalized_standard_name
    order by standard.created_at, standard.id limit 1 for update;
    if v_collision_id is not null then
      raise exception 'A whitespace-equivalent standard product already exists.'
        using errcode = '23505';
    end if;
    insert into public.standard_products (
      purchase_type, canonical_name, brand_id, product_reference_url, created_by
    ) values (
      'retail_product', btrim(p_standard_name), v_brand_id,
      p_product_reference_url, v_user_id
    ) returning id into v_standard_product_id;
  else
    select standard.canonical_name, standard.brand_id
    into v_existing_standard_name, v_existing_standard_brand_id
    from public.standard_products as standard
    where standard.id = v_standard_product_id
      and standard.purchase_type = 'retail_product'
      and standard.status = 'active' for update;
    if not found
      or pg_catalog.regexp_replace(v_existing_standard_name, '[[:space:]]+', '', 'g')
        <> v_normalized_standard_name
      or (v_existing_standard_brand_id is not null and v_brand_id is not null
        and v_existing_standard_brand_id <> v_brand_id)
    then
      raise exception 'The expected standard product changed.' using errcode = '23514';
    end if;
    if v_brand_id is null then
      v_brand_id := v_existing_standard_brand_id;
    elsif v_existing_standard_brand_id is null then
      update public.standard_products set brand_id = v_brand_id, updated_at = v_observed_at
      where id = v_standard_product_id;
    end if;
  end if;

  if v_catalog_product_id is null then
    select catalog.id into v_collision_id from public.catalog_products as catalog
    where catalog.standard_product_id = v_standard_product_id
      and catalog.purchase_type = 'retail_product'
      and pg_catalog.regexp_replace(catalog.canonical_name, '[[:space:]]+', '', 'g')
        = v_normalized_listing_name
    order by catalog.created_at, catalog.id limit 1 for update;
    if v_collision_id is not null then
      raise exception 'A whitespace-equivalent catalog variant already exists.'
        using errcode = '23505';
    end if;
    insert into public.catalog_products (
      standard_product_id, purchase_type, canonical_name, specification,
      specification_status, content_amount, content_unit, package_count,
      reference_unit, attributes, listing_reference_url, created_by
    ) values (
      v_standard_product_id, 'retail_product', btrim(p_listing_name),
      btrim(p_specification), p_specification_status, p_content_amount,
      p_content_unit, p_package_count, p_reference_unit,
      case when p_apparel_size is null then '{}'::jsonb
        else pg_catalog.jsonb_build_object('apparelSize', p_apparel_size) end,
      p_product_reference_url, v_user_id
    ) returning id into v_catalog_product_id;
  else
    select * into v_existing_catalog from public.catalog_products as catalog
    where catalog.id = v_catalog_product_id
      and catalog.purchase_type = 'retail_product' for update;
    if not found or v_existing_catalog.status <> 'active'
      or v_existing_catalog.standard_product_id <> v_standard_product_id
      or pg_catalog.regexp_replace(v_existing_catalog.canonical_name, '[[:space:]]+', '', 'g')
        <> v_normalized_listing_name
      or v_existing_catalog.specification is distinct from btrim(p_specification)
      or v_existing_catalog.specification_status <> p_specification_status
      or v_existing_catalog.content_amount is distinct from p_content_amount
      or v_existing_catalog.content_unit is distinct from p_content_unit
      or v_existing_catalog.package_count <> p_package_count
      or v_existing_catalog.reference_unit <> p_reference_unit
      or v_existing_catalog.attributes -> 'apparelSize' is distinct from p_apparel_size
    then
      raise exception 'The expected catalog variant changed.' using errcode = '23514';
    end if;
  end if;

  for v_source_label in select distinct btrim(source.source_label)
    from pg_catalog.unnest(p_source_labels) as source(source_label)
    where length(btrim(source.source_label)) > 0 order by btrim(source.source_label)
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'standard-link-source:' || v_source_label || ':' || btrim(p_source_product_code), 0
    ));
    v_mapping_id := null;
    select mapping.id, mapping.catalog_product_id
    into v_mapping_id, v_mapping_catalog_product_id
    from public.source_product_mappings as mapping
    where mapping.source_label = v_source_label
      and mapping.source_product_code = btrim(p_source_product_code) for update;
    if v_mapping_id is not null and v_mapping_catalog_product_id <> v_catalog_product_id then
      raise exception 'The source identity is already mapped to another catalog variant.'
        using errcode = '23505';
    elsif v_mapping_id is null then
      insert into public.source_product_mappings (
        source_label, source_product_code, catalog_product_id, matching_method,
        confidence, review_status, created_by, reviewed_by, reviewed_at
      ) values (
        v_source_label, btrim(p_source_product_code), v_catalog_product_id,
        'manual', 1, 'verified', v_user_id, v_user_id, v_observed_at
      );
    else
      update public.source_product_mappings set matching_method = 'manual',
        confidence = 1, review_status = 'verified', reviewed_by = v_user_id,
        reviewed_at = v_observed_at, updated_at = v_observed_at
      where id = v_mapping_id;
    end if;
  end loop;

  if length(public.normalize_brand_name(p_receipt_brand_name)) > 0 then
    insert into public.standard_product_brand_evidence (
      standard_product_id, catalog_product_id, brand_id, observed_name,
      source_type, source_label, source_product_code, observed_at, created_by
    ) select v_standard_product_id, v_catalog_product_id, v_brand_id,
      btrim(p_receipt_brand_name), 'receipt', source.source_label,
      btrim(p_source_product_code), v_observed_at, v_user_id
    from (select distinct btrim(raw.source_label) as source_label
      from pg_catalog.unnest(p_source_labels) as raw(source_label)
      where length(btrim(raw.source_label)) > 0) as source
    on conflict do nothing;
  end if;
  insert into public.standard_product_brand_evidence (
    standard_product_id, catalog_product_id, brand_id, observed_name,
    source_type, source_label, source_url, observed_at, created_by
  ) values (
    v_standard_product_id, v_catalog_product_id, v_brand_id,
    btrim(p_official_brand_name), 'official_store',
    btrim(p_official_brand_source_label), p_product_reference_url,
    v_observed_at, v_user_id
  ) on conflict do nothing;

  select link.id, link.catalog_product_id
  into v_official_link_id, v_existing_official_catalog_id
  from public.standard_product_official_links as link
  where link.channel_id = v_official ->> 'channelId'
    and link.source_product_code_namespace = v_official ->> 'sourceProductCodeNamespace'
    and link.source_product_code = v_official ->> 'sourceProductCode' for update;
  if v_official_link_id is null then
    insert into public.standard_product_official_links (
      channel_id, source_product_code_namespace, source_product_code,
      catalog_product_id, created_by
    ) values (
      v_official ->> 'channelId', v_official ->> 'sourceProductCodeNamespace',
      v_official ->> 'sourceProductCode', v_catalog_product_id, v_user_id
    ) returning id into v_official_link_id;
  elsif v_existing_official_catalog_id <> v_catalog_product_id then
    raise exception 'The official listing is already linked to another catalog variant.'
      using errcode = '23505';
  end if;
  insert into public.standard_product_official_link_evidence (
    official_link_id, snapshot_id, snapshot_hash, source_name_raw,
    specification_text_raw, source_refs, product_reference_url,
    link_execution_id, created_by
  ) values (
    v_official_link_id, (v_official ->> 'snapshotId')::uuid,
    v_official ->> 'snapshotHash', v_official ->> 'sourceNameRaw',
    v_official ->> 'specificationTextRaw', v_official -> 'sourceRefs',
    p_product_reference_url, v_execution_id, v_user_id
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'standard-representative-image:' || v_standard_product_id::text, 0
  ));
  select image.* into v_existing_image from public.standard_product_images as image
  where image.standard_product_id = v_standard_product_id for update;
  if v_existing_image.standard_product_id is null then
    if v_representative_image ->> 'action' <> 'create'
      or v_representative_image -> 'expectedCurrent' <> 'null'::jsonb
    then
      raise exception 'The expected representative image does not exist.'
        using errcode = '23505';
    end if;
    insert into public.standard_product_images (
      standard_product_id, source_type, image_url, created_by
    ) values (
      v_standard_product_id, 'external_url',
      v_representative_image ->> 'imageUrl', v_user_id
    );
  elsif v_representative_image ->> 'action' <> 'reuse_exact'
    or v_existing_image.source_type <> 'external_url'
    or v_existing_image.image_url <> v_representative_image ->> 'imageUrl'
    or v_representative_image -> 'expectedCurrent' ->> 'imageUrl'
      <> v_existing_image.image_url
  then
    raise exception 'A different representative image already exists.'
      using errcode = '23505';
  end if;
  v_image_result := pg_catalog.jsonb_build_object(
    'scope', 'standard_product_family', 'sourceType', 'external_url',
    'imageUrl', v_representative_image ->> 'imageUrl',
    'contentHash', v_representative_image ->> 'contentHash',
    'mediaType', v_representative_image ->> 'mediaType',
    'byteLength', (v_representative_image ->> 'byteLength')::integer,
    'appliedAction', case when v_representative_image ->> 'action' = 'create'
      then 'created' else 'reused_exact' end
  );

  update public.standard_product_link_executions set status = 'applied',
    standard_product_id = v_standard_product_id,
    catalog_product_id = v_catalog_product_id,
    result = pg_catalog.jsonb_build_object(
      'brandId', v_brand_id, 'standardProductId', v_standard_product_id,
      'catalogProductId', v_catalog_product_id,
      'representativeImage', v_image_result,
      'executionMode', 'link_only_v1'
    ), applied_at = v_observed_at
  where id = v_execution_id;
  update public.standard_product_link_approvals set
    consumed_execution_id = v_execution_id,
    consumed_at = coalesce(consumed_at, v_observed_at)
  where id = v_approval_id and consumed_execution_id is null;
  if not found then
    raise exception 'The approval was consumed by another execution.' using errcode = '40001';
  end if;

  return query select v_execution_id, v_standard_product_id,
    v_catalog_product_id, false;
end;
$function$;

comment on function public.approve_and_register_standard_product_link_only_v1(
  text, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  numeric, text, integer, integer, text, text[], text, jsonb
) is
  'Atomically approves and links one frozen receipt and official listing without creating a Coupang observation; optional apparel size is stored separately from quantity.';

revoke all on function public.approve_and_register_standard_product_link_only_v1(
  text, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  numeric, text, integer, integer, text, text[], text, jsonb
) from public, anon, authenticated;

grant execute on function public.approve_and_register_standard_product_link_only_v1(
  text, text, text, text, text, text, text, text, text, timestamptz,
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  numeric, text, integer, integer, text, text[], text, jsonb
) to authenticated;
