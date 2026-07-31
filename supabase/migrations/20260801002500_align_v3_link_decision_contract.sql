-- Repair the deployed V3 validator without changing its signature or grants.
-- Receipt source codes and official-channel codes are separate identities, and
-- independently reviewed matched fields may be descriptive rather than a
-- hard-coded implementation array.
do $migration$
declare
  v_signature regprocedure := 'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_updated text;
  v_conflated_code_check text := $fragment$
    or coalesce(v_official ->> 'sourceProductCode', '') <> btrim(p_source_product_code)
$fragment$;
  v_separate_code_check text := $fragment$
    or coalesce(v_official ->> 'sourceProductCode', '') = ''
$fragment$;
  v_fixed_matched_fields_check text := $fragment$
    or v_decision -> 'matchedFields'
      <> '["brand","productFamilyName","contentAmount","contentUnit","packageCount"]'::jsonb
$fragment$;
  v_reviewed_matched_fields_check text := $fragment$
    or coalesce(jsonb_typeof(v_decision -> 'matchedFields'), '') <> 'array'
    or jsonb_array_length(v_decision -> 'matchedFields') = 0
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;

  v_updated := v_definition;

  if pg_catalog.strpos(v_updated, v_conflated_code_check) > 0
  then
    v_updated := pg_catalog.replace(
      v_updated,
      v_conflated_code_check,
      v_separate_code_check
    );
  elsif pg_catalog.strpos(v_updated, v_separate_code_check) = 0
  then
    raise exception 'Unexpected V3 official source-code validation contract.';
  end if;

  if pg_catalog.strpos(v_updated, v_fixed_matched_fields_check) = 0
  then
    raise exception 'Unexpected V3 matched-fields validation contract.';
  end if;

  v_updated := pg_catalog.replace(
    v_updated,
    v_fixed_matched_fields_check,
    v_reviewed_matched_fields_check
  );

  if v_updated = v_definition
    or pg_catalog.strpos(v_updated, v_fixed_matched_fields_check) > 0
    or pg_catalog.strpos(v_updated, v_conflated_code_check) > 0
    or pg_catalog.strpos(v_updated, v_reviewed_matched_fields_check) = 0
    or pg_catalog.strpos(v_updated, v_separate_code_check) = 0
  then
    raise exception 'V3 contract repair did not produce the expected definition.';
  end if;

  execute v_updated;
end;
$migration$;

comment on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates one canonical reviewed LinkProposal while preserving separate receipt and official source-code namespaces, then atomically applies its exact effects.';

revoke all on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public, anon, authenticated;

revoke execute on function public.approve_and_register_standard_product_link_strict_v4(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from anon, authenticated;
