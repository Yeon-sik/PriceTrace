-- Evidence is owner/admin private. Only existing app_metadata admin authority can
-- publish the exact reviewed seller identity. No inference, role bootstrap or seeds.
create table public.pricetrace_seller_review_requests (
 request_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 source_record_id uuid not null,
 details jsonb not null,
 input_digest text not null check(input_digest ~ '^[a-f0-9]{64}$'),
 state text not null default 'pending' check(state in ('pending','approved','rejected')),
 store_id uuid references public.price_observation_sources(id),
 review_note text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(user_id,source_record_id) references public.pricetrace_information_inbox(user_id,record_id),
 check((state='pending' and store_id is null and reviewed_at is null) or (state='approved' and store_id is not null and reviewed_at is not null) or (state='rejected' and store_id is null and reviewed_at is not null))
);
alter table public.pricetrace_seller_review_requests enable row level security;
revoke all on public.pricetrace_seller_review_requests from public,anon,authenticated;
grant select on public.pricetrace_seller_review_requests to authenticated;
create policy seller_review_owner_or_admin on public.pricetrace_seller_review_requests for select to authenticated
 using(user_id=(select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role')='admin');
create index seller_review_owner_created on public.pricetrace_seller_review_requests(user_id,created_at desc);
create index seller_review_pending on public.pricetrace_seller_review_requests(created_at) where state='pending';

create function public.submit_pricetrace_seller_review_v1(p_request_id uuid,p_source_record_id uuid,p_expected_user_id uuid,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate public.pricetrace_seller_review_requests; fingerprint text; k text;
begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_user_id then raise exception 'Account changed' using errcode='42501'; end if;
 if not exists(select 1 from public.pricetrace_information_inbox where user_id=auth.uid() and record_id=p_source_record_id) then raise exception 'Own source required' using errcode='42501'; end if;
 if p_request_id is null or jsonb_typeof(p_details) is distinct from 'object' or
    (select count(*) from jsonb_object_keys(p_details))<>4 then raise exception 'Exact seller details required' using errcode='22023'; end if;
 foreach k in array array['display_name','location_label','evidence_url','evidence_note'] loop
   if jsonb_typeof(p_details->k) is distinct from 'string' or length(btrim(p_details->>k))=0 or length(p_details->>k)>2000 then raise exception 'Missing seller detail' using errcode='22023'; end if;
 end loop;
 if length(p_details->>'display_name')>200 or length(p_details->>'location_label')>300
   or p_details->>'evidence_url' !~ '^https://[^/@[:space:]]+[.][^/@[:space:]]+(/[^[:space:]]*)?$'
 then raise exception 'Public HTTPS evidence URL and exact identity required' using errcode='22023'; end if;
 fingerprint=encode(extensions.digest(convert_to(jsonb_build_object('account',auth.uid(),'record',p_source_record_id,'details',p_details)::text,'UTF8'),'sha256'),'hex');
 insert into public.pricetrace_seller_review_requests(request_id,user_id,source_record_id,details,input_digest)
 values(p_request_id,auth.uid(),p_source_record_id,p_details,fingerprint) on conflict(request_id) do nothing;
 select * into candidate from public.pricetrace_seller_review_requests where request_id=p_request_id;
 if candidate.user_id is distinct from auth.uid() or candidate.input_digest is distinct from fingerprint then raise exception 'Request ID conflict' using errcode='23505'; end if;
 return to_jsonb(candidate)-'reviewed_by';
end $$;

create function public.review_pricetrace_seller_v1(p_request_id uuid,p_expected_user_id uuid,p_expected_digest text,p_approve boolean,p_review_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate public.pricetrace_seller_review_requests; seller_id uuid; identity_key text;
begin
 if auth.uid() is null or auth.uid() is distinct from p_expected_user_id or (auth.jwt()->'app_metadata'->>'role') is distinct from 'admin' then raise exception 'Admin account required' using errcode='42501'; end if;
 if p_approve is null or p_review_note is null or length(btrim(p_review_note)) not between 1 and 2000 then raise exception 'Explicit review and reason required' using errcode='22023'; end if;
 select * into candidate from public.pricetrace_seller_review_requests where request_id=p_request_id for update;
 if not found then raise exception 'Request unavailable' using errcode='22023'; end if;
 if candidate.input_digest is distinct from p_expected_digest then raise exception 'Review changed' using errcode='23505'; end if;
 if candidate.state<>'pending' then
   if (candidate.state='approved') is distinct from p_approve or candidate.review_note is distinct from p_review_note then raise exception 'Final review conflict' using errcode='23505'; end if;
   return to_jsonb(candidate)-'reviewed_by';
 end if;
 if p_approve then
   identity_key=encode(extensions.digest(convert_to(jsonb_build_array(btrim(candidate.details->>'display_name'),btrim(candidate.details->>'location_label'),btrim(candidate.details->>'evidence_url'))::text,'UTF8'),'sha256'),'hex');
   insert into public.price_observation_sources(source_namespace,source_store_code,display_name,location_label,review_status,created_by,reviewed_by,reviewed_at)
   values('admin-evidence-v1',identity_key,btrim(candidate.details->>'display_name'),btrim(candidate.details->>'location_label'),'verified',candidate.user_id,auth.uid(),now())
   on conflict(source_namespace,source_store_code) do nothing;
   select id into seller_id from public.price_observation_sources where source_namespace='admin-evidence-v1' and source_store_code=identity_key and status='active' and review_status='verified' for share;
   if seller_id is null then raise exception 'Existing identity inactive or rejected; explicit administrative correction required' using errcode='22023'; end if;
 end if;
 update public.pricetrace_seller_review_requests set state=case when p_approve then 'approved' else 'rejected' end,store_id=seller_id,review_note=p_review_note,reviewed_by=auth.uid(),reviewed_at=now() where request_id=p_request_id returning * into candidate;
 return to_jsonb(candidate)-'reviewed_by';
end $$;
revoke all on function public.submit_pricetrace_seller_review_v1(uuid,uuid,uuid,jsonb) from public,anon;
revoke all on function public.review_pricetrace_seller_v1(uuid,uuid,text,boolean,text) from public,anon;
grant execute on function public.submit_pricetrace_seller_review_v1(uuid,uuid,uuid,jsonb) to authenticated;
grant execute on function public.review_pricetrace_seller_v1(uuid,uuid,text,boolean,text) to authenticated;
