-- PostgreSQL has no min(uuid) aggregate. Keep the standalone RPC's existing
-- match-count/ambiguity behavior and cast UUIDs to text only for aggregation.
do $migration$
declare
  v_definition text;
  v_patched_definition text;
  v_anchor text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.ingest_verified_standalone_price_observation_v1(text, jsonb)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'ingest_verified_standalone_price_observation_v1 is not deployed';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    pg_catalog.chr(13) || pg_catalog.chr(10),
    pg_catalog.chr(10)
  );

  foreach v_anchor in array array[
    'min(store.id)',
    'min(product.id)',
    'min(store_product.id)'
  ] loop
    if (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, ''))
    ) / pg_catalog.length(v_anchor) <> 1 then
      raise exception 'standalone UUID aggregate anchor is missing or ambiguous: %', v_anchor;
    end if;
  end loop;

  v_patched_definition := pg_catalog.replace(v_definition, 'min(store.id)', 'min(store.id::text)::uuid');
  v_patched_definition := pg_catalog.replace(v_patched_definition, 'min(product.id)', 'min(product.id::text)::uuid');
  v_patched_definition := pg_catalog.replace(v_patched_definition, 'min(store_product.id)', 'min(store_product.id::text)::uuid');

  if v_patched_definition = v_definition then
    raise exception 'standalone UUID aggregate patch made no changes';
  end if;

  execute v_patched_definition;
end;
$migration$;
