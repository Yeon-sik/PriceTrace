-- The legacy receipt RPC predates the removal of stores(user_id, name)
-- uniqueness. Its untrusted name-only upsert must not be restored; insert a
-- user-owned store row for each new idempotent receipt submission instead.
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

  v_old := '  on conflict (user_id, name) do update set' || pg_catalog.chr(10)
    || '    merchant_name = excluded.merchant_name,' || pg_catalog.chr(10)
    || '    branch_name = coalesce(excluded.branch_name, public.stores.branch_name),' || pg_catalog.chr(10)
    || '    business_kind = ''food_service''' || pg_catalog.chr(10)
    || '  returning id into v_store_id;';
  v_new := '  returning id into v_store_id;';

  if (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old) <> 1 then
    raise exception 'legacy restaurant receipt store upsert anchor is missing or ambiguous';
  end if;

  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$migration$;
