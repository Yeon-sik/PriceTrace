-- The official channel raw name proves the same-channel exact-name rule.
-- p_listing_name is the approved exact catalog variant and may legitimately
-- add specification text such as "405g".

do $migration$
declare
  v_v3_signature regprocedure :=
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_v5_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_v3_definition text;
  v_v3_updated text;
  v_v5_definition text;
  v_v5_updated text;
  v_v3_official_old text := $fragment$
    or coalesce(v_official ->> 'sourceNameRaw', '') <> p_listing_name
$fragment$;
  v_v3_official_new text := $fragment$
    or coalesce(v_official ->> 'sourceNameRaw', '') = ''
$fragment$;
  v_v3_rule_old text := $fragment$
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> regexp_replace(p_receipt_product_name, '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedOfficialName', '')
      <> regexp_replace(p_listing_name, '[[:space:]]+', '', 'g')
$fragment$;
  v_v3_rule_new text := $fragment$
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> regexp_replace(coalesce(v_receipt ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedOfficialName', '')
      <> regexp_replace(coalesce(v_official ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
$fragment$;
  v_v5_rule_old text := $fragment$
    or regexp_replace(p_receipt_product_name, '[[:space:]]+', '', 'g')
      <> regexp_replace(p_listing_name, '[[:space:]]+', '', 'g')
$fragment$;
  v_v5_rule_new text := $fragment$
    or regexp_replace(coalesce(v_receipt ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
      <> regexp_replace(coalesce(v_official ->> 'sourceNameRaw', ''), '[[:space:]]+', '', 'g')
    or coalesce(v_receipt ->> 'sourceNameRaw', '') <> p_receipt_product_name
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_v3_signature)
  into v_v3_definition;

  if pg_catalog.strpos(v_v3_definition, v_v3_official_old) = 0
    or pg_catalog.strpos(v_v3_definition, v_v3_rule_old) = 0
  then
    raise exception 'Unexpected strict V3 official-name contract.';
  end if;

  v_v3_updated := pg_catalog.replace(
    pg_catalog.replace(v_v3_definition, v_v3_official_old, v_v3_official_new),
    v_v3_rule_old,
    v_v3_rule_new
  );

  if v_v3_updated = v_v3_definition
    or pg_catalog.strpos(v_v3_updated, v_v3_official_old) > 0
    or pg_catalog.strpos(v_v3_updated, v_v3_rule_old) > 0
    or pg_catalog.strpos(v_v3_updated, v_v3_official_new) = 0
    or pg_catalog.strpos(v_v3_updated, v_v3_rule_new) = 0
  then
    raise exception 'The strict V3 official-name patch was not applied.';
  end if;

  execute v_v3_updated;

  select pg_catalog.pg_get_functiondef(v_v5_signature)
  into v_v5_definition;

  if pg_catalog.strpos(v_v5_definition, v_v5_rule_old) = 0
  then
    raise exception 'Unexpected strict V5 official-name contract.';
  end if;

  v_v5_updated := pg_catalog.replace(v_v5_definition, v_v5_rule_old, v_v5_rule_new);

  if v_v5_updated = v_v5_definition
    or pg_catalog.strpos(v_v5_updated, v_v5_rule_old) > 0
    or pg_catalog.strpos(v_v5_updated, v_v5_rule_new) = 0
  then
    raise exception 'The strict V5 official-name patch was not applied.';
  end if;

  execute v_v5_updated;
end;
$migration$;

comment on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates official raw-name identity separately from the approved exact catalog variant name, then atomically applies the reviewed effects.';

comment on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Requires independent review and compares same-channel receipt identity to the frozen official raw name, not the exact catalog variant label.';
