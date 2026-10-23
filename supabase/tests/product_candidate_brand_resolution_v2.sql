begin;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011","app_metadata":{}}',true);
do $$
declare
  root uuid:=gen_random_uuid(); child uuid:=gen_random_uuid(); leaf uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  payload jsonb; sibling jsonb; original jsonb; original_graph jsonb; original_catalog jsonb; fingerprint text;
begin
  insert into public.brands(id,canonical_name,parent_brand_id) values(root,'PCBR Root',null),(other,'PCBR Other',null);
  insert into public.brands(id,canonical_name,parent_brand_id) values(child,'PCBR Child',root);
  insert into public.brands(id,canonical_name,parent_brand_id) values(leaf,'PCBR Leaf',child);
  select jsonb_agg(to_jsonb(b) order by id) into original_graph from public.brands b;
  select jsonb_build_object('standard',(select jsonb_agg(to_jsonb(s) order by id) from public.standard_products s),
    'catalog',(select jsonb_agg(to_jsonb(c) order by id) from public.catalog_products c)) into original_catalog;
  payload:=jsonb_build_object('schema_version','PRICETRACE_PRODUCT_CANDIDATE','contract_version','product-candidate.v1',
    'source_app','pricetrace_ocr_app','candidate_type','retail_product','client_key','pcbr-revision-a',
    'product_name','PCBR Product','brand','observed brand','sub_brand','observed sub',
    'identifiers','[]'::jsonb,'evidence',jsonb_build_array(jsonb_build_object('source_type','product_photo',
    'source_ref','capture:pcbr','field','product_name','observed_value','PCBR Product')),
    'provenance',jsonb_build_object('extraction_method','ocr','capture_id','capture:pcbr'));
  perform public.submit_product_candidate_v1('pcbr-ingest-a',payload);
  select source_payload,request_fingerprint into original,fingerprint from public.product_candidate_authority_projections where client_key='pcbr-revision-a';
  execute 'set local role anon';
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',root,true);
    raise exception 'anon allowed'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.product_candidate_brand_resolutions;
    raise exception 'anon private read allowed'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',root,true);
    raise exception 'unauthenticated allowed'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000022"}',true);
  execute 'set local role authenticated';
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a')) then raise exception 'cross owner read'; end if;
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',root,true);
    raise exception 'cross owner mutation'; exception when foreign_key_violation then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011"}',true);
  execute 'set local role authenticated';
  begin perform public.set_product_candidate_brand_resolution_v2('missing','brand','observed brand',root,true);
    raise exception 'missing authority allowed'; exception when foreign_key_violation then null; end;
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','manufacturer','observed brand',root,true);
    raise exception 'manufacturer allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','stale',root,true);
    raise exception 'stale allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','',root,true);
    raise exception 'blank allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',root,false);
    raise exception 'unverified allowed'; exception when invalid_parameter_value then null; end;
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand',' observed brand ',root,true);
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',root,true);
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','sub_brand','observed sub',leaf,true);
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a') where pair_relationship<>'descendant' or not pair_relationship_valid or requires_review) then raise exception 'deep descendant status'; end if;
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','sub_brand','observed sub',root,true);
  if (select count(*) from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a') where pair_relationship='same_brand' and pair_relationship_valid and not requires_review)<>2 then raise exception 'same brand failed'; end if;
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','sub_brand','observed sub',leaf,true);
  execute 'reset role';
  update public.brands set parent_brand_id=other where id=leaf;
  execute 'set local role authenticated';
  if (select count(*) from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a') where pair_relationship='hierarchy_conflict' and not pair_relationship_valid and requires_review)<>2 then raise exception 'drift not exposed'; end if;
  execute 'reset role'; update public.brands set parent_brand_id=child where id=leaf;
  execute 'set local role authenticated';
  if (select count(*) from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a'))<>2 then raise exception 'replay/deep hierarchy failed'; end if;
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',other,true);
    raise exception 'hierarchy conflict allowed'; exception when check_violation then
      if sqlerrm<>'brand_sub_brand_hierarchy_conflict' then raise; end if; end;
  if (select brand_id from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a') where source_field='brand')<>root then raise exception 'failed change lost previous selection'; end if;
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',child,true);
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','sub_brand','observed sub',null,true);
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',null,true);
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a')) then raise exception 'clear failed'; end if;
  begin insert into public.product_candidate_brand_resolutions(user_id,client_key,request_fingerprint,source_field,observed_value,brand_id)
    values(auth.uid(),'pcbr-revision-a',fingerprint,'brand','observed brand',root);
    raise exception 'direct insert allowed'; exception when insufficient_privilege then null; end;
  perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',child,true);
  execute 'reset role';
  if (select jsonb_agg(to_jsonb(b) order by id) from public.brands b) is distinct from original_graph then raise exception 'brand graph changed'; end if;
  if jsonb_build_object('standard',(select jsonb_agg(to_jsonb(s) order by id) from public.standard_products s),
    'catalog',(select jsonb_agg(to_jsonb(c) order by id) from public.catalog_products c)) is distinct from original_catalog then raise exception 'public product mutated'; end if;
  if (select source_payload from public.product_candidate_authority_projections where client_key='pcbr-revision-a') is distinct from original then raise exception 'raw facts changed'; end if;
  update public.brands set status='archived' where id=child;
  execute 'set local role authenticated';
  if not exists(select 1 from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a') where brand_id=child and not brand_active and requires_review and parent_brand_id=root) then raise exception 'archive identity lost'; end if;
  begin perform public.set_product_candidate_brand_resolution_v2('pcbr-revision-a','brand','observed brand',child,true);
    raise exception 'archived new selection allowed'; exception when foreign_key_violation then null; end;
  execute 'reset role';
  -- A prior-fingerprint row can never leak through the current-revision read.
  insert into public.product_candidate_brand_resolutions(user_id,client_key,request_fingerprint,source_field,observed_value,brand_id)
    values(auth.uid(),'pcbr-revision-a',repeat('f',64),'sub_brand','old observed sub',leaf);
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-a') where request_fingerprint<>fingerprint) then raise exception 'stale fingerprint recovered'; end if;
  -- Both candidates were accepted before the edit. Only sibling B changes.
  sibling:=jsonb_set(jsonb_set(payload,'{client_key}','"pcbr-legacy-b"'::jsonb),'{product_name}','"PCBR Product B"'::jsonb);
  perform public.submit_product_candidate_v1('pcbr-original-b',sibling);
  perform public.submit_product_candidate_v1('pcbr-replay-unchanged-a',payload);
  payload:=jsonb_set(jsonb_set(sibling,'{client_key}','"pcbr-revision-b"'::jsonb),'{brand}','"edited brand"'::jsonb);
  perform public.submit_product_candidate_v1('pcbr-ingest-b',payload);
  -- Retry uses exactly the same A and B keys, even with a different aggregate idempotency key.
  perform public.submit_product_candidate_v1('pcbr-retry-unchanged-a',original);
  perform public.submit_product_candidate_v1('pcbr-retry-edited-b',payload);
  if (select count(*) from public.product_candidate_authority_projections where user_id=auth.uid() and source_payload - 'client_key' = original - 'client_key')<>1 then raise exception 'unchanged business payload authority duplicated'; end if;
  if (select count(*) from public.product_candidate_authority_projections where user_id=auth.uid() and source_payload - 'client_key' = payload - 'client_key')<>1 then raise exception 'edited business payload authority duplicated'; end if;
  if (select count(*) from public.product_candidate_authority_projections where user_id=auth.uid() and client_key in ('pcbr-revision-a','pcbr-legacy-b','pcbr-revision-b'))<>3 then raise exception 'candidate revision history lost'; end if;
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v2('pcbr-revision-b')) then raise exception 'prior revision applied to new key'; end if;
  begin perform public.submit_product_candidate_v1('pcbr-ingest-conflict',jsonb_set(payload,'{brand}','"another edit"'::jsonb));
    raise exception 'ingest immutable key weakened'; exception when unique_violation then null; end;
end $$;
select 'PRODUCT_CANDIDATE_BRAND_RESOLUTION_V2_SAME_DRIFT_SECURITY_PASS' as result;
rollback;

-- Run after 20260906090000_product_candidate_ingest.sql in a linked SQL
-- editor or local Supabase database. All fixture writes are rolled back.

begin;

do $$
declare
  v_user_id uuid;
  chosen_brand uuid := gen_random_uuid();
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
  v_projection_count integer;
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
        and slug = 'ready-meal'
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
    listing_reference_url,
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
    'https://example.invalid/product-candidate-fixture',
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
      'client_key', 'product-existing-' || v_suffix,
      'product_name', '__candidate_probe_variant_' || v_suffix,
      'brand', '__candidate_probe_brand_' || v_suffix,
      'sub_brand', '__candidate_probe_sub_brand_' || v_suffix,
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
    or v_existing ->> 'clientKey' <> ('product-existing-' || v_suffix)
    or v_existing ->> 'productClientKey' <> ('product-existing-' || v_suffix)
    or (v_existing ->> 'restaurantMenuCandidateCreated')::boolean is not false
    or v_existing #>> '{nutritionHandoff,status}' <> 'ready_for_existing_proposal_flow'
    or v_existing #>> '{nutritionHandoff,nutritionFoodId}' <> ('fitness-food-' || v_suffix)
  then
    raise exception 'verified exact catalog identity was not safely reused: %', v_existing;
  end if;

  select count(*) into v_projection_count
  from public.product_candidate_authority_projections as projection
  where projection.user_id = v_user_id
    and projection.client_key = 'product-existing-' || v_suffix
    and projection.resolution_status = 'catalog_product_reused'
    and projection.catalog_product_id = v_catalog_product_id
    and projection.standard_product_id = v_standard_product_id
    and projection.source_payload ->> 'sub_brand' =
      '__candidate_probe_sub_brand_' || v_suffix;
  if v_projection_count <> 1 then
    raise exception 'catalog authority projection did not preserve client_key/sub_brand';
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

  begin
    perform public.submit_product_candidate_v1(
      'candidate-uuid-client-key-' || v_suffix,
      jsonb_set(v_candidate, '{client_key}', to_jsonb(gen_random_uuid()::text))
    );
    raise exception 'UUID-shaped local client_key was accepted as a PriceTrace identity';
  exception
    when sqlstate '22023' then null;
  end;
  insert into public.brands(id,canonical_name) values(chosen_brand,'V2 catalog reuse brand');
  perform public.set_product_candidate_brand_resolution_v2('product-existing-'||v_suffix,'brand',v_candidate->>'brand',chosen_brand,true);
  if not exists(select 1 from public.get_product_candidate_brand_resolutions_v2('product-existing-'||v_suffix) where brand_id=chosen_brand and pair_relationship='single' and not requires_review) then raise exception 'catalog reuse resolution failed'; end if;
  perform public.set_product_candidate_brand_resolution_v2('product-existing-'||v_suffix,'brand',v_candidate->>'brand',null,true);
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v2('product-existing-'||v_suffix)) then raise exception 'catalog reuse clear failed'; end if;
end; $$;
select 'V2_CATALOG_REUSED_WITHOUT_PRIVATE_CANDIDATE_PASS' as result;
rollback;
