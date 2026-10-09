-- PostgreSQL has no min(uuid). This is the purchase counterpart of the
-- existing standalone fix; match counts and all V4 source gates stay intact.
begin;
do $migration$
declare
  v_definition text := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'public.ingest_verified_purchase_price_observation_v1(text,jsonb)'::regprocedure
  ), E'\r\n', E'\n');
  v_anchor text;
  v_old text := E'and v_legacy_kind is distinct from case v_purchase_kind\n      when ''retail'' then ''retail_purchase''\n      when ''restaurant'' then ''restaurant_purchase''\n      else v_purchase_kind\n    end';
begin
  -- Parentheses disambiguate the CASE inside the ELSIF condition.
  if strpos(v_definition, v_old) > 0 then
    v_definition := replace(v_definition, v_old,
      E'and v_legacy_kind is distinct from (case v_purchase_kind\n      when ''retail'' then ''retail_purchase''\n      when ''restaurant'' then ''restaurant_purchase''\n      else v_purchase_kind\n    end)');
  end if;
  foreach v_anchor in array array[
    'location.id', 'location.restaurant_id', 'menu.id', 'menu.catalog_product_id',
    'store.id', 'product.id', 'store_product.id'
  ] loop
    if (length(v_definition) - length(replace(v_definition, 'min(' || v_anchor || ')', '')))
      / length('min(' || v_anchor || ')') <> 1 then
      raise exception 'purchase UUID aggregate anchor is missing or ambiguous: %', v_anchor;
    end if;
    v_definition := replace(v_definition, 'min(' || v_anchor || ')', 'min(' || v_anchor || '::text)::uuid');
  end loop;
  execute v_definition;
end;
$migration$;
commit;
