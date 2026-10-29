-- User-confirmed connections are projections. Never rewrite OCR facts, purchases,
-- global verification, product authority, or Fitness's v1/v2 read contracts.
create function public.identity_name_similarity_v1(p_left text, p_right text)
returns numeric language plpgsql immutable security invoker set search_path = '' as $$
declare
  a text := regexp_replace(lower(btrim(coalesce(p_left,''))), '\s', '', 'g');
  b text := regexp_replace(lower(btrim(coalesce(p_right,''))), '\s', '', 'g');
  previous integer[]; current_row integer[]; i integer; j integer; n integer; m integer;
begin
  n := char_length(a); m := char_length(b);
  if n = 0 or m = 0 or n > 500 or m > 500 then return 0; end if;
  if a = b then return 1; end if;
  if abs(n-m)::numeric / greatest(n,m) > 0.15 then return 0; end if;
  previous := array(select generate_series(0,m));
  for i in 1..n loop
    current_row := array[i];
    for j in 1..m loop
      current_row := array_append(current_row, least(current_row[j]+1,previous[j+1]+1,
        previous[j] + case when substr(a,i,1)=substr(b,j,1) then 0 else 1 end));
    end loop;
    previous := current_row;
  end loop;
  return round(1 - previous[m+1]::numeric / greatest(n,m), 4);
end;
$$;
revoke all on function public.identity_name_similarity_v1(text,text) from public,anon;
grant execute on function public.identity_name_similarity_v1(text,text) to authenticated;

-- Only candidate discovery uses fuzzy matching. Exact/confirmed-alias authority
-- selection still uses the existing equality and ownership checks.
create or replace function public.private_purchase_identity_label_matches_v1(p_label text,p_query text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select position(regexp_replace(lower(btrim(p_query)),'\s','','g') in regexp_replace(lower(p_label),'\s','','g')) > 0
    or not exists(select 1 from regexp_split_to_table(lower(btrim(p_query)),'\s+') token
      where position(token in regexp_replace(lower(p_label),'\s','','g')) = 0)
    or public.identity_name_similarity_v1(p_label,p_query) >= 0.85;
$$;

create table public.owner_identity_connections (
  user_id uuid not null references auth.users(id),
  entity text not null check (entity in ('brand','store','restaurant')),
  source_id uuid not null,
  target_id uuid not null,
  observed_name text not null,
  target_name text not null,
  created_at timestamptz not null default now(),
  primary key(user_id,entity,source_id),
  check (entity = 'brand' or source_id <> target_id)
);
create index owner_identity_connections_target_idx on public.owner_identity_connections(user_id,entity,target_id);
alter table public.owner_identity_connections enable row level security;
revoke all on public.owner_identity_connections from public,anon,authenticated;
grant select on public.owner_identity_connections to authenticated;
create policy owner_read on public.owner_identity_connections for select to authenticated
  using (user_id = (select auth.uid()));
create trigger immutable before update or delete on public.owner_identity_connections
  for each row execute function public.reject_purchase_price_observation_mutation();

-- Read-only inventory shared by the web and OCR clients. Optional record IDs are
-- server-returned selectors; they never grant access to another owner's records.
create function public.get_my_identity_connection_sources_v1(p_record_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); result jsonb;
begin
  if actor is null then raise exception 'authenticated owner required' using errcode='42501'; end if;
  if cardinality(p_record_ids) > 500 then raise exception 'too many selectors' using errcode='22023'; end if;
  with sources as (
    select 'brand'::text entity,c.id,c.brand name,null::text branch,c.product_name context,c.created_at
    from public.product_identity_candidates c where c.user_id=actor and nullif(btrim(c.brand),'') is not null
      and c.review_status <> 'rejected' and (p_record_ids is null or c.id=any(p_record_ids))
    union all
    select 'store',s.id,s.name,s.branch_name,s.address,s.created_at from public.stores s where s.user_id=actor
      and (p_record_ids is null or s.id=any(p_record_ids)
        or exists(select 1 from public.receipts r where r.user_id=actor and r.store_id=s.id and r.id=any(p_record_ids))
        or exists(select 1 from public.purchase_price_source_lines l join public.store_products sp on sp.user_id=l.user_id and sp.id=l.store_product_id
          where l.user_id=actor and sp.store_id=s.id and l.purchase_source_id=any(p_record_ids)))
    union all
    select 'restaurant',r.id,r.merchant_name,r.branch_name,r.source_namespace,r.created_at
    from public.purchase_owner_restaurants r join public.merchant_identity_candidates c on c.id=r.merchant_candidate_id and c.user_id=r.user_id
    where r.user_id=actor and c.review_status <> 'rejected'
      and (p_record_ids is null or r.id=any(p_record_ids) or exists(select 1 from public.purchase_owner_restaurant_sources b
        where b.user_id=actor and b.restaurant_id=r.id and b.purchase_source_id=any(p_record_ids)))
  )
  select jsonb_build_object('schemaVersion','identity-connections.v1','ownerId',actor,
    'truncated',(select count(*)>200 from sources),'sources',coalesce((select jsonb_agg(jsonb_build_object(
      'entity',s.entity,'sourceId',s.id,'name',s.name,'branchName',s.branch,'context',s.context,
      'selected',case when b.target_id is null then null else jsonb_build_object('id',b.target_id,'name',b.target_name) end)
      order by s.created_at desc,s.entity,s.id) from (select * from sources order by created_at desc,entity,id limit 200) s
      left join public.owner_identity_connections b on b.user_id=actor and b.entity=s.entity and b.source_id=s.id),'[]')) into result;
  return result;
end;
$$;
revoke all on function public.get_my_identity_connection_sources_v1(uuid[]) from public,anon;
grant execute on function public.get_my_identity_connection_sources_v1(uuid[]) to authenticated;

create function public.search_my_identity_connections_v1(p_entity text,p_source_id uuid,p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); source jsonb; choices jsonb;
begin
  if actor is null then raise exception 'authenticated owner required' using errcode='42501'; end if;
  if p_query is null or length(btrim(p_query)) not between 2 and 200 then
    raise exception 'search requires 2 to 200 characters' using errcode='22023'; end if;
  select value into source from jsonb_array_elements(public.get_my_identity_connection_sources_v1(array[p_source_id])->'sources')
    where value->>'entity'=p_entity and value->>'sourceId'=p_source_id::text;
  if source is null then raise exception 'source not owned or unavailable' using errcode='42501'; end if;
  with targets as (
    select b.id,b.canonical_name name,null::text branch,null::text context
      from public.brands b where p_entity='brand' and b.status='active'
    union all
    select s.id,s.name,s.branch_name,s.address from public.stores s join public.stores origin on origin.id=p_source_id and origin.user_id=actor
      where p_entity='store' and s.user_id=actor and s.id<>origin.id
        and (origin.branch_name is null or s.branch_name is null or origin.branch_name=s.branch_name)
        and (origin.business_registration_number is null or s.business_registration_number is null or origin.business_registration_number=s.business_registration_number)
        and (origin.catalog_namespace is null or s.catalog_namespace is null or origin.catalog_namespace=s.catalog_namespace)
        and (origin.merchant_id is null or s.merchant_id is null or origin.merchant_id=s.merchant_id)
        and (origin.business_kind is null or s.business_kind is null or origin.business_kind=s.business_kind)
    union all
    select r.id,r.merchant_name,r.branch_name,r.source_namespace from public.purchase_owner_restaurants r
      join public.purchase_owner_restaurants origin on origin.id=p_source_id and origin.user_id=actor
      join public.merchant_identity_candidates c on c.id=r.merchant_candidate_id and c.user_id=actor
      where p_entity='restaurant' and r.user_id=actor and r.id<>origin.id and c.review_status<>'rejected'
        and (origin.branch_name is null or r.branch_name is null or origin.branch_name=r.branch_name)
        and (origin.source_namespace is null or r.source_namespace is null or (origin.source_namespace=r.source_namespace and origin.source_code=r.source_code))
        and (origin.resolved_restaurant_id is null or r.resolved_restaurant_id is null or
          (origin.resolved_restaurant_id=r.resolved_restaurant_id and origin.resolved_restaurant_location_id=r.resolved_restaurant_location_id))
  ), scored as (
    select t.*,public.identity_name_similarity_v1(t.name,p_query) score,
      exists(select 1 from public.owner_identity_connections a where a.user_id=actor and a.entity=p_entity and a.target_id=t.id
        and public.private_purchase_identity_label_matches_v1(a.observed_name,p_query))
      or (p_entity='brand' and exists(select 1 from public.brand_aliases a where a.brand_id=t.id
        and public.private_purchase_identity_label_matches_v1(a.alias_name,p_query))) alias_match
    from targets t where not exists(select 1 from public.owner_identity_connections linked
      where linked.user_id=actor and linked.entity=p_entity and linked.source_id=t.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'branchName',branch,'context',context,
    'similarity',score,'matchKind',case when score=1 then 'exact' when alias_match then 'alias' when score>=0.85 then 'similar' else 'contains' end)
    order by score desc,name,id),'[]') into choices from (
      select * from scored where alias_match or public.private_purchase_identity_label_matches_v1(name,p_query)
      order by score desc,name,id limit 20) ranked;
  return jsonb_build_object('schemaVersion','identity-search.v1','entity',p_entity,'sourceId',p_source_id,'query',p_query,'choices',choices);
end;
$$;
revoke all on function public.search_my_identity_connections_v1(text,uuid,text) from public,anon;
grant execute on function public.search_my_identity_connections_v1(text,uuid,text) to authenticated;

create function public.connect_my_identity_v1(p_entity text,p_source_id uuid,p_target_id uuid,p_query text,p_user_verified boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); source jsonb; target jsonb; existing public.owner_identity_connections%rowtype;
begin
  if actor is null or p_user_verified is distinct from true then raise exception 'explicit owner confirmation required' using errcode='42501'; end if;
  -- Serialize graph changes per owner. Prevent cycles and implicit reassignment of
  -- records which other sources already use as their confirmed target.
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':identity-connections',0));
  select * into existing from public.owner_identity_connections where user_id=actor and entity=p_entity and source_id=p_source_id;
  if found then
    if existing.target_id<>p_target_id then raise exception 'source already connected' using errcode='23505'; end if;
    return public.get_my_identity_connection_sources_v1(array[p_source_id]);
  end if;
  if exists(select 1 from public.owner_identity_connections where user_id=actor and entity=p_entity and target_id=p_source_id) then
    raise exception 'source is already a connection target' using errcode='23505'; end if;
  select value into source from jsonb_array_elements(public.get_my_identity_connection_sources_v1(array[p_source_id])->'sources')
    where value->>'entity'=p_entity and value->>'sourceId'=p_source_id::text;
  select value into target from jsonb_array_elements(public.search_my_identity_connections_v1(p_entity,p_source_id,p_query)->'choices')
    where value->>'id'=p_target_id::text;
  if source is null or target is null then raise exception 'selected identity no longer available' using errcode='42501'; end if;
  insert into public.owner_identity_connections(user_id,entity,source_id,target_id,observed_name,target_name)
    values(actor,p_entity,p_source_id,p_target_id,source->>'name',target->>'name');
  return public.get_my_identity_connection_sources_v1(array[p_source_id]);
end;
$$;
revoke all on function public.connect_my_identity_v1(text,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.connect_my_identity_v1(text,uuid,uuid,text,boolean) to authenticated;

-- New web-only projection. Keep every menu/price ID and original observation;
-- grouping changes only after an explicit connection in either OCR or PriceTrace.
create function public.get_my_owner_confirmed_restaurants_v3()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare response jsonb; result jsonb;
begin
  response := public.get_my_owner_confirmed_restaurants_v2();
  with original as (select r from jsonb_array_elements(response->'restaurants') r),
  rows as (select r,case when exists(select 1 from original target where target.r->>'id'=c.target_id::text)
      then c.target_id else (r->>'id')::uuid end effective_id
    from original left join public.owner_identity_connections c
      on c.user_id=(select auth.uid()) and c.entity='restaurant' and c.source_id=(r->>'id')::uuid),
  groups as (select root.r || jsonb_build_object('menus',coalesce((select jsonb_agg(menu order by menu->>'name',menu->>'id')
    from rows member cross join lateral jsonb_array_elements(member.r->'menus') menu where member.effective_id=root.effective_id),'[]')) r
    from rows root where (root.r->>'id')::uuid=root.effective_id)
  select coalesce(jsonb_agg(r order by r->>'name',r->>'id'),'[]') into result from groups;
  return response || jsonb_build_object('schemaVersion','owner-restaurant-read.v3','restaurants',result);
end;
$$;
revoke all on function public.get_my_owner_confirmed_restaurants_v3() from public,anon;
grant execute on function public.get_my_owner_confirmed_restaurants_v3() to authenticated;
-- Route subsequent purchase suggestions to the confirmed root, while retaining
-- both spellings as discovery terms. Existing exact authority checks are unchanged.
create or replace function public.private_purchase_owner_restaurant_choices_v1(p_source_line_id uuid,p_query text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('restaurantId',id,'restaurantLocationId',location_id,
    'merchantName',merchant_name,'branchName',branch_name,'sourceNamespace',source_namespace,'sourceCode',source_code)
    order by created_at,id),'[]') from (
    select distinct root.* from public.purchase_price_source_lines l
    join public.purchase_price_sources s on s.id=l.purchase_source_id and s.user_id=l.user_id
    join public.purchase_owner_restaurants r on r.user_id=l.user_id
    left join public.owner_identity_connections linked on linked.user_id=r.user_id and linked.entity='restaurant' and linked.source_id=r.id
    join public.purchase_owner_restaurants root on root.user_id=r.user_id and root.id=coalesce(linked.target_id,r.id)
    join public.merchant_identity_candidates c on c.id=r.merchant_candidate_id and c.user_id=r.user_id
    join public.merchant_identity_candidates root_candidate on root_candidate.id=root.merchant_candidate_id and root_candidate.user_id=root.user_id
    where l.id=p_source_line_id and l.user_id=(select auth.uid()) and s.purchase_kind='restaurant'
      and s.transaction_state='settled' and l.line_seller_status='confirmed' and l.price_status='itemized'
      and coalesce(s.ordered_on,s.paid_on) is not null and coalesce(l.unit_price_krw,l.gross_price_krw,l.net_price_krw) is not null
      and c.review_status<>'rejected' and root_candidate.review_status<>'rejected'
      and (l.line_seller_branch_name is null or root.branch_name=l.line_seller_branch_name)
      and (l.line_seller_source_namespace is null or (root.source_namespace=l.line_seller_source_namespace and root.source_code=l.line_seller_source_code))
      and ((p_query is null and (r.merchant_name=l.line_seller_name or exists(
        select 1 from public.purchase_owner_restaurant_sources b join public.merchant_identity_candidates alias on alias.id=b.merchant_candidate_id and alias.user_id=b.user_id
        where b.user_id=l.user_id and b.restaurant_id=r.id and alias.review_status<>'rejected' and alias.merchant_name=l.line_seller_name
          and alias.branch_name is not distinct from l.line_seller_branch_name and alias.source_namespace is not distinct from l.line_seller_source_namespace
          and alias.source_code is not distinct from l.line_seller_source_code)))
        or (p_query is not null and (public.private_purchase_identity_label_matches_v1(concat_ws(' ',r.merchant_name,r.branch_name),p_query)
          or public.private_purchase_identity_label_matches_v1(concat_ws(' ',root.merchant_name,root.branch_name),p_query)
          or exists(select 1 from public.purchase_owner_restaurant_sources b join public.merchant_identity_candidates alias on alias.id=b.merchant_candidate_id and alias.user_id=b.user_id
            where b.user_id=l.user_id and b.restaurant_id=r.id and alias.review_status<>'rejected'
              and public.private_purchase_identity_label_matches_v1(alias.merchant_name,p_query)))))
  ) candidates;
$$;
notify pgrst,'reload schema';
