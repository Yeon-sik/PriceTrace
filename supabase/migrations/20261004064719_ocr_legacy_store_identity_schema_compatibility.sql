-- restaurant_locations has no updated_at column. Keep the legacy identity
-- recovery write limited to the verified source facts it repairs.
do $migration$
declare
  v_definition text;
  v_old text := E',\n      updated_at = pg_catalog.now()\n  where id = v_location.id';
  v_new text := E'\n  where id = v_location.id';
  v_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.private_restore_ocr_legacy_store_source_facts_v1(uuid, jsonb)'::regprocedure
  ) into v_definition;
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10));
  v_count := (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);

  if v_count = 1 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  elsif v_count = 0 and pg_catalog.strpos(v_definition, 'updated_at = pg_catalog.now()') = 0 then
    -- Already repaired. Reapplying this forward migration is safe.
    null;
  else
    raise exception 'legacy store identity function shape is unexpected; refusing to rewrite it';
  end if;
end;
$migration$;
