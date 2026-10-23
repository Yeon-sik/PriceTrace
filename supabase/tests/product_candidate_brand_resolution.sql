begin;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011","app_metadata":{}}',true);
do $$
declare
  root uuid:=gen_random_uuid(); child uuid:=gen_random_uuid(); leaf uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  payload jsonb; original jsonb; original_graph jsonb; original_catalog jsonb; fingerprint text;
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
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',root,true);
    raise exception 'anon allowed'; exception when insufficient_privilege then null; end;
  begin perform count(*) from public.product_candidate_brand_resolutions;
    raise exception 'anon private read allowed'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',root,true);
    raise exception 'unauthenticated allowed'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000022"}',true);
  execute 'set local role authenticated';
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v1('pcbr-revision-a')) then raise exception 'cross owner read'; end if;
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',root,true);
    raise exception 'cross owner mutation'; exception when foreign_key_violation then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011"}',true);
  execute 'set local role authenticated';
  begin perform public.set_product_candidate_brand_resolution_v1('missing','brand','observed brand',root,true);
    raise exception 'missing authority allowed'; exception when foreign_key_violation then null; end;
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','manufacturer','observed brand',root,true);
    raise exception 'manufacturer allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','stale',root,true);
    raise exception 'stale allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','',root,true);
    raise exception 'blank allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',root,false);
    raise exception 'unverified allowed'; exception when invalid_parameter_value then null; end;
  perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand',' observed brand ',root,true);
  perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',root,true);
  perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','sub_brand','observed sub',leaf,true);
  if (select count(*) from public.get_product_candidate_brand_resolutions_v1('pcbr-revision-a'))<>2 then raise exception 'replay/deep hierarchy failed'; end if;
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',other,true);
    raise exception 'hierarchy conflict allowed'; exception when check_violation then
      if sqlerrm<>'brand_sub_brand_hierarchy_conflict' then raise; end if; end;
  if (select brand_id from public.get_product_candidate_brand_resolutions_v1('pcbr-revision-a') where source_field='brand')<>root then raise exception 'failed change lost previous selection'; end if;
  perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',child,true);
  perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','sub_brand','observed sub',null,true);
  perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',null,true);
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v1('pcbr-revision-a')) then raise exception 'clear failed'; end if;
  begin insert into public.product_candidate_brand_resolutions(user_id,client_key,request_fingerprint,source_field,observed_value,brand_id)
    values(auth.uid(),'pcbr-revision-a',fingerprint,'brand','observed brand',root);
    raise exception 'direct insert allowed'; exception when insufficient_privilege then null; end;
  perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',child,true);
  execute 'reset role';
  if (select jsonb_agg(to_jsonb(b) order by id) from public.brands b) is distinct from original_graph then raise exception 'brand graph changed'; end if;
  if jsonb_build_object('standard',(select jsonb_agg(to_jsonb(s) order by id) from public.standard_products s),
    'catalog',(select jsonb_agg(to_jsonb(c) order by id) from public.catalog_products c)) is distinct from original_catalog then raise exception 'public product mutated'; end if;
  if (select source_payload from public.product_candidate_authority_projections where client_key='pcbr-revision-a') is distinct from original then raise exception 'raw facts changed'; end if;
  update public.brands set status='archived' where id=child;
  execute 'set local role authenticated';
  if not exists(select 1 from public.get_product_candidate_brand_resolutions_v1('pcbr-revision-a') where brand_id=child and not brand_active and parent_brand_id=root) then raise exception 'archive identity lost'; end if;
  begin perform public.set_product_candidate_brand_resolution_v1('pcbr-revision-a','brand','observed brand',child,true);
    raise exception 'archived new selection allowed'; exception when foreign_key_violation then null; end;
  execute 'reset role';
  -- A prior-fingerprint row can never leak through the current-revision read.
  insert into public.product_candidate_brand_resolutions(user_id,client_key,request_fingerprint,source_field,observed_value,brand_id)
    values(auth.uid(),'pcbr-revision-a',repeat('f',64),'sub_brand','old observed sub',leaf);
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v1('pcbr-revision-a') where request_fingerprint<>fingerprint) then raise exception 'stale fingerprint recovered'; end if;
  payload:=jsonb_set(payload,'{client_key}','"pcbr-revision-b"'::jsonb);
  payload:=jsonb_set(payload,'{brand}','"edited brand"'::jsonb);
  perform public.submit_product_candidate_v1('pcbr-ingest-b',payload);
  if exists(select 1 from public.get_product_candidate_brand_resolutions_v1('pcbr-revision-b')) then raise exception 'prior revision applied to new key'; end if;
  begin perform public.submit_product_candidate_v1('pcbr-ingest-conflict',jsonb_set(payload,'{brand}','"another edit"'::jsonb));
    raise exception 'ingest immutable key weakened'; exception when unique_violation then null; end;
end $$;
select 'PRODUCT_CANDIDATE_BRAND_RESOLUTION_V1_PASS' as result;
rollback;
