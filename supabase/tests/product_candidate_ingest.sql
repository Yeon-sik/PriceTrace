-- Run after 20260906090000_product_candidate_ingest.sql in a linked SQL
-- editor or local Supabase database. All fixture writes are rolled back.

begin;

do $$
declare
  v_user_id uuid;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_standard_product_id uuid := '92000000-0000-4000-8000-000000000001';
  v_catalog_product_id uuid := '92000000-0000-4000-8000-000000000002';
  v_existing jsonb;
  v_candidate jsonb;
  v_new jsonb;
  v_side jsonb;
  v_estimate jsonb;
  v_conflict jsonb;
  v_candidate_id uuid;
  v_restaurant_menu_count integer;
  v_public_standard_count integer;
  v_public_catalog_count integer;
begin
  select id into v_user_id from auth.users order by created_at limit 1;
  if v_user_id is null then
    raise exception 'product candidate integration test requires one auth.users fixture';
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

  insert into public.standard_products (
    id,
    purchase_type,
    canonical_name,
    brand,
    category_id,
    verification_status,
    status
  ) values (
    v_standard_product_id,
    'retail_product',
    '__candidate_probe_family_' || v_suffix,
    '__candidate_probe_brand_' || v_suffix,
    (
      select id
      from public.catalog_categories
      where purchase_type = 'retail_product'
        and slug = 'processed-food'
      limit 1
    ),
    'verified',
    'active'
  );

  insert into public.catalog_products (
    id,
    standard_product_id,
    purchase_type,
    canonical_name,
    brand,
    specification,
    content_amount,
    content_unit,
    package_count,
    reference_unit,
    specification_status,
    verification_status,
    status
  ) values (
    v_catalog_product_id,
    v_standard_product_id,
    'retail_product',
    '__candidate_probe_variant_' || v_suffix,
    '__candidate_probe_brand_' || v_suffix,
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
    catalog_product_id,
    identifier_scheme,
    identifier_value,
    verification_status,
    provenance,
    reviewed_by,
    reviewed_at
  ) values (
    v_catalog_product_id,
    'ean',
    '8800000000000',
    'verified',
    jsonb_build_object('sourceType', 'manufacturer', 'sourceRef', '__candidate_probe_' || v_suffix),
    v_user_id,
    now()
  );

  v_candidate := jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'source_version', 'test',
      'candidate_type', 'retail_product',
      'product_name', '__candidate_probe_variant_' || v_suffix,
      'brand', '__candidate_probe_brand_' || v_suffix,
      'manufacturer', '__candidate_probe_manufacturer_' || v_suffix,
      'specification', '500g',
      'content_amount', 500,
      'content_unit', 'g',
      'package_count', 1,
      'variant', null,
      'identifiers', jsonb_build_array(jsonb_build_object('scheme', 'ean', 'value', '8800000000000')),
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'product_photo',
        'source_ref', 'capture:' || v_suffix,
        'field', 'product_name',
        'observed_value', '__candidate_probe_variant_' || v_suffix,
        'content_hash', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      )),
      'provenance', jsonb_build_object(
        'capture_id', 'capture:' || v_suffix,
        'capture_content_hash', 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'extraction_method', 'gpt_vision',
        'extractor', 'integration-test',
        'extractor_version', '1',
        'observed_at', '2026-09-06T00:00:00Z',
        'source_revision', 'candidate-test'
      ),
      'nutrition_food_id', 'fitness-food-' || v_suffix
  );
  v_existing := public.submit_product_candidate_v1(
    'candidate-existing-' || v_suffix,
    v_candidate
  );

  if v_existing ->> 'outcome' <> 'catalog_product_reused'
    or (v_existing ->> 'catalogProductId')::uuid <> v_catalog_product_id
    or (v_existing ->> 'standardProductId')::uuid <> v_standard_product_id
    or v_existing ->> 'candidateId' is not null
    or (v_existing ->> 'restaurantMenuCandidateCreated')::boolean is not false
    or v_existing #>> '{nutritionHandoff,status}' <> 'ready_for_existing_proposal_flow'
    or v_existing #>> '{nutritionHandoff,nutritionFoodId}' <> ('fitness-food-' || v_suffix)
  then
    raise exception 'verified exact catalog identity was not safely reused: %', v_existing;
  end if;

  begin
    perform public.submit_product_candidate_v1(
      'candidate-existing-' || v_suffix,
      jsonb_set(v_candidate, '{source_version}', '"tampered"'::jsonb)
    );
    raise exception 'idempotency key accepted a different product candidate payload';
  exception
    when unique_violation then
      null;
  end;
end;
$$;

do $$
declare
  v_user_id uuid;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_new jsonb;
  v_replayed jsonb;
  v_deduplicated jsonb;
  v_candidate_id uuid;
  v_candidate_count integer;
  v_standard_count integer;
  v_catalog_count integer;
begin
  select id into v_user_id from auth.users order by created_at limit 1;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user_id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('role', 'user')
    )::text,
    true
  );

  v_new := public.submit_product_candidate_v1(
    'candidate-new-' || v_suffix,
    jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'candidate_type', 'retail_product',
      'product_name', '__candidate_new_' || v_suffix,
      'brand', '__candidate_new_brand_' || v_suffix,
      'manufacturer', null,
      'specification', null,
      'content_amount', null,
      'content_unit', null,
      'package_count', null,
      'variant', 'unknown-variant',
      'identifiers', '[]'::jsonb,
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'product_photo',
        'source_ref', 'capture:' || v_suffix,
        'field', 'product_name',
        'observed_value', '__candidate_new_' || v_suffix
      )),
      'provenance', jsonb_build_object(
        'extraction_method', 'ocr',
        'capture_id', 'capture:' || v_suffix
      )
    )
  );

  if v_new ->> 'outcome' <> 'private_unverified_candidate_created'
    or (v_new ->> 'candidateId') is null
    or v_new ->> 'catalogProductId' is not null
    or v_new ->> 'standardProductId' is not null
    or v_new ->> 'verificationStatus' <> 'unverified'
    or v_new ->> 'reviewStatus' <> 'pending'
    or (v_new ->> 'restaurantMenuCandidateCreated')::boolean is not false
  then
    raise exception 'new product candidate did not remain private and unverified: %', v_new;
  end if;

  v_candidate_id := (v_new ->> 'candidateId')::uuid;
  select count(*) into v_candidate_count
  from public.product_identity_candidates
  where id = v_candidate_id
    and user_id = v_user_id
    and verification_status = 'unverified'
    and visibility = 'private'
    and review_status = 'pending';
  if v_candidate_count <> 1 then
    raise exception 'private unverified candidate row was not persisted';
  end if;

  select count(*) into v_standard_count
  from public.standard_products
  where canonical_name = '__candidate_new_' || v_suffix;
  select count(*) into v_catalog_count
  from public.catalog_products
  where canonical_name = '__candidate_new_' || v_suffix;
  if v_standard_count <> 0 or v_catalog_count <> 0 then
    raise exception 'OCR candidate created a public standard/catalog row';
  end if;

  v_replayed := public.submit_product_candidate_v1(
    'candidate-new-' || v_suffix,
    jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'candidate_type', 'retail_product',
      'product_name', '__candidate_new_' || v_suffix,
      'brand', '__candidate_new_brand_' || v_suffix,
      'manufacturer', null,
      'specification', null,
      'content_amount', null,
      'content_unit', null,
      'package_count', null,
      'variant', 'unknown-variant',
      'identifiers', '[]'::jsonb,
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'product_photo',
        'source_ref', 'capture:' || v_suffix,
        'field', 'product_name',
        'observed_value', '__candidate_new_' || v_suffix
      )),
      'provenance', jsonb_build_object(
        'extraction_method', 'ocr',
        'capture_id', 'capture:' || v_suffix
      )
    )
  );
  if (v_replayed ->> 'candidateId')::uuid <> v_candidate_id
    or (v_replayed ->> 'replayed') <> 'true'
    or (v_replayed ->> 'deduplicated') <> 'true'
  then
    raise exception 'same idempotency key did not replay the private candidate';
  end if;

  v_deduplicated := public.submit_product_candidate_v1(
    'candidate-new-alt-' || v_suffix,
    jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'candidate_type', 'retail_product',
      'product_name', '__candidate_new_' || v_suffix,
      'brand', '__candidate_new_brand_' || v_suffix,
      'manufacturer', null,
      'specification', null,
      'content_amount', null,
      'content_unit', null,
      'package_count', null,
      'variant', 'unknown-variant',
      'identifiers', '[]'::jsonb,
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'product_photo',
        'source_ref', 'capture:' || v_suffix,
        'field', 'product_name',
        'observed_value', '__candidate_new_' || v_suffix
      )),
      'provenance', jsonb_build_object(
        'extraction_method', 'ocr',
        'capture_id', 'capture:' || v_suffix
      )
    )
  );
  if (v_deduplicated ->> 'candidateId')::uuid <> v_candidate_id
    or (v_deduplicated ->> 'replayed') <> 'false'
    or (v_deduplicated ->> 'deduplicated') <> 'true'
  then
    raise exception 'same product payload with another key was not content-deduplicated';
  end if;
end;
$$;

do $$
declare
  v_user_id uuid;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_side jsonb;
  v_estimate jsonb;
  v_conflict jsonb;
  v_restaurant_menu_count integer;
begin
  select id into v_user_id from auth.users order by created_at limit 1;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user_id,
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('role', 'user')
    )::text,
    true
  );

  v_side := public.submit_product_candidate_v1(
    'candidate-side-' || v_suffix,
    jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'candidate_type', 'complimentary_side',
      'product_name', '__complimentary_side_' || v_suffix,
      'brand', null,
      'manufacturer', null,
      'specification', null,
      'content_amount', null,
      'content_unit', null,
      'package_count', null,
      'variant', null,
      'identifiers', '[]'::jsonb,
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'receipt',
        'source_ref', 'line:' || v_suffix,
        'field', 'candidate_type',
        'observed_value', 'complimentary_side'
      )),
      'provenance', jsonb_build_object('extraction_method', 'mixed')
    )
  );
  if v_side ->> 'outcome' <> 'review_required'
    or v_side ->> 'reviewStatus' <> 'review_required'
    or v_side -> 'reviewReasons' ? 'semantic_candidate_is_not_a_retail_product' is not true
    or (v_side ->> 'restaurantMenuCandidateCreated')::boolean is not false
  then
    raise exception 'complimentary_side was not routed to private review: %', v_side;
  end if;

  v_estimate := public.submit_product_candidate_v1(
    'candidate-estimate-' || v_suffix,
    jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'candidate_type', 'meal_component_estimate',
      'product_name', '__meal_component_estimate_' || v_suffix,
      'brand', null,
      'manufacturer', null,
      'specification', null,
      'content_amount', null,
      'content_unit', null,
      'package_count', null,
      'variant', null,
      'identifiers', '[]'::jsonb,
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'ocr',
        'source_ref', 'meal:' || v_suffix,
        'field', 'candidate_type',
        'observed_value', 'meal_component_estimate'
      )),
      'provenance', jsonb_build_object('extraction_method', 'gpt_vision')
    )
  );
  if v_estimate ->> 'outcome' <> 'review_required'
    or v_estimate -> 'reviewReasons' ? 'semantic_candidate_is_not_a_retail_product' is not true
    or (v_estimate ->> 'restaurantMenuCandidateCreated')::boolean is not false
  then
    raise exception 'meal_component_estimate was not routed to private review: %', v_estimate;
  end if;

  select count(*) into v_restaurant_menu_count
  from public.restaurant_menus
  where canonical_name in (
    '__complimentary_side_' || v_suffix,
    '__meal_component_estimate_' || v_suffix
  );
  if v_restaurant_menu_count <> 0 then
    raise exception 'meal semantic candidate created a RestaurantMenu row';
  end if;

  v_conflict := public.submit_product_candidate_v1(
    'candidate-conflict-' || v_suffix,
    jsonb_build_object(
      'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
      'contract_version', 'product-candidate.v1',
      'source_app', 'pricetrace_ocr_app',
      'candidate_type', 'retail_product',
      'product_name', '__different-name-' || v_suffix,
      'brand', null,
      'manufacturer', null,
      'specification', null,
      'content_amount', 500,
      'content_unit', 'g',
      'package_count', 1,
      'variant', null,
      'identifiers', jsonb_build_array(jsonb_build_object('scheme', 'ean', 'value', '8800000000000')),
      'evidence', jsonb_build_array(jsonb_build_object(
        'source_type', 'package_label',
        'source_ref', 'capture:conflict-' || v_suffix,
        'field', 'product_name',
        'observed_value', '__different-name-' || v_suffix
      )),
      'provenance', jsonb_build_object('extraction_method', 'ocr')
    )
  );
  if v_conflict ->> 'outcome' <> 'review_required'
    or v_conflict -> 'reviewReasons' ? 'identifier_name_conflict' is not true
    or v_conflict ->> 'catalogProductId' is not null
  then
    raise exception 'conflicting verified barcode was not review-gated: %', v_conflict;
  end if;

  begin
    perform public.submit_product_candidate_v1(
      'candidate-forbidden-' || v_suffix,
      jsonb_build_object(
        'schema_version', 'PRICETRACE_PRODUCT_CANDIDATE',
        'contract_version', 'product-candidate.v1',
        'source_app', 'pricetrace_ocr_app',
        'candidate_type', 'retail_product',
        'product_name', '__forbidden-' || v_suffix,
        'catalog_product_id', gen_random_uuid(),
        'identifiers', '[]'::jsonb,
        'evidence', jsonb_build_array(jsonb_build_object(
          'source_type', 'product_photo',
          'source_ref', 'capture:forbidden-' || v_suffix,
          'field', 'product_name'
        )),
        'provenance', jsonb_build_object('extraction_method', 'ocr')
      )
    );
    raise exception 'client-supplied PriceTrace identity was accepted';
  exception
    when sqlstate '22023' then null;
  end;
end;
$$;

rollback;
