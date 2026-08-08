-- Keep the strict database guard aligned with the client and proposal parsers.
-- Official catalog text may express kilograms while the normalized target and
-- exact Coupang option are fingerprinted in grams.

do $migration$
declare
  v_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  if pg_catalog.strpos(v_definition, '(g|ml|each|개|입)') = 0
    or pg_catalog.strpos(
      v_definition,
      'v_specification_match[1]::numeric is distinct from p_content_amount'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'and lower(v_specification_match[2]) <> p_content_unit'
    ) = 0
  then
    raise exception 'Unexpected strict V5 specification validation contract.';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    '(g|ml|each|개|입)',
    '(kg|g|ml|each|개|입)'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'v_specification_match[1]::numeric is distinct from p_content_amount',
    '(case lower(v_specification_match[2]) when ''kg'' then v_specification_match[1]::numeric * 1000 else v_specification_match[1]::numeric end) is distinct from p_content_amount'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'and lower(v_specification_match[2]) <> p_content_unit',
    'and (case lower(v_specification_match[2]) when ''kg'' then ''g'' else lower(v_specification_match[2]) end) <> p_content_unit'
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(v_definition, '(kg|g|ml|each|개|입)') = 0
    or pg_catalog.strpos(
      v_definition,
      'when ''kg'' then v_specification_match[1]::numeric * 1000'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'when ''kg'' then ''g'' else lower(v_specification_match[2])'
    ) = 0
  then
    raise exception 'Strict V5 kilogram patch did not produce the expected definition.';
  end if;

  execute v_definition;

  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  if pg_catalog.strpos(v_definition, '(g|ml|each|개|입)') > 0
    or pg_catalog.strpos(
      v_definition,
      'v_specification_match[1]::numeric is distinct from p_content_amount'
    ) > 0
    or pg_catalog.strpos(
      v_definition,
      'and lower(v_specification_match[2]) <> p_content_unit'
    ) > 0
    or pg_catalog.strpos(v_definition, '(kg|g|ml|each|개|입)') = 0
  then
    raise exception 'Strict V5 kilogram postcondition failed.';
  end if;
end;
$migration$;

comment on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates a complete independently reviewed LinkProposal, including g, kg, ml, and count-based official specifications, before applying V4.';
