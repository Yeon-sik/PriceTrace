-- Keep the independently reviewed AI LinkProposal RPCs unchanged while adding
-- explicit administrator-direct registration RPCs for the manual admin form.
-- The direct functions are generated from the deployed, fully validated write
-- functions so their atomic writes and idempotency behavior cannot drift.

do $migration$
declare
  v_signature regprocedure :=
    'public.approve_and_register_standard_product_link_only_v1(text,text,text,text,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,jsonb)'::regprocedure;
  v_definition text;
  v_original_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  if v_definition is null
    or pg_catalog.strpos(v_definition, 'pricetrace_independent_reviewer') = 0
    or pg_catalog.strpos(v_definition, 'authenticated_admin_explicit_second_step') = 0
    or pg_catalog.strpos(v_definition, 'v_target := p_target_canonical_json::jsonb;') = 0
  then
    raise exception 'Unexpected AI link-only registration contract.';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    'public.approve_and_register_standard_product_link_only_v1',
    'public.admin_register_standard_product_link_only_v1'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'pricetrace_independent_reviewer',
    'admin_direct'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'authenticated_admin_explicit_second_step',
    'authenticated_admin_direct_registration'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'v_target := p_target_canonical_json::jsonb;',
    $guard$
  v_target := p_target_canonical_json::jsonb;
  if coalesce(v_target -> 'approvalPolicy' ->> 'mode', '')
      <> 'authenticated_admin_direct_registration'
  then
    raise exception 'Administrator direct registration policy is required.'
      using errcode = '23514';
  end if;$guard$
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(
      v_definition,
      'public.admin_register_standard_product_link_only_v1'
    ) = 0
    or pg_catalog.strpos(v_definition, 'admin_direct') = 0
    or pg_catalog.strpos(
      v_definition,
      'authenticated_admin_direct_registration'
    ) = 0
  then
    raise exception 'Administrator link-only registration contract patch failed.';
  end if;

  execute v_definition;
end;
$migration$;

do $migration$
declare
  v_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v4(text,text,text,text,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  if v_definition is null
    or pg_catalog.strpos(v_definition, 'authenticated_admin_explicit_second_step') = 0
  then
    raise exception 'Unexpected strict registration core contract.';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    'public.approve_and_register_standard_product_link_strict_v4',
    'public.admin_register_standard_product_link_strict_core_v1'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'authenticated_admin_explicit_second_step',
    'authenticated_admin_direct_registration'
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(
      v_definition,
      'public.admin_register_standard_product_link_strict_core_v1'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'authenticated_admin_direct_registration'
    ) = 0
  then
    raise exception 'Administrator strict registration core patch failed.';
  end if;

  execute v_definition;
end;
$migration$;

do $migration$
declare
  v_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  if v_definition is null
    or pg_catalog.strpos(v_definition, 'pricetrace_independent_reviewer') = 0
    or pg_catalog.strpos(
      v_definition,
      'public.approve_and_register_standard_product_link_strict_v4'
    ) = 0
    or pg_catalog.strpos(v_definition, 'v_target := p_target_canonical_json::jsonb;') = 0
  then
    raise exception 'Unexpected AI strict checked registration contract.';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    'public.approve_and_register_standard_product_link_strict_v5',
    'public.admin_register_standard_product_link_strict_checked_v1'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'public.approve_and_register_standard_product_link_strict_v4',
    'public.admin_register_standard_product_link_strict_core_v1'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'pricetrace_independent_reviewer',
    'admin_direct'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'v_target := p_target_canonical_json::jsonb;',
    $guard$
  v_target := p_target_canonical_json::jsonb;
  if coalesce(v_target -> 'approvalPolicy' ->> 'mode', '')
      <> 'authenticated_admin_direct_registration'
  then
    raise exception 'Administrator direct registration policy is required.'
      using errcode = '23514';
  end if;$guard$
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(
      v_definition,
      'public.admin_register_standard_product_link_strict_checked_v1'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'public.admin_register_standard_product_link_strict_core_v1'
    ) = 0
    or pg_catalog.strpos(v_definition, 'admin_direct') = 0
  then
    raise exception 'Administrator strict checked registration patch failed.';
  end if;

  execute v_definition;
end;
$migration$;

do $migration$
declare
  v_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v6(text,text,text,text,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  if v_definition is null
    or pg_catalog.strpos(
      v_definition,
      'public.approve_and_register_standard_product_link_strict_v5'
    ) = 0
  then
    raise exception 'Unexpected AI strict image registration contract.';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    'public.approve_and_register_standard_product_link_strict_v6',
    'public.admin_register_standard_product_link_strict_v1'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'public.approve_and_register_standard_product_link_strict_v5',
    'public.admin_register_standard_product_link_strict_checked_v1'
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(
      v_definition,
      'public.admin_register_standard_product_link_strict_v1'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'public.admin_register_standard_product_link_strict_checked_v1'
    ) = 0
  then
    raise exception 'Administrator strict image registration patch failed.';
  end if;

  execute v_definition;
end;
$migration$;

revoke all on function public.admin_register_standard_product_link_only_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_register_standard_product_link_only_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, jsonb
) to authenticated;

revoke all on function public.admin_register_standard_product_link_strict_core_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public, anon, authenticated;

revoke all on function public.admin_register_standard_product_link_strict_checked_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public, anon, authenticated;

revoke all on function public.admin_register_standard_product_link_strict_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.admin_register_standard_product_link_strict_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) to authenticated;

comment on function public.admin_register_standard_product_link_only_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, jsonb
) is
  'Registers a frozen official product link through the explicit administrator-direct path; AI LinkProposal approvals remain on the independent-review RPC.';

comment on function public.admin_register_standard_product_link_strict_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Registers a frozen official product link and exact Coupang option through the explicit administrator-direct path; AI LinkProposal approvals remain on the independent-review RPC.';
