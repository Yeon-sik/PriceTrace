-- Synthetic facts only. Run as an administrator; all writes roll back.
begin;
create function pg_temp.eq(actual jsonb, expected jsonb, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then raise exception '%: expected %, got %', label, expected, actual; end if;
end; $$;

do $test$
declare
  owner_id uuid; suffix text := replace(gen_random_uuid()::text, '-', '');
  restaurant_id uuid := gen_random_uuid(); location_id uuid := gen_random_uuid();
  standard_id uuid := gen_random_uuid(); catalog_a uuid := gen_random_uuid(); catalog_b uuid := gen_random_uuid();
  menu_a uuid := gen_random_uuid(); menu_b uuid := gen_random_uuid(); catalog_duplicate uuid := gen_random_uuid();
  purchase jsonb; line_a jsonb; line_b jsonb; response jsonb; result jsonb; source_id uuid;
  legacy jsonb; lines jsonb; count_rows bigint; saved_facts jsonb; definition text;
begin
  select id into owner_id from auth.users order by created_at, id limit 1;
  if owner_id is null then raise exception 'One auth.users fixture required'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  insert into public.restaurants(id, canonical_name, review_status, status, verification_status, created_by, reviewed_by, reviewed_at)
  values(restaurant_id, '__purchase-restaurant-' || suffix, 'verified', 'active', 'verified', owner_id, owner_id, now());
  insert into public.restaurant_locations(id, restaurant_id, source_namespace, source_location_code, location_label,
    review_status, verification_status, created_by, reviewed_by, reviewed_at)
  values(location_id, restaurant_id, 'purchase-test', 'branch-' || suffix, '본점', 'verified', 'verified', owner_id, owner_id, now());
  insert into public.standard_products(id, purchase_type, canonical_name, verification_status, status, created_by)
  values(standard_id, 'menu_item', '__purchase-menu-' || suffix, 'verified', 'active', owner_id);
  insert into public.catalog_products(id, standard_product_id, purchase_type, canonical_name, specification,
    content_amount, content_unit, package_count, reference_unit, specification_status, verification_status, status, created_by)
  values
    (catalog_a, standard_id, 'menu_item', '__menu-a-' || suffix, '1회 제공', 1, 'each', 1, 100, 'placeholder', 'verified', 'active', owner_id),
    (catalog_b, standard_id, 'menu_item', '__menu-b-' || suffix, '대', 1, 'each', 1, 100, 'placeholder', 'verified', 'active', owner_id);
  insert into public.restaurant_menus(id, restaurant_id, catalog_product_id, canonical_name, serving_label,
    review_status, status, verification_status, created_by, reviewed_by, reviewed_at)
  values
    (menu_a, restaurant_id, catalog_a, '__menu-a-' || suffix, '1회 제공', 'verified', 'active', 'verified', owner_id, owner_id, now()),
    (menu_b, restaurant_id, catalog_b, '__menu-b-' || suffix, '대', 'verified', 'active', 'verified', owner_id, owner_id, now());
  line_a := jsonb_build_object('line_key', 'menu-a', 'product', jsonb_build_object('product_name', '__menu-a-' || suffix),
    'option_text', '1회 제공', 'price_status', 'itemized', 'quantity', 1, 'unit_price', 10000, 'gross_price', 10000, 'net_price', 10000);
  line_b := jsonb_build_object('line_key', 'menu-b', 'product', jsonb_build_object('product_name', '__menu-b-' || suffix),
    'option_text', '대', 'price_status', 'itemized', 'quantity', 1, 'unit_price', 12000, 'gross_price', 12000, 'net_price', 12000);
  purchase := jsonb_build_object(
    'schema_version', 'purchase-price-observation.v4', 'contract_version', 'purchase-price.v4',
    'source_app', 'pricetrace_ocr_app', 'source_version', 'purchase-test', 'purchase_kind', 'restaurant',
    'transcription_status', 'user_verified', 'verification_basis', 'source_evidence',
    'platform', jsonb_build_object('name', '__delivery-platform-' || suffix),
    'seller', jsonb_build_object('seller_name', '__purchase-restaurant-' || suffix, 'branch_name', '본점',
      'source_namespace', 'purchase-test', 'source_code', 'branch-' || suffix, 'business_kind', 'food_service'),
    'order', jsonb_build_object('status', 'paid', 'currency', 'KRW', 'ordered_on', '2026-10-09'),
    'payment', jsonb_build_object('status', 'paid', 'method', 'card', 'paid_on', '2026-10-09', 'total_price', 42000),
    'items', jsonb_build_array(line_b, line_a, line_a || jsonb_build_object('line_key', 'unknown-seller', 'seller', null),
      line_a || jsonb_build_object('line_key', 'price-ambiguous', 'price_status', 'ambiguous')));
  response := public.ingest_verified_purchase_price_observation_v1('line-authority-' || suffix, purchase);
  source_id := (response ->> 'purchaseSourceId')::uuid;
  perform pg_temp.eq(response -> 'sourceAcceptanceStatus', '"accepted"', 'source acceptance');
  perform pg_temp.eq(to_jsonb(jsonb_array_length(response -> 'lineResults')), '4', 'all source lines returned');
  perform pg_temp.eq(to_jsonb(jsonb_array_length(response -> 'observationIds')), '2', 'only eligible lines observed');
  -- Reversed input order proves that identity follows lineKey, not array position.
  perform pg_temp.eq(response #> '{lineResults,0,lineKey}', '"menu-b"', 'multi-line key');
  perform pg_temp.eq(response #> '{lineResults,0,authoritativeIds,restaurantMenuId}', to_jsonb(menu_b), 'menu-b identity');
  perform pg_temp.eq(response #> '{lineResults,1,authoritativeIds,restaurantMenuId}', to_jsonb(menu_a), 'menu-a identity');
  perform pg_temp.eq(response #> '{lineResults,1,authoritativeIds,restaurantId}', to_jsonb(restaurant_id), 'exact restaurant');
  perform pg_temp.eq(response #> '{lineResults,1,authoritativeIds,restaurantLocationId}', to_jsonb(location_id), 'exact location');
  perform pg_temp.eq(response #> '{lineResults,1,authoritativeIds,catalogProductId}', to_jsonb(catalog_a), 'exact catalog');
  perform pg_temp.eq(response #> '{lineResults,1,kind}', '"restaurant_purchase"', 'existing OCR decoder kind');
  perform pg_temp.eq(response #> '{lineResults,1,authorityStatus}', '"exact"', 'exact authority');
  perform pg_temp.eq(response #> '{lineResults,1,merchantResolutionStatus}', '"exact"', 'exact merchant');
  perform pg_temp.eq(response #> '{lineResults,1,menuResolutionStatus}', '"exact"', 'exact menu');
  perform pg_temp.eq(response #> '{lineResults,1,reasonCode}', 'null', 'success reason');
  perform pg_temp.eq(response #> '{lineResults,2,sourceAcceptanceStatus}', '"accepted"', 'unknown seller source accepted');
  perform pg_temp.eq(response #> '{lineResults,2,observationCreated}', 'false', 'unknown seller not observed');
  perform pg_temp.eq(response #> '{lineResults,2,reasonCode}', '"seller_unknown"', 'unknown seller reason');
  perform pg_temp.eq(response #> '{lineResults,2,authorityStatus}', '"unresolved"', 'unknown seller authority');
  perform pg_temp.eq(response #> '{lineResults,3,reasonCode}', '"product_price_ambiguous"', 'source-only reason');
  perform pg_temp.eq(response #> '{lineResults,3,authoritativeIds}', 'null', 'source-only no authority');
  select count(*) into count_rows from public.restaurant_menu_manual_observations as observation
  inner join public.purchase_price_source_lines as line on line.restaurant_menu_manual_observation_id = observation.id
  where line.purchase_source_id = source_id and line.user_id = owner_id and observation.created_by = owner_id
    and ((line.source_line_key = 'menu-a' and observation.restaurant_menu_id = menu_a)
      or (line.source_line_key = 'menu-b' and observation.restaurant_menu_id = menu_b))
    and response -> 'observationIds' @> to_jsonb(array[observation.id::text]);
  perform pg_temp.eq(to_jsonb(count_rows), '2', 'observation ID joins exact source line');
  perform pg_temp.eq(public.get_purchase_price_ingestion_response_v1(source_id), response, 'owner checkpoint exact response');
  result := public.ingest_verified_purchase_price_observation_v1('line-authority-' || suffix, purchase);
  perform pg_temp.eq(result - 'replayed' - 'deduplicated', response - 'replayed' - 'deduplicated', 'same-key replay same source/results');
  perform pg_temp.eq(result -> 'replayed', 'true', 'replay flag');
  result := public.ingest_verified_purchase_price_observation_v1('line-dedup-' || suffix, purchase);
  perform pg_temp.eq(result - 'replayed' - 'deduplicated', response - 'replayed' - 'deduplicated', 'content dedup same source/results');
  perform pg_temp.eq(result -> 'deduplicated', 'true', 'dedup flag');
  select source.source_payload into saved_facts from public.purchase_price_sources as source where source.id = source_id;
  perform pg_temp.eq(saved_facts, purchase, 'canonical financial source unchanged');
  if saved_facts::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' then
    raise exception 'server UUID leaked into canonical source';
  end if;
  if exists(select 1 from public.stores where user_id = owner_id and merchant_name = '__delivery-platform-' || suffix) then
    raise exception 'platform became seller/store';
  end if;
  -- One name candidate still cannot authorize source identity.
  result := public.ingest_verified_purchase_price_observation_v1('name-only-' || suffix,
    jsonb_set(jsonb_set(purchase, '{seller}', (purchase -> 'seller') - 'source_namespace' - 'source_code'), '{items}', jsonb_build_array(line_a)));
  perform pg_temp.eq(result #> '{lineResults,0,authorityStatus}', '"unresolved"', 'single name candidate never exact');
  result := public.ingest_verified_purchase_price_observation_v1('missing-serving-' || suffix,
    jsonb_set(purchase, '{items}', jsonb_build_array(line_a - 'option_text')));
  perform pg_temp.eq(result #> '{lineResults,0,observationCreated}', 'true', 'legacy default serving financial behavior');
  perform pg_temp.eq(result #> '{lineResults,0,reasonCode}', '"restaurant_menu_serving_label_missing"', 'unstated serving no authority');
  perform pg_temp.eq(result #> '{lineResults,0,authoritativeIds}', 'null', 'no guessed serving identity');
  insert into public.restaurant_locations(restaurant_id, source_namespace, source_location_code, location_label,
    review_status, verification_status, created_by, reviewed_by, reviewed_at)
  values(restaurant_id, 'purchase-test', 'branch-two-' || suffix, '본점', 'verified', 'verified', owner_id, owner_id, now());
  result := public.ingest_verified_purchase_price_observation_v1('ambiguous-merchant-' || suffix,
    jsonb_set(jsonb_set(purchase || jsonb_build_object('note', 'separate ambiguity source'), '{seller}', (purchase -> 'seller') - 'source_namespace' - 'source_code'), '{items}', jsonb_build_array(line_a)));
  perform pg_temp.eq(result #> '{lineResults,0,authorityStatus}', '"needs_review"', 'ambiguous merchant review');
  perform pg_temp.eq(result #> '{lineResults,0,reasonCode}', '"restaurant_authority_ambiguous"', 'ambiguous merchant reason');
  perform pg_temp.eq(result #> '{lineResults,0,observationCreated}', 'false', 'ambiguous merchant no observation');
  perform pg_temp.eq(result #> '{lineResults,0,authoritativeIds}', 'null', 'ambiguous merchant no guessed UUID');
  insert into public.catalog_products(id, standard_product_id, purchase_type, canonical_name, specification,
    content_amount, content_unit, package_count, reference_unit, specification_status, verification_status, status, created_by)
  values(catalog_duplicate, standard_id, 'menu_item', '__menu-a-' || suffix, 'another catalog',
    1, 'each', 1, 100, 'placeholder', 'verified', 'active', owner_id);
  insert into public.restaurant_menus(restaurant_id, catalog_product_id, canonical_name, serving_label,
    review_status, status, verification_status, created_by, reviewed_by, reviewed_at)
  values(restaurant_id, catalog_duplicate, '__menu-a-' || suffix, '1회 제공',
    'verified', 'active', 'verified', owner_id, owner_id, now());
  result := public.ingest_verified_purchase_price_observation_v1('ambiguous-menu-' || suffix,
    jsonb_set(purchase, '{items}', jsonb_build_array(line_a)));
  perform pg_temp.eq(result #> '{lineResults,0,authorityStatus}', '"needs_review"', 'ambiguous menu review');
  perform pg_temp.eq(result #> '{lineResults,0,reasonCode}', '"restaurant_menu_authority_ambiguous"', 'ambiguous menu reason');
  perform pg_temp.eq(result #> '{lineResults,0,merchantResolutionStatus}', '"exact"', 'ambiguous menu exact seller');
  perform pg_temp.eq(result #> '{lineResults,0,observationCreated}', 'false', 'ambiguous menu no observation');
  perform pg_temp.eq(result #> '{lineResults,0,authoritativeIds}', 'null', 'ambiguous menu no arbitrary ID');
  perform pg_temp.eq(public.get_purchase_price_ingestion_response_v1(source_id), response, 'checkpoint immutable after authority changes');
  result := public.ingest_verified_purchase_price_observation_v1('unknown-menu-' || suffix,
    jsonb_set(purchase, '{items}', jsonb_build_array(jsonb_set(line_b, '{product,product_name}', '"unknown-menu"'))));
  perform pg_temp.eq(result #> '{lineResults,0,authorityStatus}', '"unresolved"', 'unknown menu unresolved');
  perform pg_temp.eq(result #> '{lineResults,0,reasonCode}', '"restaurant_menu_authority_unresolved"', 'unknown menu reason');
  result := public.ingest_verified_purchase_price_observation_v1('conflicting-branch-' || suffix,
    jsonb_set(jsonb_set(purchase, '{seller,branch_name}', '"conflicting branch"'), '{items}', jsonb_build_array(line_b)));
  perform pg_temp.eq(result #> '{lineResults,0,observationCreated}', 'true', 'legacy financial branch behavior retained');
  perform pg_temp.eq(result #> '{lineResults,0,authorityStatus}', '"needs_review"', 'branch conflict blocks downstream');
  perform pg_temp.eq(result #> '{lineResults,0,authoritativeIds}', 'null', 'branch conflict no UUID');
  result := public.ingest_verified_purchase_price_observation_v1('conflicting-name-' || suffix,
    jsonb_set(jsonb_set(purchase, '{seller,seller_name}', '"conflicting restaurant"'), '{items}', jsonb_build_array(line_b)));
  perform pg_temp.eq(result #> '{lineResults,0,authorityStatus}', '"needs_review"', 'merchant source identity conflict');
  perform pg_temp.eq(result #> '{lineResults,0,observationCreated}', 'false', 'conflicting merchant no observation');
  result := public.ingest_verified_purchase_price_observation_v1('duplicate-line-key-' || suffix,
    jsonb_set(purchase, '{items}', jsonb_build_array(line_b, line_b)));
  perform pg_temp.eq(result #> '{lineResults,0,reasonCode}', '"duplicate_line_key"', 'duplicate keys fail closed');
  perform pg_temp.eq(result #> '{lineResults,1,authoritativeIds}', 'null', 'duplicate keys no UUID');
  result := public.ingest_verified_purchase_price_observation_v1('payment-only-' || suffix, jsonb_set(purchase, '{items}', '[]'));
  perform pg_temp.eq(result -> 'lineResults', '[]', 'payment-only empty mapping');
  perform pg_temp.eq(result -> 'sourceAcceptanceStatus', '"accepted"', 'payment-only accepted source');
  -- Reconstruct only the old response, not source facts, to exercise legacy enrichment.
  legacy := response - 'lineAuthorityVersion' - 'sourceSaved' - 'sourceAcceptanceStatus';
  select jsonb_agg(item.value - 'kind' - 'sourceSaved' - 'sourceAcceptanceStatus' - 'observationStatus'
    - 'reasonCode' - 'authorityStatus' - 'merchantResolutionStatus' - 'menuResolutionStatus' - 'authoritativeIds'
    order by item.ordinality) into lines from jsonb_array_elements(response -> 'lineResults') with ordinality as item(value, ordinality);
  legacy := jsonb_set(legacy, '{lineResults}', lines);
  perform pg_temp.eq(public.private_purchase_price_line_response_v1(source_id, legacy), response, 'legacy response metadata recovery');
  begin
    perform public.private_purchase_price_line_response_v1(source_id,
      jsonb_set(legacy, '{lineResults,0,observationId}', to_jsonb(gen_random_uuid()::text)));
    raise exception 'contradictory legacy observation accepted';
  exception when check_violation then null; end;
  begin
    perform public.ingest_verified_purchase_price_observation_v1('caller-uuid-' || suffix, purchase || jsonb_build_object('restaurant_id', gen_random_uuid()));
    raise exception 'caller-supplied authority UUID accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.ingest_verified_purchase_price_observation_v1('caller-menu-uuid-' || suffix,
      jsonb_set(purchase, '{items,0,product,restaurant_menu_id}', to_jsonb(gen_random_uuid()::text)));
    raise exception 'caller-supplied menu UUID accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.ingest_verified_purchase_price_observation_v1('v5-canonical-' || suffix,
      jsonb_set(purchase, '{schema_version}', '"yeonsik-ocr.v5"'));
    raise exception 'PriceTrace accepted V5 canonical';
  exception when invalid_parameter_value then null; end;
  begin
    update public.purchase_price_sources set payment_total_price_krw = 1 where id = source_id;
    raise exception 'source fact update accepted';
  exception when sqlstate '55000' then null; end;
  begin
    update public.purchase_price_source_lines set observation_reason = 'changed' where purchase_source_id = source_id;
    raise exception 'source line update accepted';
  exception when sqlstate '55000' then null; end;
  -- Exercise the actual owner getter with a legacy checkpoint, without editing
  -- any persisted source/checkpoint rows. Only the writer definition is restored
  -- inside this rollback-only fixture to emit one historical response.
  definition := pg_catalog.pg_get_functiondef(
    'public.ingest_verified_purchase_price_observation_v1(text,jsonb)'::regprocedure);
  if strpos(definition, '  v_response := public.private_purchase_price_line_response_v1(v_source_id, v_response);') = 0 then
    raise exception 'response enrichment anchor missing in fixture';
  end if;
  execute replace(definition, '  v_response := public.private_purchase_price_line_response_v1(v_source_id, v_response);', '');
  legacy := public.ingest_verified_purchase_price_observation_v1('legacy-source-' || suffix,
    jsonb_set(purchase || jsonb_build_object('note', 'legacy checkpoint'), '{items}', jsonb_build_array(line_b)));
  execute definition;
  result := public.get_purchase_price_ingestion_response_v1((legacy ->> 'purchaseSourceId')::uuid);
  perform pg_temp.eq(result #> '{lineResults,0,authoritativeIds,restaurantMenuId}', to_jsonb(menu_b), 'legacy getter menu recovery');
  perform pg_temp.eq(result #> '{lineResults,0,authorityStatus}', '"exact"', 'legacy getter exact authority');
  perform pg_temp.eq(
    (select content.response from public.purchase_price_observation_ingestion_contents as content
      where content.user_id = owner_id and content.purchase_source_id = (legacy ->> 'purchaseSourceId')::uuid),
    legacy, 'legacy getter leaves checkpoint unchanged');
  perform pg_temp.eq(public.get_purchase_price_ingestion_response_v1((legacy ->> 'purchaseSourceId')::uuid),
    result, 'legacy getter repeat result');

  perform set_config('purchase.test.owner', owner_id::text, true);
  perform set_config('purchase.test.source', source_id::text, true);
  perform set_config('purchase.test.response', response::text, true);
end;
$test$;

set local role authenticated;
do $test$
begin
  perform pg_temp.eq(public.get_purchase_price_ingestion_response_v1(current_setting('purchase.test.source')::uuid),
    current_setting('purchase.test.response')::jsonb, 'authenticated owner read');
  begin perform public.get_purchase_price_ingestion_response_v1(null); raise exception 'null selector accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.private_purchase_price_line_response_v1(current_setting('purchase.test.source')::uuid, '{}'::jsonb);
    raise exception 'private helper publicly executable';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  if exists(select 1 from public.purchase_price_sources where id = current_setting('purchase.test.source')::uuid)
    or exists(select 1 from public.purchase_price_source_lines where purchase_source_id = current_setting('purchase.test.source')::uuid) then
    raise exception 'foreign owner bypassed RLS';
  end if;
  begin
    perform public.get_purchase_price_ingestion_response_v1(current_setting('purchase.test.source')::uuid);
    raise exception 'foreign owner access accepted';
  exception when no_data_found then null; end;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_purchase_price_ingestion_response_v1(current_setting('purchase.test.source')::uuid);
    raise exception 'missing auth accepted';
  exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
set local role anon;
do $test$
begin
  begin perform public.get_purchase_price_ingestion_response_v1(current_setting('purchase.test.source')::uuid);
    raise exception 'anonymous getter accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.ingest_verified_purchase_price_observation_v1('anonymous-key', '{}'::jsonb);
    raise exception 'anonymous ingest accepted';
  exception when insufficient_privilege then null; end;
end;
$test$;
reset role;
select 'PURCHASE_PRICE_LINE_AUTHORITY_RESPONSE_PASS' as result;
rollback;
