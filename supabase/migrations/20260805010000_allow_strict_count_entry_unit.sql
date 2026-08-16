-- Keep the Coupang-backed strict link path aligned with the client parser.
-- Korean official catalogs use both `개` and `입` for a count-based sellable
-- specification. The reviewed target already fingerprints the parsed amount,
-- unit, package count, and exact Coupang option; this patch only admits the
-- missing source-native `입` spelling at the final V5 guard.

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

  if pg_catalog.strpos(v_definition, '(g|ml|each|개)') = 0
    or pg_catalog.strpos(
      v_definition,
      'not in (''each'', ''개'')'
    ) = 0
  then
    raise exception 'Unexpected strict V5 count-unit validation contract.';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    '(g|ml|each|개)',
    '(g|ml|each|개|입)'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'not in (''each'', ''개'')',
    'not in (''each'', ''개'', ''입'')'
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(v_definition, '(g|ml|each|개|입)') = 0
    or pg_catalog.strpos(
      v_definition,
      'not in (''each'', ''개'', ''입'')'
    ) = 0
  then
    raise exception 'Strict V5 count-unit patch did not produce the expected definition.';
  end if;

  execute v_definition;

  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  if pg_catalog.strpos(v_definition, '(g|ml|each|개)') > 0
    or pg_catalog.strpos(
      v_definition,
      'not in (''each'', ''개'')'
    ) > 0
    or pg_catalog.strpos(v_definition, '(g|ml|each|개|입)') = 0
    or pg_catalog.strpos(
      v_definition,
      'not in (''each'', ''개'', ''입'')'
    ) = 0
  then
    raise exception 'Strict V5 count-unit postcondition failed.';
  end if;
end;
$migration$;

comment on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates a complete independently reviewed LinkProposal, including count-based official specifications expressed with 개 or 입, before applying V4.';
