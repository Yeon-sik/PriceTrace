-- The legacy receipt/listing raw-name comparison was removed by
-- 20260801133000, but its normalized receipt-name declaration remained in the
-- strict core. Remove only that unused declaration to keep remote db lint clean
-- without changing the reviewed registration contract.

do $migration$
declare
  v_signature regprocedure :=
    'public.register_standard_product_link_strict(text,text,text,text,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_updated text;
  v_unused_declaration_pattern text :=
    E'\n[ \t]*v_normalized_receipt_name[ \t]+text[ \t]*:=[^\n]*\n';
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;

  if pg_catalog.strpos(v_definition, 'v_normalized_receipt_name') = 0
  then
    raise exception 'Unexpected strict core receipt-name declaration.';
  end if;

  v_updated := pg_catalog.regexp_replace(
    v_definition,
    v_unused_declaration_pattern,
    E'\n'
  );

  if v_updated = v_definition
    or pg_catalog.strpos(v_updated, 'v_normalized_receipt_name') > 0
  then
    raise exception 'The unused strict core receipt-name declaration was not removed.';
  end if;

  execute v_updated;
end;
$migration$;
