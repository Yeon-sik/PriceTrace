-- Keep the strict registration gate aligned with LinkProposal v3 provenance.
-- A default package count of one is not imported from the official listing
-- unless that listing's product name states the package count explicitly.

do $migration$
declare
  v_signature regprocedure :=
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_updated text;
  v_old text := $fragment$
    or v_rule -> 'importedOfficialFields'
      <> '["brand","contentAmount","contentUnit","packageCount"]'::jsonb
$fragment$;
  v_new text := $fragment$
    or coalesce(v_target -> 'officialSpecificationCheck' ->> 'packageCountBasis', '')
      not in ('explicit', 'default_one_absent_count')
    or (
      v_target -> 'officialSpecificationCheck' ->> 'packageCountBasis' = 'explicit'
      and v_rule -> 'importedOfficialFields'
        <> '["brand","contentAmount","contentUnit","packageCount"]'::jsonb
    )
    or (
      v_target -> 'officialSpecificationCheck' ->> 'packageCountBasis' = 'default_one_absent_count'
      and v_rule -> 'importedOfficialFields'
        <> '["brand","contentAmount","contentUnit"]'::jsonb
    )
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;

  if pg_catalog.strpos(v_definition, v_old) = 0
  then
    raise exception 'Unexpected strict V3 package-count provenance contract.';
  end if;

  v_updated := pg_catalog.replace(v_definition, v_old, v_new);

  if v_updated = v_definition
    or pg_catalog.strpos(v_updated, v_old) > 0
    or pg_catalog.strpos(v_updated, v_new) = 0
  then
    raise exception 'The strict V3 package-count provenance patch was not applied.';
  end if;

  execute v_updated;
end;
$migration$;

comment on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates one canonical reviewed LinkProposal while importing packageCount from official identity only when the official product name states it explicitly.';
