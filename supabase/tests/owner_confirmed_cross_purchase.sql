-- Works locally and on the reviewed live schema. All fixture users/data are rolled back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000022') on conflict (id) do nothing;
do $test$
declare
  actor uuid := '00000000-0000-4000-8000-000000000011'; other uuid := '00000000-0000-4000-8000-000000000022';
  purchase_a jsonb; purchase_b jsonb; purchase_c jsonb; result_a jsonb; result_b jsonb; pending jsonb; read_model jsonb;
  source_a uuid; source_b uuid; source_c uuid; candidate_a uuid; candidate_b uuid; candidate_c uuid;
  restaurant_a uuid; restaurant_c uuid; menu_a uuid; menu_b uuid; global_count bigint; global_menu_count bigint;
  source_before jsonb; lines_before jsonb; private_before bigint; menu_read jsonb; other_restaurant uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',actor)::text, true);
  purchase_a := jsonb_build_object('schema_version','purchase-price-observation.v4','contract_version','purchase-price.v4',
    'source_app','pricetrace_ocr_app','purchase_kind','restaurant','transcription_status','user_verified',
    'verification_basis','source_evidence','platform',jsonb_build_object('name','웨이티'),
    'seller',jsonb_build_object('seller_name','한성대학교 학생식당','branch_name',null,'business_kind','food_service','source_namespace',null,'source_code',null),
    'order',jsonb_build_object('status','paid','currency','KRW','ordered_on','2026-10-13','order_reference','853'),
    'payment',jsonb_build_object('status','paid','method','card','paid_on','2026-10-13','total_price',9500),
    'items',jsonb_build_array(
      jsonb_build_object('line_key','line-1','product',jsonb_build_object('product_name','돼지불백덮밥'),'price_status','itemized','quantity',1,'unit_price',5700,'gross_price',5700),
      jsonb_build_object('line_key','line-2','product',jsonb_build_object('product_name','어묵우동'),'price_status','itemized','quantity',1,'unit_price',3800,'gross_price',3800)));
  purchase_b := jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(purchase_a,
    '{order,ordered_on}','"2026-11-10"'),'{order,order_reference}','"854"'),'{payment,paid_on}','"2026-11-10"'),
    '{items,0,unit_price}','6000'),'{items,0,gross_price}','6000'),'{items,1,unit_price}','4000'),'{items,1,gross_price}','4000');
  purchase_b := jsonb_set(purchase_b,'{payment,total_price}','10000');
  select count(*) into global_count from public.restaurants;
  select count(*) into global_menu_count from public.restaurant_menus;
  execute 'set local role authenticated';
  result_a := public.ingest_verified_purchase_price_observation_v1('cross-purchase-a',purchase_a);
  result_b := public.ingest_verified_purchase_price_observation_v1('cross-purchase-b',purchase_b);
  source_a := (result_a ->> 'purchaseSourceId')::uuid; source_b := (result_b ->> 'purchaseSourceId')::uuid;
  if source_a = source_b then raise exception 'independent purchase sources collapsed'; end if;
  candidate_a := (public.submit_merchant_identity_candidate_v1('merchant-a',
    '{"merchant_name":"한성대학교 학생식당","business_kind":"food_service"}',true) ->> 'candidateId')::uuid;
  candidate_b := (public.submit_merchant_identity_candidate_v1('merchant-b',
    '{"merchant_name":"한성대학교 학생식당","business_kind":"food_service"}',true) ->> 'candidateId')::uuid;
  if candidate_a <> candidate_b then raise exception 'same owner seller facts did not reuse merchant candidate'; end if;
  select jsonb_agg(to_jsonb(s) order by id) into source_before from public.purchase_price_sources s where id in (source_a,source_b);
  select jsonb_agg(to_jsonb(l) order by id) into lines_before from public.purchase_price_source_lines l where purchase_source_id in (source_a,source_b);
  result_a := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_a,'line-1',candidate_a,true);
  result_a := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_a,'line-2',candidate_a,true);
  result_b := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',candidate_b,true);
  result_b := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-2',candidate_b,true);
  restaurant_a := (result_a #>> '{lineResults,0,ownerConfirmedIds,restaurantId}')::uuid;
  menu_a := (result_a #>> '{lineResults,0,ownerConfirmedIds,restaurantMenuId}')::uuid;
  menu_b := (result_a #>> '{lineResults,1,ownerConfirmedIds,restaurantMenuId}')::uuid;
  if result_a #> '{lineResults,0,ownerConfirmedIds}' <> result_b #> '{lineResults,0,ownerConfirmedIds}'
    or result_a #> '{lineResults,1,ownerConfirmedIds}' <> result_b #> '{lineResults,1,ownerConfirmedIds}' then
    raise exception 'second purchase made new restaurant/location/menu identities'; end if;
  if (select count(*) from public.purchase_owner_restaurants) <> 1
    or (select count(distinct location_id) from public.purchase_owner_restaurants) <> 1
    or (select count(*) from public.purchase_owner_restaurant_sources) <> 2
    or (select count(*) from public.purchase_owner_menus) <> 2
    or (select count(*) from public.purchase_owner_menu_sources) <> 4
    or (select count(*) from public.purchase_owner_price_observations) <> 4 then
    raise exception 'cross-purchase counts wrong'; end if;
  if (select array_agg(unit_price_krw order by observed_on) from public.purchase_owner_price_observations where menu_id = menu_a) <> array[5700,6000]
    or (select array_agg(unit_price_krw order by observed_on) from public.purchase_owner_price_observations where menu_id = menu_b) <> array[3800,4000] then
    raise exception 'price history not accumulated'; end if;
  if public.resolve_user_confirmed_purchase_restaurant_line_v1(source_b,'line-1',candidate_b,true) is distinct from result_b
    or public.resolve_ocr_purchase_restaurant_line_v1(source_b,'line-1',true) is distinct from result_b then
    raise exception 'replay/legacy response changed identity'; end if;
  if (select jsonb_agg(to_jsonb(s) order by id) from public.purchase_price_sources s where id in (source_a,source_b)) is distinct from source_before
    or (select jsonb_agg(to_jsonb(l) order by id) from public.purchase_price_source_lines l where purchase_source_id in (source_a,source_b)) is distinct from lines_before then
    raise exception 'canonical/source facts were mutated'; end if;
  read_model := public.get_my_owner_confirmed_restaurants_v1();
  select value into menu_read from jsonb_array_elements(read_model #> '{restaurants,0,menus}') where value ->> 'id' = menu_a::text;
  if read_model ->> 'ownerId' <> actor::text or jsonb_array_length(read_model -> 'restaurants') <> 1
    or jsonb_array_length(read_model #> '{restaurants,0,menus}') <> 2
    or jsonb_array_length(menu_read -> 'priceHistory') <> 2
    or menu_read #>> '{priceHistory,0,unitPriceKrw}' <> '6000'
    or menu_read #>> '{priceHistory,0,observedOn}' <> '2026-11-10' then
    raise exception 'owner read/history/latest projection wrong: %',read_model; end if;
  if public.get_restaurant_directory_v2()::text like '%' || restaurant_a::text || '%' then
    raise exception 'owner restaurant leaked into public directory'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other)::text,true);
  if public.get_my_owner_confirmed_restaurants_v1() -> 'restaurants' <> '[]'::jsonb
    or exists(select 1 from public.purchase_owner_price_observations)
    or exists(select 1 from public.purchase_owner_restaurant_sources)
    or exists(select 1 from public.purchase_owner_menu_sources) then raise exception 'foreign owner leak'; end if;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.get_my_owner_confirmed_restaurants_v1(); raise exception 'null actor read accepted';
    exception when insufficient_privilege then null;
  end;
  execute 'set local role anon';
  begin
    perform public.get_my_owner_confirmed_restaurants_v1(); raise exception 'anonymous private read accepted';
    exception when insufficient_privilege then null;
  end;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  -- Explicitly different branches never auto-merge into the original name-only identity.
  purchase_c := jsonb_set(jsonb_set(purchase_a,'{seller,branch_name}','"창의관"'),'{order,order_reference}','"branch-c"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('cross-branch-c',purchase_c) ->> 'purchaseSourceId')::uuid;
  candidate_c := (public.submit_merchant_identity_candidate_v1('merchant-c',
    '{"merchant_name":"한성대학교 학생식당","branch_name":"창의관","business_kind":"food_service"}',true) ->> 'candidateId')::uuid;
  pending := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_c,true);
  restaurant_c := (pending #>> '{lineResults,0,ownerConfirmedIds,restaurantId}')::uuid;
  if restaurant_c is null or restaurant_c = restaurant_a then raise exception 'different branch collapsed'; end if;
  purchase_c := jsonb_set(jsonb_set(purchase_a,'{seller,branch_name}','"상상관"'),'{order,order_reference}','"branch-d"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('cross-branch-d',purchase_c) ->> 'purchaseSourceId')::uuid;
  candidate_c := (public.submit_merchant_identity_candidate_v1('merchant-d',
    '{"merchant_name":"한성대학교 학생식당","branch_name":"상상관","business_kind":"food_service"}',true) ->> 'candidateId')::uuid;
  pending := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_c,true);
  if pending #>> '{lineResults,0,ownerConfirmedIds,restaurantId}' in (restaurant_a::text,restaurant_c::text) then
    raise exception 'explicit branches collapsed'; end if;
  -- Name-only facts now have three possible physical places. Require an explicit runtime choice.
  purchase_c := jsonb_set(purchase_b,'{order,order_reference}','"ambiguous-e"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('cross-ambiguous-e',purchase_c) ->> 'purchaseSourceId')::uuid;
  select count(*) into private_before from public.purchase_owner_price_observations;
  pending := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_a,true);
  if pending #>> '{lineResults,0,authorityStatus}' <> 'needs_review'
    or pending #>> '{lineResults,0,reasonCode}' <> 'owner_restaurant_selection_required'
    or jsonb_array_length(pending #> '{lineResults,0,ownerRestaurantChoices}') <> 3
    or (select count(*) from public.purchase_owner_price_observations) <> private_before then
    raise exception 'ambiguous owner identities merged without selection'; end if;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_a,true,other);
    raise exception 'foreign/missing owner selector accepted'; exception when insufficient_privilege then null;
  end;
  pending := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_a,true,restaurant_c);
  if pending #>> '{lineResults,0,ownerConfirmedIds,restaurantId}' <> restaurant_c::text then raise exception 'explicit owner selection not bound'; end if;
  -- Different serving/option facts create another menu only within the same restaurant.
  purchase_c := jsonb_set(jsonb_set(purchase_a,'{seller,branch_name}','"창의관"'),'{order,order_reference}','"option-f"');
  purchase_c := jsonb_set(purchase_c,'{items,0,option_text}','"대"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('cross-option-f',purchase_c) ->> 'purchaseSourceId')::uuid;
  candidate_c := (public.submit_merchant_identity_candidate_v1('merchant-f',
    '{"merchant_name":"한성대학교 학생식당","branch_name":"창의관","business_kind":"food_service"}',true) ->> 'candidateId')::uuid;
  pending := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_c,true);
  if (select count(*) from public.purchase_owner_menus where restaurant_id = restaurant_c) <> 2 then raise exception 'different serving was merged'; end if;
  -- A previously chosen source-facts alias may be reused when exactly one owner identity remains compatible.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other)::text,true);
  purchase_c := jsonb_set(jsonb_set(purchase_a,'{seller,branch_name}','"창의관"'),'{order,order_reference}','"other-branch"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('other-branch',purchase_c) ->> 'purchaseSourceId')::uuid;
  candidate_c := (public.submit_merchant_identity_candidate_v1('other-branch',
    '{"merchant_name":"한성대학교 학생식당","branch_name":"창의관","business_kind":"food_service"}',true) ->> 'candidateId')::uuid;
  pending := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_c,true);
  other_restaurant := (pending #>> '{lineResults,0,ownerConfirmedIds,restaurantId}')::uuid;
  if other_restaurant in (restaurant_a,restaurant_c) then raise exception 'cross-owner identities merged'; end if;
  candidate_c := (public.submit_merchant_identity_candidate_v1('other-weak',
    '{"merchant_name":"한성대학교 학생식당","business_kind":"food_service"}',true) ->> 'candidateId')::uuid;
  if candidate_c = candidate_a then raise exception 'merchant candidate shared across owners'; end if;
  purchase_c := jsonb_set(purchase_a,'{order,order_reference}','"other-weak-1"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('other-weak-1',purchase_c) ->> 'purchaseSourceId')::uuid;
  pending := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_c,true);
  if pending #>> '{lineResults,0,reasonCode}' <> 'owner_restaurant_selection_required' then
    raise exception 'missing branch was silently merged with a richer anchor'; end if;
  perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_c,true,other_restaurant);
  purchase_c := jsonb_set(purchase_a,'{order,order_reference}','"other-weak-2"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('other-weak-2',purchase_c) ->> 'purchaseSourceId')::uuid;
  pending := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_c,true);
  if pending #>> '{lineResults,0,ownerConfirmedIds,restaurantId}' <> other_restaurant::text
    or (select count(*) from public.purchase_owner_restaurants) <> 1 then raise exception 'explicitly confirmed source alias not reused'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  execute 'reset role';
  update public.restaurant_menu_identity_candidates set review_status = 'rejected', reviewed_by = actor, reviewed_at = now()
    where id = (select menu_candidate_id from public.purchase_owner_menus where restaurant_id = restaurant_c and serving_label is null);
  purchase_c := jsonb_set(jsonb_set(purchase_a,'{seller,branch_name}','"창의관"'),'{order,order_reference}','"rejected-menu"');
  source_c := (public.ingest_verified_purchase_price_observation_v1('rejected-menu',purchase_c) ->> 'purchaseSourceId')::uuid;
  select merchant_candidate_id into candidate_c from public.purchase_owner_restaurants where id = restaurant_c;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_c,'line-1',candidate_c,true);
    raise exception 'rejected menu candidate reused'; exception when check_violation then null;
  end;
  update public.merchant_identity_candidates set review_status = 'rejected' where id = candidate_a;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_a,'line-1',candidate_a,true);
    raise exception 'rejected merchant candidate reused'; exception when invalid_parameter_value then null;
  end;
  if (select count(*) from public.restaurants) <> global_count or (select count(*) from public.restaurant_menus) <> global_menu_count then
    raise exception 'private identities promoted to global catalogue'; end if;
end;
$test$;
rollback;
select 'OWNER_CROSS_PURCHASE_READ_RLS_PASS' as result;
