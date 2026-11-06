begin;

do $test$
declare
  v_owner uuid := '00000000-0000-4000-8000-000000000011';
  v_other uuid := '00000000-0000-4000-8000-000000000022';
  v_source uuid;
  v_line uuid;
  v_standard uuid;
  v_catalog uuid;
  v_other_catalog uuid;
  v_original_line jsonb;
  v_context jsonb;
  v_repeat_source uuid;
  v_product_id uuid;
  v_key text;
  v_spec text;
begin
  if has_function_privilege('anon', 'public.get_my_catalog_purchase_context_v1(uuid[],text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.set_my_catalog_purchase_link_v1(uuid,uuid,boolean)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.owner_catalog_purchase_links', 'INSERT')
  then raise exception 'Private purchase permissions were exposed'; end if;

  insert into public.standard_products (purchase_type, canonical_name)
  values ('retail_product', 'OCR purchase link fixture') returning id into v_standard;
  insert into public.catalog_products (
    standard_product_id, purchase_type, canonical_name, specification, specification_status,
    content_amount, content_unit, package_count, listing_reference_url
  ) values (v_standard, 'retail_product', 'Fixture 120', '120정', 'verified', 120, 'each', 1, 'https://example.test/fixture-120')
  returning id into v_catalog;
  insert into public.catalog_products (
    standard_product_id, purchase_type, canonical_name, specification, specification_status,
    content_amount, content_unit, package_count, listing_reference_url
  ) values (v_standard, 'retail_product', 'Fixture 240', '240정', 'verified', 240, 'each', 1, 'https://example.test/fixture-240')
  returning id into v_other_catalog;

  insert into public.purchase_price_sources (
    user_id, schema_version, contract_version, source_app, kind, purchase_kind, platform_name,
    order_status, ordered_on, payment_status, payment_method, payment_total_price_krw,
    source_fingerprint, source_payload, transaction_state
  ) values (
    v_owner, 'purchase-price-observation.v4', 'purchase-price.v4', 'pricetrace_ocr_app',
    'retail_purchase', 'retail', '주문 채널', 'delivered', '2025-01-02', 'paid', 'card', 10000,
    repeat('a', 64), '{}', 'settled'
  ) returning id into v_source;
  insert into public.purchase_price_source_lines as line (
    user_id, purchase_source_id, line_ordinal, source_line_key, product_client_key, product_name,
    price_status, quantity, unit_price_krw, gross_price_krw, observation_status, observation_reason, line_payload
  ) values (v_owner, v_source, 1, 'line-1', 'fixture-product-key', 'OCR 120정 구매',
    'itemized', 1, 13000, 13000, 'not_created', 'seller_unknown', '{}')
  returning id, to_jsonb(line) into v_line, v_original_line;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.get_my_catalog_purchase_context_v1(array[v_catalog], '120정')) then
    raise exception 'Non-owner search revealed the purchase';
  end if;
  begin
    perform public.set_my_catalog_purchase_link_v1(v_catalog, v_line, true);
    raise exception 'Non-owner write succeeded';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select to_jsonb(row) into strict v_context from public.get_my_catalog_purchase_context_v1(array[v_catalog], '120정') as row;
  if v_context ->> 'catalog_product_id' is not null or v_context ->> 'purchase_source_line_id' <> v_line::text then
    raise exception 'Unlinked purchase is not selectable';
  end if;
  perform public.set_my_catalog_purchase_link_v1(v_catalog, v_line, true);
  perform public.set_my_catalog_purchase_link_v1(v_catalog, v_line, true);
  begin
    perform public.set_my_catalog_purchase_link_v1(v_other_catalog, v_line, true);
    raise exception 'The same purchase was reassigned';
  exception when unique_violation then null; end;

  select to_jsonb(row) into strict v_context from public.get_my_catalog_purchase_context_v1(array[v_catalog]) as row;
  if v_context ->> 'catalog_product_id' <> v_catalog::text or v_context ->> 'owner_connected' <> 'true'
    or v_context ->> 'unit_price_krw' <> '13000' or v_context ->> 'order_total_krw' <> '10000'
    or v_context ->> 'item_net_price_krw' is not null or v_context ->> 'seller_name' is not null
  then raise exception 'Connection did not preserve separate source facts'; end if;
  if exists (select 1 from public.get_my_catalog_purchase_context_v1(array[v_catalog], '120정')) then
    raise exception 'Connected purchase is still an unlinked candidate';
  end if;
  if (select to_jsonb(line) from public.purchase_price_source_lines line where id = v_line) is distinct from v_original_line
    or exists (select 1 from public.price_observations where catalog_product_id = v_catalog)
  then raise exception 'Owner link changed the source or created a price observation'; end if;

  perform public.set_my_catalog_purchase_link_v1(v_catalog, v_line, false);
  if exists (select 1 from public.get_my_catalog_purchase_context_v1(array[v_catalog])) then
    raise exception 'Unlink failed';
  end if;

  insert into public.purchase_price_sources (
    user_id, schema_version, contract_version, source_app, kind, purchase_kind, platform_name,
    order_status, ordered_on, payment_status, payment_method, payment_total_price_krw,
    source_fingerprint, source_payload, transaction_state
  ) values (v_owner, 'purchase-price-observation.v4', 'purchase-price.v4', 'pricetrace_ocr_app',
    'retail_purchase', 'retail', '주문 채널', 'delivered', '2025-03-01', 'paid', 'card', 23000,
    repeat('b', 64), '{}', 'settled')
  returning id into v_repeat_source;
  for v_key, v_spec in values ('fixture-product-key','120정'), ('repeat-key','120정'), ('different-key','240정') loop
    insert into public.product_identity_candidates (
      user_id, schema_version, contract_version, source_app, candidate_type, product_name, client_key,
      identifiers, evidence, provenance, request_payload
    ) values (v_owner, 'PRICETRACE_PRODUCT_CANDIDATE', 'product-candidate.v1', 'pricetrace_ocr_app',
      'retail_product', 'Fixture ' || v_spec, v_key, '[]', '[]', '{}', '{}')
    returning id into v_product_id;
    insert into public.product_candidate_authority_projections (
      user_id, client_key, request_fingerprint, candidate_id, resolution_status, source_payload
    ) values (v_owner, v_key, repeat('a', 64), v_product_id, 'private_unverified_candidate_created', '{}');
  end loop;
  insert into public.purchase_price_source_lines (
    user_id, purchase_source_id, line_ordinal, source_line_key, product_client_key, product_name,
    price_status, quantity, unit_price_krw, observation_status, observation_reason, line_payload
  ) values
    (v_owner, v_repeat_source, 1, 'line-2', 'repeat-key', 'OCR 120정 구매', 'itemized', 2, 11500, 'not_created', 'seller_unknown', '{}'),
    (v_owner, v_repeat_source, 2, 'line-3', 'different-key', 'OCR 120정 구매', 'itemized', 1, 15000, 'not_created', 'seller_unknown', '{}');
  perform public.set_my_catalog_purchase_link_v1(v_catalog, v_line, true);
  select to_jsonb(row) into strict v_context from public.get_my_catalog_purchase_context_v1(array[v_catalog]) as row
    where product_client_key = 'repeat-key';
  if v_context ->> 'unit_price_krw' <> '11500' or v_context ->> 'order_line_count' <> '2'
    or exists (select 1 from public.get_my_catalog_purchase_context_v1(array[v_catalog]) where product_client_key = 'different-key')
    or (select count(*) from public.owner_catalog_purchase_links where user_id = v_owner) <> 1
  then raise exception 'Repeat order lost its own prices or reused a different variant'; end if;
  if (select count(*) from public.get_my_catalog_purchase_context_v1(array[v_catalog], '120정')) <> 1 then
    raise exception 'Only the unmatched variant should require a manual selection';
  end if;
  perform public.set_my_catalog_purchase_link_v1(v_catalog, v_line, false);
  if exists (select 1 from public.get_my_catalog_purchase_context_v1(array[v_catalog])) then
    raise exception 'Removing the owner confirmation must revoke automatic reuse';
  end if;
end;
$test$;

select 'OWNER_CATALOG_PURCHASE_LINK_PASS' as result;
rollback;
