-- V5's unused v_receipt local was removed in 20260801002000. Read the frozen
-- receipt directly from v_input when validating the same-channel raw name.

do $migration$
declare
  v_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_updated text;
  v_old text := $fragment$
    or regexp_replace(coalesce(v_receipt ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
      <> regexp_replace(coalesce(v_official ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or coalesce(v_receipt ->> 'sourceNameRaw', '') <> p_receipt_product_name
$fragment$;
  v_new text := $fragment$
    or regexp_replace(coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
      <> regexp_replace(coalesce(v_official ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or coalesce(v_input -> 'receipt' ->> 'sourceNameRaw', '') <> p_receipt_product_name
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;

  if pg_catalog.strpos(v_definition, v_old) = 0
  then
    raise exception 'Unexpected strict V5 frozen-receipt reference contract.';
  end if;

  v_updated := pg_catalog.replace(v_definition, v_old, v_new);

  if v_updated = v_definition
    or pg_catalog.strpos(v_updated, v_old) > 0
    or pg_catalog.strpos(v_updated, v_new) = 0
  then
    raise exception 'The strict V5 frozen-receipt reference patch was not applied.';
  end if;

  execute v_updated;
end;
$migration$;

comment on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Requires independent review and compares the frozen receipt and official raw names while keeping the exact catalog variant label separate.';
