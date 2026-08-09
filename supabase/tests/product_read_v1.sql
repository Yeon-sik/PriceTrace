-- Run after the migration in a linked SQL editor or local Supabase database.
-- The probe is read-only outside this transaction and rolls back all fixtures.
begin;

do $probe$
declare
  v_standard_product_id uuid := '91000000-0000-4000-8000-000000000001';
  v_catalog_product_id uuid := '91000000-0000-4000-8000-000000000002';
  v_payload jsonb;
  v_product jsonb;
  v_observation jsonb;
begin
  insert into public.standard_products (
    id,
    purchase_type,
    canonical_name,
    status
  ) values (
    v_standard_product_id,
    'retail_product',
    '__product_read_probe_family',
    'active'
  );

  insert into public.catalog_products (
    id,
    standard_product_id,
    purchase_type,
    canonical_name,
    specification,
    specification_status,
    content_amount,
    content_unit,
    package_count,
    reference_unit,
    listing_reference_url,
    status
  ) values (
    v_catalog_product_id,
    v_standard_product_id,
    'retail_product',
    '__product_read_probe_variant',
    '100g',
    'verified',
    100,
    'g',
    1,
    100,
    'https://example.com/product-read-probe',
    'active'
  );

  insert into public.source_product_mappings (
    source_label,
    source_product_code,
    catalog_product_id,
    matching_method,
    confidence,
    review_status
  ) values (
    '__product_read_probe_seller',
    '__product_read_probe_code',
    v_catalog_product_id,
    'manual',
    1,
    'verified'
  );

  insert into public.market_price_observations (
    catalog_product_id,
    seller_name,
    product_url,
    listed_price_krw,
    shipping_fee_krw,
    minimum_order_quantity,
    observed_at,
    verification_status
  ) values (
    v_catalog_product_id,
    '__product_read_probe_seller',
    'https://example.com/product-read-probe-offer',
    1000,
    500,
    2,
    '2026-08-09T01:00:00+00:00',
    'verified'
  );

  select public.get_product_read_v1(v_catalog_product_id, null, 1)
  into v_payload;

  if v_payload ->> 'schemaVersion' <> 'product-read.v1'
    or v_payload ->> 'namespace' <> 'pricetrace'
    or coalesce(v_payload ->> 'revision', '') !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_array_length(v_payload -> 'products') <> 1
  then
    raise exception 'product-read.v1 envelope contract failed: %', v_payload;
  end if;

  v_product := v_payload -> 'products' -> 0;
  if v_product #>> '{standardProduct,id}' <> v_standard_product_id::text
    or v_product #>> '{catalogProduct,id}' <> v_catalog_product_id::text
    or coalesce(v_product ->> 'revision', '') !~ '^sha256:[a-f0-9]{64}$'
    or v_product #>> '{sellerProducts,0,sellerLabel}' <> '__product_read_probe_seller'
  then
    raise exception 'product-read.v1 exact product contract failed: %', v_product;
  end if;

  v_observation := v_product -> 'observations' -> 0;
  if v_observation ->> 'sellerLabel' <> '__product_read_probe_seller'
    or (v_observation ->> 'listedPriceKrw')::integer <> 1000
    or (v_observation ->> 'checkoutPriceKrw')::integer <> 2500
    or v_observation ->> 'source' <> 'verified-market-observation'
  then
    raise exception 'product-read.v1 observation contract failed: %', v_observation;
  end if;
end;
$probe$;

rollback;
