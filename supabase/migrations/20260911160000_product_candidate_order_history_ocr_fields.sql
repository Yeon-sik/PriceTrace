-- Additive follow-up after the remotely applied 20260911140000 and
-- 20260911150000 migrations. Keep the applied migrations immutable while
-- aligning order_history evidence with the OCR Product Candidate vocabulary.
--
-- The allowlist is deliberately limited to observed product facts:
-- product_name, brand, manufacturer, sub_brand, variant, specification,
-- content_amount, content_unit, package_count, option_text, merchant_sku.
-- Barcodes remain identifiers; no barcode evidence field is introduced.

do $migration$
declare
  v_definition text;
  v_patched_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.submit_product_candidate_v1(text, jsonb)'::pg_catalog.regprocedure
  )
  into v_definition;

  if v_definition is null then
    raise exception 'submit_product_candidate_v1 must exist before the OCR vocabulary follow-up';
  end if;

  v_patched_definition := pg_catalog.regexp_replace(
    v_definition,
    $pattern$'product_name',\s+'option_text',\s+'merchant_sku',\s+'variant',\s+'brand',\s+'manufacturer',\s+'specification',\s+'content_amount',\s+'content_unit',\s+'package_count'$pattern$,
    $replacement$'product_name', 'brand', 'manufacturer', 'sub_brand', 'variant', 'specification', 'content_amount', 'content_unit', 'package_count', 'option_text', 'merchant_sku'$replacement$,
    1,
    1
  );

  if v_patched_definition = v_definition
    or pg_catalog.position(
      $allowlist$'product_name', 'brand', 'manufacturer', 'sub_brand', 'variant', 'specification', 'content_amount', 'content_unit', 'package_count', 'option_text', 'merchant_sku'$allowlist$
      in v_patched_definition
    ) = 0
  then
    raise exception 'submit_product_candidate_v1 did not contain the expected order_history vocabulary';
  end if;

  execute v_patched_definition;
end;
$migration$;

comment on function public.submit_product_candidate_v1(text, jsonb) is
  'Canonical-v3-aware Product Candidate ingest with OCR-aligned order_history evidence. Allowed evidence fields are product_name, brand, manufacturer, sub_brand, variant, specification, content_amount, content_unit, package_count, option_text, and merchant_sku; barcode remains in identifiers.';
