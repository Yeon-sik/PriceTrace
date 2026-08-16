-- Permit one item-specific truncated receipt label when the longer official
-- name contains it exactly once and the frozen PX displayed price equals the
-- receipt unit price. This remains an independently reviewed same-channel
-- exception; it is not a global fuzzy or substring auto-link.

create or replace function public.is_verified_official_name_containment(
  p_target jsonb,
  p_receipt_name text,
  p_official_name text,
  p_receipt_source_id text,
  p_receipt_unit_price_krw integer,
  p_official_price jsonb,
  p_official_source_id text
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  with names as (
    select
      pg_catalog.regexp_replace(coalesce(p_receipt_name, ''), '[[:space:]]+', '', 'g') as receipt_name,
      pg_catalog.regexp_replace(coalesce(p_official_name, ''), '[[:space:]]+', '', 'g') as official_name,
      p_target -> 'sameChannelNameRule' as rule,
      p_target -> 'sameChannelNameRule' -> 'verifiedEquivalence' as proof,
      p_target -> 'evidence' as evidence,
      p_target -> 'review' as review
  ), containment as (
    select
      names.*,
      pg_catalog.strpos(names.official_name, names.receipt_name) as one_based_index,
      pg_catalog.char_length(names.receipt_name) as receipt_length,
      pg_catalog.char_length(names.official_name) as official_length
    from names
  )
  select coalesce((
    select
      containment.rule ->> 'normalization' = 'remove_unicode_whitespace_only'
      and (containment.rule ->> 'sameChannel')::boolean is true
      and (containment.rule ->> 'exactNameMatch')::boolean is false
      and containment.rule ->> 'outcome' = 'apply_verified_name_equivalence'
      and containment.rule ->> 'normalizedReceiptName' = containment.receipt_name
      and containment.rule ->> 'normalizedOfficialName' = containment.official_name
      and containment.receipt_length >= 6
      and containment.official_length > containment.receipt_length
      and containment.receipt_length::numeric / containment.official_length::numeric >= 0.6
      and containment.one_based_index > 0
      and pg_catalog.strpos(
        pg_catalog.substr(
          containment.official_name,
          containment.one_based_index + containment.receipt_length
        ),
        containment.receipt_name
      ) = 0
      and pg_catalog.jsonb_typeof(containment.proof) = 'object'
      and containment.proof ->> 'method' = 'official_name_contains_receipt_name_v1'
      and containment.proof ->> 'scope' = 'frozen_receipt_official_pair_only'
      and containment.proof ->> 'zeroBasedOfficialCodePointIndex' ~ '^[0-9]+$'
      and (containment.proof ->> 'zeroBasedOfficialCodePointIndex')::integer
        = containment.one_based_index - 1
      and containment.proof ->> 'receiptCodePointLength' ~ '^[1-9][0-9]*$'
      and (containment.proof ->> 'receiptCodePointLength')::integer
        = containment.receipt_length
      and containment.proof ->> 'officialCodePointLength' ~ '^[1-9][0-9]*$'
      and (containment.proof ->> 'officialCodePointLength')::integer
        = containment.official_length
      and containment.proof ->> 'officialPrefix'
        = pg_catalog.substr(containment.official_name, 1, containment.one_based_index - 1)
      and containment.proof ->> 'officialSuffix'
        = pg_catalog.substr(
            containment.official_name,
            containment.one_based_index + containment.receipt_length
          )
      and containment.proof ->> 'officialDisplayedPriceKrw' ~ '^[0-9]+$'
      and (containment.proof ->> 'officialDisplayedPriceKrw')::integer
        = p_receipt_unit_price_krw
      and pg_catalog.jsonb_typeof(p_official_price) = 'object'
      and (p_official_price ->> 'amountKrw')::integer = p_receipt_unit_price_krw
      and containment.proof ->> 'officialPriceObservedAt'
        = p_official_price ->> 'observedAt'
      and (containment.proof ->> 'uniqueOfficialCandidate')::boolean is true
      and containment.proof ->> 'reviewerAgent' = 'pricetrace_independent_reviewer'
      and coalesce(containment.proof ->> 'reviewedAt', '') <> ''
      and containment.proof ->> 'conclusion' = 'same_exact_sellable_variant'
      and pg_catalog.jsonb_typeof(containment.proof -> 'supportingEvidenceSourceIds') = 'array'
      and pg_catalog.jsonb_array_length(containment.proof -> 'supportingEvidenceSourceIds') >= 2
      and pg_catalog.jsonb_array_length(containment.proof -> 'supportingEvidenceSourceIds') = (
        select pg_catalog.count(distinct source_id.value)
        from pg_catalog.jsonb_array_elements_text(
          containment.proof -> 'supportingEvidenceSourceIds'
        ) as source_id(value)
      )
      and pg_catalog.jsonb_typeof(containment.proof -> 'supportingSourceRefs') = 'array'
      and pg_catalog.jsonb_array_length(containment.proof -> 'supportingSourceRefs') >= 2
      and pg_catalog.jsonb_array_length(containment.proof -> 'supportingSourceRefs') = (
        select pg_catalog.count(distinct source_ref.value)
        from pg_catalog.jsonb_array_elements_text(
          containment.proof -> 'supportingSourceRefs'
        ) as source_ref(value)
      )
      and pg_catalog.jsonb_typeof(containment.evidence) = 'array'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(containment.evidence) as evidence(item)
        where evidence.item ->> 'sourceType' = 'receipt'
          and evidence.item ->> 'authority' = 'transactional'
          and evidence.item ->> 'sourceId' = p_receipt_source_id
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements_text(
              containment.proof -> 'supportingEvidenceSourceIds'
            ) as source_id(value)
            where source_id.value = evidence.item ->> 'sourceId'
          )
      )
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(containment.evidence) as evidence(item)
        where evidence.item ->> 'sourceType' = 'official_channel'
          and evidence.item ->> 'authority' = 'primary'
          and evidence.item ->> 'sourceId' = p_official_source_id
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements_text(
              containment.proof -> 'supportingEvidenceSourceIds'
            ) as source_id(value)
            where source_id.value = evidence.item ->> 'sourceId'
          )
      )
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(
          containment.proof -> 'supportingSourceRefs'
        ) as required_ref(value)
        where not exists (
          select 1
          from pg_catalog.jsonb_array_elements(containment.evidence) as evidence(item)
          cross join lateral pg_catalog.jsonb_array_elements_text(
            evidence.item -> 'sourceRefs'
          ) as evidence_ref(value)
          where evidence_ref.value = required_ref.value
            and exists (
              select 1
              from pg_catalog.jsonb_array_elements_text(
                containment.proof -> 'supportingEvidenceSourceIds'
              ) as source_id(value)
              where source_id.value = evidence.item ->> 'sourceId'
            )
        )
      )
      and containment.review ->> 'verdict' = 'approve'
      and containment.review ->> 'reviewerAgent' = containment.proof ->> 'reviewerAgent'
      and containment.review ->> 'evidenceQuality' = 'sufficient'
      and pg_catalog.jsonb_typeof(containment.review -> 'conflicts') = 'array'
      and pg_catalog.jsonb_array_length(containment.review -> 'conflicts') = 0
    from containment
  ), false);
$function$;

revoke all on function public.is_verified_official_name_containment(
  jsonb, text, text, text, integer, jsonb, text
) from public, anon, authenticated;

do $migration$
declare
  v_v3_signature regprocedure :=
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_v5_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_v3_definition text;
  v_v3_updated text;
  v_v5_definition text;
  v_v5_updated text;
  v_v3_old text := $fragment$
      or public.is_verified_single_codepoint_name_equivalence(
        v_target,
        coalesce(v_receipt ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'channelId', '') || ':'
          || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
          || coalesce(v_official ->> 'sourceProductCode', '')
      )
$fragment$;
  v_v3_new text := $fragment$
      or public.is_verified_single_codepoint_name_equivalence(
        v_target,
        coalesce(v_receipt ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'channelId', '') || ':'
          || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
          || coalesce(v_official ->> 'sourceProductCode', '')
      )
      or public.is_verified_official_name_containment(
        v_target,
        coalesce(v_receipt ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'sourceNameRaw', ''),
        coalesce(v_receipt ->> 'receiptId', '') || ':'
          || coalesce(v_receipt ->> 'receiptItemId', ''),
        coalesce((v_receipt ->> 'unitPriceKrw')::integer, -1),
        v_official -> 'officialPrice',
        coalesce(v_official ->> 'channelId', '') || ':'
          || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
          || coalesce(v_official ->> 'sourceProductCode', '')
      )
$fragment$;
  v_v5_old text := $fragment$
      and not public.is_verified_single_codepoint_name_equivalence(
        v_target,
        coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'channelId', '') || ':'
          || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
          || coalesce(v_official ->> 'sourceProductCode', '')
      )
$fragment$;
  v_v5_new text := $fragment$
      and not (
        public.is_verified_single_codepoint_name_equivalence(
          v_target,
          coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', ''),
          coalesce(v_official ->> 'sourceNameRaw', ''),
          coalesce(v_official ->> 'channelId', '') || ':'
            || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
            || coalesce(v_official ->> 'sourceProductCode', '')
        )
        or public.is_verified_official_name_containment(
          v_target,
          coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', ''),
          coalesce(v_official ->> 'sourceNameRaw', ''),
          coalesce(v_input -> 'receipt' ->> 'receiptId', '') || ':'
            || coalesce(v_input -> 'receipt' ->> 'receiptItemId', ''),
          coalesce((v_input -> 'receipt' ->> 'unitPriceKrw')::integer, -1),
          v_official -> 'officialPrice',
          coalesce(v_official ->> 'channelId', '') || ':'
            || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
            || coalesce(v_official ->> 'sourceProductCode', '')
        )
      )
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_v3_signature) into v_v3_definition;
  select pg_catalog.pg_get_functiondef(v_v5_signature) into v_v5_definition;

  if pg_catalog.strpos(v_v3_definition, v_v3_old) = 0
    or pg_catalog.strpos(v_v5_definition, v_v5_old) = 0
  then
    raise exception 'Unexpected strict containment patch contract.';
  end if;

  v_v3_updated := pg_catalog.replace(v_v3_definition, v_v3_old, v_v3_new);
  v_v5_updated := pg_catalog.replace(v_v5_definition, v_v5_old, v_v5_new);

  if v_v3_updated = v_v3_definition
    or v_v5_updated = v_v5_definition
    or pg_catalog.strpos(v_v3_updated, 'is_verified_official_name_containment') = 0
    or pg_catalog.strpos(v_v5_updated, 'is_verified_official_name_containment') = 0
  then
    raise exception 'The strict verified containment patch was not applied.';
  end if;

  execute v_v3_updated;
  execute v_v5_updated;
end;
$migration$;

comment on function public.is_verified_official_name_containment(
  jsonb, text, text, text, integer, jsonb, text
) is
  'Validates one frozen same-channel receipt-name truncation with a unique official-name occurrence, equal frozen PX and receipt prices, and independent approval.';
