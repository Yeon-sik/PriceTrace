begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000022') on conflict (id) do nothing;
do $$
declare actor uuid := '00000000-0000-4000-8000-000000000011'; other uuid := '00000000-0000-4000-8000-000000000022';
  brand uuid := gen_random_uuid(); product uuid := gen_random_uuid(); store_a uuid := gen_random_uuid(); store_b uuid := gen_random_uuid();
  foreign_store uuid := gen_random_uuid(); other_branch uuid := gen_random_uuid(); restaurant_a uuid := gen_random_uuid(); restaurant_b uuid := gen_random_uuid();
  merchant_a uuid; merchant_b uuid; response jsonb; snapshot jsonb; original_read jsonb;
  purchase jsonb; source_a uuid; source_b uuid; source_c uuid; line_id uuid; original_prices jsonb; connected_prices jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  insert into public.brands(id,canonical_name) values(brand,'테스트한성브랜드');
  insert into public.product_identity_candidates(id,user_id,schema_version,contract_version,source_app,candidate_type,product_name,brand,
    identifiers,evidence,provenance,request_payload) values(product,actor,'PRICETRACE_PRODUCT_CANDIDATE','product-candidate.v1',
    'pricetrace_ocr_app','retail_product','검증용 제품','테스트 한성 브랜드','[]','[]','{}','{}');
  insert into public.stores(id,user_id,name,branch_name,business_kind) values
    (store_a,actor,'테스트한성매장','본점','retail'),(store_b,actor,'테스트한성매쟝','본점','retail'),
    (other_branch,actor,'테스트한성매장','다른 지점','retail'),(foreign_store,other,'테스트한성매장','본점','retail');
  merchant_a := (public.submit_merchant_identity_candidate_v1('identity-connection-a','{"merchant_name":"한성대학교 학생식당","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  merchant_b := (public.submit_merchant_identity_candidate_v1('identity-connection-b','{"merchant_name":"한성대학교 학식당","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  purchase := '{"schema_version":"purchase-price-observation.v4","contract_version":"purchase-price.v4","source_app":"pricetrace_ocr_app",
    "purchase_kind":"restaurant","transcription_status":"user_verified","verification_basis":"source_evidence","platform":{"name":"웨이티"},
    "seller":{"seller_name":"한성대학교 학생식당","business_kind":"food_service"},
    "order":{"status":"paid","currency":"KRW","ordered_on":"2026-10-13","order_reference":"identity-a"},
    "payment":{"status":"paid","method":"card","paid_on":"2026-10-13","total_price":5700},
    "items":[{"line_key":"line-1","product":{"product_name":"돼지불백덮밥"},"price_status":"itemized","quantity":1,"unit_price":5700,"gross_price":5700}]}'::jsonb;
  source_a := (public.ingest_verified_purchase_price_observation_v1('connection-purchase-a',purchase)->>'purchaseSourceId')::uuid;
  restaurant_a := (public.resolve_user_confirmed_purchase_restaurant_line_v1(source_a,'line-1',merchant_a,true)#>>'{lineResults,0,ownerConfirmedIds,restaurantId}')::uuid;
  purchase := jsonb_set(jsonb_set(purchase,'{seller,seller_name}','"한성대학교 학식당"'),'{order,order_reference}','"identity-b"');
  source_b := (public.ingest_verified_purchase_price_observation_v1('connection-purchase-b',purchase)->>'purchaseSourceId')::uuid;
  restaurant_b := (public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',merchant_b,true)#>>'{lineResults,0,ownerConfirmedIds,restaurantId}')::uuid;
  if restaurant_a is null or restaurant_b is null or restaurant_a=restaurant_b then raise exception 'fixture must contain two distinct restaurants'; end if;
  select to_jsonb(c) into snapshot from public.product_identity_candidates c where id=product;
  execute 'set local role authenticated';
  original_read := public.get_my_owner_confirmed_restaurants_v2();
  select jsonb_agg(price order by price->>'id') into original_prices
    from jsonb_array_elements(original_read->'restaurants') r cross join lateral jsonb_array_elements(r->'menus') m
    cross join lateral jsonb_array_elements(m->'priceHistory') price;
  if public.identity_name_similarity_v1('한성대학교 학생식당','한성대학교 학식당') is distinct from 0.8889 then raise exception 'Korean similarity regression'; end if;
  response := public.search_my_identity_connections_v1('brand',product,'테스트 한성 브랜드');
  if response #>> '{choices,0,id}' is distinct from brand::text then raise exception 'brand discovery failed'; end if;
  perform public.connect_my_identity_v1('brand',product,brand,'테스트 한성 브랜드',true);
  perform public.connect_my_identity_v1('brand',product,brand,'테스트 한성 브랜드',true);
  if (select to_jsonb(c) from public.product_identity_candidates c where id=product) is distinct from snapshot then raise exception 'source facts changed'; end if;
  response := public.search_my_identity_connections_v1('store',store_b,'테스트한성매장');
  if jsonb_array_length(response->'choices')<>1 or response #>> '{choices,0,id}' is distinct from store_a::text then raise exception 'store branch/owner boundary failed'; end if;
  begin perform public.connect_my_identity_v1('store',store_b,store_a,'테스트한성매장',false); raise exception 'missing confirmation accepted'; exception when insufficient_privilege then null; end;
  perform public.connect_my_identity_v1('store',store_b,store_a,'테스트한성매장',true);
  begin perform public.connect_my_identity_v1('store',store_a,store_b,'테스트한성매쟝',true); raise exception 'cycle accepted'; exception when unique_violation then null; end;
  begin perform public.connect_my_identity_v1('store',store_b,other_branch,'테스트한성매장',true); raise exception 'reassignment accepted'; exception when unique_violation then null; end;
  response := public.search_my_identity_connections_v1('restaurant',restaurant_b,'한성대학교 학식당');
  if response #>> '{choices,0,id}' is distinct from restaurant_a::text then raise exception 'Hansung candidate missing'; end if;
  perform public.connect_my_identity_v1('restaurant',restaurant_b,restaurant_a,'한성대학교 학식당',true);
  response := public.get_my_owner_confirmed_restaurants_v3();
  if jsonb_array_length(response->'restaurants')<>1 or response #>> '{restaurants,0,id}' is distinct from restaurant_a::text then raise exception 'connected restaurant grouping failed'; end if;
  select jsonb_agg(price order by price->>'id') into connected_prices
    from jsonb_array_elements(response->'restaurants') r cross join lateral jsonb_array_elements(r->'menus') m
    cross join lateral jsonb_array_elements(m->'priceHistory') price;
  if jsonb_array_length(connected_prices)<>2 or connected_prices is distinct from original_prices then raise exception 'price facts or IDs changed during grouping'; end if;
  if public.get_my_owner_confirmed_restaurants_v2() is distinct from original_read then raise exception 'Fitness/legacy projection changed'; end if;
  select id into line_id from public.purchase_price_source_lines where purchase_source_id=source_b and source_line_key='line-1';
  execute 'reset role';
  response := public.private_purchase_owner_restaurant_choices_v1(line_id,'한성대학교 학식당');
  if jsonb_array_length(response)<>1 or response#>>'{0,restaurantId}' is distinct from restaurant_a::text then raise exception 'subsequent suggestions did not reuse connected root'; end if;
  execute 'set local role authenticated';
  purchase := jsonb_set(purchase,'{order,order_reference}','"identity-c"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('connection-purchase-c',purchase)->>'purchaseSourceId')::uuid;
  response := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',merchant_b,true,restaurant_a);
  if response#>>'{lineResults,0,ownerConfirmedIds,restaurantId}' is distinct from restaurant_a::text then raise exception 'selected connection root not used on later purchase'; end if;
  response := public.get_my_identity_connection_sources_v1(array[product]);
  if jsonb_array_length(response->'sources')<>1 or response #>> '{sources,0,selected,id}' is distinct from brand::text then raise exception 'selected brand not persisted'; end if;
  begin insert into public.owner_identity_connections values(actor,'store',store_a,foreign_store,'a','b',now()); raise exception 'direct insert allowed'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other)::text,true);
  if exists(select 1 from public.owner_identity_connections) then raise exception 'cross-owner RLS failed'; end if;
  if jsonb_array_length(public.get_my_identity_connection_sources_v1(array[product])->'sources')<>0 then raise exception 'cross-owner inventory leaked'; end if;
  begin perform public.search_my_identity_connections_v1('brand',product,'테스트 한성'); raise exception 'cross-owner search accepted'; exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  begin perform public.get_my_identity_connection_sources_v1(); raise exception 'anonymous read allowed'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$$;
select 'SHARED_IDENTITY_CONNECTIONS_RLS_AND_SOURCE_PRESERVATION_PASS' as result;
rollback;
