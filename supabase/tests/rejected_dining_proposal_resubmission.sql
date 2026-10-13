-- Runs inside restaurant_menu_identity_candidates.sql's rollback-only fixture transaction.
set local role authenticated;
do $test$
declare t proposal_test_ids%rowtype; menu jsonb; replay jsonb; merchant jsonb; next_merchant jsonb;
begin
  select * into t from proposal_test_ids;
  perform set_config('request.jwt.claim.sub', t.owner_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('app_metadata',jsonb_build_object('role','user'))::text, true);
  begin
    perform public.resubmit_restaurant_menu_candidate_v1(t.child_id,'menu-no-consent',null,null,t.merchant_id,'Edited','{}',false);
    raise exception 'missing reconfirmation accepted'; exception when invalid_parameter_value then null;
  end;
  begin
    perform public.resubmit_restaurant_menu_candidate_v1(t.candidate_id,'menu-accepted',t.restaurant_id,t.location_id,null,'Edited','{}',true);
    raise exception 'accepted proposal resubmitted'; exception when check_violation then null;
  end;
  begin
    perform public.resubmit_restaurant_menu_candidate_v1(t.child_id,'menu-unchanged',null,null,t.merchant_id,'Merchant proposal menu','{}',true);
    raise exception 'unchanged rejected menu accepted'; exception when check_violation then null;
  end;
  menu := public.resubmit_restaurant_menu_candidate_v1(t.child_id,'menu-revision-2',null,null,t.merchant_id,'Corrected menu','{}',true);
  replay := public.resubmit_restaurant_menu_candidate_v1(t.child_id,'menu-revision-2',null,null,t.merchant_id,'Corrected menu','{}',true);
  if menu ->> 'candidateId' = t.child_id::text or menu <> replay or menu ->> 'reviewStatus' <> 'pending'
    or menu ->> 'catalogProductId' is not null then raise exception 'menu revision/retry/publication contract failed'; end if;
  begin
    perform public.resubmit_restaurant_menu_candidate_v1(t.child_id,'menu-revision-2',null,null,t.merchant_id,'Different facts','{}',true);
    raise exception 'retry accepted changed facts'; exception when unique_violation then null;
  end;
  begin
    perform public.resubmit_restaurant_menu_candidate_v1(t.child_id,'menu-duplicate',null,null,t.merchant_id,'Again','{}',true);
    raise exception 'same rejection got two child requests'; exception when check_violation then null;
  end;
  begin
    perform public.resubmit_restaurant_menu_candidate_v1((menu ->> 'candidateId')::uuid,'pending-duplicate',null,null,t.merchant_id,'Again','{}',true);
    raise exception 'pending menu resubmitted'; exception when check_violation then null;
  end;
  merchant := public.submit_merchant_identity_candidate_v1('rejected-merchant-1','{"merchant_name":"Original merchant","business_kind":"food_service"}',true);
  perform set_config('request.jwt.claim.sub', t.admin_id::text,true);
  perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  perform public.admin_resolve_merchant_identity_candidate_v1((merchant ->> 'candidateId')::uuid,null,null,'reject');
  perform set_config('request.jwt.claim.sub', t.owner_id::text,true);
  perform set_config('request.jwt.claims','{"app_metadata":{"role":"user"}}',true);
  begin
    perform public.resubmit_dining_merchant_candidate_v1((merchant ->> 'candidateId')::uuid,'no-consent','{"merchant_name":"Corrected merchant","business_kind":"food_service"}',false);
    raise exception 'merchant missing consent accepted'; exception when invalid_parameter_value then null;
  end;
  begin
    perform public.resubmit_dining_merchant_candidate_v1((merchant ->> 'candidateId')::uuid,'unchanged','{"merchant_name":"Original merchant","business_kind":"food_service"}',true);
    raise exception 'unchanged rejected merchant accepted'; exception when check_violation then null;
  end;
  next_merchant := public.resubmit_dining_merchant_candidate_v1((merchant ->> 'candidateId')::uuid,'merchant-revision-2',
    '{"merchant_name":"Corrected merchant","business_kind":"food_service"}',true);
  replay := public.resubmit_dining_merchant_candidate_v1((merchant ->> 'candidateId')::uuid,'merchant-revision-2',
    '{"merchant_name":"Corrected merchant","business_kind":"food_service"}',true);
  if next_merchant <> replay or next_merchant ->> 'candidateId' = merchant ->> 'candidateId'
    or next_merchant ->> 'reviewStatus' <> 'pending' or next_merchant ->> 'restaurantId' is not null then
    raise exception 'merchant revision/retry/private identity contract failed'; end if;
  begin
    perform public.resubmit_dining_merchant_candidate_v1((merchant ->> 'candidateId')::uuid,'merchant-revision-2',
      '{"merchant_name":"Changed during retry","business_kind":"food_service"}',true);
    raise exception 'merchant retry key changed facts'; exception when unique_violation then null;
  end;
  begin
    perform public.resubmit_dining_merchant_candidate_v1((merchant ->> 'candidateId')::uuid,'merchant-duplicate',
      '{"merchant_name":"Another correction","business_kind":"food_service"}',true);
    raise exception 'merchant duplicate child created'; exception when check_violation then null;
  end;
  begin
    perform public.resubmit_dining_merchant_candidate_v1(t.merchant_id,'accepted-merchant',
      '{"merchant_name":"Edited","business_kind":"food_service"}',true);
    raise exception 'accepted merchant resubmitted'; exception when check_violation then null;
  end;
  begin
    perform public.resubmit_dining_merchant_candidate_v1((next_merchant ->> 'candidateId')::uuid,'pending-merchant',
      '{"merchant_name":"Edited","business_kind":"food_service"}',true);
    raise exception 'pending merchant resubmitted'; exception when check_violation then null;
  end;
  -- Revising back to a historical fact set still creates a NEW version and retry key.
  perform set_config('request.jwt.claim.sub',t.admin_id::text,true);
  perform set_config('request.jwt.claims','{"app_metadata":{"role":"admin"}}',true);
  perform public.admin_resolve_merchant_identity_candidate_v1((next_merchant ->> 'candidateId')::uuid,null,null,'reject');
  perform set_config('request.jwt.claim.sub',t.owner_id::text,true);
  perform set_config('request.jwt.claims','{"app_metadata":{"role":"user"}}',true);
  replay := public.resubmit_dining_merchant_candidate_v1((next_merchant ->> 'candidateId')::uuid,'merchant-revision-3',
    '{"merchant_name":"Original merchant","business_kind":"food_service"}',true);
  if replay ->> 'candidateId' = merchant ->> 'candidateId' or replay ->> 'candidateId' = next_merchant ->> 'candidateId' then
    raise exception 'historical content collapsed new request version'; end if;
  perform set_config('request.jwt.claim.sub',t.other_id::text,true);
  begin
    perform public.resubmit_restaurant_menu_candidate_v1(t.child_id,'foreign-menu',null,null,t.merchant_id,'Edited','{}',true);
    raise exception 'foreign menu resubmitted'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.resubmit_dining_merchant_candidate_v1((merchant ->> 'candidateId')::uuid,'foreign-merchant',
      '{"merchant_name":"Edited","business_kind":"food_service"}',true);
    raise exception 'foreign merchant resubmitted'; exception when insufficient_privilege then null;
  end;
  if jsonb_array_length(public.get_my_dining_merchant_candidates_v1()) <> 0
    or jsonb_array_length(public.get_my_restaurant_menu_candidates_v1()) <> 0 then
    raise exception 'revision history leaked to other owner'; end if;
  perform set_config('request.jwt.claim.sub',t.owner_id::text,true);
end;
$test$;
reset role;
-- A response lost after reservation must still replay when its selector is later unavailable.
update public.merchant_identity_candidates set review_status = 'rejected', matched_restaurant_id = null,
  matched_restaurant_location_id = null where id = (select merchant_id from proposal_test_ids);
set local role authenticated;
do $test$
declare t proposal_test_ids%rowtype; replay jsonb;
begin
  select * into t from proposal_test_ids;
  replay := public.resubmit_restaurant_menu_candidate_v1(t.child_id,'menu-revision-2',null,null,t.merchant_id,'Corrected menu','{}',true);
  if replay ->> 'reviewStatus' <> 'pending' then raise exception 'selector retirement broke exact-key replay'; end if;
end;
$test$;
reset role;
do $test$
begin
  if not exists (select 1 from public.restaurant_menu_identity_candidates child
    join public.restaurant_menu_identity_candidates previous on previous.id = child.resubmission_of
    where child.request_version = 2 and child.review_status = 'pending' and previous.review_status = 'rejected')
    or not exists (select 1 from public.merchant_identity_candidates child
      join public.merchant_identity_candidates previous on previous.id = child.resubmission_of
      where child.request_version = 3 and child.review_status = 'pending' and previous.review_status = 'rejected') then
    raise exception 'request versions or old rejected history lost'; end if;
  if has_function_privilege('anon','public.resubmit_dining_merchant_candidate_v1(uuid,text,jsonb,boolean)','EXECUTE')
    or has_function_privilege('anon','public.resubmit_restaurant_menu_candidate_v1(uuid,text,uuid,uuid,uuid,text,jsonb,boolean)','EXECUTE') then
    raise exception 'anonymous resubmission privilege leaked'; end if;
  if (select count(*) from public.restaurant_menus) <> 1 then raise exception 'resubmission auto-published menu'; end if;
  raise notice 'REJECTED_DINING_RESUBMISSION_SQL_PASS';
end;
$test$;
