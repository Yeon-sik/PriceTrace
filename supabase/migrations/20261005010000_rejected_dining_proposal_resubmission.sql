-- Append-only request chains. Existing submissions, decisions, RLS and RPC signatures survive.
alter table public.merchant_identity_candidates
  add column request_version integer not null default 1 check (request_version > 0),
  add column resubmission_of uuid references public.merchant_identity_candidates(id) on delete restrict;
alter table public.restaurant_menu_identity_candidates
  add column request_version integer not null default 1 check (request_version > 0),
  add column resubmission_of uuid references public.restaurant_menu_identity_candidates(id) on delete restrict;
create unique index merchant_candidate_resubmission_once_idx
  on public.merchant_identity_candidates(user_id, resubmission_of) where resubmission_of is not null;
create unique index menu_candidate_resubmission_once_idx
  on public.restaurant_menu_identity_candidates(user_id, resubmission_of) where resubmission_of is not null;

create function public.resubmit_dining_merchant_candidate_v1(
  p_previous_candidate_id uuid, p_idempotency_key text, p_merchant jsonb, p_user_verified boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid := (select auth.uid());
  v_previous public.merchant_identity_candidates%rowtype;
  v_candidate public.merchant_identity_candidates%rowtype;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_name text; v_branch text; v_address text; v_phone text; v_bnr text;
  v_facts jsonb; v_fingerprint text;
begin
  if v_owner is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not coalesce(p_user_verified, false) then
    raise exception 'explicit user reconfirmation required' using errcode = '22023'; end if;
  if length(v_key) not between 1 and 200 or jsonb_typeof(p_merchant) is distinct from 'object' then
    raise exception 'invalid merchant request' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_each(p_merchant) fact where
    fact.key not in ('merchant_name','branch_name','address','phone','business_registration_number','business_kind')
    or (fact.value <> 'null'::jsonb and jsonb_typeof(fact.value) <> 'string')) then
    raise exception 'unsupported merchant facts' using errcode = '22023'; end if;
  v_name := btrim(coalesce(p_merchant ->> 'merchant_name', ''));
  v_branch := nullif(btrim(p_merchant ->> 'branch_name'), '');
  v_address := nullif(btrim(p_merchant ->> 'address'), '');
  v_phone := nullif(btrim(p_merchant ->> 'phone'), '');
  v_bnr := nullif(regexp_replace(coalesce(p_merchant ->> 'business_registration_number',''), '[^0-9]', '', 'g'), '');
  if length(v_name) not between 1 and 200 or p_merchant ->> 'business_kind' is distinct from 'food_service'
    or length(v_branch) > 200 or length(v_address) > 500 or length(v_phone) > 200 or length(v_bnr) > 200 then
    raise exception 'invalid dining merchant facts' using errcode = '22023'; end if;
  v_facts := jsonb_build_object('merchantName',v_name,'branchName',v_branch,'address',v_address,
    'phone',v_phone,'businessRegistrationNumber',v_bnr,'businessKind','food_service');
  v_fingerprint := encode(extensions.digest(jsonb_build_object('facts',v_facts,
    'previousCandidateId',p_previous_candidate_id)::text, 'sha256'), 'hex');
  -- Same parent is serialized, including calls using different retry keys.
  select * into v_previous from public.merchant_identity_candidates
    where id = p_previous_candidate_id and user_id = v_owner and origin = 'merchant_only'
      and business_kind = 'food_service' for update;
  if not found then raise exception 'owner proposal required' using errcode = '42501'; end if;
  select * into v_candidate from public.merchant_identity_candidates
    where user_id = v_owner and origin = 'merchant_only' and idempotency_key = v_key;
  if found then
    if v_candidate.resubmission_of is distinct from p_previous_candidate_id
      or v_candidate.source_fingerprint <> v_fingerprint then
      raise exception 'retry key reused with different facts' using errcode = '23505'; end if;
    return (select value from jsonb_array_elements(public.get_my_dining_merchant_candidates_v1())
      where value ->> 'candidateId' = v_candidate.id::text);
  end if;
  if v_previous.review_status <> 'rejected' or exists (select 1 from public.merchant_identity_candidates
    where user_id = v_owner and resubmission_of = p_previous_candidate_id) then
    raise exception 'only latest rejected proposal can be resubmitted' using errcode = '23514'; end if;
  if v_facts = jsonb_build_object('merchantName',v_previous.merchant_name,'branchName',v_previous.branch_name,
    'address',v_previous.address,'phone',v_previous.phone,'businessRegistrationNumber',v_previous.business_registration_number,
    'businessKind',v_previous.business_kind) then
    raise exception 'edit rejected facts before reconfirming' using errcode = '23514'; end if;
  insert into public.merchant_identity_candidates(user_id,origin,source_fingerprint,merchant_name,branch_name,
    address,phone,business_registration_number,business_kind,idempotency_key,user_verified,request_version,resubmission_of)
  values (v_owner,'merchant_only',v_fingerprint,v_name,v_branch,v_address,v_phone,v_bnr,'food_service',v_key,true,
    v_previous.request_version + 1,p_previous_candidate_id) returning * into v_candidate;
  -- New request is private/pending; it never inherits the rejected row's canonical IDs.
  return (select value from jsonb_array_elements(public.get_my_dining_merchant_candidates_v1())
    where value ->> 'candidateId' = v_candidate.id::text);
end;
$function$;

create function public.resubmit_restaurant_menu_candidate_v1(
  p_previous_candidate_id uuid, p_idempotency_key text, p_restaurant_id uuid,
  p_restaurant_location_id uuid, p_merchant_candidate_id uuid, p_menu_name text,
  p_metadata jsonb, p_user_verified boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_owner uuid := (select auth.uid());
  v_previous public.restaurant_menu_identity_candidates%rowtype;
  v_candidate public.restaurant_menu_identity_candidates%rowtype;
  v_response jsonb;
  v_metadata jsonb := '{}'::jsonb;
  v_field text; v_value text; v_fingerprint text;
begin
  if v_owner is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not coalesce(p_user_verified,false) then
    raise exception 'explicit user reconfirmation required' using errcode = '22023'; end if;
  select * into v_previous from public.restaurant_menu_identity_candidates
    where id = p_previous_candidate_id and user_id = v_owner for update;
  if not found then raise exception 'owner proposal required' using errcode = '42501'; end if;
  select * into v_candidate from public.restaurant_menu_identity_candidates
    where user_id = v_owner and idempotency_key = btrim(coalesce(p_idempotency_key,''));
  if found then
    if v_candidate.resubmission_of is distinct from p_previous_candidate_id then
      raise exception 'retry key reused for another proposal' using errcode = '23505'; end if;
    -- Replay does not depend on the selector still being eligible today. Validate the same
    -- allowlisted fingerprint as submission, then return current review/identity availability.
    if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
      raise exception 'metadata must be an object' using errcode = '23514'; end if;
    foreach v_field in array array['serving_label','category_label','official_url'] loop
      if coalesce(p_metadata,'{}'::jsonb) ? v_field and p_metadata -> v_field <> 'null'::jsonb then
        if jsonb_typeof(p_metadata -> v_field) <> 'string' then
          raise exception 'factual metadata must contain text' using errcode = '23514'; end if;
        v_value := nullif(btrim(p_metadata ->> v_field),'');
        if v_value is not null then v_metadata := v_metadata || jsonb_build_object(v_field,v_value); end if;
      end if;
    end loop;
    v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
      'restaurantId',p_restaurant_id,'restaurantLocationId',p_restaurant_location_id,
      'merchantCandidateId',p_merchant_candidate_id,'menuName',btrim(coalesce(p_menu_name,'')),
      'metadata',v_metadata)::text,'UTF8'),'sha256'),'hex');
    if v_candidate.request_fingerprint <> v_fingerprint then
      raise exception 'retry key reused with different facts' using errcode = '23505'; end if;
    return public.restaurant_menu_candidate_result_v1(v_candidate.id);
  end if;
  if v_previous.review_status <> 'rejected' or exists (select 1 from public.restaurant_menu_identity_candidates
    where user_id = v_owner and resubmission_of = p_previous_candidate_id) then
    raise exception 'only latest rejected proposal can be resubmitted' using errcode = '23514'; end if;
  v_response := public.submit_restaurant_menu_candidate_v1(p_idempotency_key,p_restaurant_id,
    p_restaurant_location_id,p_merchant_candidate_id,p_menu_name,p_metadata,p_user_verified);
  select * into v_candidate from public.restaurant_menu_identity_candidates
    where id = (v_response ->> 'candidateId')::uuid and user_id = v_owner;
  if v_candidate.request_fingerprint = v_previous.request_fingerprint then
    raise exception 'edit rejected facts before reconfirming' using errcode = '23514'; end if;
  update public.restaurant_menu_identity_candidates set request_version = v_previous.request_version + 1,
    resubmission_of = p_previous_candidate_id where id = v_candidate.id;
  return v_response;
end;
$function$;

revoke all on function public.resubmit_dining_merchant_candidate_v1(uuid,text,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.resubmit_restaurant_menu_candidate_v1(uuid,text,uuid,uuid,uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.resubmit_dining_merchant_candidate_v1(uuid,text,jsonb,boolean) to authenticated;
grant execute on function public.resubmit_restaurant_menu_candidate_v1(uuid,text,uuid,uuid,uuid,text,jsonb,boolean) to authenticated;
