-- Run after the full local migration stack with `supabase db query --local -f`.
-- Fixture writes are rolled back; the linked/remote database is not used.

begin;

do $$
declare
  v_user_id uuid;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_standard_product_id uuid := gen_random_uuid();
  v_catalog_product_id uuid := gen_random_uuid();
  v_candidate_response jsonb;
  v_candidate_client_key text;
  v_barcode text := '8' || lpad((floor(random() * 1000000000000))::bigint::text, 12, '0');
  v_retail jsonb;
  v_retail_replay jsonb;
  v_retail_with_sku jsonb;
  v_nullable_price jsonb;
  v_final_payment_only jsonb;
  v_restaurant jsonb;
  v_name_only jsonb;
  v_name_only_result jsonb;
  v_name_only_retry jsonb;
  v_name_only_resolved jsonb;
  v_strong_merchant jsonb;
  v_item_facts jsonb;
  v_same_name_branch jsonb;
  v_same_name_result jsonb;
  v_exact_reuse_request jsonb;
  v_exact_reuse_result jsonb;
  v_duplicate_menu_result jsonb;
  v_duplicate_resolution_result jsonb;
  v_observation jsonb;
  v_sku_observation jsonb;
  v_nullable_observation jsonb;
  v_final_payment_observation jsonb;
  v_observation_id uuid;
  v_sku_observation_id uuid;
  v_nullable_observation_id uuid;
  v_final_payment_observation_id uuid;
  v_resolution_id uuid;
  v_other_user_id uuid;
  v_first_restaurant_id uuid;
  v_first_location_id uuid;
  v_first_menu_id uuid;
  v_first_catalog_id uuid;
  v_second_restaurant_id uuid;
  v_second_location_id uuid;
  v_second_menu_id uuid;
  v_second_catalog_id uuid;
  v_duplicate_standard_id uuid;
  v_duplicate_catalog_id uuid;
  v_duplicate_menu_id uuid;
  v_owner_denied boolean := false;
  v_receipt_id uuid;
  v_receipt_item_id text;
  v_receipt_observation_kind text;
  v_manual_id uuid;
  v_store_product_code text;
  v_observed_at_exact timestamptz;
  v_count integer;
begin
  v_user_id := gen_random_uuid();
  insert into auth.users (
    id, aud, role, email, encrypted_password, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at
  ) values (
    v_user_id, 'authenticated', 'authenticated', 'ocr-v5-standalone-' || v_suffix || '@example.invalid', '',
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user_id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('role', 'user')
    )::text,
    true
  );

  v_candidate_client_key := 'product-1-' || v_suffix;

  insert into public.standard_products (
    id, purchase_type, canonical_name, brand, verification_status, status
  ) values (
    v_standard_product_id,
    'retail_product',
    '__standalone-authority-product-' || v_suffix,
    '__standalone-authority-brand-' || v_suffix,
    'verified',
    'active'
  );

  insert into public.catalog_products (
    id, standard_product_id, purchase_type, canonical_name, brand,
    specification, content_amount, content_unit, package_count, reference_unit,
    specification_status, verification_status, status
  ) values (
    v_catalog_product_id,
    v_standard_product_id,
    'retail_product',
    '__standalone-authority-product-' || v_suffix,
    '__standalone-authority-brand-' || v_suffix,
    '500g',
    500,
    'g',
    1,
    100,
    'verified',
    'verified',
    'active'
  );

  insert into public.catalog_product_identifiers (
    catalog_product_id, identifier_scheme, identifier_value,
    verification_status, provenance, reviewed_by, reviewed_at
  ) values (
    v_catalog_product_id,
    'ean',
    v_barcode,
    'verified',
    jsonb_build_object('sourceType', 'manufacturer', 'sourceRef', 'standalone-test'),
    v_user_id,
    now()
  );

  v_candidate_response := public.submit_product_candidate_v1(
    'standalone-candidate-' || v_suffix,
    jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'source_version', 'standalone-test',
      'candidate_type', 'retail_product',
      'client_key', v_candidate_client_key,
      'product_name', '__standalone-authority-product-' || v_suffix,
      'brand', '__standalone-authority-brand-' || v_suffix,
      'sub_brand', '__standalone-authority-sub-brand-' || v_suffix,
      'manufacturer', '__standalone-authority-manufacturer-' || v_suffix,
      'specification', '500g',
      'content_amount', 500,
      'content_unit', 'g',
      'package_count', 1,
      'variant', null,
      'identifiers', jsonb_build_array(jsonb_build_object(
        'scheme', 'ean', 'value', v_barcode
      )),
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'product_photo',
        'source_ref', 'capture:standalone-' || v_suffix,
        'field', 'product_name',
        'observed_value', '__standalone-authority-product-' || v_suffix
      )),
      'provenance', jsonb_build_object(
        'capture_id', 'capture:standalone-' || v_suffix,
        'extraction_method', 'gpt_vision',
        'extractor', 'standalone-test',
        'extractor_version', '1'
      )
    )
  );
  if v_candidate_response ->> 'outcome' <> 'catalog_product_reused'
    or (v_candidate_response ->> 'catalogProductId')::uuid <> v_catalog_product_id
    or (v_candidate_response ->> 'standardProductId')::uuid <> v_standard_product_id
    or v_candidate_response ->> 'productClientKey' <> v_candidate_client_key
  then
    raise exception 'retail candidate did not resolve to the verified authority: %', v_candidate_response;
  end if;

  v_retail := jsonb_build_object(
    'schema_version', 'receipt-independent-price-observation.v3',
    'contract_version', 'price-observation.v3',
    'kind', 'retail_purchase',
    'verification_basis', 'source_evidence',
    'transcription_status', 'user_verified',
    'observed_at', '2026-09-07T00:30:00+09:00',
    'currency', 'KRW',
    'gross_price', 1200,
    'discount', 100,
    'net_price', 1100,
    'quantity', 2,
    'unit_price', 550,
    'merchant', jsonb_build_object(
      'merchant_name', '__standalone-retail-' || v_suffix,
      'branch_name', '강남',
      'source_namespace', 'test-retail',
      'source_code', 'merchant-' || v_suffix
    ),
    'product', jsonb_build_object(
      'product_client_key', v_candidate_client_key,
      'merchant_sku', null,
      'product_name', '__standalone-authority-product-' || v_suffix,
      'brand', '__standalone-authority-brand-' || v_suffix,
      'sub_brand', '__standalone-authority-sub-brand-' || v_suffix,
      'manufacturer', '__standalone-authority-manufacturer-' || v_suffix,
      'specification', '500g',
      'identifiers', jsonb_build_array(jsonb_build_object(
        'scheme', 'ean', 'value', v_barcode
      ))
    )
  );

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-missing-authority-' || v_suffix,
      jsonb_set(
        v_retail,
        '{product,product_client_key}',
        to_jsonb('missing-product-' || v_suffix)
      )
    );
    raise exception 'retail standalone observation bypassed Product Candidate authority';
  exception when sqlstate '22023' then
    null;
  end;

  v_observation := public.ingest_verified_standalone_price_observation_v1(
    'standalone-retail-' || v_suffix,
    v_retail
  );
  v_observation_id := (v_observation ->> 'observationId')::uuid;
  if v_observation ->> 'kind' <> 'retail_purchase'
    or v_observation ->> 'replayed' <> 'false'
    or (v_observation #>> '{authoritativeIds,storeId}') is null
    or (v_observation #>> '{authoritativeIds,productId}') is null
    or (v_observation #>> '{authoritativeIds,storeProductId}') is null
    or (v_observation #>> '{authoritativeIds,catalogProductId}')::uuid <> v_catalog_product_id
    or (v_observation #>> '{authoritativeIds,standardProductId}')::uuid <> v_standard_product_id
    or v_observation ->> 'productClientKey' <> v_candidate_client_key
  then
    raise exception 'retail standalone observation response is incomplete: %', v_observation;
  end if;

  select jsonb_build_object(
    'receiptItemId', observation.receipt_item_id,
    'observationKind', observation.observation_kind,
    'verificationBasis', observation.verification_basis,
    'currency', observation.currency,
    'grossPrice', observation.gross_price_krw,
    'discount', observation.discount_price_krw,
    'netPrice', observation.net_price_krw,
    'quantity', observation.quantity,
    'unitPrice', observation.unit_price_krw,
    'catalogProductId', observation.catalog_product_id,
    'observedOn', observation.observed_at,
    'observedAtExact', observation.observed_at_exact
  ) into v_observation
  from public.price_observations as observation
  where observation.user_id = v_user_id and observation.id = v_observation_id;
  select observation.observed_at_exact
  into v_observed_at_exact
  from public.price_observations as observation
  where observation.user_id = v_user_id and observation.id = v_observation_id;
  if v_observation ->> 'receiptItemId' is not null
    or v_observation ->> 'observationKind' <> 'standalone_purchase'
    or v_observation ->> 'verificationBasis' <> 'source_evidence'
    or v_observation ->> 'currency' <> 'KRW'
    or (v_observation ->> 'grossPrice')::integer <> 1200
    or (v_observation ->> 'discount')::integer <> 100
    or (v_observation ->> 'netPrice')::integer <> 1100
    or (v_observation ->> 'quantity')::integer <> 2
    or (v_observation ->> 'unitPrice')::integer <> 550
    or (v_observation ->> 'catalogProductId')::uuid <> v_catalog_product_id
    or (v_observation ->> 'observedOn') <> '2026-09-07'
    or v_observation ->> 'observedAtExact' is null
    or v_observed_at_exact <> timestamptz '2026-09-06 15:30:00+00'
  then
    raise exception 'retail standalone observation was not persisted independently: %', v_observation;
  end if;

  select store_product.store_product_code
  into v_store_product_code
  from public.store_products as store_product
  where store_product.user_id = v_user_id
    and store_product.id = (v_observation #>> '{authoritativeIds,storeProductId}')::uuid;
  if v_store_product_code is not null then
    raise exception 'client_key was promoted to merchant SKU/store product code: %',
      v_store_product_code;
  end if;

  v_retail_with_sku := jsonb_set(
    v_retail,
    '{product,merchant_sku}',
    to_jsonb('observed-sku-' || v_suffix)
  );
  v_sku_observation := public.ingest_verified_standalone_price_observation_v1(
    'standalone-retail-with-sku-' || v_suffix,
    v_retail_with_sku
  );
  v_sku_observation_id := (v_sku_observation ->> 'observationId')::uuid;
  select store_product.store_product_code
  into v_store_product_code
  from public.store_products as store_product
  inner join public.price_observations as observation
    on observation.user_id = store_product.user_id
    and observation.store_product_id = store_product.id
  where observation.user_id = v_user_id
    and observation.id = v_sku_observation_id;
  if v_store_product_code <> 'observed-sku-' || v_suffix then
    raise exception 'observed merchant_sku was not preserved separately: %',
      v_store_product_code;
  end if;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-client-key-as-sku-' || v_suffix,
      jsonb_set(
        v_retail,
        '{product,merchant_sku}',
        to_jsonb(v_candidate_client_key)
      )
    );
    raise exception 'product_client_key was accepted as merchant_sku';
  exception when sqlstate '22023' then
    null;
  end;

  v_retail_replay := public.ingest_verified_standalone_price_observation_v1(
    'standalone-retail-' || v_suffix,
    v_retail
  );
  if (v_retail_replay ->> 'observationId')::uuid <> v_observation_id
    or v_retail_replay ->> 'replayed' <> 'true'
  then
    raise exception 'standalone idempotency replay failed: %', v_retail_replay;
  end if;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-retail-' || v_suffix,
      jsonb_set(v_retail, '{net_price}', '1000'::jsonb)
    );
    raise exception 'standalone idempotency key accepted a different request';
  exception when unique_violation then
    null;
  end;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-retail-' || v_suffix,
      jsonb_set(v_retail, '{product,sub_brand}', '"changed-sub-brand"'::jsonb)
    );
    raise exception 'standalone idempotency key accepted changed product facts';
  exception when unique_violation then
    null;
  end;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-mismatch-' || v_suffix,
      jsonb_set(v_retail, '{net_price}', '1099'::jsonb)
    );
    raise exception 'standalone arithmetic mismatch was accepted';
  exception when check_violation then
    null;
  end;

  v_nullable_price := (v_retail - 'observed_at' - 'gross_price')
    || jsonb_build_object(
      'observed_on', '2026-09-07',
      'gross_price', null,
      'discount', null
    );
  v_nullable_observation := public.ingest_verified_standalone_price_observation_v1(
    'standalone-nullable-price-' || v_suffix,
    v_nullable_price
  );
  v_nullable_observation_id := (v_nullable_observation ->> 'observationId')::uuid;
  select jsonb_build_object(
    'grossPrice', observation.gross_price_krw,
    'discount', observation.discount_price_krw,
    'netPrice', observation.net_price_krw,
    'observedAtExact', observation.observed_at_exact
  )
  into v_observation
  from public.price_observations as observation
  where observation.user_id = v_user_id
    and observation.id = v_nullable_observation_id;
  if v_observation ->> 'grossPrice' is not null
    or v_observation ->> 'discount' is not null
    or (v_observation ->> 'netPrice')::integer <> 1100
    or v_observation ->> 'observedAtExact' is not null
  then
    raise exception 'unknown gross/discount or date precision was not preserved: %', v_observation;
  end if;

  v_final_payment_only := (v_retail - 'observed_at' - 'gross_price'
    - 'discount' - 'quantity' - 'unit_price')
    || jsonb_build_object('observed_on', '2026-09-07');
  v_final_payment_observation := public.ingest_verified_standalone_price_observation_v1(
    'standalone-final-payment-only-' || v_suffix,
    v_final_payment_only
  );
  v_final_payment_observation_id := (v_final_payment_observation ->> 'observationId')::uuid;
  select jsonb_build_object(
    'quantity', observation.quantity,
    'unitPrice', observation.unit_price_krw,
    'grossPrice', observation.gross_price_krw,
    'discount', observation.discount_price_krw,
    'netPrice', observation.net_price_krw,
    'observedAtExact', observation.observed_at_exact
  )
  into v_observation
  from public.price_observations as observation
  where observation.user_id = v_user_id
    and observation.id = v_final_payment_observation_id;
  if v_observation ->> 'quantity' is not null
    or v_observation ->> 'unitPrice' is not null
    or v_observation ->> 'grossPrice' is not null
    or v_observation ->> 'discount' is not null
    or (v_observation ->> 'netPrice')::integer <> 1100
    or v_observation ->> 'observedAtExact' is not null
  then
    raise exception 'final-payment-only standalone observation was not represented: %', v_observation;
  end if;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-no-price-facts-' || v_suffix,
      v_retail - array['observed_at', 'gross_price', 'discount', 'net_price', 'unit_price']
    );
    raise exception 'standalone observation without any price fact was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-date-conflict-' || v_suffix,
      v_retail || jsonb_build_object('observed_on', '2026-09-06')
    );
    raise exception 'observed_on and explicit observed_at date mismatch was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-uuid-' || v_suffix,
      v_retail || jsonb_build_object('store_id', gen_random_uuid())
    );
    raise exception 'external PriceTrace UUID was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-unreviewed-' || v_suffix,
      v_retail || jsonb_build_object('transcription_status', 'pending')
    );
    raise exception 'unreviewed OCR payload was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  v_restaurant := jsonb_build_object(
    'schema_version', 'receipt-independent-price-observation.v3',
    'contract_version', 'price-observation.v3',
    'kind', 'restaurant_purchase',
    'verification_basis', 'manual_canonical_review',
    'transcription_status', 'user_verified',
    'observed_on', '2026-09-07',
    'currency', 'KRW',
    'gross_price', 9000,
    'discount', null,
    'net_price', 9000,
    'quantity', 1,
    'unit_price', 9000,
    'merchant', jsonb_build_object(
      'merchant_name', '__standalone-restaurant-' || v_suffix,
      'branch_name', '서초',
      'source_namespace', 'test-restaurant',
      'source_location_code', 'location-' || v_suffix
    ),
    'item', jsonb_build_object(
      'item_name', '__standalone-menu-' || v_suffix,
      'serving_label', '1인분',
      'category_label', '식사'
    )
  );
  v_observation := public.ingest_verified_standalone_price_observation_v1(
    'standalone-restaurant-' || v_suffix,
    v_restaurant
  );
  v_manual_id := (v_observation ->> 'observationId')::uuid;
  if v_observation ->> 'kind' <> 'restaurant_purchase'
    or v_observation ->> 'authorityStatus' <> 'exact'
    or v_observation ->> 'merchantResolutionStatus' <> 'exact'
    or v_observation ->> 'menuResolutionStatus' <> 'exact'
    or (v_observation #>> '{authoritativeIds,restaurantId}') is null
    or (v_observation #>> '{authoritativeIds,restaurantLocationId}') is null
    or (v_observation #>> '{authoritativeIds,restaurantMenuId}') is null
    or (v_observation #>> '{authoritativeIds,catalogProductId}') is null
    or (v_observation #>> '{authoritativeIds,standardProductId}') is null
  then
    raise exception 'restaurant standalone observation response is incomplete: %', v_observation;
  end if;
  v_first_restaurant_id := (v_observation #>> '{authoritativeIds,restaurantId}')::uuid;
  v_first_location_id := (v_observation #>> '{authoritativeIds,restaurantLocationId}')::uuid;
  v_first_menu_id := (v_observation #>> '{authoritativeIds,restaurantMenuId}')::uuid;
  v_first_catalog_id := (v_observation #>> '{authoritativeIds,catalogProductId}')::uuid;
  select count(*) into v_count
  from public.restaurant_menu_manual_observations as manual_observation
  where manual_observation.id = v_manual_id
    and manual_observation.observation_kind = 'standalone_purchase'
    and manual_observation.verification_basis = 'manual_canonical_review'
    and manual_observation.verification_status = 'verified'
    and manual_observation.currency = 'KRW'
    and manual_observation.discount_price_krw is null
    and manual_observation.observed_at_exact is null
    and manual_observation.net_price_krw = 9000;
  if v_count <> 1 then
    raise exception 'restaurant standalone observation was not persisted independently';
  end if;

  if not exists (
    select 1
    from public.restaurants as restaurant
    inner join public.restaurant_locations as location on location.restaurant_id = restaurant.id
    inner join public.restaurant_menus as menu on menu.restaurant_id = restaurant.id
    inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id
    inner join public.standard_products as standard on standard.id = catalog.standard_product_id
    where restaurant.id = v_first_restaurant_id
      and location.id = v_first_location_id
      and menu.id = v_first_menu_id
      and catalog.id = v_first_catalog_id
      and standard.id = (v_observation #>> '{authoritativeIds,standardProductId}')::uuid
      and restaurant.review_status = 'verified' and restaurant.verification_status = 'verified'
      and location.review_status = 'verified' and location.verification_status = 'verified'
      and menu.review_status = 'verified' and menu.verification_status = 'verified'
      and catalog.verification_status = 'verified' and standard.verification_status = 'verified'
  ) then
    raise exception 'standalone exact response IDs are not an active verified Restaurant/Location/Menu/Catalog chain';
  end if;

  v_observation := public.ingest_verified_standalone_price_observation_v1(
    'standalone-restaurant-' || v_suffix,
    v_restaurant
  );
  if v_observation ->> 'authorityStatus' <> 'exact'
    or (v_observation ->> 'observationId')::uuid <> v_manual_id
    or (v_observation #>> '{authoritativeIds,restaurantId}')::uuid <> v_first_restaurant_id
    or (v_observation #>> '{authoritativeIds,restaurantLocationId}')::uuid <> v_first_location_id
    or (v_observation #>> '{authoritativeIds,restaurantMenuId}')::uuid <> v_first_menu_id
    or (v_observation #>> '{authoritativeIds,catalogProductId}')::uuid <> v_first_catalog_id
    or v_observation ->> 'replayed' <> 'true'
  then
    raise exception 'standalone exact retry did not reuse the same four authoritative IDs';
  end if;

  v_exact_reuse_request := jsonb_set(
    v_restaurant,
    '{document,source,original_document_id}',
    to_jsonb(('standalone-exact-reuse-' || v_suffix)::text)
  );
  v_exact_reuse_result := public.ingest_verified_standalone_price_observation_v1(
    'standalone-exact-reuse-key-' || v_suffix,
    v_exact_reuse_request
  );
  if v_exact_reuse_result ->> 'authorityStatus' <> 'exact'
    or (v_exact_reuse_result #>> '{authoritativeIds,restaurantId}')::uuid <> v_first_restaurant_id
    or (v_exact_reuse_result #>> '{authoritativeIds,restaurantLocationId}')::uuid <> v_first_location_id
    or (v_exact_reuse_result #>> '{authoritativeIds,restaurantMenuId}')::uuid <> v_first_menu_id
    or (v_exact_reuse_result #>> '{authoritativeIds,catalogProductId}')::uuid <> v_first_catalog_id
  then
    raise exception 'a separate request with the same exact source did not reuse the existing four identities';
  end if;
  select count(*) into v_count
  from public.restaurant_locations
  where source_namespace = 'test-restaurant' and source_location_code = 'location-' || v_suffix;
  if v_count <> 1 then
    raise exception 'exact source reuse created a duplicate Location row';
  end if;

  v_name_only := jsonb_set(v_restaurant, '{document,source,original_document_id}', to_jsonb(('standalone-name-only-' || v_suffix)::text));
  v_name_only := jsonb_set(v_name_only, '{merchant}', jsonb_build_object(
    'merchant_name', '__standalone-name-only-' || v_suffix,
    'branch_name', '서초',
    'source_namespace', null,
    'source_location_code', null,
    'business_registration_number', null,
    'address', null,
    'phone', null
  ));
  v_name_only_result := public.ingest_verified_standalone_price_observation_v1(
    'standalone-name-only-key-' || v_suffix,
    v_name_only
  );
  if v_name_only_result ->> 'authorityStatus' <> 'needs_ocr_resolution'
    or v_name_only_result ->> 'merchantResolutionStatus' <> 'needs_ocr_resolution'
    or v_name_only_result ->> 'menuResolutionStatus' <> 'needs_ocr_resolution'
    or v_name_only_result ->> 'observationId' is not null
    or (v_name_only_result #>> '{authoritativeIds,restaurantId}') is not null
    or (v_name_only_result #>> '{authoritativeIds,restaurantLocationId}') is not null
    or (v_name_only_result #>> '{authoritativeIds,restaurantMenuId}') is not null
    or (v_name_only_result #>> '{authoritativeIds,catalogProductId}') is not null
    or v_name_only_result #>> '{ocrResolution,status}' <> 'needs_ocr_resolution'
    or v_name_only_result #>> '{ocrResolution,resolutionId}' is null
  then
    raise exception 'name-only restaurant source was incorrectly treated as exact: %', v_name_only_result;
  end if;
  v_resolution_id := (v_name_only_result #>> '{ocrResolution,resolutionId}')::uuid;
  if exists (
    select 1 from public.restaurants
    where canonical_name = '__standalone-name-only-' || v_suffix
  ) then
    raise exception 'name-only restaurant source created a global Restaurant identity';
  end if;

  v_other_user_id := gen_random_uuid();
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_other_user_id, 'role', 'authenticated', 'app_metadata', jsonb_build_object('role', 'user'))::text,
    true
  );
  begin
    perform public.resolve_ocr_standalone_restaurant_menu_v1(
      v_resolution_id,
      jsonb_build_object('merchant_name', '__standalone-name-only-' || v_suffix, 'branch_name', '서초', 'source_namespace', 'test-restaurant', 'source_location_code', 'resolved-' || v_suffix),
      v_name_only -> 'item',
      true
    );
    raise exception 'a different user resolved a standalone OCR identity candidate';
  exception when insufficient_privilege then
    v_owner_denied := true;
  end;
  if not v_owner_denied then
    raise exception 'standalone OCR resolution did not enforce candidate ownership';
  end if;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_id, 'role', 'authenticated', 'app_metadata', jsonb_build_object('role', 'user'))::text,
    true
  );

  v_strong_merchant := jsonb_build_object(
    'merchant_name', '__standalone-name-only-' || v_suffix,
    'branch_name', '서초',
    'source_namespace', 'test-restaurant',
    'source_location_code', 'resolved-' || v_suffix
  );
  v_item_facts := v_name_only -> 'item';
  v_name_only_resolved := public.resolve_ocr_standalone_restaurant_menu_v1(
    v_resolution_id, v_strong_merchant, v_item_facts, true
  );
  if v_name_only_resolved ->> 'authorityStatus' <> 'exact'
    or v_name_only_resolved ->> 'merchantResolutionStatus' <> 'exact'
    or v_name_only_resolved ->> 'menuResolutionStatus' <> 'exact'
    or (v_name_only_resolved #>> '{authoritativeIds,restaurantId}') is null
    or (v_name_only_resolved #>> '{authoritativeIds,restaurantLocationId}') is null
    or (v_name_only_resolved #>> '{authoritativeIds,restaurantMenuId}') is null
    or (v_name_only_resolved #>> '{authoritativeIds,catalogProductId}') is null
    or (v_name_only_resolved ->> 'observationId') is null
  then
    raise exception 'owner-authenticated standalone source resolution did not return exact authority: %', v_name_only_resolved;
  end if;
  v_name_only_retry := public.ingest_verified_standalone_price_observation_v1(
    'standalone-name-only-key-' || v_suffix,
    v_name_only
  );
  if v_name_only_retry ->> 'authorityStatus' <> 'exact'
    or v_name_only_retry ->> 'replayed' <> 'true'
    or v_name_only_retry ->> 'observationId' <> v_name_only_resolved ->> 'observationId'
    or v_name_only_retry #>> '{authoritativeIds,restaurantId}' <> v_name_only_resolved #>> '{authoritativeIds,restaurantId}'
    or v_name_only_retry #>> '{authoritativeIds,restaurantLocationId}' <> v_name_only_resolved #>> '{authoritativeIds,restaurantLocationId}'
    or v_name_only_retry #>> '{authoritativeIds,restaurantMenuId}' <> v_name_only_resolved #>> '{authoritativeIds,restaurantMenuId}'
    or v_name_only_retry #>> '{authoritativeIds,catalogProductId}' <> v_name_only_resolved #>> '{authoritativeIds,catalogProductId}'
  then
    raise exception 'resolved standalone retry changed the authoritative identities';
  end if;

  v_same_name_branch := jsonb_set(v_restaurant, '{document,source,original_document_id}', to_jsonb(('standalone-same-name-branch-' || v_suffix)::text));
  v_same_name_branch := jsonb_set(v_same_name_branch, '{merchant,source_location_code}', to_jsonb(('location-other-' || v_suffix)::text));
  v_same_name_result := public.ingest_verified_standalone_price_observation_v1(
    'standalone-same-name-branch-key-' || v_suffix,
    v_same_name_branch
  );
  v_second_restaurant_id := (v_same_name_result #>> '{authoritativeIds,restaurantId}')::uuid;
  v_second_location_id := (v_same_name_result #>> '{authoritativeIds,restaurantLocationId}')::uuid;
  v_second_menu_id := (v_same_name_result #>> '{authoritativeIds,restaurantMenuId}')::uuid;
  v_second_catalog_id := (v_same_name_result #>> '{authoritativeIds,catalogProductId}')::uuid;
  if v_same_name_result ->> 'authorityStatus' <> 'exact'
    or v_second_restaurant_id is null or v_second_location_id is null
    or v_second_menu_id is null or v_second_catalog_id is null
    or v_second_restaurant_id = v_first_restaurant_id
    or v_second_location_id = v_first_location_id
    or v_second_menu_id = v_first_menu_id
    or v_second_catalog_id = v_first_catalog_id
  then
    raise exception 'same-name Restaurant/Location/Menu source identities were merged';
  end if;

  insert into public.standard_products (
    purchase_type, canonical_name, status, created_by, verification_status
  ) values ('menu_item', '__standalone-name-only-' || v_suffix, 'active', v_user_id, 'verified')
  returning id into v_duplicate_standard_id;
  insert into public.catalog_products (
    standard_product_id, purchase_type, canonical_name, specification,
    specification_status, content_amount, content_unit, package_count,
    reference_unit, attributes, status, created_by, verification_status
  ) values (
    v_duplicate_standard_id, 'menu_item', '__standalone-menu-' || v_suffix,
    '1인분', 'placeholder', 1, 'each', 1, 100,
    jsonb_build_object('restaurantId', v_first_restaurant_id), 'active', v_user_id, 'verified'
  ) returning id into v_duplicate_catalog_id;
  insert into public.restaurant_menus (
    restaurant_id, catalog_product_id, canonical_name, category_label,
    serving_label, review_status, status, verification_status,
    created_by, reviewed_by, reviewed_at
  ) values (
    v_first_restaurant_id, v_duplicate_catalog_id, '__standalone-menu-' || v_suffix,
    '식사', '1인분', 'verified', 'active', 'verified', v_user_id, v_user_id, now()
  ) returning id into v_duplicate_menu_id;

  v_duplicate_menu_result := public.ingest_verified_standalone_price_observation_v1(
    'standalone-duplicate-menu-' || v_suffix,
    v_restaurant
  );
  if v_duplicate_menu_result ->> 'authorityStatus' <> 'needs_ocr_resolution'
    or v_duplicate_menu_result #>> '{ocrResolution,reasonCode}' <> 'menu_identity_ambiguous'
    or (v_duplicate_menu_result ->> 'observationId') is not null
    or (v_duplicate_menu_result #>> '{authoritativeIds,restaurantMenuId}') is not null
    or (v_duplicate_menu_result #>> '{authoritativeIds,catalogProductId}') is not null
  then
    raise exception 'duplicate RestaurantMenu candidates were guessed instead of returned to OCR-App: %', v_duplicate_menu_result;
  end if;
  v_duplicate_resolution_result := public.resolve_ocr_standalone_restaurant_menu_v1(
    (v_duplicate_menu_result #>> '{ocrResolution,resolutionId}')::uuid,
    v_restaurant -> 'merchant',
    v_restaurant -> 'item',
    true
  );
  if v_duplicate_resolution_result ->> 'authorityStatus' = 'exact'
    or v_duplicate_resolution_result #>> '{ocrResolution,status}' <> 'needs_ocr_resolution'
  then
    raise exception 'duplicate exact Menu facts were incorrectly resolved by OCR source review';
  end if;

  select receipt_id into v_receipt_id
  from public.submit_restaurant_receipt_v1(
    'standalone-legacy-' || v_suffix,
    'legacy-' || v_suffix,
    '__legacy-restaurant-' || v_suffix,
    '본점',
    '2026-09-07'::date,
    5000,
    jsonb_build_array(jsonb_build_object(
      'line_id', 'line-1', 'description', 'legacy menu', 'quantity', 1,
      'unit_price_krw', 5000, 'total_price_krw', 5000, 'line_type', 'main'
    ))
  );
  select item.id, observation.observation_kind
    into v_receipt_item_id, v_receipt_observation_kind
  from public.receipt_items as item
  inner join public.price_observations as observation
    on observation.user_id = item.user_id
    and observation.receipt_item_id = item.id
  where item.user_id = v_user_id and item.receipt_id = v_receipt_id;
  if v_receipt_item_id is null or v_receipt_observation_kind <> 'receipt_purchase' then
    raise exception 'existing receipt ingestion regression detected';
  end if;

  if has_table_privilege('anon', 'public.standalone_price_observation_ingestion_requests', 'select')
    or has_function_privilege(
      'anon',
      'public.ingest_verified_standalone_price_observation_v1(text,jsonb)',
      'execute'
    )
    or not has_function_privilege(
      'authenticated',
      'public.resolve_ocr_standalone_restaurant_menu_v1(uuid,jsonb,jsonb,boolean)',
      'execute'
    )
    or has_function_privilege(
      'anon',
      'public.resolve_ocr_standalone_restaurant_menu_v1(uuid,jsonb,jsonb,boolean)',
      'execute'
    )
  then
    raise exception 'standalone ingestion/resolution auth/RLS grants are invalid';
  end if;
end;
$$;

rollback;
