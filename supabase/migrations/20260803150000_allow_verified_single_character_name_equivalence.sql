-- Permit one narrowly audited source-name typo without weakening the existing
-- exact-name branch. Raw receipt and official names remain frozen and covered
-- by the existing input fingerprint. The proof is covered by the target
-- fingerprint and is limited to one Unicode code-point substitution.

create or replace function public.is_verified_single_codepoint_name_equivalence(
  p_target jsonb,
  p_receipt_name text,
  p_official_name text,
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
  ), difference as (
    select
      names.*,
      (
        select pg_catalog.count(*)
        from pg_catalog.generate_series(1, pg_catalog.char_length(names.receipt_name)) as position(index)
        where pg_catalog.substr(names.receipt_name, position.index, 1)
          <> pg_catalog.substr(names.official_name, position.index, 1)
      ) as difference_count,
      (
        select pg_catalog.min(position.index) - 1
        from pg_catalog.generate_series(1, pg_catalog.char_length(names.receipt_name)) as position(index)
        where pg_catalog.substr(names.receipt_name, position.index, 1)
          <> pg_catalog.substr(names.official_name, position.index, 1)
      ) as zero_based_difference_index
    from names
  )
  select coalesce((
    select
      difference.rule ->> 'normalization' = 'remove_unicode_whitespace_only'
      and (difference.rule ->> 'sameChannel')::boolean is true
      and (difference.rule ->> 'exactNameMatch')::boolean is false
      and difference.rule ->> 'outcome' = 'apply_verified_name_equivalence'
      and difference.rule ->> 'normalizedReceiptName' = difference.receipt_name
      and difference.rule ->> 'normalizedOfficialName' = difference.official_name
      and difference.receipt_name <> difference.official_name
      and pg_catalog.char_length(difference.receipt_name)
        = pg_catalog.char_length(difference.official_name)
      and difference.difference_count = 1
      and pg_catalog.jsonb_typeof(difference.proof) = 'object'
      and difference.proof ->> 'method' = 'single_unicode_code_point_substitution_v1'
      and difference.proof ->> 'scope' = 'frozen_receipt_official_pair_only'
      and difference.proof ->> 'zeroBasedCodePointIndex' ~ '^[0-9]+$'
      and (difference.proof ->> 'zeroBasedCodePointIndex')::integer
        = difference.zero_based_difference_index
      and difference.proof ->> 'receiptCodePoint'
        = pg_catalog.substr(
            difference.receipt_name,
            difference.zero_based_difference_index + 1,
            1
          )
      and difference.proof ->> 'officialCodePoint'
        = pg_catalog.substr(
            difference.official_name,
            difference.zero_based_difference_index + 1,
            1
          )
      and difference.proof ->> 'reviewerAgent' = 'pricetrace_independent_reviewer'
      and coalesce(difference.proof ->> 'reviewedAt', '') <> ''
      and difference.proof ->> 'conclusion' = 'same_exact_sellable_variant'
      and pg_catalog.jsonb_typeof(difference.proof -> 'supportingEvidenceSourceIds') = 'array'
      and pg_catalog.jsonb_array_length(difference.proof -> 'supportingEvidenceSourceIds') >= 2
      and pg_catalog.jsonb_array_length(difference.proof -> 'supportingEvidenceSourceIds') = (
        select pg_catalog.count(distinct source_id.value)
        from pg_catalog.jsonb_array_elements_text(
          difference.proof -> 'supportingEvidenceSourceIds'
        ) as source_id(value)
      )
      and pg_catalog.jsonb_typeof(difference.proof -> 'supportingSourceRefs') = 'array'
      and pg_catalog.jsonb_array_length(difference.proof -> 'supportingSourceRefs') >= 2
      and pg_catalog.jsonb_array_length(difference.proof -> 'supportingSourceRefs') = (
        select pg_catalog.count(distinct source_ref.value)
        from pg_catalog.jsonb_array_elements_text(
          difference.proof -> 'supportingSourceRefs'
        ) as source_ref(value)
      )
      and pg_catalog.jsonb_typeof(difference.evidence) = 'array'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(difference.evidence) as evidence(item)
        where evidence.item ->> 'sourceType' = 'official_channel'
          and evidence.item ->> 'authority' = 'primary'
          and evidence.item ->> 'sourceId' = p_official_source_id
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements_text(
              difference.proof -> 'supportingEvidenceSourceIds'
            ) as source_id(value)
            where source_id.value = evidence.item ->> 'sourceId'
          )
      )
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(difference.evidence) as evidence(item)
        where evidence.item ->> 'sourceType' in ('manufacturer', 'brand')
          and evidence.item ->> 'authority' = 'primary'
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements_text(
              difference.proof -> 'supportingEvidenceSourceIds'
            ) as source_id(value)
            where source_id.value = evidence.item ->> 'sourceId'
          )
      )
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(
          difference.proof -> 'supportingSourceRefs'
        ) as required_ref(value)
        where not exists (
          select 1
          from pg_catalog.jsonb_array_elements(difference.evidence) as evidence(item)
          cross join lateral pg_catalog.jsonb_array_elements_text(
            evidence.item -> 'sourceRefs'
          ) as evidence_ref(value)
          where evidence_ref.value = required_ref.value
            and exists (
              select 1
              from pg_catalog.jsonb_array_elements_text(
                difference.proof -> 'supportingEvidenceSourceIds'
              ) as source_id(value)
              where source_id.value = evidence.item ->> 'sourceId'
            )
        )
      )
      and difference.review ->> 'verdict' = 'approve'
      and difference.review ->> 'reviewerAgent' = difference.proof ->> 'reviewerAgent'
      and difference.review ->> 'evidenceQuality' = 'sufficient'
      and pg_catalog.jsonb_typeof(difference.review -> 'conflicts') = 'array'
      and pg_catalog.jsonb_array_length(difference.review -> 'conflicts') = 0
    from difference
  ), false);
$function$;

revoke all on function public.is_verified_single_codepoint_name_equivalence(
  jsonb, text, text, text
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
    or coalesce((v_rule ->> 'exactNameMatch')::boolean, false) is not true
    or coalesce(v_rule ->> 'outcome', '') <> 'apply_official_identity'
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> regexp_replace(coalesce(v_receipt ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedOfficialName', '')
      <> regexp_replace(coalesce(v_official ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> coalesce(v_rule ->> 'normalizedOfficialName', '')
$fragment$;
  v_v3_new text := $fragment$
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> regexp_replace(coalesce(v_receipt ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedOfficialName', '')
      <> regexp_replace(coalesce(v_official ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or not (
      (
        coalesce((v_rule ->> 'exactNameMatch')::boolean, false) is true
        and coalesce(v_rule ->> 'outcome', '') = 'apply_official_identity'
        and coalesce(v_rule ->> 'normalizedReceiptName', '')
          = coalesce(v_rule ->> 'normalizedOfficialName', '')
      )
      or public.is_verified_single_codepoint_name_equivalence(
        v_target,
        coalesce(v_receipt ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'channelId', '') || ':'
          || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
          || coalesce(v_official ->> 'sourceProductCode', '')
      )
    )
$fragment$;
  v_v5_old text := $fragment$
    or regexp_replace(coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
      <> regexp_replace(coalesce(v_official ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', '') <> p_receipt_product_name
$fragment$;
  v_v5_new text := $fragment$
    or (
      regexp_replace(coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
        <> regexp_replace(coalesce(v_official ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
      and not public.is_verified_single_codepoint_name_equivalence(
        v_target,
        coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'channelId', '') || ':'
          || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
          || coalesce(v_official ->> 'sourceProductCode', '')
      )
    )
    or coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', '') <> p_receipt_product_name
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_v3_signature) into v_v3_definition;
  select pg_catalog.pg_get_functiondef(v_v5_signature) into v_v5_definition;

  if pg_catalog.strpos(v_v3_definition, v_v3_old) = 0
    or pg_catalog.strpos(v_v5_definition, v_v5_old) = 0
  then
    raise exception 'Unexpected strict name-equivalence contract.';
  end if;

  v_v3_updated := pg_catalog.replace(v_v3_definition, v_v3_old, v_v3_new);
  v_v5_updated := pg_catalog.replace(v_v5_definition, v_v5_old, v_v5_new);

  if v_v3_updated = v_v3_definition
    or v_v5_updated = v_v5_definition
    or pg_catalog.strpos(v_v3_updated, v_v3_new) = 0
    or pg_catalog.strpos(v_v5_updated, v_v5_new) = 0
  then
    raise exception 'The strict verified-name-equivalence patch was not applied.';
  end if;

  execute v_v3_updated;
  execute v_v5_updated;
end;
$migration$;

comment on function public.is_verified_single_codepoint_name_equivalence(
  jsonb, text, text, text
) is
  'Validates one frozen, independently reviewed Unicode code-point substitution backed by official and manufacturer or brand primary evidence.';

comment on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Applies exact-name or narrowly verified single-code-point same-channel identity while preserving all frozen-input and effect checks.';

comment on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Requires independent review and accepts only exact names or a validated frozen single-code-point equivalence before V4.';
