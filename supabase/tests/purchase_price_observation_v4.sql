-- Run after 20260911140000_purchase_price_observation_v4.sql and
-- 20260911150000_product_candidate_order_history_allowlist.sql in a linked
-- SQL editor or local Supabase database. Fixture writes are rolled back.

begin;

do $$
declare
  v_user_id uuid;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_standard_product_id uuid := gen_random_uuid();
  v_catalog_product_id uuid := gen_random_uuid();
  v_category_id uuid;
  v_candidate_response jsonb;
  v_candidate_client_key text;
  v_product_name text;
  v_barcode text := '8' || lpad((floor(random() * 1000000000000))::bigint::text, 12, '0');
  v_purchase jsonb;
  v_naver_purchase jsonb;
  v_unknown_seller jsonb;
  v_unresolved_purchase jsonb;
  v_unresolved_candidate jsonb;
  v_unresolved_client_key text;
  v_unresolved_product_name text;
  v_other_purchase jsonb;
  v_unknown_kind_purchase jsonb;
  v_cancelled_purchase jsonb;
  v_pending_purchase jsonb;
  v_unknown_state_purchase jsonb;
  v_refunded_purchase jsonb;
  v_multi_seller_purchase jsonb;
  v_multi_line jsonb;
  v_multi_line_b jsonb;
  v_multi_line_missing jsonb;
  v_legacy_kind_purchase jsonb;
  v_payment_only jsonb;
  v_ambiguous_line jsonb;
  v_date_only jsonb;
  v_unknown_date jsonb;
  v_delivery_purchase jsonb;
  v_v3_purchase jsonb;
  v_first jsonb;
  v_naver jsonb;
  v_unknown jsonb;
  v_unresolved_response jsonb;
  v_other_response jsonb;
  v_unknown_kind_response jsonb;
  v_cancelled_response jsonb;
  v_pending_response jsonb;
  v_unknown_state_response jsonb;
  v_refunded_response jsonb;
  v_multi_response jsonb;
  v_legacy_kind_response jsonb;
  v_payment_only_response jsonb;
  v_ambiguous_response jsonb;
  v_date_only_response jsonb;
  v_unknown_date_response jsonb;
  v_delivery_response jsonb;
  v_replay jsonb;
  v_deduplicated jsonb;
  v_v3_response jsonb;
  v_source_id uuid;
  v_naver_source_id uuid;
  v_unknown_source_id uuid;
  v_unresolved_source_id uuid;
  v_other_source_id uuid;
  v_unknown_kind_source_id uuid;
  v_cancelled_source_id uuid;
  v_pending_source_id uuid;
  v_unknown_state_source_id uuid;
  v_refunded_source_id uuid;
  v_multi_source_id uuid;
  v_payment_only_source_id uuid;
  v_ambiguous_source_id uuid;
  v_date_only_source_id uuid;
  v_unknown_date_source_id uuid;
  v_delivery_source_id uuid;
  v_delivery_restaurant_id uuid;
  v_delivery_location_id uuid;
  v_delivery_standard_product_id uuid;
  v_delivery_catalog_product_id uuid;
  v_delivery_menu_id uuid;
  v_delivery_manual_observation_id uuid;
  v_observation_id uuid;
  v_store_id uuid;
  v_receipt_id uuid;
  v_receipt_item_id text;
  v_ordered_on date;
  v_paid_on date;
  v_ordered_at_exact timestamptz;
  v_paid_at_exact timestamptz;
  v_observed_on date;
  v_observed_at_exact timestamptz;
  v_payment_discount integer;
  v_discount integer;
  v_gross integer;
  v_net integer;
  v_source_count integer;
  v_observation_count integer;
  v_store_count integer;
  v_platform_store_count integer;
  v_line_count integer;
  v_status text;
  v_reason text;
  v_observation_kind text;
begin
  select id into v_user_id from auth.users order by created_at limit 1;
  if v_user_id is null then
    raise exception 'purchase price observation v4 test requires one auth.users fixture';
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

  select category.id
  into v_category_id
  from public.catalog_categories as category
  where category.purchase_type = 'retail_product'
    and not exists (
      select 1
      from public.catalog_categories as child
      where child.parent_id = category.id
        and child.purchase_type = category.purchase_type
    )
  order by category.id
  limit 1;
  if v_category_id is null then
    raise exception 'v4 integration test requires a retail leaf category';
  end if;

  v_candidate_client_key := 'v4-product-' || v_suffix;
  v_product_name := '__v4-authority-product-' || v_suffix;

  insert into public.standard_products (
    id, purchase_type, canonical_name, brand, category_id,
    verification_status, status
  ) values (
    v_standard_product_id,
    'retail_product',
    v_product_name,
    '__v4-authority-brand-' || v_suffix,
    v_category_id,
    'verified',
    'active'
  );

  insert into public.catalog_products (
    id, standard_product_id, purchase_type, canonical_name, brand,
    specification, content_amount, content_unit, package_count, reference_unit,
    specification_status, verification_status, status, listing_reference_url
  ) values (
    v_catalog_product_id,
    v_standard_product_id,
    'retail_product',
    v_product_name,
    '__v4-authority-brand-' || v_suffix,
    '500g',
    500,
    'g',
    1,
    100,
    'verified',
    'verified',
    'active',
    'https://example.test/v4-catalog'
  );

  insert into public.catalog_product_identifiers (
    catalog_product_id, identifier_scheme, identifier_value,
    verification_status, provenance, reviewed_by, reviewed_at
  ) values (
    v_catalog_product_id,
    'ean',
    v_barcode,
    'verified',
    jsonb_build_object('sourceType', 'manufacturer', 'sourceRef', 'v4-test'),
    v_user_id,
    now()
  );

  v_candidate_response := public.submit_product_candidate_v1(
    'v4-candidate-' || v_suffix,
    jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'source_version', 'v4-test',
      'candidate_type', 'retail_product',
      'client_key', v_candidate_client_key,
      'product_name', v_product_name,
      'brand', '__v4-authority-brand-' || v_suffix,
      'sub_brand', null,
      'manufacturer', null,
      'specification', '500g',
      'content_amount', 500,
      'content_unit', 'g',
      'package_count', 1,
      'variant', null,
      'identifiers', jsonb_build_array(jsonb_build_object(
        'scheme', 'ean', 'value', v_barcode
      )),
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'order_history',
        'source_ref', 'order-history:v4-' || v_suffix,
        'field', 'product_name',
        'observed_value', v_product_name
      )),
      'provenance', jsonb_build_object(
        'capture_id', 'capture:v4-' || v_suffix,
        'extraction_method', 'gpt_vision',
        'extractor', 'v4-test',
        'extractor_version', '1'
      )
    )
  );
  if v_candidate_response ->> 'outcome' <> 'catalog_product_reused'
    or (v_candidate_response ->> 'catalogProductId')::uuid <> v_catalog_product_id
    or (v_candidate_response ->> 'standardProductId')::uuid <> v_standard_product_id
  then
    raise exception 'v4 Product Candidate did not resolve to the verified authority: %', v_candidate_response;
  end if;

  v_purchase := jsonb_build_object(
    'schema_version', 'purchase-price-observation.v4',
    'contract_version', 'purchase-price.v4',
    'source_app', 'pricetrace_ocr_app',
    'source_version', 'v4-test',
    'purchase_kind', 'retail',
    'verification_basis', 'source_evidence',
    'transcription_status', 'user_verified',
    'platform', jsonb_build_object('name', '쿠팡', 'code', 'coupang'),
    'seller', jsonb_build_object(
      'seller_name', '__v4-confirmed-seller-' || v_suffix,
      'branch_name', '온라인',
      'source_namespace', 'coupang-seller',
      'source_code', 'seller-' || v_suffix,
      'business_kind', 'retail'
    ),
    'order', jsonb_build_object(
      'order_reference', 'coupang-order-' || v_suffix,
      'status', 'paid',
      'currency', 'KRW',
      'ordered_on', '2026-09-11',
      'ordered_at', '2026-09-11T23:30:00+09:00'
    ),
    'payment', jsonb_build_object(
      'status', 'paid',
      'method', 'card',
      'paid_on', '2026-09-12',
    'paid_at', '2026-09-12T00:05:00+09:00',
    'total_price', 1100,
    'items_subtotal', 1100,
    'shipping_fee', 0,
    'discount', null
    ),
    'items', jsonb_build_array(jsonb_build_object(
      'line_key', 'line-1',
      'product', jsonb_build_object(
        'client_key', v_candidate_client_key,
        'product_name', v_product_name,
        'merchant_sku', 'sku-' || v_suffix
      ),
      'option_text', null,
      'price_status', 'itemized',
      'quantity', 2,
      'unit_price', 550,
      'gross_price', 1100,
      'discount', null,
      'net_price', 1100
    ))
  );

  v_first := public.ingest_verified_purchase_price_observation_v1(
    'v4-coupang-' || v_suffix,
    v_purchase
  );
  v_source_id := (v_first ->> 'purchaseSourceId')::uuid;
  if v_first ->> 'observationCreated' <> 'true'
    or v_first ->> 'purchaseKind' <> 'retail'
    or v_first ->> 'platform' <> '쿠팡'
    or (v_first ->> 'seller') <> ('__v4-confirmed-seller-' || v_suffix)
    or v_first ->> 'orderedOn' <> '2026-09-11'
    or v_first ->> 'paidOn' <> '2026-09-12'
  then
    raise exception 'Coupang seller-present v4 response is incomplete: %', v_first;
  end if;

  select
    source.ordered_on,
    source.ordered_at_exact,
    source.paid_on,
    source.paid_at_exact,
    source.payment_discount_krw,
    observation.observed_at,
    observation.observed_at_exact,
    observation.discount_price_krw,
    observation.gross_price_krw,
    observation.net_price_krw,
    observation.attributes #>> '{platform,name}',
    store.merchant_name,
    store.id,
    observation.id
  into
    v_ordered_on,
    v_ordered_at_exact,
    v_paid_on,
    v_paid_at_exact,
    v_payment_discount,
    v_observed_on,
    v_observed_at_exact,
    v_discount,
    v_gross,
    v_net,
    v_status,
    v_reason,
    v_store_id,
    v_observation_id
  from public.purchase_price_sources as source
  inner join public.purchase_price_source_lines as line
    on line.user_id = source.user_id
    and line.purchase_source_id = source.id
  inner join public.price_observations as observation
    on observation.user_id = line.user_id
    and observation.id = line.price_observation_id
  inner join public.store_products as store_product
    on store_product.user_id = observation.user_id
    and store_product.id = observation.store_product_id
  inner join public.stores as store
    on store.user_id = store_product.user_id
    and store.id = store_product.store_id
  where source.user_id = v_user_id
    and source.id = v_source_id;
  if v_ordered_on <> '2026-09-11'::date
    or v_ordered_at_exact <> '2026-09-11T14:30:00+00'::timestamptz
    or v_paid_on <> '2026-09-12'::date
    or v_paid_at_exact <> '2026-09-11T15:05:00+00'::timestamptz
    or v_payment_discount is not null
    or v_observed_on <> '2026-09-11'::date
    or v_observed_at_exact <> '2026-09-11T14:30:00+00'::timestamptz
    or v_discount is not null
    or v_gross <> 1100
    or v_net <> 1100
    or v_status <> '쿠팡'
    or v_reason <> ('__v4-confirmed-seller-' || v_suffix)
  then
    raise exception 'platform/seller, null discount, or independent date precision failed';
  end if;

  select count(*) into v_store_count
  from public.stores
  where user_id = v_user_id
    and merchant_name = '__v4-confirmed-seller-' || v_suffix;
  select count(*) into v_platform_store_count
  from public.stores
  where user_id = v_user_id
    and merchant_name = '쿠팡';

  v_naver_purchase := jsonb_set(
    jsonb_set(v_purchase, '{platform,name}', to_jsonb('네이버쇼핑'::text)),
    '{platform,code}', to_jsonb('naver-shopping'::text)
  );
  v_naver_purchase := jsonb_set(
    v_naver_purchase,
    '{order,order_reference}',
    to_jsonb(('naver-order-' || v_suffix)::text)
  );
  v_naver := public.ingest_verified_purchase_price_observation_v1(
    'v4-naver-' || v_suffix,
    v_naver_purchase
  );
  v_naver_source_id := (v_naver ->> 'purchaseSourceId')::uuid;
  if v_naver ->> 'observationCreated' <> 'true'
    or v_naver ->> 'platform' <> '네이버쇼핑'
  then
    raise exception 'platform change did not produce a second observation: %', v_naver;
  end if;
  select count(*) into v_observation_count
  from public.purchase_price_source_lines
  where user_id = v_user_id
    and purchase_source_id = v_naver_source_id
    and observation_status = 'created';
  select count(*) into v_line_count
  from public.stores
  where user_id = v_user_id
    and merchant_name = '__v4-confirmed-seller-' || v_suffix;
  if v_observation_count <> 1 or v_line_count <> v_store_count then
    raise exception 'platform was incorrectly used as seller/store identity';
  end if;

  v_replay := public.ingest_verified_purchase_price_observation_v1(
    'v4-coupang-' || v_suffix,
    v_purchase
  );
  if (v_replay ->> 'purchaseSourceId')::uuid <> v_source_id
    or v_replay ->> 'replayed' <> 'true'
    or v_replay ->> 'deduplicated' <> 'false'
  then
    raise exception 'v4 idempotency replay failed: %', v_replay;
  end if;

  v_deduplicated := public.ingest_verified_purchase_price_observation_v1(
    'v4-coupang-alt-' || v_suffix,
    v_purchase
  );
  if (v_deduplicated ->> 'purchaseSourceId')::uuid <> v_source_id
    or v_deduplicated ->> 'replayed' <> 'false'
    or v_deduplicated ->> 'deduplicated' <> 'true'
  then
    raise exception 'v4 content deduplication failed: %', v_deduplicated;
  end if;
  select count(*) into v_source_count
  from public.purchase_price_sources
  where user_id = v_user_id
    and id in (v_source_id, v_naver_source_id);
  if v_source_count <> 2 then
    raise exception 'content deduplication created a duplicate source';
  end if;

  begin
    perform public.ingest_verified_purchase_price_observation_v1(
      'v4-coupang-' || v_suffix,
      jsonb_set(v_purchase, '{payment,total_price}', '999'::jsonb)
    );
    raise exception 'v4 idempotency key accepted a changed request';
  exception when unique_violation then
    null;
  end;

  v_unknown_seller := v_purchase - 'seller';
  v_unknown_seller := jsonb_set(
    v_unknown_seller,
    '{order,order_reference}',
    to_jsonb(('unknown-seller-order-' || v_suffix)::text)
  );
  select count(*) into v_store_count
  from public.stores
  where user_id = v_user_id
    and merchant_name = '__v4-confirmed-seller-' || v_suffix;
  v_unknown := public.ingest_verified_purchase_price_observation_v1(
    'v4-unknown-seller-' || v_suffix,
    v_unknown_seller
  );
  v_unknown_source_id := (v_unknown ->> 'purchaseSourceId')::uuid;
  if v_unknown ->> 'observationCreated' <> 'false'
    or v_unknown ->> 'sellerConfirmed' <> 'false'
  then
    raise exception 'seller-unknown order created a PriceTrace observation: %', v_unknown;
  end if;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_unknown_source_id
    and line.line_ordinal = 1;
  select count(*) into v_line_count
  from public.stores
  where user_id = v_user_id
    and merchant_name = '__v4-confirmed-seller-' || v_suffix;
  select count(*) into v_source_count
  from public.stores
  where user_id = v_user_id
    and merchant_name = '쿠팡';
  if v_status <> 'not_created'
    or v_reason <> 'seller_unknown'
    or v_line_count <> v_store_count
    or v_source_count <> v_platform_store_count
  then
    raise exception 'seller-unknown source line/store safety failed';
  end if;

  -- A new candidate without a verified catalog authority may be ingested as
  -- private source evidence, but it must not unlock a purchase observation.
  v_unresolved_client_key := 'v4-unresolved-product-' || v_suffix;
  v_unresolved_product_name := '__v4-unresolved-product-' || v_suffix;
  v_unresolved_candidate := jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'source_version', 'v4-test',
      'candidate_type', 'retail_product',
      'client_key', v_unresolved_client_key,
      'product_name', v_unresolved_product_name,
      'brand', null,
      'manufacturer', null,
      'specification', null,
      'content_amount', null,
      'content_unit', null,
      'package_count', null,
      'variant', null,
      'identifiers', '[]'::jsonb,
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'order_history',
        'source_ref', 'order-history:unresolved-' || v_suffix,
        'field', 'product_name',
        'observed_value', v_unresolved_product_name
      )),
      'provenance', jsonb_build_object(
        'extraction_method', 'manual',
        'source_revision', 'v4-unresolved-test'
      )
  );
  v_candidate_response := public.submit_product_candidate_v1(
    'v4-unresolved-candidate-' || v_suffix,
    v_unresolved_candidate
  );
  if v_candidate_response ->> 'outcome' <> 'private_unverified_candidate_created'
    or v_candidate_response ->> 'catalogProductId' is not null
    or v_candidate_response ->> 'standardProductId' is not null
  then
    raise exception 'unresolved Product Candidate was promoted to authority: %', v_candidate_response;
  end if;
  v_unresolved_purchase := jsonb_set(
    v_purchase,
    '{order,order_reference}',
    to_jsonb(('unresolved-candidate-order-' || v_suffix)::text)
  );
  v_unresolved_purchase := jsonb_set(
    v_unresolved_purchase,
    '{items,0,product,client_key}',
    to_jsonb(v_unresolved_client_key)
  );
  v_unresolved_purchase := jsonb_set(
    v_unresolved_purchase,
    '{items,0,product,product_name}',
    to_jsonb(v_unresolved_product_name)
  );
  v_unresolved_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-unresolved-purchase-' || v_suffix,
    v_unresolved_purchase
  );
  v_unresolved_source_id := (v_unresolved_response ->> 'purchaseSourceId')::uuid;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_unresolved_source_id
    and line.line_ordinal = 1;
  if v_unresolved_response ->> 'observationCreated' <> 'false'
    or v_status <> 'not_created'
    or v_reason <> 'product_candidate_authority_unresolved'
  then
    raise exception 'unresolved Product Candidate created a price observation: %', v_unresolved_response;
  end if;
  select count(*)
  into v_source_count
  from public.product_identity_candidates as candidate
  where candidate.user_id = v_user_id
    and candidate.id = (v_candidate_response ->> 'candidateId')::uuid
    and candidate.evidence @> jsonb_build_array(jsonb_build_object(
      'source_type', 'order_history',
      'field', 'product_name',
      'observed_value', v_unresolved_product_name
    ));
  if v_source_count <> 1 then
    raise exception 'order_history evidence was not preserved on the candidate source: %', v_candidate_response;
  end if;
  begin
    perform public.submit_product_candidate_v1(
      'v4-order-history-identity-field-' || v_suffix,
      jsonb_set(v_unresolved_candidate, '{evidence,0,field}', '"seller_name"'::jsonb)
    );
    raise exception 'order_history accepted a seller identity fact';
  exception when sqlstate '22023' then
    null;
  end;

  v_payment_only := v_unknown_seller - 'items';
  v_payment_only_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-payment-only-' || v_suffix,
    v_payment_only
  );
  v_payment_only_source_id := (v_payment_only_response ->> 'purchaseSourceId')::uuid;
  if v_payment_only_response ->> 'observationCreated' <> 'false'
    or jsonb_array_length(v_payment_only_response -> 'lineResults') <> 0
  then
    raise exception 'payment-only order created a line observation: %', v_payment_only_response;
  end if;
  select count(*) into v_observation_count
  from public.price_observations as observation
  inner join public.purchase_price_source_lines as line
    on line.user_id = observation.user_id
    and line.price_observation_id = observation.id
  where line.user_id = v_user_id
    and line.purchase_source_id = v_payment_only_source_id;
  if v_observation_count <> 0 then
    raise exception 'payment-only order created a PriceTrace observation';
  end if;

  -- Explicit purchase_kind semantics: non-observable kinds preserve source
  -- lines even when the order is otherwise paid and itemized.
  v_other_purchase := jsonb_set(v_purchase, '{purchase_kind}', '"other"'::jsonb);
  v_other_purchase := jsonb_set(
    v_other_purchase,
    '{order,order_reference}',
    to_jsonb(('other-kind-order-' || v_suffix)::text)
  );
  v_other_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-other-kind-' || v_suffix,
    v_other_purchase
  );
  v_other_source_id := (v_other_response ->> 'purchaseSourceId')::uuid;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_other_source_id
    and line.line_ordinal = 1;
  if v_other_response ->> 'purchaseKind' <> 'other'
    or v_other_response ->> 'kind' <> 'other'
    or v_other_response ->> 'transactionState' <> 'settled'
    or v_other_response ->> 'observationCreated' <> 'false'
    or v_status <> 'not_created'
    or v_reason <> 'purchase_kind_not_observable'
  then
    raise exception 'other purchase kind created an observation: %', v_other_response;
  end if;

  v_unknown_kind_purchase := jsonb_set(v_purchase, '{purchase_kind}', '"unknown"'::jsonb);
  v_unknown_kind_purchase := jsonb_set(
    v_unknown_kind_purchase,
    '{order,order_reference}',
    to_jsonb(('unknown-kind-order-' || v_suffix)::text)
  );
  v_unknown_kind_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-unknown-kind-' || v_suffix,
    v_unknown_kind_purchase
  );
  v_unknown_kind_source_id := (v_unknown_kind_response ->> 'purchaseSourceId')::uuid;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_unknown_kind_source_id
    and line.line_ordinal = 1;
  if v_unknown_kind_response ->> 'purchaseKind' <> 'unknown'
    or v_unknown_kind_response ->> 'kind' <> 'unknown'
    or v_unknown_kind_response ->> 'observationCreated' <> 'false'
    or v_status <> 'not_created'
    or v_reason <> 'purchase_kind_not_observable'
  then
    raise exception 'unknown purchase kind created an observation: %', v_unknown_kind_response;
  end if;

  -- Settlement is a separate gate from item price and seller authority.
  v_cancelled_purchase := jsonb_set(
    v_purchase,
    '{order,status}',
    '"cancelled"'::jsonb
  );
  v_cancelled_purchase := jsonb_set(
    v_cancelled_purchase,
    '{order,order_reference}',
    to_jsonb(('cancelled-order-' || v_suffix)::text)
  );
  v_cancelled_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-cancelled-' || v_suffix,
    v_cancelled_purchase
  );
  v_cancelled_source_id := (v_cancelled_response ->> 'purchaseSourceId')::uuid;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_cancelled_source_id
    and line.line_ordinal = 1;
  if v_cancelled_response ->> 'transactionState' <> 'cancelled'
    or v_cancelled_response ->> 'observationCreated' <> 'false'
    or v_status <> 'not_created'
    or v_reason <> 'transaction_cancelled'
  then
    raise exception 'cancelled transaction created an observation: %', v_cancelled_response;
  end if;

  v_pending_purchase := jsonb_set(
    v_purchase,
    '{order,status}',
    '"pending"'::jsonb
  );
  v_pending_purchase := jsonb_set(
    v_pending_purchase,
    '{payment,status}',
    '"pending"'::jsonb
  );
  v_pending_purchase := jsonb_set(
    v_pending_purchase,
    '{order,order_reference}',
    to_jsonb(('pending-order-' || v_suffix)::text)
  );
  v_pending_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-pending-' || v_suffix,
    v_pending_purchase
  );
  v_pending_source_id := (v_pending_response ->> 'purchaseSourceId')::uuid;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_pending_source_id
    and line.line_ordinal = 1;
  if v_pending_response ->> 'transactionState' <> 'pending'
    or v_pending_response ->> 'observationCreated' <> 'false'
    or v_status <> 'not_created'
    or v_reason <> 'transaction_pending'
  then
    raise exception 'pending transaction created an observation: %', v_pending_response;
  end if;

  v_unknown_state_purchase := jsonb_set(
    v_purchase,
    '{order,status}',
    '"unknown"'::jsonb
  );
  v_unknown_state_purchase := jsonb_set(
    v_unknown_state_purchase,
    '{payment,status}',
    '"unknown"'::jsonb
  );
  v_unknown_state_purchase := jsonb_set(
    v_unknown_state_purchase,
    '{order,order_reference}',
    to_jsonb(('unknown-state-order-' || v_suffix)::text)
  );
  v_unknown_state_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-unknown-state-' || v_suffix,
    v_unknown_state_purchase
  );
  v_unknown_state_source_id := (v_unknown_state_response ->> 'purchaseSourceId')::uuid;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_unknown_state_source_id
    and line.line_ordinal = 1;
  if v_unknown_state_response ->> 'transactionState' <> 'unknown'
    or v_unknown_state_response ->> 'observationCreated' <> 'false'
    or v_status <> 'not_created'
    or v_reason <> 'transaction_unknown'
  then
    raise exception 'unknown transaction state created an observation: %', v_unknown_state_response;
  end if;

  v_refunded_purchase := jsonb_set(
    v_purchase,
    '{order,status}',
    '"refunded"'::jsonb
  );
  v_refunded_purchase := jsonb_set(
    v_refunded_purchase,
    '{payment,status}',
    '"refunded"'::jsonb
  );
  v_refunded_purchase := jsonb_set(
    v_refunded_purchase,
    '{order,order_reference}',
    to_jsonb(('refunded-order-' || v_suffix)::text)
  );
  v_refunded_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-refunded-' || v_suffix,
    v_refunded_purchase
  );
  v_refunded_source_id := (v_refunded_response ->> 'purchaseSourceId')::uuid;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_refunded_source_id
    and line.line_ordinal = 1;
  if v_refunded_response ->> 'transactionState' <> 'refunded'
    or v_refunded_response ->> 'observationCreated' <> 'false'
    or v_status <> 'not_created'
    or v_reason <> 'transaction_refunded'
  then
    raise exception 'refunded transaction created a new observation: %', v_refunded_response;
  end if;

  -- Marketplace line sellers are authoritative per line. The third line has
  -- no seller and must remain source-only without rejecting the first two.
  v_multi_seller_purchase := v_purchase - 'seller';
  v_multi_seller_purchase := jsonb_set(
    v_multi_seller_purchase,
    '{order,order_reference}',
    to_jsonb(('multi-seller-order-' || v_suffix)::text)
  );
  v_multi_line := jsonb_set(
    v_purchase -> 'items' -> 0,
    '{seller}',
    jsonb_build_object(
      'seller_name', '__v4-multi-seller-a-' || v_suffix,
      'branch_name', null,
      'source_namespace', 'marketplace-seller',
      'source_code', 'multi-a-' || v_suffix,
      'business_kind', 'retail'
    ),
    true
  );
  v_multi_line_b := jsonb_set(
    jsonb_set(
      v_purchase -> 'items' -> 0,
      '{line_key}',
      to_jsonb(('multi-line-b-' || v_suffix)::text)
    ),
    '{seller}',
    jsonb_build_object(
      'seller_name', '__v4-multi-seller-b-' || v_suffix,
      'branch_name', null,
      'source_namespace', 'marketplace-seller',
      'source_code', 'multi-b-' || v_suffix,
      'business_kind', 'retail'
    ),
    true
  );
  v_multi_line_b := jsonb_set(
    v_multi_line_b,
    '{product,merchant_sku}',
    to_jsonb(('sku-multi-b-' || v_suffix)::text)
  );
  v_multi_line_missing := jsonb_set(
    jsonb_set(
      v_purchase -> 'items' -> 0,
      '{line_key}',
      to_jsonb(('multi-line-missing-' || v_suffix)::text)
    ),
    '{product,merchant_sku}',
    to_jsonb(('sku-multi-missing-' || v_suffix)::text)
  );
  v_multi_seller_purchase := jsonb_set(
    v_multi_seller_purchase,
    '{items}',
    jsonb_build_array(v_multi_line, v_multi_line_b, v_multi_line_missing),
    true
  );
  v_multi_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-multi-seller-' || v_suffix,
    v_multi_seller_purchase
  );
  v_multi_source_id := (v_multi_response ->> 'purchaseSourceId')::uuid;
  select count(*) filter (where line.observation_status = 'created'),
    count(*) filter (where line.observation_status = 'not_created'),
    count(distinct line.line_seller_source_code),
    min(line.observation_reason) filter (where line.observation_status = 'not_created')
  into v_observation_count, v_line_count, v_source_count, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_multi_source_id;
  select source.seller_name, source.seller_status
  into v_status, v_observation_kind
  from public.purchase_price_sources as source
  where source.user_id = v_user_id
    and source.id = v_multi_source_id;
  if v_multi_response ->> 'observationCreated' <> 'true'
    or v_multi_response ->> 'sellerConfirmed' <> 'false'
    or jsonb_array_length(v_multi_response -> 'lineResults') <> 3
    or (v_multi_response -> 'lineResults' -> 0 ->> 'seller')
      <> ('__v4-multi-seller-a-' || v_suffix)
    or (v_multi_response -> 'lineResults' -> 1 ->> 'seller')
      <> ('__v4-multi-seller-b-' || v_suffix)
    or (v_multi_response -> 'lineResults' -> 2 ->> 'observationCreated') <> 'false'
    or (v_multi_response -> 'lineResults' -> 2 ->> 'reason') <> 'seller_unknown'
    or v_observation_count <> 2
    or v_line_count <> 1
    or v_source_count <> 2
    or v_reason <> 'seller_unknown'
    or v_status is not null
    or v_observation_kind <> 'unknown'
  then
    raise exception 'multi-seller line isolation failed: %', v_multi_response;
  end if;
  select count(*) into v_store_count
  from public.stores as store
  where store.user_id = v_user_id
    and store.merchant_name in (
      '__v4-multi-seller-a-' || v_suffix,
      '__v4-multi-seller-b-' || v_suffix
    );
  if v_store_count <> 2 then
    raise exception 'multi-seller retail authorities were not created per seller';
  end if;

  -- Keep the first additive V4 draft readable while making purchase_kind
  -- canonical: an old kind-only caller still resolves to the same semantics.
  v_legacy_kind_purchase := (v_purchase - 'purchase_kind')
    || jsonb_build_object('kind', 'retail_purchase');
  v_legacy_kind_purchase := jsonb_set(
    v_legacy_kind_purchase,
    '{order,order_reference}',
    to_jsonb(('legacy-kind-order-' || v_suffix)::text)
  );
  v_legacy_kind_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-legacy-kind-' || v_suffix,
    v_legacy_kind_purchase
  );
  if v_legacy_kind_response ->> 'kind' <> 'retail_purchase'
    or v_legacy_kind_response ->> 'purchaseKind' <> 'retail'
    or v_legacy_kind_response ->> 'observationCreated' <> 'true'
  then
    raise exception 'legacy V4 kind compatibility failed: %', v_legacy_kind_response;
  end if;

  v_ambiguous_line := jsonb_set(
    v_purchase,
    '{items,0,price_status}',
    '"ambiguous"'::jsonb
  );
  v_ambiguous_line := jsonb_set(
    v_ambiguous_line,
    '{order,order_reference}',
    to_jsonb(('ambiguous-order-' || v_suffix)::text)
  );
  v_ambiguous_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-ambiguous-line-' || v_suffix,
    v_ambiguous_line
  );
  v_ambiguous_source_id := (v_ambiguous_response ->> 'purchaseSourceId')::uuid;
  select line.observation_status, line.observation_reason
  into v_status, v_reason
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_ambiguous_source_id
    and line.line_ordinal = 1;
  if v_ambiguous_response ->> 'observationCreated' <> 'false'
    or v_status <> 'not_created'
    or v_reason <> 'product_price_ambiguous'
  then
    raise exception 'ambiguous product price created an observation';
  end if;

  v_date_only := jsonb_set(v_purchase, '{order,ordered_at}', 'null'::jsonb);
  v_date_only := jsonb_set(
    v_date_only,
    '{order,order_reference}',
    to_jsonb(('date-only-order-' || v_suffix)::text)
  );
  v_date_only_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-date-only-' || v_suffix,
    v_date_only
  );
  v_date_only_source_id := (v_date_only_response ->> 'purchaseSourceId')::uuid;
  select source.ordered_at_exact, source.paid_at_exact,
    observation.observed_at_exact
  into v_ordered_at_exact, v_paid_at_exact, v_observed_at_exact
  from public.purchase_price_sources as source
  inner join public.purchase_price_source_lines as line
    on line.user_id = source.user_id
    and line.purchase_source_id = source.id
  inner join public.price_observations as observation
    on observation.user_id = line.user_id
    and observation.id = line.price_observation_id
  where source.user_id = v_user_id
    and source.id = v_date_only_source_id;
  if v_ordered_at_exact is not null
    or v_paid_at_exact is null
    or v_observed_at_exact is not null
  then
    raise exception 'date-only precision was not preserved';
  end if;

  v_unknown_date := v_purchase - 'order' - 'payment';
  v_unknown_date := jsonb_set(
    v_unknown_date,
    '{order}',
    jsonb_build_object(
      'order_reference', 'unknown-date-order-' || v_suffix,
      'status', 'paid',
      'currency', 'KRW'
    )
  );
  v_unknown_date := jsonb_set(
    v_unknown_date,
    '{payment}',
    jsonb_build_object(
      'status', 'paid',
      'method', 'card',
      'total_price', 1100
    )
  );
  v_unknown_date_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-unknown-date-' || v_suffix,
    v_unknown_date
  );
  v_unknown_date_source_id := (v_unknown_date_response ->> 'purchaseSourceId')::uuid;
  select source.ordered_on, source.ordered_at_exact,
    source.paid_on, source.paid_at_exact,
    line.observation_status, line.observation_reason
  into v_ordered_on, v_ordered_at_exact, v_paid_on, v_paid_at_exact,
    v_status, v_reason
  from public.purchase_price_sources as source
  inner join public.purchase_price_source_lines as line
    on line.user_id = source.user_id
    and line.purchase_source_id = source.id
  where source.user_id = v_user_id
    and source.id = v_unknown_date_source_id
    and line.line_ordinal = 1;
  if v_unknown_date_response ->> 'observationCreated' <> 'false'
    or v_ordered_on is not null
    or v_ordered_at_exact is not null
    or v_paid_on is not null
    or v_paid_at_exact is not null
    or v_status <> 'not_created'
    or v_reason <> 'order_and_payment_date_unknown'
  then
    raise exception 'unknown order/payment dates were not preserved as NULL';
  end if;

  v_delivery_restaurant_id := gen_random_uuid();
  v_delivery_location_id := gen_random_uuid();
  v_delivery_standard_product_id := gen_random_uuid();
  v_delivery_catalog_product_id := gen_random_uuid();
  v_delivery_menu_id := gen_random_uuid();
  insert into public.restaurants (
    id, canonical_name, review_status, status, verification_status,
    created_by, reviewed_by, reviewed_at
  ) values (
    v_delivery_restaurant_id,
    '__v4-delivery-restaurant-' || v_suffix,
    'verified', 'active', 'verified', v_user_id, v_user_id, now()
  );
  insert into public.restaurant_locations (
    id, restaurant_id, source_namespace, source_location_code,
    location_label, review_status, verification_status,
    created_by, reviewed_by, reviewed_at
  ) values (
    v_delivery_location_id,
    v_delivery_restaurant_id,
    'delivery-app', 'location-' || v_suffix, '본점',
    'verified', 'verified', v_user_id, v_user_id, now()
  );
  insert into public.standard_products (
    id, purchase_type, canonical_name, verification_status, status, created_by
  ) values (
    v_delivery_standard_product_id,
    'menu_item', '__v4-delivery-menu-' || v_suffix,
    'verified', 'active', v_user_id
  );
  insert into public.catalog_products (
    id, standard_product_id, purchase_type, canonical_name, specification,
    content_amount, content_unit, package_count, reference_unit,
    specification_status, verification_status, status, created_by
  ) values (
    v_delivery_catalog_product_id,
    v_delivery_standard_product_id,
    'menu_item', '__v4-delivery-menu-' || v_suffix, '1회 제공',
    1, 'each', 1, 100, 'placeholder', 'verified', 'active', v_user_id
  );
  insert into public.restaurant_menus (
    id, restaurant_id, catalog_product_id, canonical_name, serving_label,
    review_status, status, verification_status, created_by, reviewed_by,
    reviewed_at
  ) values (
    v_delivery_menu_id,
    v_delivery_restaurant_id,
    v_delivery_catalog_product_id,
    '__v4-delivery-menu-' || v_suffix,
    '1회 제공', 'verified', 'active', 'verified', v_user_id, v_user_id, now()
  );

  v_delivery_purchase := jsonb_build_object(
    'schema_version', 'purchase-price-observation.v4',
    'contract_version', 'purchase-price.v4',
    'source_app', 'pricetrace_ocr_app',
    'source_version', 'v4-test',
    'purchase_kind', 'restaurant',
    'verification_basis', 'source_evidence',
    'transcription_status', 'user_verified',
    'platform', jsonb_build_object('name', '배달앱', 'code', 'delivery-app'),
    'seller', jsonb_build_object(
      'seller_name', '__v4-delivery-restaurant-' || v_suffix,
      'branch_name', '본점',
      'source_namespace', 'delivery-app',
      'source_code', 'location-' || v_suffix,
      'business_kind', 'food_service'
    ),
    'order', jsonb_build_object(
      'order_reference', 'delivery-order-' || v_suffix,
      'status', 'paid',
      'currency', 'KRW',
      'ordered_on', '2026-09-13'
    ),
    'payment', jsonb_build_object(
      'status', 'paid',
      'method', 'mobile_payment',
      'paid_on', '2026-09-13',
      'total_price', 15000,
      'items_subtotal', 15000,
      'shipping_fee', 0,
      'discount', null
    ),
    'items', jsonb_build_array(jsonb_build_object(
      'line_key', 'delivery-line-1',
      'product', jsonb_build_object(
        'product_name', '__v4-delivery-menu-' || v_suffix,
        'merchant_sku', null
      ),
      'option_text', '1회 제공',
      'price_status', 'itemized',
      'quantity', 1,
      'unit_price', 15000,
      'gross_price', 15000,
      'discount', null,
      'net_price', 15000
    ))
  );
  v_delivery_response := public.ingest_verified_purchase_price_observation_v1(
    'v4-delivery-' || v_suffix,
    v_delivery_purchase
  );
  v_delivery_source_id := (v_delivery_response ->> 'purchaseSourceId')::uuid;
  if v_delivery_response ->> 'kind' <> 'restaurant_purchase'
    or v_delivery_response ->> 'purchaseKind' <> 'restaurant'
    or v_delivery_response ->> 'platform' <> '배달앱'
    or v_delivery_response ->> 'observationCreated' <> 'true'
  then
    raise exception 'delivery-app authority observation was not created: %', v_delivery_response;
  end if;
  select line.observation_status, line.observation_reason,
    line.product_id, line.store_product_id, line.catalog_product_id,
    line.standard_product_id, line.restaurant_menu_manual_observation_id
  into v_status, v_reason, v_product_id, v_store_product_id,
    v_catalog_product_id, v_standard_product_id, v_delivery_manual_observation_id
  from public.purchase_price_source_lines as line
  where line.user_id = v_user_id
    and line.purchase_source_id = v_delivery_source_id
    and line.line_ordinal = 1;
  if v_status <> 'created'
    or v_reason is not null
    or v_product_id is not null
    or v_store_product_id is not null
    or v_catalog_product_id <> v_delivery_catalog_product_id
    or v_standard_product_id <> v_delivery_standard_product_id
    or v_delivery_manual_observation_id is null
  then
    raise exception 'delivery-app line did not reuse exact restaurant authority';
  end if;
  select count(*) into v_observation_count
  from public.restaurant_menu_manual_observations as observation
  where observation.id = v_delivery_manual_observation_id
    and observation.restaurant_id = v_delivery_restaurant_id
    and observation.restaurant_location_id = v_delivery_location_id
    and observation.restaurant_menu_id = v_delivery_menu_id
    and observation.observation_kind = 'standalone_purchase'
    and observation.discount_price_krw is null
    and observation.net_price_krw = 15000;
  select count(*) into v_store_count
  from public.stores as store
  where store.user_id = v_user_id
    and store.merchant_name = '__v4-delivery-restaurant-' || v_suffix;
  if v_observation_count <> 1 or v_store_count <> 0 then
    raise exception 'delivery-app path created the wrong authority rows';
  end if;

  begin
    perform public.ingest_verified_purchase_price_observation_v1(
      'v4-uuid-' || v_suffix,
      v_purchase || jsonb_build_object('store_id', gen_random_uuid())
    );
    raise exception 'V4 accepted a PriceTrace UUID or identity field';
  exception when sqlstate '22023' then
    null;
  end;

  v_v3_purchase := jsonb_build_object(
    'schema_version', 'receipt-independent-price-observation.v3',
    'contract_version', 'price-observation.v3',
    'kind', 'retail_purchase',
    'verification_basis', 'source_evidence',
    'transcription_status', 'user_verified',
    'observed_on', '2026-09-20',
    'currency', 'KRW',
    'gross_price', 1200,
    'discount', null,
    'net_price', 1200,
    'quantity', 2,
    'unit_price', 600,
    'merchant', jsonb_build_object(
      'merchant_name', '__v3-regression-seller-' || v_suffix,
      'branch_name', null,
      'source_namespace', 'v3-regression',
      'source_code', 'seller-' || v_suffix
    ),
    'product', jsonb_build_object(
      'product_client_key', v_candidate_client_key,
      'product_name', v_product_name,
      'merchant_sku', null
    )
  );
  v_v3_response := public.ingest_verified_standalone_price_observation_v1(
    'v3-regression-' || v_suffix,
    v_v3_purchase
  );
  v_observation_id := (v_v3_response ->> 'observationId')::uuid;
  select observation.observation_kind
  into v_observation_kind
  from public.price_observations as observation
  where observation.user_id = v_user_id
    and observation.id = v_observation_id;
  if v_v3_response ->> 'kind' <> 'retail_purchase'
    or v_observation_kind <> 'standalone_purchase'
  then
    raise exception 'V3 standalone regression detected: %', v_v3_response;
  end if;

  select receipt_id into v_receipt_id
  from public.submit_restaurant_receipt_v1(
    'v3-receipt-regression-' || v_suffix,
    'v3-receipt-document-' || v_suffix,
    '__v3-receipt-restaurant-' || v_suffix,
    '본점',
    '2026-09-20'::date,
    5000,
    jsonb_build_array(jsonb_build_object(
      'line_id', 'line-1',
      'description', 'V3 regression menu',
      'quantity', 1,
      'unit_price_krw', 5000,
      'total_price_krw', 5000,
      'line_type', 'main'
    ))
  );
  select item.id, observation.observation_kind
  into v_receipt_item_id, v_observation_kind
  from public.receipt_items as item
  inner join public.price_observations as observation
    on observation.user_id = item.user_id
    and observation.receipt_item_id = item.id
  where item.user_id = v_user_id
    and item.receipt_id = v_receipt_id;
  if v_receipt_item_id is null or v_observation_kind <> 'receipt_purchase' then
    raise exception 'V3 receipt regression detected';
  end if;

  if has_table_privilege('anon', 'public.purchase_price_sources', 'select')
    or has_table_privilege('anon', 'public.purchase_price_source_lines', 'select')
    or has_table_privilege('anon', 'public.purchase_price_observation_ingestion_contents', 'select')
    or has_table_privilege('anon', 'public.purchase_price_observation_ingestion_requests', 'select')
    or has_table_privilege('authenticated', 'public.purchase_price_sources', 'insert')
    or has_table_privilege('authenticated', 'public.purchase_price_sources', 'update')
    or has_table_privilege('authenticated', 'public.purchase_price_sources', 'delete')
    or has_table_privilege('authenticated', 'public.purchase_price_source_lines', 'insert')
    or has_table_privilege('authenticated', 'public.purchase_price_source_lines', 'update')
    or has_table_privilege('authenticated', 'public.purchase_price_source_lines', 'delete')
    or has_table_privilege('authenticated', 'public.purchase_price_observation_ingestion_contents', 'insert')
    or has_table_privilege('authenticated', 'public.purchase_price_observation_ingestion_contents', 'update')
    or has_table_privilege('authenticated', 'public.purchase_price_observation_ingestion_contents', 'delete')
    or has_table_privilege('authenticated', 'public.purchase_price_observation_ingestion_requests', 'insert')
    or has_table_privilege('authenticated', 'public.purchase_price_observation_ingestion_requests', 'update')
    or has_table_privilege('authenticated', 'public.purchase_price_observation_ingestion_requests', 'delete')
    or has_function_privilege(
      'anon',
      'public.ingest_verified_purchase_price_observation_v1(text,jsonb)',
      'execute'
    )
  then
    raise exception 'V4 source/RPC auth grants are too broad';
  end if;
end;
$$;

rollback;
