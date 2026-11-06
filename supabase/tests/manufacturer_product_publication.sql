begin;

do $test$
declare
  v_product jsonb := '{
    "product_name":"제조사 공개 검증 상품",
    "brand_name":"Manufacturer Publication Fixture",
    "manufacturer_sku":"FIXTURE-120",
    "manufacturer_url":"https://manufacturer.example/products/fixture-120",
    "specification":"120정",
    "content_amount":120,
    "content_unit":"each",
    "package_count":1
  }';
  v_result jsonb;
  v_catalog_id uuid;
  v_public jsonb;
begin
  if pg_catalog.has_function_privilege('anon', 'public.publish_manufacturer_product_v1(jsonb,boolean)', 'EXECUTE')
    or pg_catalog.has_table_privilege('anon', 'public.manufacturer_product_publications', 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', 'public.manufacturer_product_publications', 'INSERT')
  then
    raise exception 'manufacturer publication privileges were exposed';
  end if;

  perform pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated","user_metadata":{"role":"admin"}}', true);
  begin
    perform public.publish_manufacturer_product_v1(v_product, true);
    raise exception 'untrusted user role accepted';
  exception when insufficient_privilege then null;
  end;

  perform pg_catalog.set_config('request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000011","role":"authenticated","app_metadata":{"role":"admin"}}', true);
  begin
    perform public.publish_manufacturer_product_v1(v_product, false);
    raise exception 'publication without confirmation accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.publish_manufacturer_product_v1(v_product || '{"purchase_price":15390}', true);
    raise exception 'private purchase field accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.publish_manufacturer_product_v1(v_product || '{"manufacturer_url":"https://manufacturer.example/products/fixture?order=123"}', true);
    raise exception 'personal URL parameters accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.publish_manufacturer_product_v1(v_product || '{"content_amount":1.1}', true);
    raise exception 'non-integral each quantity accepted';
  exception when invalid_parameter_value then null;
  end;

  v_result := public.publish_manufacturer_product_v1(v_product, true);
  v_catalog_id := (v_result ->> 'catalog_product_id')::uuid;
  if v_result ->> 'status' is distinct from 'published' or v_catalog_id is null then
    raise exception 'public registration failed';
  end if;
  v_result := public.publish_manufacturer_product_v1(v_product, true);
  if v_result ->> 'status' is distinct from 'already_published'
    or (v_result ->> 'catalog_product_id')::uuid is distinct from v_catalog_id
  then
    raise exception 'replay changed the published identity';
  end if;
  begin
    perform public.publish_manufacturer_product_v1(v_product || '{"specification":"240정"}', true);
    raise exception 'conflicting manufacturer identity accepted';
  exception when unique_violation then null;
  end;

  select to_jsonb(row) into strict v_public from public.search_public_manufacturer_products_v1('fixture-120', 10) as row;
  if v_public ->> 'catalog_product_id' is distinct from v_catalog_id::text
    or v_public ->> 'specification' is distinct from '120정'
    or v_public - array['catalog_product_id','product_name','brand_name','specification','manufacturer_sku','manufacturer_url'] <> '{}'::jsonb
  then
    raise exception 'public manufacturer search has the wrong product or fields';
  end if;

  v_public := public.get_product_read_v1(v_catalog_id, null, 1) #> '{products,0}';
  if v_public #>> '{catalogProduct,id}' is distinct from v_catalog_id::text
    or v_public -> 'sellerProducts' is distinct from '[]'::jsonb
    or v_public -> 'observations' is distinct from '[]'::jsonb
    or exists (select 1 from public.price_observations where catalog_product_id = v_catalog_id)
  then
    raise exception 'product read failed or publication created a price/seller';
  end if;
end;
$test$;

set local role anon;
do $test$
begin
  if (select count(*) from public.search_public_manufacturer_products_v1('', 50)) < 1 then
    raise exception 'anonymous standard catalog browsing without search failed';
  end if;
  if (select count(*) from public.search_public_manufacturer_products_v1('제조사 공개 검증', 10)) <> 1 then
    raise exception 'anonymous manufacturer search failed';
  end if;
end;
$test$;

select 'MANUFACTURER_PRODUCT_PUBLICATION_PASS' as result;
rollback;
