-- Exercises the public receipt RPC with new and existing merchant SKUs.
-- Synthetic fixtures only; all writes are rolled back.
begin;

do $test$
declare
  v_user_id uuid := gen_random_uuid();
  v_other_user_id uuid := gen_random_uuid();
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_kind text;
  v_receipt jsonb;
  v_first jsonb;
  v_result jsonb;
  v_product_id uuid;
  v_store_product_id uuid;
  v_store_id uuid;
begin
  insert into auth.users(id) values (v_user_id), (v_other_user_id);

  foreach v_kind in array array['retail', 'food_service'] loop
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);

    v_receipt := jsonb_build_object(
      'schema_version', 'receipt.v2',
      'document', jsonb_build_object(
        'id', null, 'type', 'receipt', 'status', 'final', 'currency', 'KRW',
        'issued_on', '2026-10-21', 'issued_at', null,
        'source', jsonb_build_object(
          'original_document_id', 'sku-new-' || v_kind || v_suffix,
          'transcription_status', 'user_verified', 'source_images', '[]'::jsonb,
          'raw_text', null, 'capture_method', 'ocr'
        ),
        'fulfillment', jsonb_build_object('type', 'unknown', 'evidence', 'unknown')
      ),
      'merchant', jsonb_build_object(
        'name', 'SKU fixture ' || v_kind || v_suffix, 'branch_name', null,
        'business_kind', v_kind, 'retail_channel', 'regular',
        'catalog_namespace', null, 'merchant_id', null,
        'business_registration_number', null, 'address', null, 'phone', null
      ),
      'line_items', jsonb_build_array(jsonb_build_object(
        'id', 'line-001', 'type', 'product', 'description', 'SKU item ' || v_kind || v_suffix,
        'source_line_references', jsonb_build_array('line-001'),
        'identifiers', jsonb_build_array(jsonb_build_object('scheme', 'merchant_sku', 'value', '000002')),
        'quantity', jsonb_build_object('value', 1, 'unit', 'each'),
        'unit_price_amount_minor', 12000, 'gross_amount_minor', 12000,
        'discount_amount_minor', 0, 'tax_amount_minor', null, 'net_amount_minor', 12000,
        'confidence', 'user_verified', 'tax_rate_percent', null,
        'food_service', case when v_kind = 'food_service'
          then jsonb_build_object('role', 'main', 'applies_to_line_id', null)
          else null end
      )),
      'totals', jsonb_build_object(
        'items_gross_amount_minor', 12000, 'discount_amount_minor', 0,
        'tax_amount_minor', null, 'fee_amount_minor', null, 'tip_amount_minor', null,
        'rounding_amount_minor', null, 'grand_total_amount_minor', 12000
      ),
      'payments', jsonb_build_array(jsonb_build_object(
        'method', 'card', 'amount_minor', 12000, 'status', 'paid', 'reference', null
      ))
    );

    -- A previously unseen SKU must retain the newly created private product ID.
    v_first := public.submit_verified_receipt_v2('sku-new-' || v_kind || v_suffix, v_receipt);
    v_product_id := (v_first #>> '{lines,0,productId}')::uuid;
    v_store_product_id := (v_first #>> '{lines,0,storeProductId}')::uuid;
    v_store_id := (v_first ->> 'storeId')::uuid;
    if v_product_id is null or v_store_product_id is null or not exists (
      select 1 from public.store_products
      where user_id = v_user_id and id = v_store_product_id
        and store_id = v_store_id and product_id = v_product_id
        and store_product_code = '000002'
    ) then raise exception 'new SKU lost its private product identity: %', v_kind; end if;

    -- Retrying the same request or content must preserve the stored references.
    v_result := public.submit_verified_receipt_v2('sku-new-' || v_kind || v_suffix, v_receipt);
    if v_result ->> 'replayed' is distinct from 'true'
      or v_result ->> 'receiptId' is distinct from v_first ->> 'receiptId'
      or v_result #>> '{lines,0,storeProductId}' is distinct from v_store_product_id::text
    then raise exception 'SKU receipt replay changed identity: %', v_kind; end if;
    v_result := public.submit_verified_receipt_v2('sku-dedup-' || v_kind || v_suffix, v_receipt);
    if v_result ->> 'deduplicated' is distinct from 'true'
      or v_result ->> 'receiptId' is distinct from v_first ->> 'receiptId'
    then raise exception 'SKU receipt content deduplication changed: %', v_kind; end if;

    -- A different receipt for an existing SKU must reuse the same mapping.
    v_receipt := jsonb_set(v_receipt, '{document,source,original_document_id}',
      to_jsonb('sku-existing-' || v_kind || v_suffix));
    v_receipt := jsonb_set(v_receipt, '{line_items,0,description}',
      to_jsonb('Printed alias ' || v_kind || v_suffix));
    v_result := public.submit_verified_receipt_v2('sku-existing-' || v_kind || v_suffix, v_receipt);
    if v_result ->> 'receiptId' is not distinct from v_first ->> 'receiptId'
      or v_result #>> '{lines,0,productId}' is distinct from v_product_id::text
      or v_result #>> '{lines,0,storeProductId}' is distinct from v_store_product_id::text
      or (select count(*) from public.store_products
          where user_id = v_user_id and store_id = v_store_id and store_product_code = '000002') <> 1
    then raise exception 'existing SKU was not reused: %', v_kind; end if;

    -- An existing private product with a new SKU must retain that product ID too.
    v_receipt := jsonb_set(v_receipt, '{document,source,original_document_id}',
      to_jsonb('sku-second-' || v_kind || v_suffix));
    v_receipt := jsonb_set(v_receipt, '{line_items,0,description}',
      to_jsonb('SKU item ' || v_kind || v_suffix));
    v_receipt := jsonb_set(v_receipt, '{line_items,0,identifiers,0,value}', '"000003"'::jsonb);
    v_result := public.submit_verified_receipt_v2('sku-second-' || v_kind || v_suffix, v_receipt);
    if v_result #>> '{lines,0,productId}' is distinct from v_product_id::text
      or not exists (select 1 from public.store_products
          where user_id = v_user_id and store_id = v_store_id and product_id = v_product_id
            and store_product_code = '000003')
    then raise exception 'new SKU lost an existing private product ID: %', v_kind; end if;

    -- Absence of a SKU remains supported and does not erase the private ID.
    v_receipt := jsonb_set(v_receipt, '{document,source,original_document_id}',
      to_jsonb('sku-none-' || v_kind || v_suffix));
    v_receipt := jsonb_set(v_receipt, '{line_items,0,identifiers}', '[]'::jsonb);
    v_result := public.submit_verified_receipt_v2('sku-none-' || v_kind || v_suffix, v_receipt);
    if v_result #>> '{lines,0,productId}' is distinct from v_product_id::text
    then raise exception 'SKU-less receipt lost its product ID: %', v_kind; end if;

    -- The same merchant/SKU facts for another owner must create owner-local IDs.
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_other_user_id, 'role', 'authenticated')::text, true);
    v_receipt := jsonb_set(v_receipt, '{line_items,0,identifiers}',
      jsonb_build_array(jsonb_build_object('scheme', 'merchant_sku', 'value', '000002')));
    v_result := public.submit_verified_receipt_v2('sku-other-owner-' || v_kind || v_suffix, v_receipt);
    if v_result #>> '{lines,0,productId}' is null
      or v_result #>> '{lines,0,productId}' = v_product_id::text
      or v_result #>> '{lines,0,storeProductId}' = v_store_product_id::text
      or not exists (select 1 from public.store_products
          where user_id = v_other_user_id
            and id = (v_result #>> '{lines,0,storeProductId}')::uuid
            and product_id = (v_result #>> '{lines,0,productId}')::uuid)
    then raise exception 'SKU identity crossed owner boundaries: %', v_kind; end if;
  end loop;

  if has_function_privilege('anon', 'public.submit_verified_receipt_v2(text,jsonb)', 'execute')
    or not has_function_privilege('authenticated', 'public.submit_verified_receipt_v2(text,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.submit_verified_receipt_v2_legacy(text,jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.submit_verified_receipt_v2_legacy(text,jsonb)', 'execute')
  then raise exception 'SKU repair changed the public/legacy RPC permission boundary'; end if;
end;
$test$;

select 'VERIFIED_RECEIPT_SKU_IDENTITY_PASS' as result;
rollback;
