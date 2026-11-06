-- Manual hosted smoke, root/operator only. Entire synthetic flow rolls back.
-- Uses an existing admin and another account; never changes roles or real data.
begin;
do $$
declare admin_id uuid; other_id uuid; product_id uuid;
begin
 select id into admin_id from auth.users where raw_app_meta_data->>'role'='admin' order by id limit 1;
 select id into other_id from auth.users where id<>admin_id order by id limit 1;
 if admin_id is null or other_id is null then raise exception 'Existing admin and second account required'; end if;
 select c.id into product_id from public.catalog_products c join public.standard_products s on s.id=c.standard_product_id
 where c.status='active' and c.verification_status='verified' and c.specification_status='verified' and c.purchase_type='retail_product'
 and s.status='active' and s.verification_status='verified' and s.purchase_type='retail_product' order by c.id limit 1;
 if product_id is null then raise exception 'Existing verified retail package required'; end if;
 perform set_config('information_smoke.admin',admin_id::text,true);
 perform set_config('information_smoke.other',other_id::text,true);
 perform set_config('information_smoke.product',product_id::text,true);
 perform set_config('information_smoke.private_count',(select count(*)::text from public.price_observations),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'app_metadata',jsonb_build_object('role','admin'))::text,true);
end $$;
set local role authenticated;
do $$
declare uid uuid:=auth.uid(); fixture_record uuid:='97000000-0000-4000-8000-000000000001'; request_id uuid:='97000000-0000-4000-8000-000000000002';
 payload text; source jsonb; seller jsonb; preview jsonb; applied jsonb; mapping jsonb;
begin
 payload:=jsonb_build_object('schema_version','information-record.v1','record_id',fixture_record,'owner_app','pricetrace','record_type','pricetrace.observation',
  'title','ROLLBACK ONLY synthetic information','captured_at','2026-11-06T12:00:00Z','references','[]'::jsonb,
  'sources',jsonb_build_array(jsonb_build_object('source_id','manual-1','kind','manual','text','PRIVATE_INFORMATION_SMOKE')),
  'fields',jsonb_build_array(jsonb_build_object('key','price','value_type','decimal','unit','KRW','value','2345.00'),jsonb_build_object('key','day','value_type','date','value','2026-11-06')))::text;
 source:=public.ingest_pricetrace_information_record_v1(payload,uid);
 if not (public.ingest_pricetrace_information_record_v1(payload,uid)->>'duplicate')::boolean then raise exception 'Ingest replay failed'; end if;
 seller:=public.submit_pricetrace_seller_review_v1(request_id,fixture_record,uid,jsonb_build_object('display_name','ROLLBACK ONLY exact fixture seller','location_label','Synthetic location; not a real seller','evidence_url','https://example.invalid/rollback-fixture','evidence_note','PRIVATE_SELLER_SMOKE'));
 if seller->>'state'<>'pending' then raise exception 'Seller must start pending'; end if;
 seller:=public.review_pricetrace_seller_v1(request_id,uid,seller->>'input_digest',true,'Synthetic exact identity reviewed inside rollback only');
 if seller->>'state'<>'approved' then raise exception 'Explicit admin approval failed'; end if;
 mapping:=jsonb_build_object('catalog_product_id',current_setting('information_smoke.product'),'store_id',seller->>'store_id','price_field','price','date_field','day');
 preview:=public.preview_pricetrace_information_price_v1(fixture_record,uid,source->>'content_fingerprint',mapping);
 if preview->>'status'<>'ready' then raise exception 'Price preview failed: %',preview->>'reason'; end if;
 begin
  perform public.apply_pricetrace_information_price_v1(fixture_record,uid,source->>'content_fingerprint',mapping,preview->>'mapping_digest',false);
  raise exception 'Missing approval accepted';
 exception when invalid_parameter_value then null; end;
 applied:=public.apply_pricetrace_information_price_v1(fixture_record,uid,source->>'content_fingerprint',mapping,preview->>'mapping_digest',true);
 if applied->>'status'<>'applied' then raise exception 'Native price application failed'; end if;
 if (public.apply_pricetrace_information_price_v1(fixture_record,uid,source->>'content_fingerprint',mapping,preview->>'mapping_digest',true)->>'observation_id') is distinct from applied->>'observation_id' then raise exception 'Native replay failed'; end if;
 if (select payload_text from public.pricetrace_information_inbox where user_id=uid and record_id=fixture_record) is distinct from payload then raise exception 'Original changed'; end if;
 begin update public.pricetrace_information_projection_receipts set adapter='changed'; raise exception 'Receipt mutable'; exception when insufficient_privilege then null; end;
 perform set_config('information_smoke.observation',applied->>'observation_id',true);
 perform set_config('information_smoke.fingerprint',source->>'content_fingerprint',true);
 perform set_config('information_smoke.mapping',mapping::text,true);
 perform set_config('information_smoke.digest',preview->>'mapping_digest',true);
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('information_smoke.other'))::text,true); end $$;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.pricetrace_information_projection_receipts where record_id='97000000-0000-4000-8000-000000000001') then raise exception 'Foreign receipt visible'; end if;
 if exists(select 1 from public.pricetrace_seller_review_requests where request_id='97000000-0000-4000-8000-000000000002') then raise exception 'Foreign seller evidence visible'; end if;
 begin
  perform public.apply_pricetrace_information_price_v1('97000000-0000-4000-8000-000000000001',auth.uid(),current_setting('information_smoke.fingerprint'),current_setting('information_smoke.mapping')::jsonb,current_setting('information_smoke.digest'),true);
  raise exception 'Foreign apply allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.review_pricetrace_seller_v1('97000000-0000-4000-8000-000000000002',auth.uid(),repeat('0',64),true,'Nonadmin attempt'); raise exception 'Nonadmin approve allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ declare row_value jsonb; begin
 select to_jsonb(p) into row_value from public.get_information_public_prices_v1(0,500) p where observation_id=current_setting('information_smoke.observation')::uuid;
 if row_value is null or row_value->>'unit_price_krw'<>'2345' then raise exception 'Native public reader missing'; end if;
 if row_value ?| array['user_id','source_fingerprint','payload_text','evidence_note'] then raise exception 'Private evidence leaked'; end if;
 begin perform count(*) from public.pricetrace_information_projection_receipts; raise exception 'Anonymous private read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if (select count(*)::text from public.price_observations)<>current_setting('information_smoke.private_count') then raise exception 'Private price aggregate changed'; end if;
end $$;
rollback;
select 'INFORMATION_SELLER_TO_NATIVE_PUBLIC_PRICE_ROLLBACK_PASS' as result;
