-- Local rollback fixture: aliases are explicit owner choices, never rewritten source facts.
begin;
do $test$
declare actor uuid := '00000000-0000-4000-8000-000000000011'; other uuid := '00000000-0000-4000-8000-000000000022';
  purchase jsonb; seed jsonb; a jsonb; b jsonb; snapshot jsonb; lines_snapshot jsonb; result jsonb; search jsonb;
  source_seed uuid; source_a uuid; source_b uuid; candidate_seed uuid; candidate_a uuid; candidate_b uuid;
  restaurant uuid; menu uuid; platform uuid; observations bigint; source_side uuid; side_candidate uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  purchase := jsonb_build_object('schema_version','purchase-price-observation.v4','contract_version','purchase-price.v4',
    'source_app','pricetrace_ocr_app','purchase_kind','restaurant','transcription_status','user_verified','verification_basis','source_evidence',
    'platform',jsonb_build_object('name','WAITI'),
    'seller',jsonb_build_object('seller_name','한성대학교 학식당','business_kind','food_service'),
    'order',jsonb_build_object('status','paid','currency','KRW','ordered_on','2026-10-13','order_reference','identity-seed'),
    'payment',jsonb_build_object('status','paid','method','card','paid_on','2026-10-13','total_price',6000),
    'items',jsonb_build_array(jsonb_build_object('line_key','line-1','product',jsonb_build_object('product_name','캐네디소시지오므라이스'),
      'price_status','itemized','quantity',1,'unit_price',6000,'gross_price',6000)));
  execute 'set local role authenticated';
  seed := public.ingest_verified_purchase_price_observation_v1('component-seed',purchase);
  source_seed := (seed->>'purchaseSourceId')::uuid;
  candidate_seed := (public.submit_merchant_identity_candidate_v1('component-seed-merchant','{"merchant_name":"한성대학교 학식당","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  seed := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_seed,'line-1',candidate_seed,true);
  restaurant := (seed #>> '{lineResults,0,ownerConfirmedIds,restaurantId}')::uuid;
  menu := (seed #>> '{lineResults,0,ownerConfirmedIds,restaurantMenuId}')::uuid;
  result := public.resolve_purchase_owner_platform_v1(source_seed,null,true,true);
  platform := (result #>> '{platformIdentity,id}')::uuid;
  if platform is null then raise exception 'private platform registration missing'; end if;

  -- A/C/G: different source labels explicitly link existing identities.
  a := jsonb_set(jsonb_set(jsonb_set(jsonb_set(purchase,'{seller,seller_name}','"한성대 학식당"'),
    '{platform,name}','"웨이티"'),'{items,0,product,product_name}','"캐네디 소시지 오므라이스"'),'{order,order_reference}','"identity-a"');
  result := public.ingest_verified_purchase_price_observation_v1('component-a',a); source_a := (result->>'purchaseSourceId')::uuid;
  candidate_a := (public.submit_merchant_identity_candidate_v1('component-a-merchant','{"merchant_name":"한성대 학식당","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  select to_jsonb(s) into snapshot from public.purchase_price_sources s where id = source_a;
  select jsonb_agg(to_jsonb(l) order by id) into lines_snapshot from public.purchase_price_source_lines l where purchase_source_id = source_a;
  result := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_a,'line-1',candidate_a,true,null,null,'review');
  if result #>> '{lineResults,0,reasonCode}' <> 'owner_restaurant_selection_required' or (select count(*) from public.purchase_owner_restaurants) <> 1 then raise exception 'review created an unchosen restaurant'; end if;
  search := public.search_purchase_owner_identity_v1(source_a,'line-1','restaurant','한성대 학식당');
  if jsonb_array_length(search->'choices') <> 1 or search #>> '{choices,0,id}' <> restaurant::text then raise exception 'restaurant search failed'; end if;
  result := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_a,'line-1',candidate_a,true,restaurant,null,'select_restaurant');
  if result #>> '{lineResults,0,reasonCode}' <> 'owner_menu_selection_required' or (select count(*) from public.purchase_owner_menus) <> 1 then raise exception 'restaurant selection created an unchosen menu'; end if;
  search := public.search_purchase_owner_identity_v1(source_a,'line-1','menu','캐네디 소시지 오므라이스');
  if jsonb_array_length(search->'choices') <> 1 or search #>> '{choices,0,id}' <> menu::text then raise exception 'menu search failed'; end if;
  result := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_a,'line-1',candidate_a,true,null,menu,'select_menu');
  if result #>> '{lineResults,0,ownerConfirmedIds,restaurantMenuId}' <> menu::text or result #> '{lineResults,0,authoritativeIds}' <> 'null' then raise exception 'menu selection mixed authority'; end if;
  search := public.search_purchase_owner_identity_v1(source_a,'line-1','platform','WAITI');
  if search #>> '{choices,0,id}' <> platform::text then raise exception 'platform search failed'; end if;
  result := public.resolve_purchase_owner_platform_v1(source_a,platform,false,true);
  if result #>> '{platformIdentity,id}' <> platform::text then raise exception 'platform selection failed'; end if;
  if (select to_jsonb(s) from public.purchase_price_sources s where id = source_a) is distinct from snapshot
    or (select jsonb_agg(to_jsonb(l) order by id) from public.purchase_price_source_lines l where purchase_source_id = source_a) is distinct from lines_snapshot then raise exception 'source labels mutated'; end if;

  -- B/H: subsequent source aliases and retries reuse the same restaurant/location/menu/platform.
  b := jsonb_set(a,'{order,order_reference}','"identity-b"');
  result := public.ingest_verified_purchase_price_observation_v1('component-b',b); source_b := (result->>'purchaseSourceId')::uuid;
  candidate_b := (public.submit_merchant_identity_candidate_v1('component-b-merchant','{"merchant_name":"한성대 학식당","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  result := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',candidate_b,true,null,null,'review');
  if result #>> '{lineResults,0,ownerConfirmedIds,restaurantId}' <> restaurant::text
    or result #>> '{lineResults,0,ownerConfirmedIds,restaurantMenuId}' <> menu::text
    or result #>> '{lineResults,0,ownerConfirmedIds,restaurantLocationId}' <> seed #>> '{lineResults,0,ownerConfirmedIds,restaurantLocationId}' then raise exception 'alias reuse created new identity'; end if;
  result := public.resolve_purchase_owner_platform_v1(source_b,null,false,true);
  if result #>> '{platformIdentity,id}' <> platform::text or (select count(*) from public.purchase_owner_platforms) <> 1 then raise exception 'platform alias reuse failed'; end if;
  b := jsonb_set(jsonb_set(a,'{seller,seller_name}','"한성대학교 학식당"'),'{order,order_reference}','"identity-b-long"');
  result := public.ingest_verified_purchase_price_observation_v1('component-b-long',b); source_b := (result->>'purchaseSourceId')::uuid;
  candidate_b := (public.submit_merchant_identity_candidate_v1('component-b-long-merchant','{"merchant_name":"한성대학교 학식당","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  result := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',candidate_b,true,null,null,'review');
  if result #>> '{lineResults,0,ownerConfirmedIds,restaurantId}' <> restaurant::text or result #>> '{lineResults,0,ownerConfirmedIds,restaurantMenuId}' <> menu::text then raise exception 'original restaurant label did not reuse selected identities'; end if;
  observations := (select count(*) from public.purchase_owner_price_observations);
  perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',candidate_b,true,null,null,'review');
  perform public.resolve_purchase_owner_platform_v1(source_b,null,false,true);
  if (select count(*) from public.purchase_owner_price_observations) <> observations then raise exception 'identity retry duplicated price'; end if;
  if (select count(*) from public.purchase_owner_restaurants) <> 1 or (select count(*) from public.purchase_owner_menus) <> 1 then raise exception 'identity duplicate'; end if;

  -- D: free soup has a relation and photo evidence, never a purchase line or price row.
  result := public.register_purchase_menu_components_v1(source_a,'line-1',repeat('a',64),
    '[{"nutritionClientKey":"food-soup","name":"국물","role":"complimentary_side","evidenceRefs":["food-photo-1"]}]',true);
  if result #>> '{menuComponents,0,name}' <> '국물' or result #>> '{menuComponents,0,parentOwnerMenuId}' <> menu::text
    or (select count(*) from public.purchase_price_source_lines where purchase_source_id = source_a) <> 1
    or (select count(*) from public.purchase_owner_price_observations) <> observations then raise exception 'component invented a price or line'; end if;
  perform public.register_purchase_menu_components_v1(source_a,'line-1',repeat('a',64),
    '[{"nutritionClientKey":"food-soup","name":"국물","role":"complimentary_side","evidenceRefs":["food-photo-1"]}]',true);
  if (select count(*) from public.purchase_owner_menu_component_sources) <> 1 then raise exception 'component replay duplicate'; end if;
  begin
    perform public.register_purchase_menu_components_v1(source_b,'line-1',repeat('a',64),
      '[{"nutritionClientKey":"food-soup","name":"국물","role":"complimentary_side","evidenceRefs":["food-photo-1"]}]',true);
    raise exception 'same canonical nutrition linked to two purchases'; exception when unique_violation then null;
  end;
  begin
    perform public.register_purchase_menu_components_v1(source_a,'line-1',repeat('a',64),
      '[{"nutritionClientKey":"food-soup","name":"다른 국물","role":"complimentary_side","evidenceRefs":["food-photo-1"]}]',true);
    raise exception 'component evidence rewritten'; exception when unique_violation then null;
  end;
  begin
    perform public.register_purchase_menu_components_v1(source_a,'missing',repeat('a',64),'[]',true);
    raise exception 'dangling parent accepted'; exception when insufficient_privilege then null;
  end;
  if public.get_my_owner_confirmed_restaurants_v1() #> '{restaurants,0,menus,0,components}' is not null then raise exception 'v1 read contract changed'; end if;
  if public.get_my_owner_confirmed_restaurants_v2() #>> '{restaurants,0,menus,0,components,0,name}' <> '국물' then raise exception 'component read missing'; end if;

  -- E: a paid side remains a separate real menu + observation.
  a := jsonb_set(jsonb_set(purchase,'{items}',jsonb_build_array(
    jsonb_build_object('line_key','line-1','product',jsonb_build_object('product_name','캐네디소시지오므라이스'),'price_status','itemized','quantity',1,'unit_price',6000,'gross_price',6000),
    jsonb_build_object('line_key','paid-side','product',jsonb_build_object('product_name','추가 돈까스'),'price_status','itemized','quantity',1,'unit_price',1500,'gross_price',1500))),'{order,order_reference}','"paid-side"');
  a := jsonb_set(a,'{payment,total_price}','7500');
  result := public.ingest_verified_purchase_price_observation_v1('component-paid-side',a); source_side := (result->>'purchaseSourceId')::uuid;
  result := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_side,'paid-side',candidate_seed,true,null,null,'create_menu');
  if result #>> '{lineResults,1,observationCreated}' <> 'true' or result #>> '{lineResults,1,ownerConfirmedIds,restaurantMenuId}' = menu::text then raise exception 'paid side lost independent menu'; end if;
  if (select count(*) from public.purchase_owner_price_observations) <> observations + 1 then raise exception 'paid side price missing'; end if;

  -- Serving/branch/source-pair conflicts cannot be selected as aliases.
  a := jsonb_set(jsonb_set(purchase,'{items,0,option_text}','"large"'),'{order,order_reference}','"serving-conflict"');
  result := public.ingest_verified_purchase_price_observation_v1('component-serving',a); source_side := (result->>'purchaseSourceId')::uuid;
  perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_side,'line-1',candidate_seed,true,restaurant,null,'select_restaurant');
  if public.search_purchase_owner_identity_v1(source_side,'line-1','menu','')->'choices' <> '[]' then raise exception 'different serving suggested'; end if;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_side,'line-1',candidate_seed,true,null,menu,'select_menu');
    raise exception 'different serving selected'; exception when insufficient_privilege then null;
  end;
  a := jsonb_set(jsonb_set(purchase,'{seller,branch_name}','"다른 지점"'),'{order,order_reference}','"branch-conflict"');
  result := public.ingest_verified_purchase_price_observation_v1('component-branch',a); source_side := (result->>'purchaseSourceId')::uuid;
  side_candidate := (public.submit_merchant_identity_candidate_v1('component-branch-merchant','{"merchant_name":"한성대학교 학식당","branch_name":"다른 지점","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  if public.search_purchase_owner_identity_v1(source_side,'line-1','restaurant','')->'choices' <> '[]' then raise exception 'branch conflict suggested'; end if;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_side,'line-1',side_candidate,true,restaurant,null,'select_restaurant');
    raise exception 'branch conflict selected'; exception when insufficient_privilege then null;
  end;
  b := jsonb_set(jsonb_set(jsonb_set(purchase,'{seller,source_namespace}','"different-campus"'),'{seller,source_code}','"different-location"'),'{order,order_reference}','"source-pair-conflict"');
  result := public.ingest_verified_purchase_price_observation_v1('component-source-pair',b); source_b := (result->>'purchaseSourceId')::uuid;
  candidate_b := (public.submit_merchant_identity_candidate_v1('component-source-pair-merchant','{"merchant_name":"한성대학교 학식당","business_kind":"food_service","source_namespace":"different-campus","source_location_code":"different-location"}',true)->>'candidateId')::uuid;
  if public.search_purchase_owner_identity_v1(source_b,'line-1','restaurant','')->'choices' <> '[]' then raise exception 'different source pair suggested'; end if;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',candidate_b,true,restaurant,null,'select_restaurant');
    raise exception 'different source pair selected'; exception when insufficient_privilege then null;
  end;
  -- F: unknown branch + two anchors requires selection, even on retry.
  perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_side,'line-1',side_candidate,true);
  a := jsonb_set(purchase,'{order,order_reference}','"ambiguous"');
  result := public.ingest_verified_purchase_price_observation_v1('component-ambiguous',a); source_side := (result->>'purchaseSourceId')::uuid;
  result := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_side,'line-1',candidate_seed,true,null,null,'review');
  if result #>> '{lineResults,0,reasonCode}' <> 'owner_restaurant_selection_required' or jsonb_array_length(result #> '{lineResults,0,ownerRestaurantChoices}') <> 2 then raise exception 'ambiguous restaurant auto selected'; end if;

  -- RLS: no search, select, relation or registry access across owners.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other)::text,true);
  begin perform public.search_purchase_owner_identity_v1(source_a,'line-1','restaurant',''); raise exception 'foreign source searched'; exception when insufficient_privilege then null; end;
  begin perform public.resolve_purchase_owner_platform_v1(source_a,platform,false,true); raise exception 'foreign platform selected'; exception when insufficient_privilege then null; end;
  begin perform public.register_purchase_menu_components_v1(source_a,'line-1',repeat('a',64),'[]',true); raise exception 'foreign component registered'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.purchase_owner_platforms) or exists(select 1 from public.purchase_owner_menu_components)
    or exists(select 1 from public.purchase_owner_menu_component_sources) then raise exception 'private tables leaked'; end if;
  result := public.ingest_verified_purchase_price_observation_v1('other-owner-identity-selection',purchase); source_b := (result->>'purchaseSourceId')::uuid;
  candidate_b := (public.submit_merchant_identity_candidate_v1('other-owner-merchant','{"merchant_name":"한성대학교 학식당","business_kind":"food_service"}',true)->>'candidateId')::uuid;
  begin perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',candidate_b,true,restaurant,null,'select_restaurant'); raise exception 'foreign restaurant selected on owned source'; exception when insufficient_privilege then null; end;
  begin perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',candidate_b,true,null,menu,'select_menu'); raise exception 'foreign menu selected on owned source'; exception when insufficient_privilege then null; end;
  begin perform public.resolve_purchase_owner_platform_v1(source_b,platform,false,true); raise exception 'foreign platform selected on owned source'; exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  begin perform public.search_purchase_owner_identity_v1(source_a,'line-1','menu',''); raise exception 'anonymous search'; exception when insufficient_privilege then null; end;
  begin perform public.resolve_purchase_owner_platform_v1(source_a,null,true,true); raise exception 'anonymous platform'; exception when insufficient_privilege then null; end;
  begin perform public.register_purchase_menu_components_v1(source_a,'line-1',repeat('a',64),'[]',true); raise exception 'anonymous component'; exception when insufficient_privilege then null; end;
  begin perform public.get_my_owner_confirmed_restaurants_v2(); raise exception 'anonymous component read'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$test$;
select 'RESTAURANT_COMPONENT_IDENTITY_A_H_RLS_PASS' as result;
rollback;
