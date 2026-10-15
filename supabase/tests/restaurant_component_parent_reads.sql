-- Synthetic authenticated fixtures; all writes roll back. No HTTP/JWT proof.
begin;
do $test$
declare
  actor uuid := '00000000-0000-4000-8000-000000000011'; other uuid := '00000000-0000-4000-8000-000000000022';
  restaurant uuid := gen_random_uuid(); location uuid := gen_random_uuid(); standard uuid := gen_random_uuid();
  catalog uuid := gen_random_uuid(); menu uuid := gen_random_uuid(); owner_menu uuid;
  purchase jsonb; result jsonb; source uuid; exact_source uuid; other_source uuid; v1 jsonb; v1_definition text;
  global_snapshot jsonb; source_snapshot jsonb; observations bigint; owner_observations bigint; components jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  insert into public.restaurants(id,canonical_name,review_status,status,verification_status,created_by,reviewed_by,reviewed_at)
    values(restaurant,'한성대학교 학식당','verified','active','verified',actor,actor,now());
  insert into public.restaurant_locations(id,restaurant_id,source_namespace,source_location_code,review_status,verification_status,created_by,reviewed_by,reviewed_at)
    values(location,restaurant,'component-read','campus-main','verified','verified',actor,actor,now());
  insert into public.standard_products(id,purchase_type,canonical_name,verification_status,status,created_by)
    values(standard,'menu_item','오므라이스','verified','active',actor);
  insert into public.catalog_products(id,standard_product_id,purchase_type,canonical_name,specification,content_amount,content_unit,package_count,reference_unit,specification_status,verification_status,status,created_by)
    values(catalog,standard,'menu_item','오므라이스','1회 제공',1,'each',1,100,'placeholder','verified','active',actor);
  insert into public.restaurant_menus(id,restaurant_id,catalog_product_id,canonical_name,serving_label,review_status,status,verification_status,created_by,reviewed_by,reviewed_at)
    values(menu,restaurant,catalog,'오므라이스','1회 제공','verified','active','verified',actor,actor,now());
  v1_definition := pg_get_functiondef('public.get_my_owner_confirmed_restaurants_v1()'::regprocedure);
  global_snapshot := (select to_jsonb(m) from public.restaurant_menus m where id = menu);
  purchase := jsonb_build_object('schema_version','purchase-price-observation.v4','contract_version','purchase-price.v4','source_app','pricetrace_ocr_app',
    'purchase_kind','restaurant','transcription_status','user_verified','verification_basis','source_evidence','platform',jsonb_build_object('name','웨이티'),
    'seller',jsonb_build_object('seller_name','한성대 학식당','business_kind','food_service'),
    'order',jsonb_build_object('status','paid','currency','KRW','ordered_on','2026-10-14','order_reference','owner-component-read'),
    'payment',jsonb_build_object('status','paid','method','card','paid_on','2026-10-14','total_price',6000),
    'items',jsonb_build_array(jsonb_build_object('line_key','line-1','product',jsonb_build_object('product_name','오므라이스'),
      'price_status','itemized','quantity',1,'unit_price',6000,'gross_price',6000)));
  execute 'set local role authenticated';
  result := public.ingest_verified_purchase_price_observation_v1('owner-component-read',purchase); source := (result->>'purchaseSourceId')::uuid;
  perform public.resolve_purchase_global_identity_v1(source,'line-1','restaurant',location,true);
  result := public.resolve_purchase_global_identity_v1(source,'line-1','menu',menu,true);
  owner_menu := (result #>> '{lineResults,0,ownerConfirmedIds,restaurantMenuId}')::uuid;
  if owner_menu is null or result #>> '{lineResults,0,authorityStatus}' <> 'owner_confirmed'
    or result #> '{lineResults,0,authoritativeIds}' <> 'null' then raise exception 'mapping granted global authority'; end if;
  perform public.register_purchase_menu_components_v1(source,'line-1',repeat('a',64),
    '[{"nutritionClientKey":"food-sauce","name":"소스","role":"sauce","evidenceRefs":["food-photo-1"]}]',true);
  v1 := public.get_my_owner_confirmed_restaurants_v1();
  components := public.get_my_owner_confirmed_restaurants_v2() #> '{restaurants,0,menus,0,components}';
  if jsonb_array_length(components) <> 1 or components #>> '{0,name}' <> '소스' then raise exception 'owner parent read missing'; end if;
  purchase := jsonb_set(jsonb_set(jsonb_set(purchase,'{seller}',jsonb_build_object('seller_name','한성대학교 학식당','business_kind','food_service',
    'source_namespace','component-read','source_code','campus-main')),'{items,0,option_text}','"1회 제공"'),'{order,order_reference}','"exact-component-read"');
  result := public.ingest_verified_purchase_price_observation_v1('exact-component-read',purchase); exact_source := (result->>'purchaseSourceId')::uuid;
  if result #>> '{lineResults,0,authorityStatus}' <> 'exact' then raise exception 'fixture exact authority missing'; end if;
  source_snapshot := (select source_payload from public.purchase_price_sources where id = exact_source);
  -- Real paid observations may refresh the legacy menu price cache before component registration.
  global_snapshot := (select to_jsonb(m) from public.restaurant_menus m where id = menu);
  observations := (select count(*) from public.restaurant_menu_manual_observations);
  owner_observations := (select count(*) from public.purchase_owner_price_observations);
  result := public.register_purchase_menu_components_v1(exact_source,'line-1',repeat('b',64),
    '[{"nutritionClientKey":"food-soup","name":"국물","role":"complimentary_side","evidenceRefs":["food-photo-1"]}]',true);
  if result #>> '{menuComponents,0,parentRestaurantMenuId}' <> menu::text
    or result #> '{menuComponents,0,parentOwnerMenuId}' <> 'null' then raise exception 'exact storage parent lost'; end if;
  -- Replays/new evidence revisions must not multiply the component read.
  perform public.register_purchase_menu_components_v1(exact_source,'line-1',repeat('b',64),
    '[{"nutritionClientKey":"food-soup","name":"국물","role":"complimentary_side","evidenceRefs":["food-photo-1"]}]',true);
  perform public.register_purchase_menu_components_v1(exact_source,'line-1',repeat('c',64),
    '[{"nutritionClientKey":"food-soup","name":"국물","role":"complimentary_side","evidenceRefs":["food-photo-2"]}]',true);
  components := public.get_my_owner_confirmed_restaurants_v2() #> '{restaurants,0,menus,0,components}';
  if not exists(select 1 from jsonb_array_elements(components) c where c->>'name' = '국물') then
    raise exception 'EXACT_GLOBAL_COMPONENT_PRIVATE_READ_MISSING'; end if;
  if jsonb_array_length(components) <> 2 or (select count(distinct c->>'id') from jsonb_array_elements(components) c) <> 2 then
    raise exception 'duplicate component read'; end if;
  if public.get_my_owner_confirmed_restaurants_v1() is distinct from v1
    or pg_get_functiondef('public.get_my_owner_confirmed_restaurants_v1()'::regprocedure) is distinct from v1_definition then
    raise exception 'V1 changed'; end if;
  if exists(select 1 from jsonb_array_elements(components) c where (select array_agg(k order by k) from jsonb_object_keys(c) k) <> array['id','name','role'])
    or (select count(*) from public.restaurant_menu_manual_observations) <> observations
    or (select count(*) from public.purchase_owner_price_observations) <> owner_observations
    or (select count(*) from public.purchase_price_source_lines where purchase_source_id = exact_source) <> 1
    or (select source_payload from public.purchase_price_sources where id = exact_source) is distinct from source_snapshot then
    raise exception 'component invented financial data or rewrote facts'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other)::text,true);
  result := public.ingest_verified_purchase_price_observation_v1('other-exact-component-read',purchase); other_source := (result->>'purchaseSourceId')::uuid;
  perform public.register_purchase_menu_components_v1(other_source,'line-1',repeat('b',64),
    '[{"nutritionClientKey":"food-soup","name":"타 사용자 국물","role":"complimentary_side","evidenceRefs":["food-photo-1"]}]',true);
  if exists(select 1 from public.purchase_owner_menu_components where user_id = actor) then raise exception 'RLS leaked actor components'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  components := public.get_my_owner_confirmed_restaurants_v2() #> '{restaurants,0,menus,0,components}';
  if jsonb_array_length(components) <> 2 or exists(select 1 from jsonb_array_elements(components) c where c->>'name' = '타 사용자 국물') then
    raise exception 'foreign exact-parent component leaked'; end if;
  if (select to_jsonb(m) from public.restaurant_menus m where id = menu) is distinct from global_snapshot then raise exception 'global menu mutated'; end if;
  begin
    update public.purchase_owner_menu_components set name = 'unauthorized';
    raise exception 'authenticated direct update accepted'; exception when insufficient_privilege then null;
  end;
  begin
    delete from public.purchase_owner_menu_component_sources;
    raise exception 'authenticated direct delete accepted'; exception when insufficient_privilege then null;
  end;
  begin
    insert into public.purchase_owner_menu_components(user_id,restaurant_menu_id,name,role) values(actor,menu,'unauthorized','sauce');
    raise exception 'authenticated direct insert accepted'; exception when insufficient_privilege then null;
  end;
  execute 'set local role anon';
  begin perform public.get_my_owner_confirmed_restaurants_v2(); raise exception 'anon read accepted'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.purchase_owner_menu_components; raise exception 'anon table read accepted'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.purchase_owner_menu_component_sources; raise exception 'anon source read accepted'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$test$;
select 'COMPONENT_OWNER_EXACT_PRIVATE_READ_A_F_PASS' as result;
rollback;
