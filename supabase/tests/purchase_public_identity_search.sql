begin;
do $test$
declare actor uuid := '00000000-0000-4000-8000-000000000011';
  restaurant uuid := gen_random_uuid(); location uuid := gen_random_uuid(); standard uuid := gen_random_uuid(); catalog uuid := gen_random_uuid(); menu uuid := gen_random_uuid();
  purchase jsonb; result jsonb; source uuid; candidate uuid; own_restaurant uuid; own_menu uuid; snapshot jsonb;
  global_restaurants bigint; global_menus bigint; global_observations bigint;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  insert into public.restaurants(id,canonical_name,review_status,status,verification_status,created_by,reviewed_by,reviewed_at)
    values(restaurant,'한성대학교 공개 학식당','verified','active','verified',actor,actor,now());
  insert into public.restaurant_locations(id,restaurant_id,source_namespace,source_location_code,location_label,review_status,verification_status,created_by,reviewed_by,reviewed_at)
    values(location,restaurant,'component-registry',location::text,null,'verified','verified',actor,actor,now());
  insert into public.standard_products(id,purchase_type,canonical_name,verification_status,status,created_by)
    values(standard,'menu_item','캐네디소시지오므라이스','verified','active',actor);
  insert into public.catalog_products(id,standard_product_id,purchase_type,canonical_name,specification,content_amount,content_unit,package_count,reference_unit,specification_status,verification_status,status,created_by)
    values(catalog,standard,'menu_item','캐네디소시지오므라이스','1회 제공',1,'each',1,100,'placeholder','verified','active',actor);
  insert into public.restaurant_menus(id,restaurant_id,catalog_product_id,canonical_name,serving_label,review_status,status,verification_status,created_by,reviewed_by,reviewed_at)
    values(menu,restaurant,catalog,'캐네디소시지오므라이스','1회 제공','verified','active','verified',actor,actor,now());
  purchase := jsonb_build_object('schema_version','purchase-price-observation.v4','contract_version','purchase-price.v4','source_app','pricetrace_ocr_app',
    'purchase_kind','restaurant','transcription_status','user_verified','verification_basis','source_evidence','platform',jsonb_build_object('name','웨이티'),
    'seller',jsonb_build_object('seller_name','한성대 공개 학식당','business_kind','food_service'),
    'order',jsonb_build_object('status','paid','currency','KRW','ordered_on','2026-10-14','order_reference','public-search'),
    'payment',jsonb_build_object('status','paid','method','card','paid_on','2026-10-14','total_price',6000),
    'items',jsonb_build_array(jsonb_build_object('line_key','line-1','product',jsonb_build_object('product_name','캐네디 소시지 오므라이스'),
      'price_status','itemized','quantity',1,'unit_price',6000,'gross_price',6000)));
  execute 'set local role authenticated';
  select count(*) into global_restaurants from public.restaurants;
  select count(*) into global_menus from public.restaurant_menus;
  select count(*) into global_observations from public.restaurant_menu_manual_observations;
  result := public.ingest_verified_purchase_price_observation_v1('public-component-search',purchase); source := (result->>'purchaseSourceId')::uuid;
  snapshot := (select source_payload from public.purchase_price_sources where id = source);
  result := public.search_purchase_owner_identity_v1(source,'line-1','restaurant','한성');
  if result #>> '{choices,0,identityKind}' <> 'global_verified' or result #>> '{choices,0,id}' <> location::text then raise exception 'public restaurant search missing'; end if;
  result := public.resolve_purchase_global_identity_v1(source,'line-1','restaurant',location,true);
  own_restaurant := (result #>> '{lineResults,0,ownerRestaurantId}')::uuid;
  if own_restaurant is null or own_restaurant = restaurant then raise exception 'public choice not separated from owner identity'; end if;
  result := public.search_purchase_owner_identity_v1(source,'line-1','menu','캐네디 소시지');
  if result #>> '{choices,0,identityKind}' <> 'global_verified' or result #>> '{choices,0,id}' <> menu::text then raise exception 'public menu search missing'; end if;
  result := public.resolve_purchase_global_identity_v1(source,'line-1','menu',menu,true);
  own_menu := (result #>> '{lineResults,0,ownerConfirmedIds,restaurantMenuId}')::uuid;
  if own_menu is null or own_menu = menu or result #>> '{lineResults,0,authorityStatus}' <> 'owner_confirmed'
    or result #> '{lineResults,0,authoritativeIds}' <> 'null' then raise exception 'public choice falsely granted exact authority'; end if;
  if (select resolved_restaurant_id from public.purchase_owner_restaurants where id = own_restaurant) <> restaurant
    or (select resolved_restaurant_menu_id from public.purchase_owner_menus where id = own_menu) <> menu then raise exception 'selected registry mapping missing'; end if;
  if (select source_payload from public.purchase_price_sources where id = source) is distinct from snapshot then raise exception 'public choice rewrote canonical source'; end if;
  perform public.resolve_purchase_global_identity_v1(source,'line-1','menu',menu,true);
  if (select count(*) from public.purchase_owner_price_observations) <> 1 or (select count(*) from public.purchase_owner_menus) <> 1 then raise exception 'public selection retry duplicated owner rows'; end if;
  purchase := jsonb_set(purchase,'{order,order_reference}','"public-search-next"');
  result := public.ingest_verified_purchase_price_observation_v1('public-component-alias',purchase); source := (result->>'purchaseSourceId')::uuid;
  candidate := (public.submit_merchant_identity_candidate_v1('public-component-merchant','{"merchant_name":"한성대 공개 학식당","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  result := public.resolve_user_confirmed_purchase_restaurant_line_v1(source,'line-1',candidate,true,null,null,'review');
  if result #>> '{lineResults,0,ownerConfirmedIds,restaurantMenuId}' <> own_menu::text then raise exception 'public chosen alias did not reuse owner menu'; end if;
  if (select count(*) from public.restaurants) <> global_restaurants or (select count(*) from public.restaurant_menus) <> global_menus
    or (select count(*) from public.restaurant_menu_manual_observations) <> global_observations then raise exception 'public selection created global rows/observations'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin perform public.resolve_purchase_global_identity_v1(source,'line-1','menu',menu,true); raise exception 'null owner global selector'; exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  begin perform public.resolve_purchase_global_identity_v1(source,'line-1','menu',menu,true); raise exception 'anonymous global selector'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$test$;
select 'PUBLIC_SEARCH_OWNER_AUTHORITY_SEPARATION_PASS' as result;
rollback;
