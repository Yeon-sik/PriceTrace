-- Run after 20260907100000_standalone_price_observation_v3.sql in a linked
-- SQL editor or local Supabase database. Fixture writes are rolled back.

begin;

do $$
declare
  v_user_id uuid;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_retail jsonb;
  v_retail_replay jsonb;
  v_restaurant jsonb;
  v_observation jsonb;
  v_observation_id uuid;
  v_receipt_id uuid;
  v_receipt_item_id text;
  v_receipt_observation_kind text;
  v_manual_id uuid;
  v_count integer;
begin
  select id into v_user_id from auth.users order by created_at limit 1;
  if v_user_id is null then
    raise exception 'standalone observation integration test requires one auth.users fixture';
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
    'schema_version', 'receipt-independent-price-observation.v3',
    'contract_version', 'price-observation.v3',
    'kind', 'retail_purchase',
    'verification_basis', 'source_evidence',
    'transcription_status', 'user_verified',
    'observed_at', '2026-09-07T09:30:00+09:00',
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
      'product_name', '__standalone-product-' || v_suffix,
      'merchant_sku', 'sku-' || v_suffix,
      'brand', 'Test Brand',
      'specification', '2개',
      'identifiers', jsonb_build_array()
    )
  );

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
    'unitPrice', observation.unit_price_krw
  ) into v_observation
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
  then
    raise exception 'retail standalone observation was not persisted independently: %', v_observation;
  end if;

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
      'standalone-mismatch-' || v_suffix,
      jsonb_set(v_retail, '{net_price}', '1099'::jsonb)
    );
    raise exception 'standalone arithmetic mismatch was accepted';
  exception when check_violation then
    null;
  end;

  begin
    perform public.ingest_verified_standalone_price_observation_v1(
      'standalone-no-net-' || v_suffix,
      v_retail - 'net_price'
    );
    raise exception 'standalone observation without net_price was accepted';
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
    or (v_observation #>> '{authoritativeIds,restaurantId}') is null
    or (v_observation #>> '{authoritativeIds,restaurantLocationId}') is null
    or (v_observation #>> '{authoritativeIds,restaurantMenuId}') is null
  then
    raise exception 'restaurant standalone observation response is incomplete: %', v_observation;
  end if;
  select count(*) into v_count
  from public.restaurant_menu_manual_observations as manual_observation
  where manual_observation.id = v_manual_id
    and manual_observation.observation_kind = 'standalone_purchase'
    and manual_observation.verification_basis = 'manual_canonical_review'
    and manual_observation.verification_status = 'verified'
    and manual_observation.currency = 'KRW'
    and manual_observation.discount_price_krw is null
    and manual_observation.net_price_krw = 9000;
  if v_count <> 1 then
    raise exception 'restaurant standalone observation was not persisted independently';
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
  then
    raise exception 'standalone ingestion auth/RLS grants are too broad';
  end if;
end;
$$;

rollback;
