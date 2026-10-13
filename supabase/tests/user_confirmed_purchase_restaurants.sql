begin;
do $test$
declare
  owner_id uuid := '00000000-0000-4000-8000-000000000011'; other_id uuid := '00000000-0000-4000-8000-000000000022';
  purchase jsonb; response jsonb; resolved jsonb; source_id uuid; candidate_id uuid; other_candidate uuid;
  source_before jsonb; lines_before jsonb; identity jsonb; global_count bigint; menu_count bigint; candidate jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id)::text, true);
  purchase := jsonb_build_object('schema_version', 'purchase-price-observation.v4', 'contract_version', 'purchase-price.v4',
    'source_app', 'pricetrace_ocr_app', 'purchase_kind', 'restaurant', 'transcription_status', 'user_verified',
    'verification_basis', 'source_evidence', 'platform', jsonb_build_object('name', '웨이티'),
    'seller', jsonb_build_object('seller_name', '한성대학교 학생식당', 'branch_name', null,
      'business_kind', 'food_service', 'source_namespace', null, 'source_code', null),
    'order', jsonb_build_object('status', 'paid', 'currency', 'KRW', 'ordered_on', '2026-10-13', 'order_reference', '853'),
    'payment', jsonb_build_object('status', 'paid', 'method', 'card', 'paid_on', '2026-10-13', 'total_price', 9500),
    'items', jsonb_build_array(
      jsonb_build_object('line_key', 'line-1', 'product', jsonb_build_object('product_name', '돼지불백덮밥'),
        'price_status', 'itemized', 'quantity', 1, 'unit_price', 5700, 'gross_price', 5700),
      jsonb_build_object('line_key', 'line-2', 'product', jsonb_build_object('product_name', '어묵우동'),
        'price_status', 'itemized', 'quantity', 1, 'unit_price', 3800, 'gross_price', 3800)));
  -- Even multiple globally verified names cannot become the owner restaurant by name matching.
  perform public.private_resolve_ocr_standalone_restaurant_v1(owner_id,
    '{"merchant_name":"한성대학교 학생식당","source_namespace":"test-only","source_location_code":"hansung-a"}', true);
  perform public.private_resolve_ocr_standalone_restaurant_v1(owner_id,
    '{"merchant_name":"한성대학교 학생식당","source_namespace":"test-only","source_location_code":"hansung-b"}', true);
  select count(*) into global_count from public.restaurants;
  select count(*) into menu_count from public.restaurant_menus;
  response := public.ingest_verified_purchase_price_observation_v1('hansung-853', purchase);
  source_id := (response ->> 'purchaseSourceId')::uuid;
  if response #>> '{lineResults,0,reason}' <> 'restaurant_source_identity_missing'
    or response #>> '{lineResults,0,authorityStatus}' <> 'needs_review' then raise exception 'fixture not reproduced: %', response; end if;
  select to_jsonb(s) into source_before from public.purchase_price_sources s where id = source_id;
  select jsonb_agg(to_jsonb(l) order by line_ordinal) into lines_before from public.purchase_price_source_lines l where purchase_source_id = source_id;
  candidate := '{"merchant_name":"한성대학교 학생식당","business_kind":"food_service"}';
  begin
    perform public.submit_merchant_identity_candidate_v1('hansung', candidate, false);
    raise exception 'unreviewed candidate accepted'; exception when invalid_parameter_value then null;
  end;
  candidate_id := (public.submit_merchant_identity_candidate_v1('hansung', candidate, true) ->> 'candidateId')::uuid;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_id, 'line-1', candidate_id, false);
    raise exception 'unreviewed registration accepted'; exception when invalid_parameter_value then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', other_id)::text, true);
  other_candidate := (public.submit_merchant_identity_candidate_v1('hansung-other', candidate, true) ->> 'candidateId')::uuid;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_id, 'line-1', other_candidate, true);
    raise exception 'foreign purchase accepted'; exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id)::text, true);
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_id, 'line-1', other_candidate, true);
    raise exception 'foreign candidate accepted'; exception when insufficient_privilege then null;
  end;
  other_candidate := (public.submit_merchant_identity_candidate_v1('hansung-wrong', candidate || '{"branch_name":"가짜 지점"}', true) ->> 'candidateId')::uuid;
  begin
    perform public.resolve_user_confirmed_purchase_restaurant_line_v1(source_id, 'line-1', other_candidate, true);
    raise exception 'seller fact mismatch accepted'; exception when invalid_parameter_value then null;
  end;
  execute 'set local role authenticated';
  resolved := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_id, 'line-1', candidate_id, true);
  resolved := public.resolve_user_confirmed_purchase_restaurant_line_v1(source_id, 'line-2', candidate_id, true);
  if resolved ->> 'observationCount' <> '2' or exists(select 1 from jsonb_array_elements(resolved -> 'lineResults') row
    where row ->> 'authorityStatus' <> 'owner_confirmed' or row -> 'authoritativeIds' <> 'null'::jsonb) then
    raise exception 'private authority not resolved: %', resolved; end if;
  identity := resolved #> '{lineResults,0,ownerConfirmedIds}';
  if identity -> 'restaurantId' <> resolved #> '{lineResults,1,ownerConfirmedIds,restaurantId}'
    or identity -> 'restaurantLocationId' <> resolved #> '{lineResults,1,ownerConfirmedIds,restaurantLocationId}' then
    raise exception 'lines created duplicate restaurants'; end if;
  if (select count(*) from public.purchase_owner_restaurants) <> 1
    or (select count(*) from public.purchase_owner_menus) <> 2
    or (select count(*) from public.purchase_owner_price_observations) <> 2
    or (select sum(unit_price_krw) from public.purchase_owner_price_observations) <> 9500
    or exists(select 1 from public.purchase_owner_price_observations where observed_on <> '2026-10-13' or quantity <> 1) then
    raise exception 'wrong private entities/prices/date'; end if;
  if public.resolve_user_confirmed_purchase_restaurant_line_v1(source_id, 'line-1', candidate_id, true) is distinct from resolved
    or public.resolve_user_confirmed_purchase_restaurant_line_v1(source_id, 'line-2', candidate_id, true) is distinct from resolved
    or public.get_purchase_price_ingestion_response_v1(source_id) is distinct from resolved then
    raise exception 'retry changed response'; end if;
  if public.resolve_ocr_purchase_restaurant_line_v1(source_id, 'line-1', true) is distinct from resolved then
    raise exception 'legacy retry lost private response'; end if;
  begin
    perform public.resolve_ocr_purchase_restaurant_line_v1(source_id,'line-1',true,'{"source_namespace":"fake","source_location_code":"853"}');
    raise exception 'legacy override duplicated private observation'; exception when check_violation then null;
  end;
  response := public.ingest_verified_purchase_price_observation_v1('hansung-853-reimport', purchase);
  if response ->> 'purchaseSourceId' <> source_id::text then raise exception 'duplicate source on reimport'; end if;
  begin
    update public.purchase_owner_restaurants set user_id = other_id;
    raise exception 'direct identity write allowed'; exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', other_id)::text, true);
  if exists(select 1 from public.purchase_owner_restaurants) or exists(select 1 from public.purchase_owner_menus)
    or exists(select 1 from public.purchase_owner_price_observations) then raise exception 'cross-owner private identity leaked'; end if;
  begin
    perform public.get_purchase_price_ingestion_response_v1(source_id);
    raise exception 'foreign getter allowed'; exception when insufficient_privilege or no_data_found then null;
  end;
  execute 'reset role';
  if (select count(*) from public.restaurants) <> global_count or (select count(*) from public.restaurant_menus) <> menu_count then
    raise exception 'private confirmation contaminated global catalogue'; end if;
  if (select to_jsonb(s) from public.purchase_price_sources s where id = source_id) is distinct from source_before
    or (select jsonb_agg(to_jsonb(l) order by line_ordinal) from public.purchase_price_source_lines l where purchase_source_id = source_id) is distinct from lines_before then
    raise exception 'accepted source mutated'; end if;
  if has_function_privilege('anon','public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid,text,uuid,boolean)','execute')
    or has_function_privilege('authenticated','public.private_purchase_price_line_response_v1(uuid,jsonb)','execute') then
    raise exception 'unexpected function ACL'; end if;
end;
$test$;
select 'HANSUNG_OWNER_CONFIRMED_PURCHASE_PASS' as result;
rollback;
