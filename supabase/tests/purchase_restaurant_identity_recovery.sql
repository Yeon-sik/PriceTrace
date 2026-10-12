begin;
do $test$
declare
  owner_id uuid; other_id uuid; suffix text := replace(gen_random_uuid()::text, '-', '');
  purchase jsonb; response jsonb; resolved jsonb; source_id uuid; source_before jsonb; lines_before jsonb;
  merchant jsonb; observation_id uuid; observation public.restaurant_menu_manual_observations%rowtype;
  count_before bigint;
begin
  select id into owner_id from auth.users order by id limit 1;
  select id into other_id from auth.users where id <> owner_id order by id limit 1;
  if other_id is null then raise exception 'Two auth users required'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id)::text, true);
  purchase := jsonb_build_object('schema_version', 'purchase-price-observation.v4', 'contract_version', 'purchase-price.v4',
    'source_app', 'pricetrace_ocr_app', 'purchase_kind', 'restaurant', 'transcription_status', 'user_verified',
    'verification_basis', 'source_evidence', 'platform', jsonb_build_object('name', '__delivery-' || suffix),
    'seller', jsonb_build_object('seller_name', '__restaurant-' || suffix, 'branch_name', '본점', 'business_kind', 'food_service'),
    'order', jsonb_build_object('status', 'paid', 'currency', 'KRW'),
    'payment', jsonb_build_object('status', 'paid', 'method', 'card', 'paid_on', '2026-10-10', 'total_price', 8900),
    'items', jsonb_build_array(jsonb_build_object('line_key', 'menu-1', 'product', jsonb_build_object('product_name', '__menu-' || suffix),
      'option_text', '현미밥 180g', 'price_status', 'itemized', 'quantity', 1, 'unit_price', 14900, 'gross_price', 14900)));
  response := public.ingest_verified_purchase_price_observation_v1('purchase-recovery-' || suffix, purchase);
  source_id := (response ->> 'purchaseSourceId')::uuid;
  select to_jsonb(source) into source_before from public.purchase_price_sources source where id = source_id;
  select jsonb_agg(to_jsonb(line) order by line_ordinal) into lines_before from public.purchase_price_source_lines line where purchase_source_id = source_id;
  select count(*) into count_before from public.restaurant_menu_manual_observations;
  resolved := public.resolve_ocr_purchase_restaurant_line_v1(source_id, 'menu-1', true);
  if resolved #>> '{lineResults,0,reasonCode}' <> 'restaurant_source_identity_insufficient' or
    (select count(*) from public.restaurant_menu_manual_observations) <> count_before then
    raise exception 'Missing identity must remain unresolved without observations'; end if;
  merchant := jsonb_build_object('source_namespace', 'purchase-fixture', 'source_location_code', suffix);
  begin
    perform public.resolve_ocr_purchase_restaurant_line_v1(source_id, 'menu-1', false, merchant);
    raise exception 'Review gate bypass'; exception when invalid_parameter_value then null;
  end;
  begin
    perform public.resolve_ocr_purchase_restaurant_line_v1(source_id, 'menu-1', true, merchant || '{"restaurant_id":"00000000-0000-4000-8000-000000000001"}'::jsonb);
    raise exception 'Client authority accepted'; exception when invalid_parameter_value then null;
  end;
  begin
    perform public.resolve_ocr_purchase_restaurant_line_v1(source_id, 'menu-1', true, merchant || '{"merchant_name":"other"}'::jsonb);
    raise exception 'Seller rewritten'; exception when invalid_parameter_value then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', other_id)::text, true);
  begin
    perform public.resolve_ocr_purchase_restaurant_line_v1(source_id, 'menu-1', true, merchant);
    raise exception 'Owner gate bypass'; exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id)::text, true);
  resolved := public.resolve_ocr_purchase_restaurant_line_v1(source_id, 'menu-1', true, merchant);
  if resolved #>> '{lineResults,0,authorityStatus}' <> 'exact' or resolved -> 'observationCount' <> '1'::jsonb then
    raise exception 'Expected exact recovered observation: %', resolved; end if;
  observation_id := (resolved #>> '{lineResults,0,observationId}')::uuid;
  select * into strict observation from public.restaurant_menu_manual_observations where id = observation_id;
  if observation.unit_price_krw <> 14900 or observation.gross_price_krw <> 14900 or observation.net_price_krw is not null then
    raise exception 'Order-wide discounted total must not become line price'; end if;
  if public.get_purchase_price_ingestion_response_v1(source_id) is distinct from resolved
    or public.resolve_ocr_purchase_restaurant_line_v1(source_id, 'menu-1', true, merchant) is distinct from resolved then
    raise exception 'Recovery/checkpoint replay changed identity'; end if;
  response := public.ingest_verified_purchase_price_observation_v1('purchase-recovery-' || suffix, purchase);
  if response ->> 'purchaseSourceId' <> source_id::text or response -> 'replayed' <> 'true'::jsonb
    or public.get_purchase_price_ingestion_response_v1(source_id) is distinct from resolved then
    raise exception 'Frozen ingest replay changed source or recovered checkpoint'; end if;
  if (select to_jsonb(source) from public.purchase_price_sources source where id = source_id) is distinct from source_before
    or (select jsonb_agg(to_jsonb(line) order by line_ordinal) from public.purchase_price_source_lines line where purchase_source_id = source_id) is distinct from lines_before
    or (select count(*) from public.restaurant_menu_manual_observations) <> count_before + 1 then
    raise exception 'Source facts mutated or duplicate observation created'; end if;
  if has_function_privilege('anon', 'public.resolve_ocr_purchase_restaurant_line_v1(uuid,text,boolean,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.private_purchase_price_line_response_v1(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Unexpected resolver grants'; end if;
end;
$test$;
select 'PURCHASE_RESTAURANT_RECOVERY_PASS' as result;
rollback;
