-- Run in the linked project's SQL editor after migrations 030 and 040.
-- All fixture and probe writes are rolled back.
begin;

grant execute on function public.canonical_jsonb_text(jsonb) to authenticated;

create temporary table official_image_probe_fixture (
  admin_user_id uuid not null,
  brand_id uuid not null,
  standard_product_id uuid not null,
  catalog_product_id uuid not null,
  official_link_id uuid not null,
  receipt_source_label text not null,
  receipt_source_code text not null,
  official_source_code text not null,
  product_name text not null,
  official_reference_url text not null
);

do $$
declare
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_admin_user_id uuid;
  v_brand_id uuid;
  v_standard_product_id uuid;
  v_catalog_product_id uuid;
  v_execution_id uuid;
  v_official_link_id uuid;
  v_product_name text := '__official_image_probe_' || v_suffix;
  v_receipt_source_label text := '__official_image_probe_store';
  v_receipt_source_code text := 'receipt-' || v_suffix;
  v_official_source_code text := 'official-' || v_suffix;
  v_official_reference_url text := 'https://example.com/official/' || v_suffix;
begin
  select id
  into v_admin_user_id
  from auth.users
  where coalesce(raw_app_meta_data ->> 'role', '') = 'admin'
  order by created_at
  limit 1;

  if v_admin_user_id is null
  then
    raise exception 'The official image probe requires an admin user.';
  end if;

  insert into public.brands (canonical_name, created_by)
  values ('__official_image_probe_brand_' || v_suffix, v_admin_user_id)
  returning id into v_brand_id;

  insert into public.standard_products (
    purchase_type,
    canonical_name,
    brand_id,
    brand,
    product_reference_url,
    created_by
  )
  values (
    'retail_product',
    v_product_name,
    v_brand_id,
    '__official_image_probe_brand_' || v_suffix,
    v_official_reference_url,
    v_admin_user_id
  )
  returning id into v_standard_product_id;

  insert into public.catalog_products (
    standard_product_id,
    purchase_type,
    canonical_name,
    brand,
    specification,
    specification_status,
    content_amount,
    content_unit,
    package_count,
    reference_unit,
    listing_reference_url,
    created_by
  )
  values (
    v_standard_product_id,
    'retail_product',
    v_product_name,
    '__official_image_probe_brand_' || v_suffix,
    '52g',
    'verified',
    52,
    'g',
    1,
    100,
    v_official_reference_url,
    v_admin_user_id
  )
  returning id into v_catalog_product_id;

  insert into public.source_product_mappings (
    source_label,
    source_product_code,
    catalog_product_id,
    matching_method,
    confidence,
    review_status,
    created_by,
    reviewed_by,
    reviewed_at
  )
  values (
    v_receipt_source_label,
    v_receipt_source_code,
    v_catalog_product_id,
    'manual',
    1,
    'verified',
    v_admin_user_id,
    v_admin_user_id,
    now()
  );

  insert into public.standard_product_link_executions (
    idempotency_key,
    case_id,
    input_fingerprint,
    target_fingerprint,
    status,
    standard_product_id,
    catalog_product_id,
    result,
    created_by,
    applied_at
  )
  values (
    '__official_image_probe_execution:' || v_suffix,
    '__official_image_probe_case:' || v_suffix,
    'sha256:' || repeat('1', 64),
    'sha256:' || repeat('2', 64),
    'applied',
    v_standard_product_id,
    v_catalog_product_id,
    '{}'::jsonb,
    v_admin_user_id,
    now()
  )
  returning id into v_execution_id;

  insert into public.standard_product_official_links (
    channel_id,
    source_product_code_namespace,
    source_product_code,
    catalog_product_id,
    created_by
  )
  values (
    '__official_image_probe_channel',
    '__official_image_probe_namespace',
    v_official_source_code,
    v_catalog_product_id,
    v_admin_user_id
  )
  returning id into v_official_link_id;

  insert into public.standard_product_official_link_evidence (
    official_link_id,
    snapshot_id,
    snapshot_hash,
    source_name_raw,
    specification_text_raw,
    source_refs,
    product_reference_url,
    link_execution_id,
    created_by
  )
  values (
    v_official_link_id,
    '33333333-3333-4333-8333-333333333333',
    'sha256:' || repeat('3', 64),
    v_product_name,
    '52g',
    '["private-source","official-source"]'::jsonb,
    v_official_reference_url,
    v_execution_id,
    v_admin_user_id
  );

  insert into pg_temp.official_image_probe_fixture
  values (
    v_admin_user_id,
    v_brand_id,
    v_standard_product_id,
    v_catalog_product_id,
    v_official_link_id,
    v_receipt_source_label,
    v_receipt_source_code,
    v_official_source_code,
    v_product_name,
    v_official_reference_url
  );
end;
$$;

create function pg_temp.delete_official_image_probe_mapping()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.source_product_mappings as mapping
  using pg_temp.official_image_probe_fixture as fixture
  where mapping.source_label = fixture.receipt_source_label
    and mapping.source_product_code = fixture.receipt_source_code;
$$;

create function pg_temp.replace_official_image_probe_with_upload()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_standard_product_id uuid;
begin
  select standard_product_id
  into v_standard_product_id
  from pg_temp.official_image_probe_fixture;

  update public.standard_product_images
  set
    source_type = 'upload',
    image_url = 'https://example.com/uploaded.webp',
    storage_path = 'official-image-probe/uploaded.webp',
    mime_type = 'image/webp',
    file_size_bytes = 1234,
    width = 100,
    height = 100
  where standard_product_id = v_standard_product_id;
end;
$$;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', fixture.admin_user_id,
    'role', 'authenticated',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'admin')
  )::text,
  true
)
from pg_temp.official_image_probe_fixture as fixture;

create function pg_temp.run_official_image_probe(
  p_case_id text,
  p_image_url text,
  p_image_action text default 'create',
  p_approval_override text default null,
  p_remove_planned_effects boolean default false
)
returns table (
  approval_id uuid,
  standard_product_id uuid,
  catalog_product_id uuid,
  replayed boolean,
  applied_action text
)
language plpgsql
set search_path = ''
as $$
declare
  v_fixture pg_temp.official_image_probe_fixture%rowtype;
  v_receipt jsonb;
  v_official jsonb;
  v_input jsonb;
  v_input_fingerprint text;
  v_rule jsonb;
  v_identity jsonb;
  v_decision jsonb;
  v_representative_image jsonb;
  v_effects jsonb := '[
    "reuse_standard_family",
    "reuse_catalog_variant",
    "update_representative_image"
  ]'::jsonb;
  v_target jsonb;
  v_target_fingerprint text;
  v_approval_statement text;
  v_proposal jsonb;
begin
  select * into v_fixture
  from pg_temp.official_image_probe_fixture;

  v_receipt := jsonb_build_object(
    'receiptId', '__official_image_probe_receipt',
    'receiptItemId', '__official_image_probe_item',
    'receiptRevision', '__official_image_probe_revision',
    'sourceCatalogNamespace', '__official_image_probe_channel',
    'sourceLabel', v_fixture.receipt_source_label,
    'sourceProductCode', v_fixture.receipt_source_code,
    'sourceNameRaw', v_fixture.product_name,
    'observedAt', '2026-08-01T00:00:00.000Z',
    'unitPriceKrw', 1080,
    'quantity', 1
  );
  v_official := jsonb_build_object(
    'channelId', '__official_image_probe_channel',
    'sourceProductCodeNamespace', '__official_image_probe_namespace',
    'sourceProductCode', v_fixture.official_source_code,
    'snapshotId', '33333333-3333-4333-8333-333333333333',
    'snapshotHash', 'sha256:' || repeat('3', 64),
    'sourceNameRaw', v_fixture.product_name,
    'specificationTextRaw', '52g',
    'sourceRefs', jsonb_build_array('official-source'),
    'image', jsonb_build_object(
      'url', p_image_url,
      'contentHash', 'sha256:' || repeat('4', 64),
      'mediaType', 'image/jpeg',
      'byteLength', 85635
    )
  );
  v_input := jsonb_build_object(
    'receipt', v_receipt,
    'officialListing', v_official
  );
  v_input_fingerprint := 'sha256:' || encode(
    extensions.digest(
      convert_to(public.canonical_jsonb_text(v_input), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_rule := jsonb_build_object(
    'sameChannel', true,
    'normalization', 'remove_unicode_whitespace_only',
    'normalizedReceiptName', v_fixture.product_name,
    'normalizedOfficialName', v_fixture.product_name,
    'exactNameMatch', true,
    'outcome', 'apply_official_identity',
    'importedOfficialFields', jsonb_build_array(
      'brand', 'contentAmount', 'contentUnit', 'packageCount'
    )
  );
  select jsonb_build_object(
    'brand', brand.canonical_name,
    'productFamilyName', v_fixture.product_name,
    'variantName', v_fixture.product_name,
    'contentAmount', 52,
    'contentUnit', 'g',
    'packageCount', 1,
    'gtin', null
  )
  into v_identity
  from public.brands as brand
  where brand.id = v_fixture.brand_id;
  v_decision := jsonb_build_object(
    'action', 'reuse_variant',
    'standardProductId', v_fixture.standard_product_id,
    'catalogProductId', v_fixture.catalog_product_id,
    'proposedStandardName', null,
    'proposedVariantName', null,
    'confidence', 'high',
    'matchedFields', jsonb_build_array(
      'brand', 'productFamilyName', 'contentAmount', 'contentUnit', 'packageCount'
    ),
    'conflictingFields', '[]'::jsonb,
    'missingFields', '[]'::jsonb
  );
  v_representative_image := jsonb_build_object(
    'scope', 'standard_product_family',
    'action', p_image_action,
    'sourceType', 'external_url',
    'imageUrl', p_image_url,
    'contentHash', 'sha256:' || repeat('4', 64),
    'mediaType', 'image/jpeg',
    'byteLength', 85635,
    'expectedCurrent', case
      when p_image_action = 'create' then 'null'::jsonb
      else jsonb_build_object(
        'sourceType', 'external_url',
        'imageUrl', p_image_url
      )
    end
  );
  v_target := jsonb_build_object(
    'caseId', p_case_id,
    'inputFingerprint', v_input_fingerprint,
    'sameChannelNameRule', v_rule,
    'normalizedIdentity', v_identity,
    'decision', v_decision,
    'coupangOffer', 'null'::jsonb,
    'representativeImage', v_representative_image,
    'plannedEffects', v_effects
  );
  v_target_fingerprint := 'sha256:' || encode(
    extensions.digest(
      convert_to(public.canonical_jsonb_text(v_target), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_approval_statement :=
    '영수증 ' || v_fixture.receipt_source_label || '/'
    || v_fixture.receipt_source_code
    || ' · 공식 __official_image_probe_channel/__official_image_probe_namespace:'
    || v_fixture.official_source_code
    || ' · ' || (v_identity ->> 'brand') || ' ' || v_fixture.product_name
    || ' / ' || v_fixture.product_name
    || ' · reuse_standard_family,reuse_catalog_variant,update_representative_image'
    || ' 연결을 승인합니다. [' || v_target_fingerprint || ']';
  v_proposal := jsonb_build_object(
    'schemaVersion', 'pricetrace-link-proposal.v3',
    'caseId', p_case_id,
    'status', 'approved',
    'inputFingerprint', v_input_fingerprint,
    'receipt', v_receipt,
    'officialListing', v_official,
    'sameChannelNameRule', v_rule,
    'normalizedIdentity', v_identity,
    'decision', v_decision,
    'coupangOffer', 'null'::jsonb,
    'representativeImage', v_representative_image,
    'evidence', jsonb_build_array(
      jsonb_build_object(
        'sourceType', 'receipt',
        'sourceId', '__official_image_probe_receipt:__official_image_probe_item',
        'authority', 'transactional',
        'url', null,
        'capturedAt', '2026-08-01T00:00:00.000Z',
        'claims', jsonb_build_array('receipt identity'),
        'sourceRefs', jsonb_build_array('receipt-source')
      ),
      jsonb_build_object(
        'sourceType', 'official_channel',
        'sourceId', '__official_image_probe_channel:__official_image_probe_namespace:'
          || v_fixture.official_source_code,
        'authority', 'primary',
        'url', v_fixture.official_reference_url,
        'capturedAt', '2026-08-01T00:00:00.000Z',
        'claims', jsonb_build_array('official identity and image'),
        'sourceRefs', jsonb_build_array('official-source')
      )
    ),
    'review', jsonb_build_object(
      'verdict', 'approve',
      'reviewerAgent', 'pricetrace_independent_reviewer',
      'counterCandidates', '[]'::jsonb,
      'conflicts', '[]'::jsonb,
      'evidenceQuality', 'sufficient',
      'notes', jsonb_build_array('probe')
    ),
    'plannedEffects', v_effects,
    'approval', jsonb_build_object(
      'status', 'approved',
      'approvalRef', 'sql-probe',
      'userApprovalText', coalesce(p_approval_override, v_approval_statement),
      'approvedAt', '2026-08-01T00:01:00.000Z',
      'targetFingerprint', v_target_fingerprint
    ),
    'execution', jsonb_build_object(
      'status', 'not_started',
      'idempotencyKey', 'standard-product-official-image:'
        || substring(v_target_fingerprint from 8),
      'appliedAt', null,
      'result', null
    )
  );

  if p_remove_planned_effects
  then
    v_proposal := v_proposal - 'plannedEffects';
  end if;

  return query
  select *
  from public.approve_standard_product_official_image_v1(
    'standard-product-official-image:' || substring(v_target_fingerprint from 8),
    public.canonical_jsonb_text(v_proposal),
    coalesce(p_approval_override, v_approval_statement),
    v_fixture.standard_product_id,
    v_fixture.catalog_product_id
  );
end;
$$;

set local role authenticated;

do $$
declare
  v_fixture pg_temp.official_image_probe_fixture%rowtype;
  v_image_url text := 'https://example.com/official-image.webp';
  v_first record;
  v_replay record;
  v_reuse record;
  v_image_updated_at timestamptz;
  v_standard_count bigint;
  v_catalog_count bigint;
  v_mapping_count bigint;
  v_official_link_count bigint;
  v_official_evidence_count bigint;
  v_coupang_count bigint;
begin
  select * into v_fixture
  from pg_temp.official_image_probe_fixture;

  if not has_function_privilege(
    'authenticated',
    'public.approve_standard_product_official_image_v1(text,text,text,uuid,uuid)',
    'EXECUTE'
  )
    or has_function_privilege(
      'anon',
      'public.approve_standard_product_official_image_v1(text,text,text,uuid,uuid)',
      'EXECUTE'
    )
    or has_table_privilege(
      'authenticated',
      'public.standard_product_official_image_approvals',
      'INSERT'
    )
  then
    raise exception 'Official image approval privileges are unsafe.';
  end if;

  select count(*) into v_standard_count from public.standard_products;
  select count(*) into v_catalog_count from public.catalog_products;
  select count(*) into v_mapping_count from public.source_product_mappings;
  select count(*) into v_official_link_count from public.standard_product_official_links;
  select count(*) into v_official_evidence_count from public.standard_product_official_link_evidence;
  select count(*) into v_coupang_count from public.standard_product_coupang_prices;

  select * into v_first
  from pg_temp.run_official_image_probe('official-image-create', v_image_url);

  if v_first.replayed
    or v_first.applied_action <> 'created'
    or not exists (
      select 1
      from public.standard_product_images as image
      where image.standard_product_id = v_fixture.standard_product_id
        and image.source_type = 'external_url'
        and image.image_url = v_image_url
    )
    or not exists (
      select 1
      from public.standard_product_official_image_approvals as approval
      where approval.id = v_first.approval_id
        and approval.standard_product_id = v_fixture.standard_product_id
        and approval.applied_action = 'created'
    )
  then
    raise exception 'The first image-only approval was not applied.';
  end if;

  if (select count(*) from public.standard_products) <> v_standard_count
    or (select count(*) from public.catalog_products) <> v_catalog_count
    or (select count(*) from public.source_product_mappings) <> v_mapping_count
    or (select count(*) from public.standard_product_official_links) <> v_official_link_count
    or (select count(*) from public.standard_product_official_link_evidence) <> v_official_evidence_count
    or (select count(*) from public.standard_product_coupang_prices) <> v_coupang_count
  then
    raise exception 'The image-only approval changed core catalog or price rows.';
  end if;

  select updated_at into v_image_updated_at
  from public.standard_product_images
  where standard_product_id = v_fixture.standard_product_id;

  select * into v_replay
  from pg_temp.run_official_image_probe('official-image-create', v_image_url);

  if not v_replay.replayed
    or v_replay.approval_id <> v_first.approval_id
    or (
      select updated_at
      from public.standard_product_images
      where standard_product_id = v_fixture.standard_product_id
    ) is distinct from v_image_updated_at
  then
    raise exception 'The image-only replay was not stable.';
  end if;

  select * into v_reuse
  from pg_temp.run_official_image_probe(
    'official-image-reuse',
    v_image_url,
    'reuse_exact'
  );

  if v_reuse.replayed
    or v_reuse.applied_action <> 'reused_exact'
    or (
      select updated_at
      from public.standard_product_images
      where standard_product_id = v_fixture.standard_product_id
    ) is distinct from v_image_updated_at
  then
    raise exception 'An exact official image was not safely reused.';
  end if;

  begin
    perform 1
    from pg_temp.run_official_image_probe(
      'official-image-collision',
      'https://example.com/different.webp'
    );
    raise exception 'A different external image was overwritten.';
  exception
    when unique_violation then null;
  end;

  begin
    perform pg_temp.replace_official_image_probe_with_upload();
    perform 1
    from pg_temp.run_official_image_probe(
      'official-image-upload-collision',
      v_image_url,
      'reuse_exact'
    );
    raise exception 'An uploaded image was overwritten.';
  exception
    when unique_violation then null;
  end;

  begin
    perform pg_temp.delete_official_image_probe_mapping();
    perform 1
    from pg_temp.run_official_image_probe(
      'official-image-stale-mapping',
      v_image_url,
      'reuse_exact'
    );
    raise exception 'A stale receipt mapping was accepted.';
  exception
    when serialization_failure then null;
  end;

  begin
    perform 1
    from pg_temp.run_official_image_probe(
      'official-image-bad-approval',
      v_image_url,
      'reuse_exact',
      'NOT_APPROVED'
    );
    raise exception 'A wrong approval statement was accepted.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1
    from pg_temp.run_official_image_probe(
      'official-image-missing-effects',
      v_image_url,
      'reuse_exact',
      null,
      true
    );
    raise exception 'A proposal without planned effects was accepted.';
  exception
    when insufficient_privilege or check_violation then null;
  end;

  if (
    select count(*)
    from public.standard_product_official_image_approvals
    where standard_product_id = v_fixture.standard_product_id
  ) <> 2
  then
    raise exception 'Rejected image-only attempts left partial approvals.';
  end if;
end;
$$;

rollback;
