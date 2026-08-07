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
  p_image_url text default null,
  p_verified_equivalence boolean default false,
  p_verified_insertion_deletion boolean default false,
  p_link_only boolean default false,
  p_brand_name_override text default null,
  p_reviewed_at_override text default null,
  p_content_amount_override numeric default 52,
  p_content_unit_override text default 'g',
  p_package_count_override integer default 1,
  p_official_specification_check_override jsonb default null,
  p_identity_attributes_override jsonb default '{}'::jsonb,
  p_imported_official_fields_override jsonb default null
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
  v_brand text := coalesce(p_brand_name_override, '__strict_probe_brand');
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
    "verify_receipt_mapping"
  ]'::jsonb;
  if not p_link_only then
    v_effects := v_effects || jsonb_build_array('register_coupang_offer');
  end if;
  v_effects := v_effects || jsonb_build_array('update_representative_image');

  v_target := jsonb_build_object(
    'caseId', p_case_id,
    'inputFingerprint', v_input_fingerprint,
    'approvalPolicy', jsonb_build_object(
      'mode', 'authenticated_admin_explicit_second_step',
      'requiredStatementPrefix', 'APPROVE_STANDARD_PRODUCT_LINK',
      'statementTemplateVersion', 'link-approval-ko-v1',
      'oneTimeTargetFingerprint', true
    ),
    'executionMode', case when p_link_only then 'link_only_v1' else 'strict_v6' end,
    'sameChannelNameRule', case when p_verified_insertion_deletion then
      jsonb_build_object(
        'sameChannel', true,
        'normalization', 'remove_unicode_whitespace_only',
        'normalizedReceiptName', regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g'),
        'normalizedOfficialName', regexp_replace(p_official_name, '[[:space:]]+', '', 'g'),
        'exactNameMatch', false,
        'outcome', 'apply_verified_name_equivalence',
        'importedOfficialFields', jsonb_build_array(
          'brand',
          'contentAmount',
          'contentUnit'
        ),
        'verifiedEquivalence', jsonb_build_object(
          'method', 'single_unicode_code_point_insertion_deletion_v1',
          'scope', 'frozen_receipt_official_pair_only',
          'editDirection', case
            when char_length(regexp_replace(p_official_name, '[[:space:]]+', '', 'g'))
              > char_length(regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g'))
              then 'insert_official_code_point_into_receipt'
            else 'delete_receipt_code_point'
          end,
          'zeroBasedEditIndex', least(
            char_length(regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g')),
            char_length(regexp_replace(p_official_name, '[[:space:]]+', '', 'g'))
          ),
          'editedCodePoint', case
            when char_length(regexp_replace(p_official_name, '[[:space:]]+', '', 'g'))
              > char_length(regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g'))
              then right(regexp_replace(p_official_name, '[[:space:]]+', '', 'g'), 1)
            else right(regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g'), 1)
          end,
          'receiptCodePointLength', char_length(
            regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g')
          ),
          'officialCodePointLength', char_length(
            regexp_replace(p_official_name, '[[:space:]]+', '', 'g')
          ),
          'discoverySimilarityBasisPoints', floor(
            least(
              char_length(regexp_replace(p_receipt_name, '[^0-9A-Za-z가-힣]+', '', 'g')),
              char_length(regexp_replace(p_official_name, '[^0-9A-Za-z가-힣]+', '', 'g'))
            )::numeric * 10000
            / greatest(
              char_length(regexp_replace(p_receipt_name, '[^0-9A-Za-z가-힣]+', '', 'g')),
              char_length(regexp_replace(p_official_name, '[^0-9A-Za-z가-힣]+', '', 'g'))
            )::numeric
          )::integer,
          'uniqueOfficialCandidate', true,
          'supportingEvidenceSourceIds', jsonb_build_array(
            v_channel_id || ':' || v_source_namespace || ':' || p_official_source_code,
            'strict-probe-manufacturer:' || v_case_token
          ),
          'supportingSourceRefs', jsonb_build_array(
            'strict-probe-source:' || v_case_token,
            'strict-probe-manufacturer:' || v_case_token
          ),
          'reviewerAgent', 'pricetrace_independent_reviewer',
          'reviewedAt', coalesce(
            p_reviewed_at_override,
            to_char(
              p_observed_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          ),
          'conclusion', 'same_exact_sellable_variant'
        )
      )
    when p_verified_equivalence then
      jsonb_build_object(
        'sameChannel', true,
        'normalization', 'remove_unicode_whitespace_only',
        'normalizedReceiptName', regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g'),
        'normalizedOfficialName', regexp_replace(p_official_name, '[[:space:]]+', '', 'g'),
        'exactNameMatch', false,
        'outcome', 'apply_verified_name_equivalence',
        'importedOfficialFields', jsonb_build_array(
          'brand',
          'contentAmount',
          'contentUnit'
        ),
        'verifiedEquivalence', jsonb_build_object(
          'method', 'single_unicode_code_point_substitution_v1',
          'scope', 'frozen_receipt_official_pair_only',
          'zeroBasedCodePointIndex', char_length(
            regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g')
          ) - 1,
          'receiptCodePoint', right(
            regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g'),
            1
          ),
          'officialCodePoint', right(
            regexp_replace(p_official_name, '[[:space:]]+', '', 'g'),
            1
          ),
          'supportingEvidenceSourceIds', jsonb_build_array(
            v_channel_id || ':' || v_source_namespace || ':' || p_official_source_code,
            'strict-probe-manufacturer:' || v_case_token
          ),
          'supportingSourceRefs', jsonb_build_array(
            'strict-probe-source:' || v_case_token,
            'strict-probe-manufacturer:' || v_case_token
          ),
          'reviewerAgent', 'pricetrace_independent_reviewer',
          'reviewedAt', coalesce(
            p_reviewed_at_override,
            to_char(
              p_observed_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            )
          ),
          'conclusion', 'same_exact_sellable_variant'
        )
      )
    else
      jsonb_build_object(
        'sameChannel', true,
        'normalization', 'remove_unicode_whitespace_only',
        'normalizedReceiptName', regexp_replace(p_receipt_name, '[[:space:]]+', '', 'g'),
        'normalizedOfficialName', regexp_replace(p_official_name, '[[:space:]]+', '', 'g'),
        'exactNameMatch', true,
        'outcome', 'apply_official_identity',
        'importedOfficialFields', coalesce(
          p_imported_official_fields_override,
          case
            when p_official_specification_check_override ->> 'packageCountBasis'
              = 'explicit_specification'
              then jsonb_build_array('brand', 'contentAmount', 'contentUnit', 'packageCount')
            else jsonb_build_array('brand', 'contentAmount', 'contentUnit')
          end
        )
      )
    end,
    'officialSpecificationCheck', coalesce(
      p_official_specification_check_override,
      jsonb_build_object(
        'specificationTextRaw', p_official_specification_text,
        'parsedContentAmount', 52,
        'parsedContentUnit', 'g',
        'parsedPackageCount', 1,
        'packageCountBasis', 'default_one_absent_count',
        'matchesTarget', true
      )
    ),
    'normalizedIdentity', jsonb_build_object(
      'brand', v_brand,
      'productFamilyName', p_official_name,
      'variantName', v_variant_name,
      'specificationStatus', 'verified',
      'contentAmount', p_content_amount_override,
      'contentUnit', p_content_unit_override,
      'packageCount', p_package_count_override,
      'referenceUnit', 100,
      'gtin', null
    ) || coalesce(p_identity_attributes_override, '{}'::jsonb),
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
    'coupangOffer', case when p_link_only then null else jsonb_build_object(
      'productUrl', 'https://example.com/coupang/' || v_case_token,
      'listedPriceKrw', p_proposal_price_krw,
      'quantity', 3,
      'contentAmount', p_content_amount_override,
      'contentUnit', p_content_unit_override,
      'maxBundleQuantity', 12,
      'maxBundleListedPriceKrw', 13150
    ) end,
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
      ),
      jsonb_build_object(
        'sourceType', 'manufacturer',
        'sourceId', 'strict-probe-manufacturer:' || v_case_token,
        'authority', 'primary',
        'url', 'https://example.com/manufacturer/' || v_case_token,
        'capturedAt', to_char(
          p_observed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ),
        'claims', jsonb_build_array('Manufacturer exact variant identity verified.'),
        'sourceRefs', jsonb_build_array('strict-probe-manufacturer:' || v_case_token)
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

  if p_link_only then
    return query
    select *
    from public.approve_and_register_standard_product_link_only_v1(
      'standard-product-link:' || substring(v_target_fingerprint from 8),
      p_case_id,
      v_input_fingerprint,
      v_target_fingerprint,
      v_input_text,
      v_target_text,
      coalesce(p_approval_statement_override, v_approval_statement),
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
      p_content_amount_override,
      p_content_unit_override,
      p_package_count_override,
      100,
      p_receipt_source_code,
      array[v_source_label],
      p_official_specification_text,
      null
    );
    return;
  end if;

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
    p_content_amount_override,
    p_content_unit_override,
    p_package_count_override,
    100,
    p_receipt_source_code,
    array[v_source_label],
    'https://example.com/coupang/' || v_case_token,
    coalesce(p_requested_price_krw, p_proposal_price_krw),
    3,
    p_content_amount_override,
    p_content_unit_override,
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

do $$
declare
  v_receipt_name text := 'Demo Product 500';
  v_official_name text := 'PX Demo Product 500 ml';
  v_receipt_source_id text := 'strict-containment-receipt:item-1';
  v_official_source_id text := '__strict_probe_channel:__strict_probe_namespace:containment-1';
  v_observed_at text := '2026-08-03T00:00:00.000Z';
  v_target jsonb;
begin
  if not public.is_valid_explicit_offset_datetime('2026-08-04T12:30:00+09:00')
    or public.is_valid_explicit_offset_datetime('2026-02-31T12:00:00+09:00')
    or public.is_valid_explicit_offset_datetime('2026-08-04T12:00:00+99:99')
    or public.is_valid_explicit_offset_datetime('2026-08-04T12:00:00')
  then
    raise exception 'Explicit-offset review datetime validation is not strict.';
  end if;

  v_target := jsonb_build_object(
    'sameChannelNameRule', jsonb_build_object(
      'sameChannel', true,
      'normalization', 'remove_unicode_whitespace_only',
      'normalizedReceiptName', 'DemoProduct500',
      'normalizedOfficialName', 'PXDemoProduct500ml',
      'exactNameMatch', false,
      'outcome', 'apply_verified_name_equivalence',
      'verifiedEquivalence', jsonb_build_object(
        'method', 'official_name_contains_receipt_name_v1',
        'scope', 'frozen_receipt_official_pair_only',
        'zeroBasedOfficialCodePointIndex', 2,
        'receiptCodePointLength', 14,
        'officialCodePointLength', 18,
        'officialPrefix', 'PX',
        'officialSuffix', 'ml',
        'officialDisplayedPriceKrw', 3900,
        'officialPriceObservedAt', v_observed_at,
        'uniqueOfficialCandidate', true,
        'supportingEvidenceSourceIds', jsonb_build_array(
          v_receipt_source_id,
          v_official_source_id
        ),
        'supportingSourceRefs', jsonb_build_array(
          'strict-containment-receipt-ref',
          'strict-containment-official-ref'
        ),
        'reviewerAgent', 'pricetrace_independent_reviewer',
        'reviewedAt', v_observed_at,
        'conclusion', 'same_exact_sellable_variant'
      )
    ),
    'evidence', jsonb_build_array(
      jsonb_build_object(
        'sourceType', 'receipt',
        'sourceId', v_receipt_source_id,
        'authority', 'transactional',
        'sourceRefs', jsonb_build_array('strict-containment-receipt-ref')
      ),
      jsonb_build_object(
        'sourceType', 'official_channel',
        'sourceId', v_official_source_id,
        'authority', 'primary',
        'sourceRefs', jsonb_build_array('strict-containment-official-ref')
      )
    ),
    'review', jsonb_build_object(
      'reviewerAgent', 'pricetrace_independent_reviewer',
      'verdict', 'approve',
      'evidenceQuality', 'sufficient',
      'conflicts', '[]'::jsonb
    )
  );

  if not public.is_verified_official_name_containment(
    v_target,
    v_receipt_name,
    v_official_name,
    v_receipt_source_id,
    3900,
    jsonb_build_object(
      'amountKrw', 3900,
      'sourceText', '3,900원',
      'observedAt', v_observed_at
    ),
    v_official_source_id
  )
  then
    raise exception 'The valid verified official-name containment was rejected.';
  end if;

  if public.is_verified_official_name_containment(
    v_target,
    v_receipt_name,
    v_official_name,
    v_receipt_source_id,
    3901,
    jsonb_build_object(
      'amountKrw', 3900,
      'sourceText', '3,900원',
      'observedAt', v_observed_at
    ),
    v_official_source_id
  )
  then
    raise exception 'A receipt and official price mismatch passed containment.';
  end if;

  if public.is_verified_official_name_containment(
    v_target,
    v_receipt_name,
    v_official_name || ' ' || v_receipt_name,
    v_receipt_source_id,
    3900,
    jsonb_build_object(
      'amountKrw', 3900,
      'sourceText', '3,900원',
      'observedAt', v_observed_at
    ),
    v_official_source_id
  )
  then
    raise exception 'A repeated receipt substring passed containment.';
  end if;
end;
$$;

do $$
declare
  v_receipt_name text := 'Demo Product 500 m';
  v_official_name text := 'Demo Product 500 ml';
  v_official_source_id text := '__strict_probe_channel:__strict_probe_namespace:indel-1';
  v_manufacturer_source_id text := 'manufacturer:strict-probe:indel-1';
  v_target jsonb;
begin
  v_target := jsonb_build_object(
    'sameChannelNameRule', jsonb_build_object(
      'sameChannel', true,
      'normalization', 'remove_unicode_whitespace_only',
      'normalizedReceiptName', 'DemoProduct500m',
      'normalizedOfficialName', 'DemoProduct500ml',
      'exactNameMatch', false,
      'outcome', 'apply_verified_name_equivalence',
      'verifiedEquivalence', jsonb_build_object(
        'method', 'single_unicode_code_point_insertion_deletion_v1',
        'scope', 'frozen_receipt_official_pair_only',
        'editDirection', 'insert_official_code_point_into_receipt',
        'zeroBasedEditIndex', 15,
        'editedCodePoint', 'l',
        'receiptCodePointLength', 15,
        'officialCodePointLength', 16,
        'discoverySimilarityBasisPoints', 9375,
        'uniqueOfficialCandidate', true,
        'supportingEvidenceSourceIds', jsonb_build_array(
          v_official_source_id,
          v_manufacturer_source_id
        ),
        'supportingSourceRefs', jsonb_build_array(
          'strict-indel-official-ref',
          'strict-indel-manufacturer-ref'
        ),
        'reviewerAgent', 'pricetrace_independent_reviewer',
        'reviewedAt', '2026-08-04T12:30:00+09:00',
        'conclusion', 'same_exact_sellable_variant'
      )
    ),
    'evidence', jsonb_build_array(
      jsonb_build_object(
        'sourceType', 'official_channel',
        'sourceId', v_official_source_id,
        'authority', 'primary',
        'sourceRefs', jsonb_build_array('strict-indel-official-ref')
      ),
      jsonb_build_object(
        'sourceType', 'manufacturer',
        'sourceId', v_manufacturer_source_id,
        'authority', 'primary',
        'sourceRefs', jsonb_build_array('strict-indel-manufacturer-ref')
      )
    ),
    'review', jsonb_build_object(
      'reviewerAgent', 'pricetrace_independent_reviewer',
      'verdict', 'approve',
      'evidenceQuality', 'sufficient',
      'conflicts', '[]'::jsonb
    )
  );

  if not public.is_verified_single_codepoint_name_insertion_deletion(
    v_target,
    v_receipt_name,
    v_official_name,
    v_official_source_id
  )
  then
    raise exception 'The valid verified name insertion/deletion was rejected.';
  end if;

  if public.is_verified_single_codepoint_name_insertion_deletion(
    jsonb_set(
      v_target,
      '{sameChannelNameRule,verifiedEquivalence,zeroBasedEditIndex}',
      '14'::jsonb
    ),
    v_receipt_name,
    v_official_name,
    v_official_source_id
  )
  then
    raise exception 'An incorrect insertion/deletion index was accepted.';
  end if;

  if public.is_verified_single_codepoint_name_insertion_deletion(
    jsonb_set(
      v_target,
      '{sameChannelNameRule,verifiedEquivalence,discoverySimilarityBasisPoints}',
      '9000'::jsonb
    ),
    v_receipt_name,
    v_official_name,
    v_official_source_id
  )
  then
    raise exception 'A mismatched insertion/deletion similarity was accepted.';
  end if;
end;
$$;

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
  v_count_entry record;
  v_count_entry_replay record;
  v_replay record;
  v_image_reuse record;
  v_verified_equivalence record;
  v_verified_insertion_deletion record;
  v_link_only_insertion_deletion record;
  v_link_only_replay record;
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

  if has_function_privilege(
    'authenticated',
    'public.is_verified_single_codepoint_name_equivalence(jsonb,text,text,text)',
    'EXECUTE'
  )
    or has_function_privilege(
      'anon',
      'public.is_verified_single_codepoint_name_equivalence(jsonb,text,text,text)',
      'EXECUTE'
    )
  then
    raise exception 'The verified name-equivalence helper is externally executable.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.is_verified_official_name_containment(jsonb,text,text,text,integer,jsonb,text)',
    'EXECUTE'
  )
    or has_function_privilege(
      'anon',
      'public.is_verified_official_name_containment(jsonb,text,text,text,integer,jsonb,text)',
      'EXECUTE'
    )
  then
    raise exception 'The verified containment helper is externally executable.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.is_verified_single_codepoint_name_insertion_deletion(jsonb,text,text,text)',
    'EXECUTE'
  )
    or has_function_privilege(
      'anon',
      'public.is_verified_single_codepoint_name_insertion_deletion(jsonb,text,text,text)',
      'EXECUTE'
    )
  then
    raise exception 'The verified insertion/deletion helper is externally executable.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.is_valid_explicit_offset_datetime(text)',
    'EXECUTE'
  )
    or has_function_privilege(
      'anon',
      'public.is_valid_explicit_offset_datetime(text)',
      'EXECUTE'
    )
  then
    raise exception 'The review datetime validator is externally executable.';
  end if;

  if position(
    'is_verified_single_codepoint_name_equivalence'
    in pg_get_functiondef(
      'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
    )
  ) = 0
    or position(
      'is_verified_single_codepoint_name_equivalence'
      in pg_get_functiondef(
        'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
      )
    ) = 0
  then
    raise exception 'The strict write chain is missing the verified name-equivalence gate.';
  end if;

  if position(
    'is_verified_official_name_containment'
    in pg_get_functiondef(
      'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
    )
  ) = 0
    or position(
      'is_verified_official_name_containment'
      in pg_get_functiondef(
        'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
      )
    ) = 0
  then
    raise exception 'The strict write chain is missing the verified containment gate.';
  end if;

  if position(
    'is_verified_single_codepoint_name_insertion_deletion'
    in pg_get_functiondef(
      'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
    )
  ) = 0
    or position(
      'is_verified_single_codepoint_name_insertion_deletion'
      in pg_get_functiondef(
        'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure
      )
    ) = 0
    or position(
      'is_verified_single_codepoint_name_insertion_deletion'
      in pg_get_functiondef(
        'public.approve_and_register_standard_product_link_only_v1(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,jsonb)'::regprocedure
      )
    ) = 0
  then
    raise exception 'A write path is missing the verified insertion/deletion gate.';
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

  select *
  into v_count_entry
  from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-count-entry:' || v_suffix,
    p_receipt_name => v_name || ' 면도날',
    p_official_name => v_name || ' 면도날',
    p_receipt_source_code => v_receipt_source_code || '_count_entry',
    p_official_source_code => v_official_source_code || '_count_entry',
    p_observed_at => v_observed_at,
    p_official_specification_text => '4입',
    p_content_amount_override => 4,
    p_content_unit_override => 'each',
    p_package_count_override => 1,
    p_official_specification_check_override => jsonb_build_object(
      'specificationTextRaw', '4입',
      'parsedContentAmount', 4,
      'parsedContentUnit', 'each',
      'parsedPackageCount', 1,
      'packageCountBasis', 'default_one_absent_count',
      'matchesTarget', true
    )
  );

  if v_count_entry.replayed
    or v_count_entry.standard_product_id is null
    or v_count_entry.catalog_product_id is null
  then
    raise exception 'The strict V6 count-entry specification was not applied.';
  end if;

  if not exists (
    select 1
    from public.catalog_products as catalog
    where catalog.id = v_count_entry.catalog_product_id
      and catalog.standard_product_id = v_count_entry.standard_product_id
      and catalog.content_amount = 4
      and catalog.content_unit = 'each'
      and catalog.package_count = 1
  ) or not exists (
    select 1
    from public.standard_product_coupang_prices as price
    where price.link_execution_id = v_count_entry.execution_id
      and price.standard_product_id = v_count_entry.standard_product_id
      and price.catalog_product_id is null
      and price.content_amount = 4
      and price.content_unit = 'each'
  ) or not exists (
    select 1
    from public.source_product_mappings as mapping
    where mapping.source_label = '__strict_probe_store'
      and mapping.source_product_code = v_receipt_source_code || '_count_entry'
      and mapping.catalog_product_id = v_count_entry.catalog_product_id
  ) or not exists (
    select 1
    from public.standard_product_official_links as link
    inner join public.standard_product_official_link_evidence as evidence
      on evidence.official_link_id = link.id
    where link.catalog_product_id = v_count_entry.catalog_product_id
      and evidence.link_execution_id = v_count_entry.execution_id
  )
  then
    raise exception 'The strict V6 count-entry write did not preserve the exact variant relationships.';
  end if;

  select *
  into v_count_entry_replay
  from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-count-entry:' || v_suffix,
    p_receipt_name => v_name || ' 면도날',
    p_official_name => v_name || ' 면도날',
    p_receipt_source_code => v_receipt_source_code || '_count_entry',
    p_official_source_code => v_official_source_code || '_count_entry',
    p_observed_at => v_observed_at,
    p_official_specification_text => '4입',
    p_content_amount_override => 4,
    p_content_unit_override => 'each',
    p_package_count_override => 1,
    p_official_specification_check_override => jsonb_build_object(
      'specificationTextRaw', '4입',
      'parsedContentAmount', 4,
      'parsedContentUnit', 'each',
      'parsedPackageCount', 1,
      'packageCountBasis', 'default_one_absent_count',
      'matchesTarget', true
    )
  );

  if not v_count_entry_replay.replayed
    or v_count_entry_replay.execution_id <> v_count_entry.execution_id
    or v_count_entry_replay.standard_product_id <> v_count_entry.standard_product_id
    or v_count_entry_replay.catalog_product_id <> v_count_entry.catalog_product_id
  then
    raise exception 'The strict V6 count-entry replay was not idempotent.';
  end if;

  begin
    perform * from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-count-entry-mismatch:' || v_suffix,
      p_receipt_name => v_name || ' mismatch 면도날',
      p_official_name => v_name || ' mismatch 면도날',
      p_receipt_source_code => v_receipt_source_code || '_count_entry_mismatch',
      p_official_source_code => v_official_source_code || '_count_entry_mismatch',
      p_observed_at => v_observed_at,
      p_official_specification_text => '4입',
      p_content_amount_override => 5,
      p_content_unit_override => 'each',
      p_package_count_override => 1,
      p_official_specification_check_override => jsonb_build_object(
        'specificationTextRaw', '4입',
        'parsedContentAmount', 4,
        'parsedContentUnit', 'each',
        'parsedPackageCount', 1,
        'packageCountBasis', 'default_one_absent_count',
        'matchesTarget', true
      )
    );
    raise exception 'A mismatched strict V6 count-entry target was accepted.';
  exception
    when check_violation then null;
  end;

  select *
  into v_verified_equivalence
  from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-verified-equivalence:' || v_suffix,
    p_receipt_name => v_name || '속',
    p_official_name => v_name || '숙',
    p_receipt_source_code => v_receipt_source_code || '_verified_equivalence',
    p_official_source_code => v_official_source_code || '_verified_equivalence',
    p_observed_at => v_observed_at,
    p_verified_equivalence => true
  );

  if v_verified_equivalence.replayed
    or v_verified_equivalence.standard_product_id is null
    or v_verified_equivalence.catalog_product_id is null
  then
    raise exception 'The verified single-code-point V6 registration was not applied.';
  end if;

  select *
  into v_verified_insertion_deletion
  from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-verified-insertion-deletion:' || v_suffix,
    p_receipt_name => v_name || ' 500 m',
    p_official_name => v_name || ' 500 ml',
    p_receipt_source_code => v_receipt_source_code || '_verified_indel',
    p_official_source_code => v_official_source_code || '_verified_indel',
    p_observed_at => v_observed_at,
    p_verified_insertion_deletion => true
  );

  if v_verified_insertion_deletion.replayed
    or v_verified_insertion_deletion.standard_product_id is null
    or v_verified_insertion_deletion.catalog_product_id is null
  then
    raise exception 'The verified insertion/deletion V6 registration was not applied.';
  end if;

  select *
  into v_link_only_insertion_deletion
  from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-link-only-insertion-deletion:' || v_suffix,
    p_receipt_name => v_name || ' 500 m',
    p_official_name => v_name || ' 500 ml',
    p_receipt_source_code => v_receipt_source_code || '_link_only_indel',
    p_official_source_code => v_official_source_code || '_link_only_indel',
    p_observed_at => v_observed_at,
    p_verified_insertion_deletion => true,
    p_link_only => true
  );

  if v_link_only_insertion_deletion.replayed
    or v_link_only_insertion_deletion.standard_product_id is null
    or v_link_only_insertion_deletion.catalog_product_id is null
  then
    raise exception 'The verified insertion/deletion link-only registration was not applied.';
  end if;

  if exists (
    select 1
    from public.standard_product_coupang_prices as price
    where price.link_execution_id = v_link_only_insertion_deletion.execution_id
  )
  then
    raise exception 'The link-only insertion/deletion path created a Coupang observation.';
  end if;

  select *
  into v_link_only_replay
  from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-link-only-insertion-deletion:' || v_suffix,
    p_receipt_name => v_name || ' 500 m',
    p_official_name => v_name || ' 500 ml',
    p_receipt_source_code => v_receipt_source_code || '_link_only_indel',
    p_official_source_code => v_official_source_code || '_link_only_indel',
    p_observed_at => v_observed_at,
    p_verified_insertion_deletion => true,
    p_link_only => true
  );

  if not v_link_only_replay.replayed
    or v_link_only_replay.execution_id <> v_link_only_insertion_deletion.execution_id
  then
    raise exception 'The link-only insertion/deletion replay was not idempotent.';
  end if;

  perform * from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-structured-count:' || v_suffix,
    p_receipt_name => v_name || ' 파스 5매',
    p_official_name => v_name || ' 파스 5매',
    p_receipt_source_code => v_receipt_source_code || '_structured_count',
    p_official_source_code => v_official_source_code || '_structured_count',
    p_observed_at => v_observed_at,
    p_official_specification_text => '5매',
    p_link_only => true,
    p_content_amount_override => 1,
    p_content_unit_override => 'each',
    p_package_count_override => 5,
    p_official_specification_check_override => jsonb_build_object(
      'kind', 'structured_content',
      'specificationTextRaw', '5매',
      'parseRule', 'count_only_v1',
      'parsedContentAmount', 1,
      'parsedContentUnit', 'each',
      'parsedPackageCount', 5,
      'packageCountBasis', 'explicit_specification',
      'matchesTarget', true
    )
  );

  perform * from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-structured-multipack:' || v_suffix,
    p_receipt_name => v_name || ' 짜왕',
    p_official_name => v_name || ' 짜왕',
    p_receipt_source_code => v_receipt_source_code || '_structured_multipack',
    p_official_source_code => v_official_source_code || '_structured_multipack',
    p_observed_at => v_observed_at,
    p_official_specification_text => '134g*4개입',
    p_link_only => true,
    p_content_amount_override => 134,
    p_content_unit_override => 'g',
    p_package_count_override => 4,
    p_official_specification_check_override => jsonb_build_object(
      'kind', 'structured_content',
      'specificationTextRaw', '134g*4개입',
      'parseRule', 'per_item_times_count_v1',
      'parsedContentAmount', 134,
      'parsedContentUnit', 'g',
      'parsedPackageCount', 4,
      'packageCountBasis', 'explicit_specification',
      'matchesTarget', true
    )
  );

  perform * from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-structured-decimal-multipack:' || v_suffix,
    p_receipt_name => v_name || ' 옥수수수염차',
    p_official_name => v_name || ' 옥수수수염차',
    p_receipt_source_code => v_receipt_source_code || '_structured_decimal',
    p_official_source_code => v_official_source_code || '_structured_decimal',
    p_observed_at => v_observed_at,
    p_official_specification_text => '1.5g x 20개입',
    p_link_only => true,
    p_content_amount_override => 1.5,
    p_content_unit_override => 'g',
    p_package_count_override => 20,
    p_official_specification_check_override => jsonb_build_object(
      'kind', 'structured_content',
      'specificationTextRaw', '1.5g x 20개입',
      'parseRule', 'per_item_times_count_v1',
      'parsedContentAmount', 1.5,
      'parsedContentUnit', 'g',
      'parsedPackageCount', 20,
      'packageCountBasis', 'explicit_specification',
      'matchesTarget', true
    )
  );

  perform * from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-structured-multipack-total:' || v_suffix,
    p_receipt_name => v_name || ' 그릭콩포트 블루베리',
    p_official_name => v_name || ' 그릭콩포트 블루베리',
    p_receipt_source_code => v_receipt_source_code || '_structured_multipack_total',
    p_official_source_code => v_official_source_code || '_structured_multipack_total',
    p_observed_at => v_observed_at,
    p_official_specification_text => '140g*2개/280g',
    p_link_only => true,
    p_content_amount_override => 140,
    p_content_unit_override => 'g',
    p_package_count_override => 2,
    p_official_specification_check_override => jsonb_build_object(
      'kind', 'structured_content',
      'specificationTextRaw', '140g*2개/280g',
      'parseRule', 'per_item_times_count_with_total_v1',
      'parsedContentAmount', 140,
      'parsedContentUnit', 'g',
      'parsedPackageCount', 2,
      'packageCountBasis', 'explicit_specification',
      'parsedTotalContentAmount', 280,
      'matchesTarget', true
    )
  );

  begin
    perform * from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-structured-bad-multipack-total:' || v_suffix,
      p_receipt_name => v_name || ' bad 그릭콩포트',
      p_official_name => v_name || ' bad 그릭콩포트',
      p_receipt_source_code => v_receipt_source_code || '_structured_bad_multipack_total',
      p_official_source_code => v_official_source_code || '_structured_bad_multipack_total',
      p_observed_at => v_observed_at,
      p_official_specification_text => '140g*2개/270g',
      p_link_only => true,
      p_content_amount_override => 140,
      p_content_unit_override => 'g',
      p_package_count_override => 2,
      p_official_specification_check_override => jsonb_build_object(
        'kind', 'structured_content',
        'specificationTextRaw', '140g*2개/270g',
        'parseRule', 'per_item_times_count_with_total_v1',
        'parsedContentAmount', 140,
        'parsedContentUnit', 'g',
        'parsedPackageCount', 2,
        'packageCountBasis', 'explicit_specification',
        'parsedTotalContentAmount', 270,
        'matchesTarget', true
      )
    );
    raise exception 'Mismatched stated multipack total was accepted.';
  exception
    when sqlstate '23514' then null;
  end;

  perform * from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-wiper-fitment:' || v_suffix,
    p_receipt_name => v_name || ' RainOK 와이퍼',
    p_official_name => v_name || ' RainOK 와이퍼',
    p_receipt_source_code => v_receipt_source_code || '_wiper_fitment',
    p_official_source_code => v_official_source_code || '_wiper_fitment',
    p_observed_at => v_observed_at,
    p_official_specification_text => '400mm',
    p_link_only => true,
    p_content_amount_override => 1,
    p_content_unit_override => 'each',
    p_package_count_override => 1,
    p_official_specification_check_override => jsonb_build_object(
      'kind', 'wiper_blade_fitment',
      'specificationTextRaw', '400mm',
      'parsedWiperBladeFitment', jsonb_build_object('lengthMm', 400),
      'matchesTarget', true
    ),
    p_identity_attributes_override => jsonb_build_object(
      'wiperBladeFitment', jsonb_build_object('lengthMm', 400)
    ),
    p_imported_official_fields_override => jsonb_build_array(
      'brand', 'wiperBladeFitment'
    )
  );

  perform * from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-structured-total-per-count:' || v_suffix,
    p_receipt_name => v_name || ' 마스크',
    p_official_name => v_name || ' 마스크',
    p_receipt_source_code => v_receipt_source_code || '_structured_total',
    p_official_source_code => v_official_source_code || '_structured_total',
    p_observed_at => v_observed_at,
    p_official_specification_text => '360g/30매입',
    p_link_only => true,
    p_content_amount_override => 12,
    p_content_unit_override => 'g',
    p_package_count_override => 30,
    p_official_specification_check_override => jsonb_build_object(
      'kind', 'structured_content',
      'specificationTextRaw', '360g/30매입',
      'parseRule', 'total_amount_per_count_v1',
      'parsedContentAmount', 12,
      'parsedContentUnit', 'g',
      'parsedPackageCount', 30,
      'packageCountBasis', 'explicit_specification',
      'parsedTotalContentAmount', 360,
      'matchesTarget', true
    )
  );

  perform * from pg_temp.run_strict_link_probe(
    p_case_id => 'strict-probe-structured-name-unit:' || v_suffix,
    p_receipt_name => v_name || ' 칼국수 424.8g',
    p_official_name => v_name || ' 칼국수 424.8g',
    p_receipt_source_code => v_receipt_source_code || '_structured_name_unit',
    p_official_source_code => v_official_source_code || '_structured_name_unit',
    p_observed_at => v_observed_at,
    p_official_specification_text => '424.8',
    p_link_only => true,
    p_content_amount_override => 424.8,
    p_content_unit_override => 'g',
    p_package_count_override => 1,
    p_official_specification_check_override => jsonb_build_object(
      'kind', 'structured_content',
      'specificationTextRaw', '424.8',
      'parseRule', 'numeric_spec_unit_from_official_name_v1',
      'parsedContentAmount', 424.8,
      'parsedContentUnit', 'g',
      'parsedPackageCount', 1,
      'packageCountBasis', 'default_one_absent_count',
      'matchedOfficialNameFragment', '424.8g',
      'matchesTarget', true
    )
  );

  begin
    perform * from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-structured-inflated-total:' || v_suffix,
      p_receipt_name => v_name || ' bad mask',
      p_official_name => v_name || ' bad mask',
      p_receipt_source_code => v_receipt_source_code || '_structured_bad_total',
      p_official_source_code => v_official_source_code || '_structured_bad_total',
      p_observed_at => v_observed_at,
      p_official_specification_text => '360g/30매입',
      p_link_only => true,
      p_content_amount_override => 360,
      p_content_unit_override => 'g',
      p_package_count_override => 30,
      p_official_specification_check_override => jsonb_build_object(
        'kind', 'structured_content',
        'specificationTextRaw', '360g/30매입',
        'parseRule', 'total_amount_per_count_v1',
        'parsedContentAmount', 12,
        'parsedContentUnit', 'g',
        'parsedPackageCount', 30,
        'packageCountBasis', 'explicit_specification',
        'parsedTotalContentAmount', 360,
        'matchesTarget', true
      )
    );
    raise exception 'Inflated total-per-count target was accepted.';
  exception
    when sqlstate '23514' then null;
  end;

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
      p_case_id => 'strict-probe-two-character-equivalence:' || v_suffix,
      p_receipt_name => v_name || '속가',
      p_official_name => v_name || '숙나',
      p_receipt_source_code => v_receipt_source_code || '_two_character',
      p_official_source_code => v_official_source_code || '_two_character',
      p_observed_at => v_observed_at,
      p_verified_equivalence => true
    );
    raise exception 'A two-character name mismatch was accepted as verified equivalence.';
  exception
    when check_violation then null;
  end;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-link-only-empty-brand:' || v_suffix,
      p_receipt_name => v_name || ' 500 m',
      p_official_name => v_name || ' 500 ml',
      p_receipt_source_code => v_receipt_source_code || '_link_only_empty_brand',
      p_official_source_code => v_official_source_code || '_link_only_empty_brand',
      p_observed_at => v_observed_at,
      p_verified_insertion_deletion => true,
      p_link_only => true,
      p_brand_name_override => ''
    );
    raise exception 'A link-only proposal with an empty canonical brand was accepted.';
  exception
    when check_violation then null;
  end;

  begin
    perform 1
    from pg_temp.run_strict_link_probe(
      p_case_id => 'strict-probe-link-only-malformed-review-time:' || v_suffix,
      p_receipt_name => v_name || ' 500 m',
      p_official_name => v_name || ' 500 ml',
      p_receipt_source_code => v_receipt_source_code || '_link_only_bad_review_time',
      p_official_source_code => v_official_source_code || '_link_only_bad_review_time',
      p_observed_at => v_observed_at,
      p_verified_insertion_deletion => true,
      p_link_only => true,
      p_reviewed_at_override => '2026-02-31T12:00:00+09:00'
    );
    raise exception 'A link-only proposal with malformed review audit time was accepted.';
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

begin;

do $$
declare
  v_target jsonb := '{
    "sameChannelNameRule": {
      "outcome": "apply_verified_name_equivalence",
      "verifiedEquivalence": {
        "method": "explicit_user_selected_frozen_pair_v1",
        "scope": "frozen_receipt_official_pair_only",
        "selectedReceiptSourceId": "receipt:item",
        "selectedOfficialSourceId": "px:namespace:30118",
        "selectedNormalizedReceiptName": "Dr.G레드-블레미쉬클리어크림_7",
        "selectedNormalizedOfficialName": "Dr.G레드-블래미쉬클리어크림_70ml",
        "userSelectionSourceRef": "user:image",
        "userSelectionContentHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    },
    "userSelectedOfficialVariant": {
      "scope": "frozen_receipt_official_pair_only",
      "selectedReceiptSourceId": "receipt:item",
      "selectedOfficialSourceId": "px:namespace:30118",
      "selectedSpecificationTextRaw": "70ml",
      "selectionSourceRef": "user:image",
      "selectionContentHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "selectedAt": "2026-08-05T00:35:35+09:00"
    },
    "review": {
      "verdict": "approve",
      "reviewerAgent": "pricetrace_independent_reviewer",
      "evidenceQuality": "sufficient",
      "conflicts": []
    },
    "evidence": [
      {"sourceType":"receipt","authority":"transactional","sourceId":"receipt:item"},
      {"sourceType":"official_channel","authority":"primary","sourceId":"px:namespace:30118"},
      {"sourceType":"brand","authority":"primary","sourceId":"brand:dr-g"}
    ]
  }'::jsonb;
begin
  if not public.is_verified_explicit_user_selected_frozen_pair(
    v_target,
    'Dr.G레드-블레미쉬클리어크림_7',
    'Dr.G레드-블래미쉬클리어크림_70ml',
    'receipt:item',
    'px:namespace:30118',
    '70ml'
  ) then
    raise exception 'explicit user-selected frozen pair should validate';
  end if;

  if public.is_verified_explicit_user_selected_frozen_pair(
    jsonb_set(v_target, '{userSelectedOfficialVariant,selectionContentHash}', '"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"'),
    'Dr.G레드-블레미쉬클리어크림_7',
    'Dr.G레드-블래미쉬클리어크림_70ml',
    'receipt:item',
    'px:namespace:30118',
    '70ml'
  ) then
    raise exception 'selection hash mismatch must fail closed';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.is_verified_explicit_user_selected_frozen_pair(jsonb,text,text,text,text,text)',
    'execute'
  ) then
    raise exception 'explicit user-selection helper must not be executable by authenticated';
  end if;
end
$$;

do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.approve_and_register_standard_product_link_only_v1(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,jsonb)'::regprocedure
  ) into v_definition;
  if position('cardinality(p_source_labels) <> 1' in v_definition) = 0
    or position('composite_kit' in v_definition) = 0
    or position('razor_handle' in v_definition) = 0
    or position('razor_blade' in v_definition) = 0
    or position('wiper_blade_fitment' in v_definition) = 0
    or position('per_item_times_count_with_total_v1' in v_definition) = 0
    or position('v_expected_attributes' in v_definition) = 0
  then
    raise exception 'link-only RPC must enforce one source label and typed composite kits';
  end if;
end
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
