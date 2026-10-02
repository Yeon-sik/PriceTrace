-- Product names are not unique user identities in the current schema. Keep
-- each submitted receipt line attached to the product row created for it.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_restaurant_receipt_v1(text, text, text, text, date, integer, jsonb)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'submit_restaurant_receipt_v1 is not deployed';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    pg_catalog.chr(13) || pg_catalog.chr(10),
    pg_catalog.chr(10)
  );

  v_old := '    insert into public.products (user_id, name, purchase_type, category_tags)' || pg_catalog.chr(10)
    || '    values (v_user_id, btrim(v_item.description), ''menu_item'', array[btrim(v_item.line_type)])' || pg_catalog.chr(10)
    || '    on conflict (user_id, name) do update set' || pg_catalog.chr(10)
    || '      purchase_type = ''menu_item'';' || pg_catalog.chr(10)
    || '    select id into v_product_id' || pg_catalog.chr(10)
    || '    from public.products' || pg_catalog.chr(10)
    || '    where user_id = v_user_id and name = btrim(v_item.description);';
  v_new := '    insert into public.products (user_id, name, purchase_type, category_tags)' || pg_catalog.chr(10)
    || '    values (v_user_id, btrim(v_item.description), ''menu_item'', array[btrim(v_item.line_type)])' || pg_catalog.chr(10)
    || '    returning id into v_product_id;';

  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old) <> 1 then
    raise exception 'legacy restaurant receipt product upsert anchor is missing or ambiguous';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;
