-- V1 is deployed history. V2 reads current graph validity without rewriting selections.
begin;
create function public.get_product_candidate_brand_resolutions_v2(p_client_key text)
returns table(product_client_key text,request_fingerprint text,source_field text,observed_value text,
  brand_id uuid,canonical_name text,brand_active boolean,parent_brand_id uuid,parent_canonical_name text,
  created_at timestamptz,updated_at timestamptz,pair_relationship text,pair_relationship_valid boolean,requires_review boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  return query
  with selected as materialized (
    select r.* from public.product_candidate_brand_resolutions r
    join public.product_candidate_authority_projections p on p.user_id=r.user_id and p.client_key=r.client_key
      and p.request_fingerprint=r.request_fingerprint
    where r.user_id=auth.uid() and r.client_key=p_client_key
  ), pair as (
    select (select s.brand_id from selected s where s.source_field='brand') as parent_id,
           (select s.brand_id from selected s where s.source_field='sub_brand') as child_id
  ), relationship as (
    select case when parent_id is null or child_id is null then 'single'
      when parent_id=child_id then 'same_brand'
      when exists (
        with recursive ancestors as (
          select b.id,b.parent_brand_id from public.brands b where b.id=pair.child_id
          union select b.id,b.parent_brand_id from public.brands b join ancestors a on a.parent_brand_id=b.id
        ) select 1 from ancestors a where a.id=pair.parent_id
      ) then 'descendant' else 'hierarchy_conflict' end as kind from pair
  )
  select r.client_key,r.request_fingerprint,r.source_field,r.observed_value,r.brand_id,
    case when b.status='active' then b.canonical_name end,b.status='active',b.parent_brand_id,
    case when b.status='active' and parent.status='active' then parent.canonical_name end,r.created_at,r.updated_at,
    rel.kind,rel.kind<>'hierarchy_conflict',b.status<>'active' or rel.kind='hierarchy_conflict'
  from selected r join public.brands b on b.id=r.brand_id
  left join public.brands parent on parent.id=b.parent_brand_id cross join relationship rel
  order by r.source_field;
end $$;
revoke all on function public.get_product_candidate_brand_resolutions_v2(text) from public,anon;
grant execute on function public.get_product_candidate_brand_resolutions_v2(text) to authenticated;

create function public.set_product_candidate_brand_resolution_v2(
  p_client_key text, p_source_field text, p_observed_value text,
  p_brand_id uuid, p_user_verified boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  projection public.product_candidate_authority_projections%rowtype;
  observed text := btrim(coalesce(p_observed_value, ''));
  other_brand uuid;
  selected_parent uuid;
  selected_child uuid;
begin
  if actor is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_user_verified is distinct from true then raise exception 'explicit_user_verification_required' using errcode = '22023'; end if;
  if p_source_field is null or p_source_field not in ('brand','sub_brand') then
    raise exception 'invalid_brand_source_field' using errcode = '22023'; end if;
  if p_client_key is null or length(btrim(p_client_key)) not between 1 and 200 then
    raise exception 'invalid_candidate_client_key' using errcode = '22023'; end if;
  -- Use the same mutex as hierarchy writers: paired selections cannot race with
  -- each other or validate against a concurrently re-parented graph.
  update public.brand_hierarchy_write_guard set revision = revision + 1 where singleton;
  select * into projection from public.product_candidate_authority_projections
    where user_id = actor and client_key = p_client_key for update;
  if not found then raise exception 'candidate_authority_required' using errcode = '23503'; end if;
  if observed = '' or jsonb_typeof(projection.source_payload -> p_source_field) is distinct from 'string'
    or btrim(projection.source_payload ->> p_source_field) is distinct from observed then
    raise exception 'stale_brand_observed_value' using errcode = '22023'; end if;
  if p_brand_id is null then
    delete from public.product_candidate_brand_resolutions where user_id=actor and client_key=p_client_key
      and request_fingerprint=projection.request_fingerprint and source_field=p_source_field;
  else
    if not exists(select 1 from public.brands where id=p_brand_id and status='active') then
      raise exception 'active_brand_required' using errcode = '23503'; end if;
    select brand_id into other_brand from public.product_candidate_brand_resolutions
      where user_id=actor and client_key=p_client_key and request_fingerprint=projection.request_fingerprint
      and source_field=case p_source_field when 'brand' then 'sub_brand' else 'brand' end;
    if other_brand is not null then
      selected_parent := case p_source_field when 'brand' then p_brand_id else other_brand end;
      selected_child := case p_source_field when 'sub_brand' then p_brand_id else other_brand end;
      if selected_parent<>selected_child and not exists (
        with recursive ancestors as (
          select id,parent_brand_id from public.brands where id=selected_child
          union select b.id,b.parent_brand_id from public.brands b join ancestors a on a.parent_brand_id=b.id
        ) select 1 from ancestors where id=selected_parent
      ) then raise exception 'brand_sub_brand_hierarchy_conflict' using errcode = '23514'; end if;
    end if;
    insert into public.product_candidate_brand_resolutions(user_id,client_key,request_fingerprint,source_field,observed_value,brand_id)
    values(actor,p_client_key,projection.request_fingerprint,p_source_field,observed,p_brand_id)
    on conflict (user_id,client_key,request_fingerprint,source_field) do update
      set observed_value=excluded.observed_value,brand_id=excluded.brand_id,updated_at=now();
  end if;
  return jsonb_build_object('product_client_key',p_client_key,'request_fingerprint',projection.request_fingerprint,
    'source_field',p_source_field,'observed_value',observed,'brand_id',p_brand_id,'cleared',p_brand_id is null);
end $$;
revoke all on function public.set_product_candidate_brand_resolution_v2(text,text,text,uuid,boolean) from public,anon;
grant execute on function public.set_product_candidate_brand_resolution_v2(text,text,text,uuid,boolean) to authenticated;

commit;
