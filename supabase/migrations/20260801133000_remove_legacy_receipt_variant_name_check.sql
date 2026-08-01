-- The strict core receives the exact catalog variant name, not the official
-- channel raw name. Same-channel receipt/official raw-name equality is already
-- fingerprinted and validated by the internal V3 and public V5 gates.

do $migration$
declare
  v_signature regprocedure :=
    'public.register_standard_product_link_strict(text,text,text,text,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_updated text;
  v_old text := $fragment$
  if v_normalized_receipt_name <> v_normalized_listing_name
  then
    raise exception 'Receipt and official product names differ after whitespace removal.'
      using errcode = '23514';
  end if;

$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;

  if pg_catalog.strpos(v_definition, v_old) = 0
  then
    raise exception 'Unexpected strict core legacy name contract.';
  end if;

  v_updated := pg_catalog.replace(v_definition, v_old, '');

  if v_updated = v_definition
    or pg_catalog.strpos(v_updated, v_old) > 0
  then
    raise exception 'The strict core legacy name check was not removed.';
  end if;

  execute v_updated;
end;
$migration$;

comment on function public.register_standard_product_link_strict(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text, text,
  text, text, numeric, text, integer, integer, text, text[], text, integer,
  integer, numeric, text, integer, integer
) is
  'Atomically creates or reuses one exact catalog variant after reviewed wrappers validate frozen receipt and official raw-name identity.';
