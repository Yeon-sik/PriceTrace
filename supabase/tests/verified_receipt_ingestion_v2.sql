-- Executes the PriceTrace RPC against an already migrated Supabase/Postgres database.
-- Run this file in the Supabase SQL editor or with `supabase db query --linked`.
-- All fixture writes are rolled back at the end.

begin;

do $$
declare
  v_user_id uuid;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_retail jsonb;
  v_restaurant jsonb;
  v_refund jsonb;
  v_tampered jsonb;
  v_first jsonb;
  v_replayed jsonb;
  v_deduplicated jsonb;
  v_private jsonb;
  v_receipt_id uuid;
  v_option_receipt_item_id text;
  v_parent_receipt_item_id text;
  v_restaurant_id uuid;
  v_location_id uuid;
  v_standard_product_id uuid;
  v_catalog_product_id uuid;
  v_menu_id uuid;
  v_candidate_id uuid;
  v_restaurant_count integer;
  v_request_count integer;
  v_content_count integer;
begin
  select id into v_user_id from auth.users order by created_at limit 1;
  if v_user_id is null then
    raise exception 'verified receipt integration test requires one auth.users fixture';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user_id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('role', 'user')
    )::text,
    true
  );

  v_retail := jsonb_build_object(
    'schema_version', 'receipt.v2',
    'document', jsonb_build_object(
      'id', null, 'type', 'receipt', 'status', 'final', 'currency', 'KRW',
      'issued_on', '2026-08-28', 'issued_at', null,
      'source', jsonb_build_object(
        'original_document_id', 'integration-retail-' || v_suffix,
        'transcription_status', 'user_verified', 'source_images', '[]'::jsonb,
        'raw_text', null, 'capture_method', 'ocr'
      ),
      'fulfillment', jsonb_build_object('type', 'unknown', 'evidence', 'unknown')
    ),
    'merchant', jsonb_build_object(
      'name', 'Integration Retail ' || v_suffix, 'branch_name', null,
      'business_kind', 'retail', 'retail_channel', 'regular',
      'catalog_namespace', null, 'merchant_id', null,
      'business_registration_number', null, 'address', null, 'phone', null
    ),
    'line_items', jsonb_build_array(jsonb_build_object(
      'id', 'retail-1', 'type', 'product', 'description', 'Integration product',
      'source_line_references', jsonb_build_array('line:1'), 'identifiers', jsonb_build_array(),
      'quantity', jsonb_build_object('value', 1, 'unit', 'each'),
      'unit_price_amount_minor', 1200, 'gross_amount_minor', 1200,
      'discount_amount_minor', 0, 'tax_amount_minor', 0, 'net_amount_minor', 1200,
      'confidence', 'user_verified', 'tax_rate_percent', 0, 'food_service', null
    )),
    'totals', jsonb_build_object(
      'items_gross_amount_minor', 1200, 'discount_amount_minor', 0,
      'tax_amount_minor', 0, 'fee_amount_minor', 0, 'tip_amount_minor', 0,
      'rounding_amount_minor', 0, 'grand_total_amount_minor', 1200
    ),
    'payments', jsonb_build_array(jsonb_build_object(
      'method', 'card', 'amount_minor', 1200, 'status', 'paid', 'reference', null
    ))
  );

  v_first := public.submit_verified_receipt_v2('integration-retail-key-' || v_suffix, v_retail);
  if (v_first ->> 'replayed') <> 'false' or (v_first ->> 'deduplicated') <> 'false' then
    raise exception 'normal retail receipt was not ingested as a new receipt';
  end if;
  v_receipt_id := (v_first ->> 'receiptId')::uuid;
  if (v_first ->> 'storeId') is null
    or ((v_first -> 'lines' -> 0) ->> 'lineOrdinal') <> '1'
    or ((v_first -> 'lines' -> 0) ->> 'productId') is null
    or ((v_first -> 'lines' -> 0) ->> 'storeProductId') is null
    or ((v_first -> 'lines' -> 0) ->> 'catalogProductId') is not null
    or ((v_first -> 'lines' -> 0) ->> 'restaurantMenuId') is not null
  then
    raise exception 'retail identity response did not contain the server-owned store, ordinal, and private IDs';
  end if;

  v_replayed := public.submit_verified_receipt_v2('integration-retail-key-' || v_suffix, v_retail);
  if (v_replayed ->> 'replayed') <> 'true' or (v_replayed ->> 'deduplicated') <> 'true'
  then
    raise exception 'same idempotency key and payload was not replayed';
  end if;
  if (v_replayed ->> 'storeId') <> (v_first ->> 'storeId')
    or ((v_replayed -> 'lines' -> 0) ->> 'storeProductId') <> ((v_first -> 'lines' -> 0) ->> 'storeProductId')
  then
    raise exception 'replayed identity response changed its server-owned references';
  end if;

  v_deduplicated := public.submit_verified_receipt_v2('integration-retail-key-2-' || v_suffix, v_retail);
  if (v_deduplicated ->> 'replayed') <> 'false' or (v_deduplicated ->> 'deduplicated') <> 'true'
  then
    raise exception 'same payload with a different idempotency key was not deduplicated';
  end if;
  select count(*) into v_request_count
  from public.verified_receipt_ingestion_requests
  where user_id = v_user_id and request_fingerprint = encode(extensions.digest(v_retail::text, 'sha256'), 'hex');
  select count(*) into v_content_count
  from public.verified_receipt_ingestion_contents
  where user_id = v_user_id and request_fingerprint = encode(extensions.digest(v_retail::text, 'sha256'), 'hex');
  if v_request_count <> 2 or v_content_count <> 1 then
    raise exception 'content dedup and idempotency bindings are not separate: requests %, contents %', v_request_count, v_content_count;
  end if;

  begin
    perform public.submit_verified_receipt_v2(
      'integration-retail-key-' || v_suffix,
      jsonb_set(v_retail, '{merchant,name}', to_jsonb('Different merchant'::text))
    );
    raise exception 'same idempotency key accepted a different payload';
  exception when unique_violation then
    null;
  end;

  insert into public.restaurants(canonical_name, review_status, status, created_by, reviewed_by, reviewed_at)
  values ('Integration Restaurant ' || v_suffix, 'verified', 'active', v_user_id, v_user_id, now())
  returning id into v_restaurant_id;
  insert into public.restaurant_locations(
    restaurant_id, source_namespace, source_location_code, location_label,
    review_status, created_by, reviewed_by, reviewed_at
  ) values (
    v_restaurant_id, 'integration-test', 'location-' || v_suffix, 'Main',
    'verified', v_user_id, v_user_id, now()
  ) returning id into v_location_id;
  insert into public.standard_products(purchase_type, canonical_name, created_by)
  values ('menu_item', 'Integration main menu standard ' || v_suffix, v_user_id)
  returning id into v_standard_product_id;
  insert into public.catalog_products(standard_product_id, purchase_type, canonical_name, created_by)
  values (v_standard_product_id, 'menu_item', 'Integration main menu ' || v_suffix, v_user_id)
  returning id into v_catalog_product_id;
  insert into public.restaurant_menus(
    restaurant_id, catalog_product_id, canonical_name, review_status,
    created_by, reviewed_by, reviewed_at
  ) values (
    v_restaurant_id, v_catalog_product_id, 'Integration main menu',
    'verified', v_user_id, v_user_id, now()
  ) returning id into v_menu_id;

  v_restaurant := jsonb_set(
    jsonb_set(v_retail, '{document,source,original_document_id}', to_jsonb(('integration-restaurant-' || v_suffix)::text)),
    '{merchant}',
    jsonb_build_object(
      'name', 'Integration Restaurant ' || v_suffix, 'branch_name', 'Main',
      'business_kind', 'food_service', 'retail_channel', 'unknown',
      'catalog_namespace', 'integration-test', 'merchant_id', 'location-' || v_suffix,
      'business_registration_number', null, 'address', null, 'phone', null
    )
  );
  v_restaurant := jsonb_set(v_restaurant, '{line_items}', jsonb_build_array(
    jsonb_build_object(
      'id', 'main-1', 'type', 'product', 'description', 'Integration main menu',
      'source_line_references', jsonb_build_array('line:1'), 'identifiers', jsonb_build_array(),
      'quantity', jsonb_build_object('value', 1, 'unit', 'each'),
      'unit_price_amount_minor', 800, 'gross_amount_minor', 800,
      'discount_amount_minor', 0, 'tax_amount_minor', 0, 'net_amount_minor', 800,
      'confidence', 'user_verified', 'tax_rate_percent', 0,
      'food_service', jsonb_build_object('role', 'main', 'applies_to_line_id', null)
    ),
    jsonb_build_object(
      'id', 'option-1', 'type', 'product', 'description', 'Integration option',
      'source_line_references', jsonb_build_array('line:2'), 'identifiers', jsonb_build_array(),
      'quantity', jsonb_build_object('value', 1, 'unit', 'each'),
      'unit_price_amount_minor', 100, 'gross_amount_minor', 100,
      'discount_amount_minor', 0, 'tax_amount_minor', 0, 'net_amount_minor', 100,
      'confidence', 'user_verified', 'tax_rate_percent', 0,
      'food_service', jsonb_build_object('role', 'option', 'applies_to_line_id', 'main-1')
    )
  ));
  v_restaurant := jsonb_set(v_restaurant, '{totals}', jsonb_build_object(
    'items_gross_amount_minor', 900, 'discount_amount_minor', 0,
    'tax_amount_minor', 0, 'fee_amount_minor', 0, 'tip_amount_minor', 0,
    'rounding_amount_minor', 0, 'grand_total_amount_minor', 900
  ));
  v_restaurant := jsonb_set(v_restaurant, '{payments,0,amount_minor}', '900'::jsonb);
  v_first := public.submit_verified_receipt_v2('integration-restaurant-key-' || v_suffix, v_restaurant);
  if (v_first ->> 'restaurantId') <> v_restaurant_id::text
    or (v_first ->> 'restaurantLocationId') <> v_location_id::text
    or (v_first ->> 'merchantResolutionStatus') <> 'exact'
  then
    raise exception 'verified restaurant location was not resolved exactly';
  end if;
  if ((v_first -> 'lines' -> 0) ->> 'restaurantMenuId') <> v_menu_id::text
    or ((v_first -> 'lines' -> 0) ->> 'catalogProductId') <> v_catalog_product_id::text
    or ((v_first -> 'lines' -> 0) ->> 'lineOrdinal') <> '1'
    or ((v_first -> 'lines' -> 0) ->> 'productId') is null
    or ((v_first -> 'lines' -> 0) ->> 'storeProductId') is null
    or ((v_first -> 'lines' -> 1) ->> 'lineOrdinal') <> '2'
    or ((v_first -> 'lines' -> 1) ->> 'productId') is null
    or ((v_first -> 'lines' -> 1) ->> 'storeProductId') is null
  then
    raise exception 'verified restaurant menu identity was not returned';
  end if;
  v_receipt_id := (v_first ->> 'receiptId')::uuid;
  v_private := public.get_authenticated_identity_detail_v1(
    p_store_id => (v_first ->> 'storeId')::uuid
  );
  if (v_private -> 'selector' ->> 'type') <> 'store'
    or (v_private -> 'selector' ->> 'id') <> (v_first ->> 'storeId')
    or jsonb_array_length(v_private -> 'receipts') = 0
  then
    raise exception 'authenticated private store read did not return the linked receipt';
  end if;
  select option_receipt_item_id, parent_receipt_item_id
    into v_option_receipt_item_id, v_parent_receipt_item_id
  from public.receipt_item_menu_option_sources
  where receipt_id = v_receipt_id;
  if v_option_receipt_item_id is null or v_parent_receipt_item_id is null then
    raise exception 'restaurant option parent source link was not preserved';
  end if;

  v_refund := jsonb_set(
    jsonb_set(v_retail, '{document,source,original_document_id}', to_jsonb(('integration-refund-' || v_suffix)::text)),
    '{line_items}',
    (v_retail -> 'line_items') || jsonb_build_array(jsonb_build_object(
      'id', 'refund-1', 'type', 'refund', 'description', 'Integration refund',
      'source_line_references', jsonb_build_array('line:2'), 'identifiers', jsonb_build_array(),
      'quantity', null, 'unit_price_amount_minor', null, 'gross_amount_minor', 0,
      'discount_amount_minor', 0, 'tax_amount_minor', 0, 'net_amount_minor', -200,
      'confidence', 'user_verified', 'tax_rate_percent', null, 'food_service', null
    ))
  );
  v_refund := jsonb_set(v_refund, '{totals}', jsonb_build_object(
    'items_gross_amount_minor', 1200, 'discount_amount_minor', 0,
    'tax_amount_minor', 0, 'fee_amount_minor', 0, 'tip_amount_minor', 0,
    'rounding_amount_minor', 0, 'grand_total_amount_minor', 1000
  ));
  v_refund := jsonb_set(v_refund, '{payments,0,amount_minor}', '1000'::jsonb);
  v_first := public.submit_verified_receipt_v2('integration-refund-key-' || v_suffix, v_refund);
  if (v_first ->> 'receiptId') is null then
    raise exception 'refund receipt was not ingested';
  end if;

  v_tampered := jsonb_set(
    jsonb_set(v_retail, '{document,source,original_document_id}', to_jsonb(('integration-tampered-' || v_suffix)::text)),
    '{line_items,0,net_amount_minor}', '1199'::jsonb
  );
  begin
    perform public.submit_verified_receipt_v2('integration-tampered-key-' || v_suffix, v_tampered);
    raise exception 'tampered product net amount was accepted';
  exception when check_violation then
    null;
  end;

  v_first := public.submit_merchant_identity_candidate_v1(
    'integration-merchant-only-key-' || v_suffix,
    jsonb_build_object(
      'merchant_name', 'Integration Candidate ' || v_suffix,
      'branch_name', 'Unresolved branch', 'business_kind', 'food_service',
      'source_namespace', null, 'source_location_code', null,
      'business_registration_number', null, 'address', null, 'phone', null
    ),
    true
  );
  v_candidate_id := (v_first ->> 'candidateId')::uuid;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user_id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('role', 'admin')
    )::text,
    true
  );
  begin
    perform * from public.admin_register_restaurant_from_merchant_candidate_v1(v_candidate_id);
    raise exception 'merchant-only food_service candidate without source identity was registered';
  exception when check_violation then
    null;
  end;
  select count(*) into v_restaurant_count
  from public.restaurants
  where canonical_name = 'Integration Candidate ' || v_suffix;
  if v_restaurant_count <> 0 then
    raise exception 'merchant-only candidate created a restaurant without a location identity';
  end if;
end;
$$;

rollback;
