-- A Coupang observation belongs to the standard-product family, while the
-- official/PX amount remains the exact sellable variant. Keep the units
-- compatible, but allow a weight or volume offer such as 360g to be compared
-- with a PX variant such as 387g through the existing reference-unit pricing.
-- Count-based specifications remain exact because their amount identifies the
-- sellable count rather than a weight/volume observation.

do $migration$
declare
  v_signature regprocedure;
  v_definition text;
  v_original_definition text;
  v_legacy_guard text := $legacy$
    or p_coupang_content_amount is distinct from p_content_amount
$legacy$;
  v_family_guard text := $family$
    or (
      p_content_unit = 'each'
      and p_coupang_content_amount is distinct from p_content_amount
    )
$family$;
begin
  for v_signature in
    select signature_text::regprocedure
    from unnest(array[
      'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::text,
      'public.admin_register_standard_product_link_strict_checked_v1(text,text,text,text,text,text,text,text,text,timestamp with time zone,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::text
    ]) as signatures(signature_text)
  loop
    select pg_catalog.pg_get_functiondef(v_signature)
    into v_definition;
    v_original_definition := v_definition;

    if v_definition is null
      or pg_catalog.strpos(v_definition, v_legacy_guard) = 0
      or pg_catalog.strpos(v_definition, 'p_coupang_content_unit <> p_content_unit') = 0
    then
      raise exception 'Unexpected strict Coupang specification guard for %.', v_signature;
    end if;

    v_definition := pg_catalog.replace(v_definition, v_legacy_guard, v_family_guard);

    if v_definition = v_original_definition
      or pg_catalog.strpos(v_definition, v_legacy_guard) > 0
      or pg_catalog.strpos(v_definition, v_family_guard) = 0
    then
      raise exception 'Family-level Coupang specification patch failed for %.', v_signature;
    end if;

    execute v_definition;
  end loop;
end;
$migration$;

comment on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates an independently reviewed LinkProposal with an exact official variant and a family-level Coupang offer; weight or volume amounts may differ when units match.';

comment on function public.admin_register_standard_product_link_strict_checked_v1(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates an administrator-direct LinkProposal with an exact official variant and a family-level Coupang offer; weight or volume amounts may differ when units match.';
