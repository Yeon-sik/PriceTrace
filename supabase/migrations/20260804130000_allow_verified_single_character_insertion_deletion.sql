-- Permit one item-specific Unicode code-point insertion or deletion only when
-- the frozen same-channel names retain at least 90% discovery similarity, the
-- complete official snapshot has one candidate, and independent primary
-- evidence plus review are bound into the approved target fingerprint.

create or replace function public.is_valid_explicit_offset_datetime(
  p_value text
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if not coalesce(
    p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$',
    false
  )
  then
    return false;
  end if;

  perform p_value::timestamptz;
  return true;
exception
  when others then return false;
end;
$function$;

revoke all on function public.is_valid_explicit_offset_datetime(text)
from public, anon, authenticated;

create or replace function public.is_verified_single_codepoint_name_insertion_deletion(
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
      pg_catalog.lower(pg_catalog.regexp_replace(coalesce(p_receipt_name, ''), '[^0-9A-Za-z가-힣]+', '', 'g')) as discovery_receipt_name,
      pg_catalog.lower(pg_catalog.regexp_replace(coalesce(p_official_name, ''), '[^0-9A-Za-z가-힣]+', '', 'g')) as discovery_official_name,
      p_target -> 'sameChannelNameRule' as rule,
      p_target -> 'sameChannelNameRule' -> 'verifiedEquivalence' as proof,
      p_target -> 'evidence' as evidence,
      p_target -> 'review' as review
  ), shape as (
    select
      names.*,
      pg_catalog.char_length(names.receipt_name) as receipt_length,
      pg_catalog.char_length(names.official_name) as official_length,
      case
        when pg_catalog.char_length(names.official_name)
          = pg_catalog.char_length(names.receipt_name) + 1
          then 'insert_official_code_point_into_receipt'
        when pg_catalog.char_length(names.receipt_name)
          = pg_catalog.char_length(names.official_name) + 1
          then 'delete_receipt_code_point'
        else null
      end as edit_direction,
      case
        when pg_catalog.char_length(names.official_name)
          = pg_catalog.char_length(names.receipt_name) + 1
          then names.official_name
        when pg_catalog.char_length(names.receipt_name)
          = pg_catalog.char_length(names.official_name) + 1
          then names.receipt_name
        else ''
      end as longer_name,
      case
        when pg_catalog.char_length(names.official_name)
          = pg_catalog.char_length(names.receipt_name) + 1
          then names.receipt_name
        when pg_catalog.char_length(names.receipt_name)
          = pg_catalog.char_length(names.official_name) + 1
          then names.official_name
        else ''
      end as shorter_name
    from names
  ), edit as (
    select
      shape.*,
      (
        select pg_catalog.count(*)
        from pg_catalog.generate_series(1, pg_catalog.char_length(shape.longer_name)) as position(index)
        where pg_catalog.substr(shape.longer_name, 1, position.index - 1)
          || pg_catalog.substr(shape.longer_name, position.index + 1)
          = shape.shorter_name
      ) as edit_count,
      (
        select pg_catalog.min(position.index)
        from pg_catalog.generate_series(1, pg_catalog.char_length(shape.longer_name)) as position(index)
        where pg_catalog.substr(shape.longer_name, 1, position.index - 1)
          || pg_catalog.substr(shape.longer_name, position.index + 1)
          = shape.shorter_name
      ) as one_based_edit_index
    from shape
  ), scored as (
    select
      edit.*,
      case
        when edit.discovery_receipt_name = edit.discovery_official_name then 10000
        when pg_catalog.abs(
          pg_catalog.char_length(edit.discovery_receipt_name)
          - pg_catalog.char_length(edit.discovery_official_name)
        ) = 1
        then pg_catalog.floor(
          least(
            pg_catalog.char_length(edit.discovery_receipt_name),
            pg_catalog.char_length(edit.discovery_official_name)
          )::numeric * 10000
          / greatest(
            pg_catalog.char_length(edit.discovery_receipt_name),
            pg_catalog.char_length(edit.discovery_official_name)
          )::numeric
        )::integer
        else 0
      end as discovery_similarity_basis_points
    from edit
  )
  select coalesce((
    select
      scored.rule ->> 'normalization' = 'remove_unicode_whitespace_only'
      and (scored.rule ->> 'sameChannel')::boolean is true
      and (scored.rule ->> 'exactNameMatch')::boolean is false
      and scored.rule ->> 'outcome' = 'apply_verified_name_equivalence'
      and scored.rule ->> 'normalizedReceiptName' = scored.receipt_name
      and scored.rule ->> 'normalizedOfficialName' = scored.official_name
      and scored.edit_direction is not null
      and scored.edit_count = 1
      and scored.discovery_similarity_basis_points >= 9000
      and pg_catalog.jsonb_typeof(scored.proof) = 'object'
      and scored.proof ->> 'method' = 'single_unicode_code_point_insertion_deletion_v1'
      and scored.proof ->> 'scope' = 'frozen_receipt_official_pair_only'
      and scored.proof ->> 'editDirection' = scored.edit_direction
      and scored.proof ->> 'zeroBasedEditIndex' ~ '^[0-9]+$'
      and (scored.proof ->> 'zeroBasedEditIndex')::integer
        = scored.one_based_edit_index - 1
      and scored.proof ->> 'editedCodePoint'
        = pg_catalog.substr(scored.longer_name, scored.one_based_edit_index, 1)
      and scored.proof ->> 'receiptCodePointLength' ~ '^[1-9][0-9]*$'
      and (scored.proof ->> 'receiptCodePointLength')::integer = scored.receipt_length
      and scored.proof ->> 'officialCodePointLength' ~ '^[1-9][0-9]*$'
      and (scored.proof ->> 'officialCodePointLength')::integer = scored.official_length
      and scored.proof ->> 'discoverySimilarityBasisPoints' ~ '^[0-9]+$'
      and (scored.proof ->> 'discoverySimilarityBasisPoints')::integer
        = scored.discovery_similarity_basis_points
      and (scored.proof ->> 'uniqueOfficialCandidate')::boolean is true
      and scored.proof ->> 'reviewerAgent' = 'pricetrace_independent_reviewer'
      and public.is_valid_explicit_offset_datetime(scored.proof ->> 'reviewedAt')
      and scored.proof ->> 'conclusion' = 'same_exact_sellable_variant'
      and pg_catalog.jsonb_typeof(scored.proof -> 'supportingEvidenceSourceIds') = 'array'
      and pg_catalog.jsonb_array_length(scored.proof -> 'supportingEvidenceSourceIds') >= 2
      and pg_catalog.jsonb_array_length(scored.proof -> 'supportingEvidenceSourceIds') = (
        select pg_catalog.count(distinct source_id.value)
        from pg_catalog.jsonb_array_elements_text(
          scored.proof -> 'supportingEvidenceSourceIds'
        ) as source_id(value)
      )
      and pg_catalog.jsonb_typeof(scored.proof -> 'supportingSourceRefs') = 'array'
      and pg_catalog.jsonb_array_length(scored.proof -> 'supportingSourceRefs') >= 2
      and pg_catalog.jsonb_array_length(scored.proof -> 'supportingSourceRefs') = (
        select pg_catalog.count(distinct source_ref.value)
        from pg_catalog.jsonb_array_elements_text(
          scored.proof -> 'supportingSourceRefs'
        ) as source_ref(value)
      )
      and pg_catalog.jsonb_typeof(scored.evidence) = 'array'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(scored.evidence) as evidence(item)
        where evidence.item ->> 'sourceType' = 'official_channel'
          and evidence.item ->> 'authority' = 'primary'
          and evidence.item ->> 'sourceId' = p_official_source_id
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements_text(
              scored.proof -> 'supportingEvidenceSourceIds'
            ) as source_id(value)
            where source_id.value = evidence.item ->> 'sourceId'
          )
      )
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(scored.evidence) as evidence(item)
        where evidence.item ->> 'sourceType' in ('manufacturer', 'brand')
          and evidence.item ->> 'authority' = 'primary'
          and exists (
            select 1
            from pg_catalog.jsonb_array_elements_text(
              scored.proof -> 'supportingEvidenceSourceIds'
            ) as source_id(value)
            where source_id.value = evidence.item ->> 'sourceId'
          )
      )
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(
          scored.proof -> 'supportingSourceRefs'
        ) as required_ref(value)
        where not exists (
          select 1
          from pg_catalog.jsonb_array_elements(scored.evidence) as evidence(item)
          cross join lateral pg_catalog.jsonb_array_elements_text(
            evidence.item -> 'sourceRefs'
          ) as evidence_ref(value)
          where evidence_ref.value = required_ref.value
            and exists (
              select 1
              from pg_catalog.jsonb_array_elements_text(
                scored.proof -> 'supportingEvidenceSourceIds'
              ) as source_id(value)
              where source_id.value = evidence.item ->> 'sourceId'
            )
        )
      )
      and scored.review ->> 'verdict' = 'approve'
      and scored.review ->> 'reviewerAgent' = scored.proof ->> 'reviewerAgent'
      and scored.review ->> 'evidenceQuality' = 'sufficient'
      and pg_catalog.jsonb_typeof(scored.review -> 'conflicts') = 'array'
      and pg_catalog.jsonb_array_length(scored.review -> 'conflicts') = 0
    from scored
  ), false);
$function$;

revoke all on function public.is_verified_single_codepoint_name_insertion_deletion(
  jsonb, text, text, text
) from public, anon, authenticated;

do $migration$
declare
  v_v3_signature regprocedure :=
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_v5_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_link_only_signature regprocedure :=
    'public.approve_and_register_standard_product_link_only_v1(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,jsonb)'::regprocedure;
  v_v3_definition text;
  v_v3_updated text;
  v_v5_definition text;
  v_v5_updated text;
  v_link_only_definition text;
  v_link_only_updated text;
  v_v3_old text := $fragment$
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
  v_v3_new text := v_v3_old || $fragment$
      or public.is_verified_single_codepoint_name_insertion_deletion(
        v_target,
        coalesce(v_receipt ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'sourceNameRaw', ''),
        coalesce(v_official ->> 'channelId', '') || ':'
          || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
          || coalesce(v_official ->> 'sourceProductCode', '')
      )
$fragment$;
  v_v5_old text := $fragment$
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
$fragment$;
  v_v5_new text := v_v5_old || $fragment$
        or public.is_verified_single_codepoint_name_insertion_deletion(
          v_target,
          coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', ''),
          coalesce(v_official ->> 'sourceNameRaw', ''),
          coalesce(v_official ->> 'channelId', '') || ':'
            || coalesce(v_official ->> 'sourceProductCodeNamespace', '') || ':'
            || coalesce(v_official ->> 'sourceProductCode', '')
        )
$fragment$;
  v_link_only_old text := $fragment$
    or public.is_verified_official_name_containment(
      v_target,
      v_receipt ->> 'sourceNameRaw',
      v_official ->> 'sourceNameRaw',
      v_receipt_source_id,
      (v_receipt ->> 'unitPriceKrw')::integer,
      v_official -> 'officialPrice',
      v_official_source_id
    )
$fragment$;
  v_link_only_new text := v_link_only_old || $fragment$
    or public.is_verified_single_codepoint_name_insertion_deletion(
      v_target,
      v_receipt ->> 'sourceNameRaw',
      v_official ->> 'sourceNameRaw',
      v_official_source_id
    )
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_v3_signature) into v_v3_definition;
  select pg_catalog.pg_get_functiondef(v_v5_signature) into v_v5_definition;
  select pg_catalog.pg_get_functiondef(v_link_only_signature) into v_link_only_definition;

  if pg_catalog.strpos(v_v3_definition, v_v3_old) = 0
    or pg_catalog.strpos(v_v5_definition, v_v5_old) = 0
    or pg_catalog.strpos(v_link_only_definition, v_link_only_old) = 0
  then
    raise exception 'Unexpected strict insertion/deletion patch contract.';
  end if;

  v_v3_updated := pg_catalog.replace(v_v3_definition, v_v3_old, v_v3_new);
  v_v5_updated := pg_catalog.replace(v_v5_definition, v_v5_old, v_v5_new);
  v_link_only_updated := pg_catalog.replace(
    v_link_only_definition,
    v_link_only_old,
    v_link_only_new
  );

  if v_v3_updated = v_v3_definition
    or v_v5_updated = v_v5_definition
    or v_link_only_updated = v_link_only_definition
    or pg_catalog.strpos(v_v3_updated, 'is_verified_single_codepoint_name_insertion_deletion') = 0
    or pg_catalog.strpos(v_v5_updated, 'is_verified_single_codepoint_name_insertion_deletion') = 0
    or pg_catalog.strpos(v_link_only_updated, 'is_verified_single_codepoint_name_insertion_deletion') = 0
  then
    raise exception 'The verified insertion/deletion patch was not applied.';
  end if;

  execute v_v3_updated;
  execute v_v5_updated;
  execute v_link_only_updated;
end;
$migration$;

comment on function public.is_verified_single_codepoint_name_insertion_deletion(
  jsonb, text, text, text
) is
  'Validates one frozen, independently reviewed Unicode code-point insertion or deletion with at least 90% discovery similarity and official plus manufacturer or brand primary evidence.';
