-- Keep the applied V5 function warning-free without rewriting migration history.
do $migration$
declare
  v_signature regprocedure :=
    'public.approve_and_register_standard_product_link_strict_v5(text,text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
begin
  select pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  v_definition := replace(v_definition, E'  v_receipt jsonb;\n', '');
  v_definition := replace(
    v_definition,
    E'  v_receipt := v_input -> ''receipt'';\n',
    ''
  );

  if v_definition = v_original_definition
    or position('v_receipt jsonb' in v_definition) > 0
    or position('v_receipt := v_input' in v_definition) > 0
  then
    raise exception 'The V5 function did not match the unused-variable cleanup contract.';
  end if;

  execute v_definition;
end;
$migration$;
