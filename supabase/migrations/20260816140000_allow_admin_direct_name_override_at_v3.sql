-- The administrator RPC delegates its atomic write to the shared V3 validator.
-- Allow the explicit administrator-direct mode to bypass only the reviewed
-- same-channel name-equivalence block; retain that block for AI approvals.

do $migration$
declare
  v_signature regprocedure :=
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
  v_name_clause_start integer;
  v_name_clause_end integer;
  v_name_clause text;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  if v_definition is null
    or pg_catalog.strpos(
      v_definition,
      'The same-channel exact-name rule is not an approved apply decision.'
    ) = 0
  then
    raise exception 'Unexpected V3 same-channel name contract.';
  end if;

  v_name_clause_start := pg_catalog.strpos(
    v_definition,
    'coalesce(v_rule ->> ''normalizedReceiptName'''
  );
  if v_name_clause_start = 0 then
    raise exception 'V3 name contract start was not found.';
  end if;

  v_name_clause_end := pg_catalog.strpos(
    substring(v_definition from v_name_clause_start),
    E'\n    or coalesce(v_target -> ''officialSpecificationCheck'''
  );
  if v_name_clause_end = 0 then
    raise exception 'V3 name contract end was not found.';
  end if;

  v_name_clause_end := v_name_clause_start + v_name_clause_end - 1;
  v_name_clause := substring(
    v_definition
    from v_name_clause_start
    for v_name_clause_end - v_name_clause_start
  );

  v_definition := overlay(
    v_definition placing
      E'(\n      coalesce(v_target -> ''approvalPolicy'' ->> ''mode'', '''')\n'
      || E'        <> ''authenticated_admin_direct_registration''\n'
      || E'      and (\n      '
      || v_name_clause
      || E'\n      )\n    )'
    from v_name_clause_start
    for v_name_clause_end - v_name_clause_start
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(
      v_definition,
      'authenticated_admin_direct_registration'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'The same-channel exact-name rule is not an approved apply decision.'
    ) = 0
  then
    raise exception 'V3 administrator-direct name override patch failed.';
  end if;

  execute v_definition;
end;
$migration$;

comment on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates reviewed LinkProposals while allowing the explicit administrator-direct mode to override raw receipt/official name mismatch only.';
