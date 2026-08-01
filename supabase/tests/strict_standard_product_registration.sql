-- Run in the linked project's SQL editor as postgres.
-- Every probe write is rolled back; the final result must contain only zeroes.
begin;

-- The helper needs the same canonical serializer as the client-facing V3 RPC.
-- This grant is transaction-local because the entire probe is rolled back.
grant execute on function public.canonical_jsonb_text(jsonb) to authenticated;

create function pg_temp.run_strict_link_probe(
  p_case_id text,
  p_receipt_name text,
  p_official_name text,
  p_receipt_source_code text,
  p_official_source_code text,
  p_observed_at timestamptz,
  p_proposal_price_krw integer default 4380,
  p_requested_price_krw integer default null,
  p_approval_statement_override text default null,
  p_standard_product_id uuid default null,
  p_catalog_product_id uuid default null,
  p_review_verdict text default 'approve',
  p_official_specification_text text default '52g',
  p_matched_fields jsonb default null,
  p_image_action text default 'create',
  p_image_url text default null
)
returns table (
  execution_id uuid,
  standard_product_id uuid,
  catalog_product_id uuid,
  replayed boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_channel_id text := '__strict_probe_channel';
  v_source_namespace text := '__strict_probe_namespace';
  v_source_label text := '__strict_probe_store';
  v_brand text := '__strict_probe_brand';
  v_variant_name text := p_official_name || ' 52g';
  v_case_token text := md5(p_case_id);
  v_image_url text := coalesce(
    p_image_url,
    'https://example.com/official-image/' || v_case_token || '.webp'
  );
  v_input jsonb;
  v_input_text text;
  v_input_fingerprint text;
  v_target jsonb;
  v_target_text text;
  v_target_fingerprint text;
  v_approval_statement text;
  v_action text;
  v_effects jsonb := '[]'::jsonb;
begin
  v_input := jsonb_build_object(
    'receipt', jsonb_build_object(
      'receiptId', 'strict-probe-receipt:' || v_case_token,
      'receiptItemId', 'strict-probe-item:' || v_case_token,
      'receiptRevision', 'revision:' || v_case_token,
      'sourceCatalogNamespace', v_channel_id,
      'sourceLabel', v_source_label,
      'sourceProductCode', p_receipt_source_code,
      'sourceNameRaw', p_receipt_name,
      'observedAt', to_char(
        p_observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'unitPriceKrw', 3900,
      'quantity', 1
    ),
    'officialListing', jsonb_build_object(
      'channelId', v_channel_id,
      'sourceProductCodeNamespace', v_source_namespace,
      'sourceProductCode', p_official_source_code,
      'snapshotId', '33333333-3333-4333-8333-333333333333',
      'snapshotHash', 'sha256:' || repeat('1', 64),
      'sourceNameRaw', p_official_name,
      'specificationTextRaw', p_official_specification_text,
      'sourceRefs', jsonb_build_array('strict-probe-source:' || v_case_token),
      'image', jsonb_build_object(
        'url', v_image_url,
        'contentHash', 'sha256:' || repeat('2', 64),
        'mediaType', 'image/webp',
        'byteLength', 12345
      )
    )
  );
  v_input_text := public.canonical_jsonb_text(v_input);
  v_input_fingerprint := 'sha256:' || encode(
    extensions.digest(convert_to(v_input_text, 'UTF8'), 'sha256'),
    'hex'
  );

  if p_catalog_product_id is not null
  then
    v_action := 'reuse_variant';
  elsif p_standard_product_id is not null
  then
    v_action := 'create_variant';
  else
    v_action := 'create_family_and_variant';
  end if;

  v_effects := v_effects || jsonb_build_array(
    case when p_standard_product_id is null
      then 'create_standard_family' else 'reuse_standard_family' end
  );
  v_effects := v_effects || jsonb_build_array(
    case when p_catalog_product_id is null
      then 'create_catalog_variant' else 'reuse_catalog_variant' end
  );
  v_effects := v_effects || '[
    "link_official_listing",
    "verify_receipt_mapping",
    "register_coupang_offer",
    "update_representative_image"
  ]'::jsonb;

  v_target := jsonb_build_object(
    'caseId', p_case_id,
    'inputFingerprint', v_input_fingerprint,
    'approvalPolicy', jsonb_build_object(
      'mode', 'authenticated_admin_explicit_second_step',
      'requiredStatementPrefix', 'APPROVE_STANDARD_PRODUCT_LINK',
      'statementTemplateVersion', 'link-approval-ko-v1',
      'oneTimeTargetFingerprint', true
    ),
    'sameChannelNameRule', jsonb_build_object(
      'sameChannel', true,
      'normalization', 'remove_unicode_whitespace_only',
      'normalizedReceiptName', regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g'),
      'normalizedOfficialName', regexp_replace(p_official_name, '[[:space:]]+', '', 'g'),
      'exactNameMatch', true,
      'outcome', 'apply_official_identity',
      'importedOfficialFields', jsonb_build_array(
        'brand',
        'contentAmount',
        'contentUnit'
      )
    ),
    'officialSpecificationCheck', jsonb_build_object(
      'specificationTextRaw', p_official_specification_text,
      'parsedContentAmount', 52,
      'parsedContentUnit', 'g',
      'parsedPackageCount', 1,
      'packageCountBasis', 'default_one_absent_count',
      'matchesTarget', true
    ),
    'normalizedIdentity', jsonb_build_object(
      'brand', v_brand,
      'productFamilyName', p_official_name,
      'variantName', v_variant_name,
      'specificationStatus', 'verified',
      'contentAmount', 52,
      'contentUnit', 'g',
      'packageCount', 1,
      'referenceUnit', 100,
      'gtin', null
    ),
    'brandEvidence', jsonb_build_object(
      'canonicalName', v_brand,
      'receiptObservedName', null,
      'officialObservedName', v_brand,
      'officialSourceLabel', 'example.com',
      'productReferenceUrl', 'https://example.com/official/' || v_case_token
    ),
    'decision', jsonb_build_object(
      'action', v_action,
      'standardProductId', p_standard_product_id,
      'catalogProductId', p_catalog_product_id,
      'proposedStandardName', case
        when p_standard_product_id is null then p_official_name else null end,
      'proposedVariantName', case
        when p_catalog_product_id is null then v_variant_name else null end,
      'confidence', 'high',
      'matchedFields', coalesce(
        p_matched_fields,
        jsonb_build_array(
          'same catalog channel',
          'exact name after removing Unicode whitespace',
          'official package identity',
          'official specification',
          'package-count policy'
        )
      ),
      'conflictingFields', '[]'::jsonb,
      'missingFields', '[]'::jsonb
    ),
    'coupangOffer', jsonb_build_object(
      'productUrl', 'https://example.com/coupang/' || v_case_token,
      'listedPriceKrw', p_proposal_price_krw,
      'quantity', 3,
      'contentAmount', 52,
      'contentUnit', 'g',
      'maxBundleQuantity', 12,
      'maxBundleListedPriceKrw', 13150
    ),
    'representativeImage', jsonb_build_object(
      'scope', 'standard_product_family',
      'action', p_image_action,
      'sourceType', 'external_url',
      'imageUrl', v_image_url,
      'contentHash', 'sha256:' || repeat('2', 64),
      'mediaType', 'image/webp',
      'byteLength', 12345,
      'expectedCurrent', case
        when p_image_action = 'reuse_exact'
          then jsonb_build_object(
            'sourceType', 'external_url',
            'imageUrl', v_image_url
          )
        else null
      end
    ),
    'evidence', jsonb_build_array(
      jsonb_build_object(
        'sourceType', 'receipt',
        'sourceId', 'strict-probe-receipt:' || v_case_token
          || ':strict-probe-item:' || v_case_token,
        'authority', 'transactional',
        'url', null,
        'capturedAt', to_char(
          p_observed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'claims', jsonb_build_array('Receipt identity and observation verified.'),
        'sourceRefs', jsonb_build_array('strict-probe-receipt:' || v_case_token)
      ),
      jsonb_build_object(
        'sourceType', 'official_channel',
        'sourceId', v_channel_id || ':' || v_source_namespace || ':'
          || p_official_source_code,
        'authority', 'primary',
        'url', 'https://example.com/official/' || v_case_token,
        'capturedAt', to_char(
          p_observed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'claims', jsonb_build_array('Official name and specification verified.'),
        'sourceRefs', jsonb_build_array('strict-probe-source:' || v_case_token)
      ),
      jsonb_build_object(
        'sourceType', 'coupang',
        'sourceId', 'strict-probe-coupang:' || v_case_token,
        'authority', 'transactional',
        'url', 'https://example.com/coupang/' || v_case_token,
        'capturedAt', to_char(
          p_observed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'claims', jsonb_build_array('Exact 52g three-unit option verified.'),
        'sourceRefs', jsonb_build_array('strict-probe-coupang:' || v_case_token)
      )
    ),
    'review', jsonb_build_object(
      'verdict', p_review_verdict,
      'reviewerAgent', 'pricetrace_independent_reviewer',
      'counterCandidates', jsonb_build_array(
        'No compatible counter-candidate found.'
      ),
      'conflicts', '[]'::jsonb,
      'evidenceQuality', 'sufficient',
      'notes', jsonb_build_array('Regression probe review.')
    ),
    'plannedEffects', v_effects
  );
  v_target_text := public.canonical_jsonb_text(v_target);
  v_target_fingerprint := 'sha256:' || encode(
    extensions.digest(convert_to(v_target_text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_approval_statement :=
    '영수증 ' || v_source_label || '/' || p_receipt_source_code
    || ' · 공식 ' || v_channel_id || '/' || v_source_namespace || ':'
    || p_official_source_code
    || ' · ' || v_brand || ' ' || p_official_name
    || ' / ' || v_variant_name
    || ' · ' || (
      select string_agg(value, ',' order by ordinal)
      from jsonb_array_elements_text(v_effects)
        with ordinality as effect(value, ordinal)
    )
    || ' 연결을 승인합니다. [' || v_target_fingerprint || ']';

  return query
  select *
  from public.approve_and_register_standard_product_link_strict_v6(
    'standard-product-link:' || substring(v_target_fingerprint from 8),
    p_case_id,
    v_input_fingerprint,
    v_target_fingerprint,
    v_input_text,
    v_target_text,
    coalesce(
      p_approval_statement_override,
      v_approval_statement
    ),
    'strict-probe-receipt:' || v_case_token,
    'strict-probe-item:' || v_case_token,
    p_observed_at,
    p_standard_product_id,
    p_catalog_product_id,
    p_official_name,
    v_brand,
    null,
    v_brand,
    'example.com',
    'https://example.com/official/' || v_case_token,
    v_variant_name,
    p_receipt_name,
    'verified',
    52,
    'g',
    1,
    100,
    p_receipt_source_code,
    array[v_source_label],
    'https://example.com/coupang/' || v_case_token,
    coalesce(p_requested_price_krw, p_proposal_price_krw),
    3,
    52,
    'g',
    12,
    13150
  );
end;
$$;

create function pg_temp.set_strict_probe_brand(
  p_standard_product_id uuid,
  p_brand_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.standard_products
  set brand_id = p_brand_id
  where id = p_standard_product_id;
$$;

create function pg_temp.delete_strict_probe_mapping(
  p_source_product_code text
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.source_product_mappings
  where source_label = '__strict_probe_store'
    and source_product_code = p_source_product_code;
$$;

select set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', admin_user.id,
    'role', 'authenticated',
    'app_metadata', pg_catalog.jsonb_build_object('role', 'admin')
  )::text,
  true
)
from (
  select id
  from auth.users
  where coalesce(raw_app_meta_data ->> 'role', '') = 'admin'
  order by created_at
  limit 1
) as admin_user;

set local role authenticated;

do $$
declare
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_name text := '__strict_probe_' || v_suffix;
  v_receipt_source_code text := '250428-probe-' || v_suffix;
  v_official_source_code text := '35276-probe-' || v_suffix;
  v_case_id text := 'strict-probe:' || v_suffix;
  v_observed_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  v_first record;
  v_replay record;
  v_image_reuse record;
  v_brand_id uuid;
  v_image_updated_at timestamptz;
begin
  if auth.uid() is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'The strict registration probe requires an admin auth context.';
  end if;

  if position(
    'price.standard_product_id'
    in lower(pg_get_functiondef(
      'public.get_public_exact_standard_product_catalog_v2()'::regprocedure
    ))
  ) = 0
  then
    raise exception 'The public exact catalog does not resolve Coupang observations by standard product.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)',
    'EXECUTE'
  )
  then
    raise exception 'Authenticated users can still bypass approval through V3.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.approve_and_register_standard_product_link_strict_v4(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)',
    'EXECUTE'
  )
  then
    raise exception 'Authenticated users can still bypass complete proposal validation through V4.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)',
    'EXECUTE'
  )
  then
    raise exception 'Authenticated users can still bypass official image registration through V5.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.approve_and_register_standard_product_link_strict_v6(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)',
    'EXECUTE'
  )
  then
    raise exception 'Authenticated administrators cannot execute the complete V6 path.';
  end if;

  if has_function_privilege(
    'anon',
    'public.approve_and_register_standard_product_link_strict_v6(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)',
    'EXECUTE'
  )
  then
    raise exception 'Anonymous users can execute the V6 write path.';
  end if;

  if position(
    'coalesce(v_official ->> ''sourceProductCode'', '''') <> btrim(p_source_product_code)'
    in pg_get_functiondef(
      'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
    )
  ) > 0
  then
    raise exception 'V3 still conflates receipt and official source codes.';
  end if;

  if position(
    '<> ''["brand","productFamilyName","contentAmount","contentUnit","packageCount"]''::jsonb'
    in pg_get_functiondef(
      'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
    )
  ) > 0
  then
    raise exception 'V3 still requires one hard-coded matched-fields array.';
  end if;

  if position(
    'jsonb_typeof(v_decision -> ''matchedFields'')'
    in pg_get_functiondef(
      'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
    )
  ) = 0
    or position(
      'jsonb_array_length(v_decision -> ''matchedFields'') = 0'
      in pg_get_functiondef(
        'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
      )
    ) = 0
  then
    raise exception 'V3 does not require a non-empty matched-fields array.';
  end if;

  begin
    insert into public.standard_product_link_executions (
      idempotency_key,
      case_id,
      input_fingerprint,
      target_fingerprint,
      status,
      created_by
    )
    values (
      'strict-probe-direct-ledger:' || v_suffix,
      'strict-probe-direct-ledger:' || v_suffix,
      'sha256:' || repeat('0', 64),
      'sha256:' || repeat('0', 64),
      'in_progress',
      auth.uid()
    );
    raise exception 'Direct execution-ledger mutation was not rejected.';
  exception
    when insufficient_privilege then null;
  end;

  select *
  into v_first
  from pg_temp.run_strict_link_probe(
    v_case_id,
    v_name,
    v_name,
    v_receipt_source_code,
    v_official_source_code,
    v_observed_at
  );

  if v_first.replayed
    or v_first.standard_product_id is null
    or v_first.catalog_product_id is null
  then
    raise exception 'The first V6 registration did not create an applied result.';
  end if;

  if not exists (
    select 1
    from public.standard_product_coupang_prices as price
    where price.link_execution_id = v_first.execution_id
      and price.standard_product_id = v_first.standard_product_id
      and price.catalog_product_id is null
  )
  then
    raise exception 'The strict registration did not record a family-owned Coupang observation.';
  end if;

  if not exists (
    select 1
    from public.standard_product_link_approvals as approval
    where approval.consumed_execution_id = v_first.execution_id
      and approval.approved_by = auth.uid()
      and approval.user_approval_text is not null
  )
  then
    raise exception 'The item-specific approval was not recorded and consumed.';
  end if;

  if not exists (
    select 1
    from public.standard_product_official_links as link
    inner join public.standard_product_official_link_evidence as evidence
      on evidence.official_link_id = link.id
    where link.catalog_product_id = v_first.catalog_product_id
      and evidence.link_execution_id = v_first.execution_id
  )
  then
    raise exception 'The official listing identity or snapshot evidence was not recorded.';
  end if;

  if not exists (
    select 1
    from public.standard_product_images as image
    where image.standard_product_id = v_first.standard_product_id
      and image.source_type = 'external_url'
      and image.image_url = 'https://example.com/official-image/'
        || md5(v_case_id) || '.webp'
  ) or not exists (
    select 1
    from public.standard_product_link_executions as execution
    where execution.id = v_first.execution_id
      and execution.result -> 'representativeImage' ->> 'imageUrl'
        = 'https://example.com/official-image/' || md5(v_case_id) || '.webp'
      and execution.result -> 'representativeImage' ->> 'appliedAction' = 'created'
  )
  then
    raise exception 'The approved official representative image was not recorded.';
  end if;

  select image.updated_at
  into v_image_updated_at
  from public.standard_product_images as image
  where image.standard_product_id = v_first.standard_product_id;

  if not exists (
    select 1
    from public.source_product_mappings as mapping
    where mapping.source_label = '__strict_probe_store'
      and mapping.source_product_code = v_receipt_source_code
      and mapping.catalog_product_id = v_first.catalog_product_id
  )
    or exists (
      select 1
      from public.source_product_mappings as mapping
      where mapping.source_label = '__strict_probe_store'
        and mapping.source_product_code = v_official_source_code
    )
  then
    raise exception 'The receipt mapping did not preserve the receipt source code.';
  end if;

  if not exists (
    select 1
    from public.standard_product_official_links as link
    where link.channel_id = '__strict_probe_channel'
      and link.source_product_code_namespace = '__strict_probe_namespace'
      and link.source_product_code = v_official_source_code
      and link.catalog_product_id = v_first.catalog_product_id
  )
    or exists (
      select 1
      from public.standard_product_official_links as link
      where link.channel_id = '__strict_probe_channel'
        and link.source_product_code_namespace = '__strict_probe_namespace'
        and link.source_product_code = v_receipt_source_code
    )
  then
    raise exception 'The official link did not preserve the official source code.';
  end if;

  select *
  into v_replay
  from pg_temp.run_strict_link_probe(
    v_case_id,
    v_name,
    v_name,
    v_receipt_source_code,
    v_official_source_code,
    v_observed_at
  );

  if not v_replay.replayed
    or v_replay.execution_id <> v_first.execution_id
    or v_replay.standard_product_id <> v_first.standard_product_id
    or v_replay.catalog_product_id <> v_first.catalog_product_id
  then
    raise exception 'The V6 replay changed the approved result.';
  end if;

  if (
    select image.updated_at
    from public.standard_product_images as image
    where image.standard_product_id = v_first.standard_product_id
  ) is distinct from v_image_updated_at
  then
    raise exception 'The V6 replay mutated the representative image timestamp.';
  end if;

  select *
  into v_image_reuse
  from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-image-reuse:' || v_suffix,
    p_receipt_name => v_name,
    p_official_name => v_name,
    p_receipt_source_code => v_receipt_source_code || '_image_reuse',
    p_official_source_code => v_official_source_code || '_image_reuse',
    p_observed_at => v_observed_at,
    p_standard_product_id => v_first.standard_product_id,
    p_catalog_product_id => v_first.catalog_product_id,
    p_image_action => 'reuse_exact',
    p_image_url => 'https://example.com/official-image/'
      || md5(v_case_id) || '.webp'
  );

  if v_image_reuse.replayed
    or v_image_reuse.standard_product_id <> v_first.standard_product_id
    or v_image_reuse.catalog_product_id <> v_first.catalog_product_id
    or (
      select image.updated_at
      from public.standard_product_images as image
      where image.standard_product_id = v_first.standard_product_id
    ) is distinct from v_image_updated_at
  then
    raise exception 'The exact existing representative image was not safely reused.';
  end if;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-image-collision:' || v_suffix,
      p_receipt_name => v_name,
      p_official_name => v_name,
      p_receipt_source_code => v_receipt_source_code || '_image_collision',
      p_official_source_code => v_official_source_code || '_image_collision',
      p_observed_at => v_observed_at,
      p_standard_product_id => v_first.standard_product_id,
      p_catalog_product_id => v_first.catalog_product_id
    );
    raise exception 'A different family representative image was overwritten.';
  exception
    when unique_violation then null;
  end;

  if exists (
    select 1
    from public.source_product_mappings as mapping
    where mapping.source_label = '__strict_probe_store'
      and mapping.source_product_code = v_receipt_source_code || '_image_collision'
  ) or exists (
    select 1
    from public.standard_product_official_links as link
    where link.channel_id = '__strict_probe_channel'
      and link.source_product_code_namespace = '__strict_probe_namespace'
      and link.source_product_code = v_official_source_code || '_image_collision'
  )
  then
    raise exception 'The rejected image collision left partial core links.';
  end if;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      'strict-probe-bad-approval:' || v_suffix,
      v_name || '_bad_approval',
      v_name || '_bad_approval',
      v_receipt_source_code || '_bad_approval',
      v_official_source_code || '_bad_approval',
      v_observed_at,
      4380,
      null,
      'NOT_APPROVED'
    );
    raise exception 'An invalid approval statement was accepted.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-unreviewed:' || v_suffix,
      p_receipt_name => v_name || '_unreviewed',
      p_official_name => v_name || '_unreviewed',
      p_receipt_source_code => v_receipt_source_code || '_unreviewed',
      p_official_source_code => v_official_source_code || '_unreviewed',
      p_observed_at => v_observed_at,
      p_review_verdict => 'needs_more_evidence'
    );
    raise exception 'An independently unapproved proposal was accepted.';
  exception
    when check_violation then null;
  end;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-empty-matched:' || v_suffix,
      p_receipt_name => v_name || '_empty_matched',
      p_official_name => v_name || '_empty_matched',
      p_receipt_source_code => v_receipt_source_code || '_empty_matched',
      p_official_source_code => v_official_source_code || '_empty_matched',
      p_observed_at => v_observed_at,
      p_matched_fields => '[]'::jsonb
    );
    raise exception 'An empty matched-fields proposal was accepted.';
  exception
    when check_violation then null;
  end;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-spec-drift:' || v_suffix,
      p_receipt_name => v_name || '_spec_drift',
      p_official_name => v_name || '_spec_drift',
      p_receipt_source_code => v_receipt_source_code || '_spec_drift',
      p_official_source_code => v_official_source_code || '_spec_drift',
      p_observed_at => v_observed_at,
      p_official_specification_text => '53g'
    );
    raise exception 'An official specification mismatch was accepted.';
  exception
    when check_violation then null;
  end;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      v_case_id,
      v_name,
      v_name,
      v_receipt_source_code,
      v_official_source_code,
      v_observed_at,
      4380,
      4381
    );
    raise exception 'The frozen proposal accepted a tampered requested effect.';
  exception
    when check_violation then null;
  end;

  if (
    select count(*)
    from public.standard_product_coupang_prices
    where link_execution_id = v_first.execution_id
  ) <> 1
  then
    raise exception 'The replay duplicated the Coupang observation.';
  end if;

  begin
    update public.source_product_mappings
    set source_product_code = source_product_code || '_direct'
    where source_label = '__strict_probe_store'
      and source_product_code = v_receipt_source_code;
    raise exception 'Direct source mapping mutation was not rejected.';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.admin_manage_standard_catalog(
      'update_source_mapping',
      (
        select mapping.id
        from public.source_product_mappings as mapping
        where mapping.source_label = '__strict_probe_store'
          and mapping.source_product_code = v_receipt_source_code
      ),
      jsonb_build_object(
        'sourceLabel', '__strict_probe_other_store',
        'sourceProductCode', v_receipt_source_code || '_other'
      ),
      'CONFIRM_STANDARD_CATALOG_ACTION:update_source_mapping:' || (
        select mapping.id::text
        from public.source_product_mappings as mapping
        where mapping.source_label = '__strict_probe_store'
          and mapping.source_product_code = v_receipt_source_code
      )
    );
    raise exception 'The admin RPC changed an immutable source identity.';
  exception
    when check_violation then null;
  end;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      'strict-probe-conflict:' || v_suffix,
      v_name || '_other',
      v_name || '_other',
      v_receipt_source_code,
      v_official_source_code || '_conflict',
      v_observed_at
    );
    raise exception 'The source mapping collision was not rejected.';
  exception
    when unique_violation then null;
  end;

  if exists (
    select 1
    from public.standard_products
    where canonical_name = v_name || '_other'
  )
  then
    raise exception 'The rejected collision left a partial standard product.';
  end if;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      'strict-probe-name-mismatch:' || v_suffix,
      v_name || '_receipt',
      v_name || '_official',
      v_receipt_source_code || '_mismatch',
      v_official_source_code || '_mismatch',
      v_observed_at
    );
    raise exception 'The receipt and official name mismatch was not rejected.';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.standard_product_coupang_prices (
      standard_product_id,
      catalog_product_id,
      product_url,
      listed_price_krw,
      quantity,
      content_amount,
      content_unit,
      observed_at,
      created_by
    )
    values (
      v_first.standard_product_id,
      v_first.catalog_product_id,
      'https://example.com/coupang/family-only/' || v_suffix,
      4380,
      1,
      52,
      'g',
      now(),
      auth.uid()
    );
    raise exception 'Direct Coupang observation mutation was not rejected.';
  exception
    when insufficient_privilege then null;
  end;

  select standard.brand_id
  into v_brand_id
  from public.standard_products as standard
  where standard.id = v_first.standard_product_id;

  perform pg_temp.set_strict_probe_brand(v_first.standard_product_id, null);

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      v_case_id,
      v_name,
      v_name,
      v_receipt_source_code,
      v_official_source_code,
      v_observed_at
    );
    raise exception 'Replay accepted a changed standard product brand.';
  exception
    when serialization_failure then null;
  end;

  perform pg_temp.set_strict_probe_brand(v_first.standard_product_id, v_brand_id);

  perform pg_temp.delete_strict_probe_mapping(v_receipt_source_code);

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      v_case_id,
      v_name,
      v_name,
      v_receipt_source_code,
      v_official_source_code,
      v_observed_at
    );
    raise exception 'Replay accepted a missing applied source mapping.';
  exception
    when serialization_failure then null;
  end;
end;
$$;

rollback;

select 'standard_products' as relation, count(*) as persisted_probe_rows
from public.standard_products
where canonical_name like '__strict_probe_%'
union all
select 'catalog_products', count(*)
from public.catalog_products
where canonical_name like '__strict_probe_%'
union all
select 'link_executions', count(*)
from public.standard_product_link_executions
where case_id like 'strict-probe:%'
union all
select 'link_approvals', count(*)
from public.standard_product_link_approvals
where case_id like 'strict-probe:%'
union all
select 'official_links', count(*)
from public.standard_product_official_links
where channel_id = '__strict_probe_channel'
union all
select 'official_link_evidence', count(*)
from public.standard_product_official_link_evidence
where source_name_raw like '__strict_probe_%'
union all
select 'catalog_admin_actions', count(*)
from public.standard_catalog_admin_actions
where payload::text like '%__strict_probe_%'
union all
select 'standard_product_images', count(*)
from public.standard_product_images as image
inner join public.standard_products as standard
  on standard.id = image.standard_product_id
where standard.canonical_name like '__strict_probe_%';
