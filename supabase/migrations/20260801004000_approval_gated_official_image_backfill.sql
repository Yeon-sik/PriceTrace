-- Add an approval-gated image-only path for an already linked standard product.
-- This path never replays family, variant, receipt-mapping, official-link, or
-- Coupang effects and never overwrites a different representative image.

create table public.standard_product_official_image_approvals (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) > 0),
  case_id text not null check (length(btrim(case_id)) > 0),
  input_fingerprint text not null check (input_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  target_fingerprint text not null unique check (target_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  approval_statement text not null check (length(btrim(approval_statement)) > 0),
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
  standard_product_id uuid not null references public.standard_products(id) on delete restrict,
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  official_link_id uuid not null references public.standard_product_official_links(id) on delete restrict,
  image_url text not null check (image_url ~ '^https://'),
  content_hash text not null check (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  media_type text not null check (media_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_length integer not null check (byte_length > 0),
  applied_action text not null check (applied_action in ('created', 'reused_exact')),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now()
);

alter table public.standard_product_official_image_approvals enable row level security;

grant select on public.standard_product_official_image_approvals to authenticated;

create policy "admins read official image approvals"
  on public.standard_product_official_image_approvals for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create function public.approve_standard_product_official_image_v1(
  p_idempotency_key text,
  p_proposal_canonical_json text,
  p_approval_statement text,
  p_standard_product_id uuid,
  p_catalog_product_id uuid
)
returns table (
  approval_id uuid,
  standard_product_id uuid,
  catalog_product_id uuid,
  replayed boolean,
  applied_action text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_proposal jsonb;
  v_receipt jsonb;
  v_official jsonb;
  v_rule jsonb;
  v_identity jsonb;
  v_decision jsonb;
  v_image jsonb;
  v_representative_image jsonb;
  v_review jsonb;
  v_input jsonb;
  v_target jsonb;
  v_input_text text;
  v_target_text text;
  v_input_fingerprint text;
  v_target_fingerprint text;
  v_expected_approval_statement text;
  v_effect_text text;
  v_official_source_id text;
  v_official_evidence jsonb;
  v_official_link_id uuid;
  v_existing_image public.standard_product_images%rowtype;
  v_existing_approval public.standard_product_official_image_approvals%rowtype;
  v_applied_action text;
  v_expected_result jsonb;
  v_result jsonb;
  v_approval_id uuid;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  begin
    v_proposal := p_proposal_canonical_json::jsonb;
  exception
    when others then
      raise exception 'Canonical LinkProposal JSON is invalid.'
        using errcode = '22023';
  end;

  if public.canonical_jsonb_text(v_proposal) <> p_proposal_canonical_json
  then
    raise exception 'LinkProposal JSON is not canonical.'
      using errcode = '23514';
  end if;

  v_receipt := v_proposal -> 'receipt';
  v_official := v_proposal -> 'officialListing';
  v_rule := v_proposal -> 'sameChannelNameRule';
  v_identity := v_proposal -> 'normalizedIdentity';
  v_decision := v_proposal -> 'decision';
  v_image := v_official -> 'image';
  v_representative_image := v_proposal -> 'representativeImage';
  v_review := v_proposal -> 'review';

  v_input := pg_catalog.jsonb_build_object(
    'receipt', v_receipt,
    'officialListing', v_official
  );
  v_input_text := public.canonical_jsonb_text(v_input);
  v_input_fingerprint := 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_input_text, 'UTF8'), 'sha256'),
    'hex'
  );

  v_target := pg_catalog.jsonb_build_object(
    'caseId', v_proposal -> 'caseId',
    'inputFingerprint', pg_catalog.to_jsonb(v_input_fingerprint),
    'sameChannelNameRule', v_rule,
    'normalizedIdentity', v_identity,
    'decision', v_decision,
    'coupangOffer', v_proposal -> 'coupangOffer',
    'representativeImage', v_representative_image,
    'plannedEffects', v_proposal -> 'plannedEffects'
  );
  v_target_text := public.canonical_jsonb_text(v_target);
  v_target_fingerprint := 'sha256:' || pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_target_text, 'UTF8'), 'sha256'),
    'hex'
  );

  if coalesce(v_proposal ->> 'schemaVersion', '') <> 'pricetrace-link-proposal.v3'
    or coalesce(v_proposal ->> 'status', '') <> 'approved'
    or coalesce(v_proposal ->> 'inputFingerprint', '') <> v_input_fingerprint
    or coalesce(v_proposal -> 'approval' ->> 'status', '') <> 'approved'
    or coalesce(v_proposal -> 'approval' ->> 'approvalRef', '') = ''
    or coalesce(v_proposal -> 'approval' ->> 'userApprovalText', '') <> p_approval_statement
    or coalesce(v_proposal -> 'approval' ->> 'approvedAt', '') = ''
    or coalesce(v_proposal -> 'approval' ->> 'targetFingerprint', '') <> v_target_fingerprint
    or coalesce(v_proposal -> 'execution' ->> 'status', '') <> 'not_started'
  then
    raise exception 'A validated and explicitly approved LinkProposal is required.'
      using errcode = '42501';
  end if;

  if btrim(p_idempotency_key)
      <> 'standard-product-official-image:' || pg_catalog.substr(v_target_fingerprint, 8)
  then
    raise exception 'The image idempotency key must be derived from the target fingerprint.'
      using errcode = '23514';
  end if;

  select pg_catalog.string_agg(effect.value, ',' order by effect.ordinality)
  into v_effect_text
  from pg_catalog.jsonb_array_elements_text(v_proposal -> 'plannedEffects')
    with ordinality as effect(value, ordinality);

  v_expected_approval_statement :=
    '영수증 ' || btrim(v_receipt ->> 'sourceLabel') || '/'
    || btrim(v_receipt ->> 'sourceProductCode')
    || ' · 공식 ' || btrim(v_official ->> 'channelId') || '/'
    || btrim(v_official ->> 'sourceProductCodeNamespace') || ':'
    || btrim(v_official ->> 'sourceProductCode')
    || ' · ' || btrim(v_identity ->> 'brand') || ' '
    || btrim(v_identity ->> 'productFamilyName') || ' / '
    || btrim(v_identity ->> 'variantName')
    || ' · ' || v_effect_text
    || ' 연결을 승인합니다. [' || v_target_fingerprint || ']';

  if p_approval_statement is distinct from v_expected_approval_statement
  then
    raise exception 'The exact official-image approval statement is required.'
      using errcode = '42501';
  end if;

  if coalesce(v_receipt ->> 'receiptId', '') = ''
    or coalesce(v_receipt ->> 'receiptItemId', '') = ''
    or coalesce(v_receipt ->> 'receiptRevision', '') = ''
    or coalesce(v_receipt ->> 'sourceLabel', '') = ''
    or coalesce(v_receipt ->> 'sourceProductCode', '') = ''
    or coalesce(v_receipt ->> 'sourceNameRaw', '') = ''
    or coalesce(v_receipt ->> 'sourceCatalogNamespace', '')
      <> coalesce(v_official ->> 'channelId', '')
    or coalesce(v_official ->> 'sourceProductCodeNamespace', '') = ''
    or coalesce(v_official ->> 'sourceProductCode', '') = ''
    or coalesce(v_official ->> 'snapshotId', '')
      !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or coalesce(v_official ->> 'snapshotHash', '') !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(v_official ->> 'sourceNameRaw', '') = ''
    or coalesce(v_official ->> 'specificationTextRaw', '') = ''
    or coalesce(jsonb_typeof(v_official -> 'sourceRefs'), '') <> 'array'
    or jsonb_array_length(v_official -> 'sourceRefs') = 0
    or coalesce(v_rule ->> 'normalization', '') <> 'remove_unicode_whitespace_only'
    or coalesce((v_rule ->> 'sameChannel')::boolean, false) is not true
    or coalesce((v_rule ->> 'exactNameMatch')::boolean, false) is not true
    or coalesce(v_rule ->> 'outcome', '') <> 'apply_official_identity'
    or v_rule -> 'importedOfficialFields' is distinct from
      '["brand","contentAmount","contentUnit","packageCount"]'::jsonb
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> pg_catalog.regexp_replace(v_receipt ->> 'sourceNameRaw', '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedOfficialName', '')
      <> pg_catalog.regexp_replace(v_official ->> 'sourceNameRaw', '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> coalesce(v_rule ->> 'normalizedOfficialName', '')
  then
    raise exception 'Frozen receipt and official listing do not satisfy the exact-name rule.'
      using errcode = '23514';
  end if;

  if coalesce(v_decision ->> 'action', '') <> 'reuse_variant'
    or (v_decision ->> 'standardProductId') is distinct from p_standard_product_id::text
    or (v_decision ->> 'catalogProductId') is distinct from p_catalog_product_id::text
    or coalesce(v_decision ->> 'confidence', '') <> 'high'
    or coalesce(jsonb_typeof(v_decision -> 'matchedFields'), '') <> 'array'
    or jsonb_array_length(v_decision -> 'matchedFields') = 0
    or coalesce(jsonb_typeof(v_decision -> 'conflictingFields'), '') <> 'array'
    or v_decision -> 'conflictingFields' is distinct from '[]'::jsonb
    or coalesce(jsonb_typeof(v_decision -> 'missingFields'), '') <> 'array'
    or v_decision -> 'missingFields' is distinct from '[]'::jsonb
    or coalesce(jsonb_typeof(v_proposal -> 'coupangOffer'), '') <> 'null'
    or coalesce(jsonb_typeof(v_proposal -> 'plannedEffects'), '') <> 'array'
    or v_proposal -> 'plannedEffects' is distinct from '[
      "reuse_standard_family",
      "reuse_catalog_variant",
      "update_representative_image"
    ]'::jsonb
    or coalesce(v_review ->> 'verdict', '') <> 'approve'
    or coalesce(v_review ->> 'reviewerAgent', '') <> 'pricetrace_independent_reviewer'
    or coalesce(v_review ->> 'evidenceQuality', '') <> 'sufficient'
    or coalesce(jsonb_typeof(v_review -> 'conflicts'), '') <> 'array'
    or v_review -> 'conflicts' is distinct from '[]'::jsonb
  then
    raise exception 'The proposal is not an independently approved image-only reuse target.'
      using errcode = '23514';
  end if;

  if coalesce(v_representative_image ->> 'scope', '') <> 'standard_product_family'
    or coalesce(v_representative_image ->> 'action', '') not in ('create', 'reuse_exact')
    or coalesce(v_representative_image ->> 'sourceType', '') <> 'external_url'
    or coalesce(v_image ->> 'url', '') !~ '^https://'
    or coalesce(v_image ->> 'contentHash', '') !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(v_image ->> 'mediaType', '') not in ('image/jpeg', 'image/png', 'image/webp')
    or coalesce((v_image ->> 'byteLength')::integer, 0) <= 0
    or v_representative_image ->> 'imageUrl' is distinct from v_image ->> 'url'
    or v_representative_image ->> 'contentHash' is distinct from v_image ->> 'contentHash'
    or v_representative_image ->> 'mediaType' is distinct from v_image ->> 'mediaType'
    or (v_representative_image ->> 'byteLength')::integer
      is distinct from (v_image ->> 'byteLength')::integer
    or (
      v_representative_image ->> 'action' = 'create'
      and jsonb_typeof(v_representative_image -> 'expectedCurrent')
        is distinct from 'null'
    )
    or (
      v_representative_image ->> 'action' = 'reuse_exact'
      and (
        coalesce(v_representative_image -> 'expectedCurrent' ->> 'sourceType', '')
          <> 'external_url'
        or v_representative_image -> 'expectedCurrent' ->> 'imageUrl'
          is distinct from v_image ->> 'url'
      )
    )
  then
    raise exception 'The frozen official representative-image target is invalid.'
      using errcode = '23514';
  end if;

  v_expected_result := pg_catalog.jsonb_build_object(
    'scope', 'standard_product_family',
    'sourceType', 'external_url',
    'imageUrl', v_image ->> 'url',
    'contentHash', v_image ->> 'contentHash',
    'mediaType', v_image ->> 'mediaType',
    'byteLength', (v_image ->> 'byteLength')::integer,
    'appliedAction', case
      when v_representative_image ->> 'action' = 'create'
        then 'created'
      else 'reused_exact'
    end
  );

  v_official_source_id := btrim(v_official ->> 'channelId') || ':'
    || btrim(v_official ->> 'sourceProductCodeNamespace') || ':'
    || btrim(v_official ->> 'sourceProductCode');

  select evidence.item
  into v_official_evidence
  from pg_catalog.jsonb_array_elements(v_proposal -> 'evidence') as evidence(item)
  where evidence.item ->> 'sourceType' = 'official_channel'
    and evidence.item ->> 'authority' = 'primary'
    and evidence.item ->> 'sourceId' = v_official_source_id
    and coalesce(evidence.item ->> 'url', '') ~ '^https?://'
    and coalesce(jsonb_typeof(evidence.item -> 'claims'), '') = 'array'
    and jsonb_array_length(evidence.item -> 'claims') > 0
    and coalesce(jsonb_typeof(evidence.item -> 'sourceRefs'), '') = 'array'
    and evidence.item -> 'sourceRefs' ?| array(
      select source_ref.value
      from pg_catalog.jsonb_array_elements_text(v_official -> 'sourceRefs')
        as source_ref(value)
    )
  limit 1;

  if v_official_evidence is null
    or not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_proposal -> 'evidence') as evidence(item)
      where evidence.item ->> 'sourceType' = 'receipt'
        and evidence.item ->> 'authority' = 'transactional'
        and evidence.item ->> 'sourceId' = btrim(v_receipt ->> 'receiptId')
          || ':' || btrim(v_receipt ->> 'receiptItemId')
        and coalesce(jsonb_typeof(evidence.item -> 'claims'), '') = 'array'
        and jsonb_array_length(evidence.item -> 'claims') > 0
        and coalesce(jsonb_typeof(evidence.item -> 'sourceRefs'), '') = 'array'
        and jsonb_array_length(evidence.item -> 'sourceRefs') > 0
    )
  then
    raise exception 'Receipt and primary official evidence are required.'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'standard-official-image-approval:' || v_target_fingerprint,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'standard-representative-image:' || p_standard_product_id::text,
      0
    )
  );

  perform 1
  from public.standard_products as standard
  inner join public.brands as brand on brand.id = standard.brand_id
  inner join public.catalog_products as catalog
    on catalog.standard_product_id = standard.id
  where standard.id = p_standard_product_id
    and standard.status = 'active'
    and catalog.id = p_catalog_product_id
    and catalog.status = 'active'
    and standard.canonical_name = v_identity ->> 'productFamilyName'
    and catalog.canonical_name = v_identity ->> 'variantName'
    and brand.status = 'active'
    and brand.normalized_name = public.normalize_brand_name(v_identity ->> 'brand')
    and catalog.content_amount is not distinct from (v_identity ->> 'contentAmount')::numeric
    and catalog.content_unit = v_identity ->> 'contentUnit'
    and catalog.package_count is not distinct from (v_identity ->> 'packageCount')::integer
  for share of standard, brand, catalog;

  if not found
  then
    raise exception 'The approved family, variant, or brand changed.'
      using errcode = '40001';
  end if;

  perform 1
  from public.source_product_mappings as mapping
  where mapping.source_label = btrim(v_receipt ->> 'sourceLabel')
    and mapping.source_product_code = btrim(v_receipt ->> 'sourceProductCode')
    and mapping.catalog_product_id = p_catalog_product_id
    and mapping.review_status = 'verified'
  for share of mapping;

  if not found
  then
    raise exception 'The approved receipt mapping changed.'
      using errcode = '40001';
  end if;

  select link.id
  into v_official_link_id
  from public.standard_product_official_links as link
  where link.channel_id = btrim(v_official ->> 'channelId')
    and link.source_product_code_namespace = btrim(v_official ->> 'sourceProductCodeNamespace')
    and link.source_product_code = btrim(v_official ->> 'sourceProductCode')
    and link.catalog_product_id = p_catalog_product_id
  for share of link;

  if v_official_link_id is null
  then
    raise exception 'The approved official link changed.'
      using errcode = '40001';
  end if;

  perform 1
  from public.standard_product_official_link_evidence as evidence
  where evidence.official_link_id = v_official_link_id
    and evidence.snapshot_id = (v_official ->> 'snapshotId')::uuid
    and evidence.snapshot_hash = v_official ->> 'snapshotHash'
    and evidence.source_name_raw = v_official ->> 'sourceNameRaw'
    and evidence.specification_text_raw = v_official ->> 'specificationTextRaw'
    and evidence.source_refs @> (v_official -> 'sourceRefs')
    and evidence.product_reference_url = v_official_evidence ->> 'url'
  for share of evidence;

  if not found
  then
    raise exception 'The approved official snapshot evidence changed.'
      using errcode = '40001';
  end if;

  select approval.*
  into v_existing_approval
  from public.standard_product_official_image_approvals as approval
  where approval.target_fingerprint = v_target_fingerprint
  for update;

  if not found
  then
    select approval.*
    into v_existing_approval
    from public.standard_product_official_image_approvals as approval
    where approval.idempotency_key = btrim(p_idempotency_key)
    for update;
  end if;

  if found
  then
    if v_existing_approval.idempotency_key <> btrim(p_idempotency_key)
      or v_existing_approval.case_id <> btrim(v_proposal ->> 'caseId')
      or v_existing_approval.input_fingerprint <> v_input_fingerprint
      or v_existing_approval.target_fingerprint <> v_target_fingerprint
      or v_existing_approval.approval_statement <> p_approval_statement
      or v_existing_approval.proposal <> v_proposal
      or v_existing_approval.standard_product_id <> p_standard_product_id
      or v_existing_approval.catalog_product_id <> p_catalog_product_id
      or v_existing_approval.official_link_id <> v_official_link_id
      or v_existing_approval.image_url <> v_image ->> 'url'
      or v_existing_approval.content_hash <> v_image ->> 'contentHash'
      or v_existing_approval.media_type <> v_image ->> 'mediaType'
      or v_existing_approval.byte_length <> (v_image ->> 'byteLength')::integer
      or v_existing_approval.applied_action <> v_expected_result ->> 'appliedAction'
      or v_existing_approval.result is distinct from v_expected_result
      or v_existing_approval.approved_by <> v_user_id
    then
      raise exception 'The image idempotency key or fingerprint belongs to another approval.'
        using errcode = '23505';
    end if;

    if not exists (
      select 1
      from public.standard_product_images as image
      where image.standard_product_id = p_standard_product_id
        and image.source_type = 'external_url'
        and image.image_url = v_image ->> 'url'
    )
    then
      raise exception 'The replayed official image no longer matches its approved result.'
        using errcode = '40001';
    end if;

    return query
    select
      v_existing_approval.id,
      v_existing_approval.standard_product_id,
      v_existing_approval.catalog_product_id,
      true,
      v_existing_approval.applied_action;
    return;
  end if;

  select image.*
  into v_existing_image
  from public.standard_product_images as image
  where image.standard_product_id = p_standard_product_id
  for update;

  if v_existing_image.standard_product_id is null
  then
    if v_representative_image ->> 'action' <> 'create'
    then
      raise exception 'The expected representative image does not exist.'
        using errcode = '23505';
    end if;

    insert into public.standard_product_images (
      standard_product_id,
      source_type,
      image_url,
      created_by
    )
    values (
      p_standard_product_id,
      'external_url',
      v_image ->> 'url',
      v_user_id
    );
    v_applied_action := 'created';
  else
    if v_representative_image ->> 'action' <> 'reuse_exact'
      or v_existing_image.source_type <> 'external_url'
      or v_existing_image.image_url <> v_image ->> 'url'
    then
      raise exception 'A different representative image exists; overwrite is not allowed.'
        using errcode = '23505';
    end if;
    v_applied_action := 'reused_exact';
  end if;

  v_result := v_expected_result;

  insert into public.standard_product_official_image_approvals (
    idempotency_key,
    case_id,
    input_fingerprint,
    target_fingerprint,
    approval_statement,
    proposal,
    standard_product_id,
    catalog_product_id,
    official_link_id,
    image_url,
    content_hash,
    media_type,
    byte_length,
    applied_action,
    result,
    approved_by
  )
  values (
    btrim(p_idempotency_key),
    btrim(v_proposal ->> 'caseId'),
    v_input_fingerprint,
    v_target_fingerprint,
    p_approval_statement,
    v_proposal,
    p_standard_product_id,
    p_catalog_product_id,
    v_official_link_id,
    v_image ->> 'url',
    v_image ->> 'contentHash',
    v_image ->> 'mediaType',
    (v_image ->> 'byteLength')::integer,
    v_applied_action,
    v_result,
    v_user_id
  )
  returning id into v_approval_id;

  return query
  select
    v_approval_id,
    p_standard_product_id,
    p_catalog_product_id,
    false,
    v_applied_action;
end;
$$;

comment on table public.standard_product_official_image_approvals is
  'Item-specific approval ledger for image-only official representative-image creation or exact reuse.';

comment on function public.approve_standard_product_official_image_v1(
  text, text, text, uuid, uuid
) is
  'Applies an approved official image to an already linked family without replaying catalog, mapping, official-link, or Coupang writes and without overwriting.';

revoke all on function public.approve_standard_product_official_image_v1(
  text, text, text, uuid, uuid
) from public;

grant execute on function public.approve_standard_product_official_image_v1(
  text, text, text, uuid, uuid
) to authenticated;

revoke insert, update, delete
  on public.standard_product_official_image_approvals
  from anon, authenticated;
