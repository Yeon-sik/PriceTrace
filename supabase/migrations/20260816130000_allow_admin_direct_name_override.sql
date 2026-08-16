-- Administrator-direct registration may intentionally connect a receipt item
-- to an official listing whose raw names differ. Keep the old exact-name gate
-- on the independent approval function; patch only the direct checked wrapper.

do $migration$
declare
  v_signature regprocedure :=
    'public.admin_register_standard_product_link_strict_checked_v1(text,text,text,text,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
  v_name_clause_start integer;
  v_name_clause_end integer;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  if v_definition is null
    or pg_catalog.strpos(
      v_definition,
      'The approved same-channel exact-name contract is invalid.'
    ) = 0
    or pg_catalog.strpos(v_definition, 'admin_direct') = 0
  then
    raise exception 'Unexpected administrator-direct strict checked registration contract.';
  end if;

  v_name_clause_start := pg_catalog.strpos(
    v_definition,
    'regexp_replace(coalesce(v_input'
  );

  if v_name_clause_start = 0 then
    raise exception 'Administrator-direct name contract start was not found.';
  end if;

  v_name_clause_end := pg_catalog.strpos(
    substring(v_definition from v_name_clause_start),
    E'\n  then\n    raise exception '
  );

  if v_name_clause_end = 0 then
    raise exception 'Administrator-direct name contract end was not found.';
  end if;

  v_name_clause_end := v_name_clause_start + v_name_clause_end - 1;

  v_definition := overlay(
    v_definition placing 'false)'
    from v_name_clause_start
    for v_name_clause_end - v_name_clause_start
  );

  v_definition := pg_catalog.replace(
    v_definition,
    'The approved same-channel exact-name contract is invalid.',
    'Administrator-direct name mismatch is allowed.'
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(
      v_definition,
      'The approved same-channel exact-name contract is invalid.'
    ) <> 0
  then
    raise exception 'Administrator-direct name override patch failed.';
  end if;

  execute v_definition;
end;
$migration$;

comment on function public.admin_register_standard_product_link_strict_checked_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Admin-direct strict registration allows an explicit receipt/official raw-name mismatch while preserving the remaining identity and evidence checks.';
