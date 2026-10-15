-- Forward extension of #62. Source snapshots and global authority stay immutable.
-- This expands suggestions only. It is never used by the automatic exact/alias selector.
create function public.private_purchase_identity_label_matches_v1(p_label text,p_query text)
returns boolean language sql immutable security invoker set search_path = '' as $function$
  select position(regexp_replace(lower(btrim(p_query)),'\s','','g') in regexp_replace(lower(p_label),'\s','','g')) > 0
    or not exists(select 1 from regexp_split_to_table(lower(btrim(p_query)),'\s+') token
      where position(token in regexp_replace(lower(p_label),'\s','','g')) = 0);
$function$;
revoke all on function public.private_purchase_identity_label_matches_v1(text,text) from public,anon,authenticated;
create function public.private_purchase_owner_restaurant_choices_v1(p_source_line_id uuid, p_query text)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('restaurantId', r.id, 'restaurantLocationId', r.location_id,
    'merchantName', r.merchant_name, 'branchName', r.branch_name, 'sourceNamespace', r.source_namespace,
    'sourceCode', r.source_code) order by r.created_at, r.id), '[]'::jsonb)
  from public.purchase_price_source_lines l
  join public.purchase_price_sources s on s.id = l.purchase_source_id and s.user_id = l.user_id
  join public.purchase_owner_restaurants r on r.user_id = l.user_id
    and (l.line_seller_branch_name is null or r.branch_name = l.line_seller_branch_name)
    and (l.line_seller_source_namespace is null or
      (r.source_namespace = l.line_seller_source_namespace and r.source_code = l.line_seller_source_code))
  join public.merchant_identity_candidates c on c.id = r.merchant_candidate_id and c.user_id = r.user_id
    and c.review_status <> 'rejected'
  where l.id = p_source_line_id and l.user_id = (select auth.uid()) and s.purchase_kind = 'restaurant'
    and s.transaction_state = 'settled' and l.line_seller_status = 'confirmed' and l.price_status = 'itemized'
    and coalesce(s.ordered_on,s.paid_on) is not null and coalesce(l.unit_price_krw,l.gross_price_krw,l.net_price_krw) is not null
    and ((p_query is null and (r.merchant_name = l.line_seller_name or exists (
      select 1 from public.purchase_owner_restaurant_sources b join public.merchant_identity_candidates alias
        on alias.id = b.merchant_candidate_id and alias.user_id = b.user_id
      where b.user_id = l.user_id and b.restaurant_id = r.id and alias.review_status <> 'rejected'
        and alias.merchant_name = l.line_seller_name
        and alias.branch_name is not distinct from l.line_seller_branch_name
        and alias.source_namespace is not distinct from l.line_seller_source_namespace
        and alias.source_code is not distinct from l.line_seller_source_code)))
    or (p_query is not null and (public.private_purchase_identity_label_matches_v1(concat_ws(' ',r.merchant_name,r.branch_name),p_query) or exists (
      select 1 from public.purchase_owner_restaurant_sources b join public.merchant_identity_candidates alias on alias.id = b.merchant_candidate_id and alias.user_id = b.user_id
      where b.user_id = l.user_id and b.restaurant_id = r.id and alias.review_status <> 'rejected'
        and public.private_purchase_identity_label_matches_v1(alias.merchant_name,p_query)))));
$function$;
revoke all on function public.private_purchase_owner_restaurant_choices_v1(uuid,text) from public, anon, authenticated;
create or replace function public.private_purchase_owner_restaurant_choices_v1(p_source_line_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select public.private_purchase_owner_restaurant_choices_v1(p_source_line_id, null);
$function$;

create function public.private_purchase_owner_menu_choices_v1(p_source_line_id uuid, p_restaurant_id uuid, p_query text)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.menu_name,
    'servingLabel', m.serving_label) order by m.created_at,m.id), '[]'::jsonb)
  from public.purchase_price_source_lines l join public.purchase_owner_menus m
    on m.user_id = l.user_id and m.restaurant_id = p_restaurant_id
    and m.serving_label is not distinct from l.option_text
  join public.restaurant_menu_identity_candidates c on c.id = m.menu_candidate_id and c.user_id = m.user_id and c.review_status <> 'rejected'
  where l.id = p_source_line_id and l.user_id = (select auth.uid())
    and ((p_query is null and (m.menu_name = l.product_name or exists (
      select 1 from public.purchase_owner_menu_sources b join public.purchase_price_source_lines alias
        on alias.id = b.purchase_source_line_id and alias.user_id = b.user_id
      where b.user_id = l.user_id and b.menu_id = m.id and alias.product_name = l.product_name
        and alias.option_text is not distinct from l.option_text)))
    or (p_query is not null and (public.private_purchase_identity_label_matches_v1(concat_ws(' ',m.menu_name,m.serving_label),p_query) or exists (
      select 1 from public.purchase_owner_menu_sources b join public.purchase_price_source_lines alias on alias.id = b.purchase_source_line_id and alias.user_id = b.user_id
      where b.user_id = l.user_id and b.menu_id = m.id and alias.option_text is not distinct from l.option_text
        and public.private_purchase_identity_label_matches_v1(alias.product_name,p_query)))));
$function$;
revoke all on function public.private_purchase_owner_menu_choices_v1(uuid,uuid,text) from public, anon, authenticated;

-- Platform has no previous authority registry. Every row here is owner-private.
create table public.purchase_owner_platforms (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  name text not null check(length(btrim(name)) between 1 and 100), code text,
  created_at timestamptz not null default now(), unique(user_id,id),
  check(code is null or length(btrim(code)) between 1 and 100)
);
create table public.purchase_owner_platform_sources (
  user_id uuid not null references auth.users(id), purchase_source_id uuid primary key,
  platform_id uuid not null, created_at timestamptz not null default now(),
  foreign key(user_id,purchase_source_id) references public.purchase_price_sources(user_id,id),
  foreign key(user_id,platform_id) references public.purchase_owner_platforms(user_id,id)
);
create index purchase_owner_platforms_owner_name_idx on public.purchase_owner_platforms(user_id,name);
create index purchase_owner_platform_sources_alias_idx on public.purchase_owner_platform_sources(user_id,platform_id,purchase_source_id);

create table public.purchase_owner_menu_components (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  owner_menu_id uuid, restaurant_menu_id uuid references public.restaurant_menus(id),
  name text not null check(length(btrim(name)) between 1 and 500),
  role text not null check(role in ('side','complimentary_side','sauce','beverage','other')),
  created_at timestamptz not null default now(), unique(user_id,id),
  foreign key(user_id,owner_menu_id) references public.purchase_owner_menus(user_id,id),
  check((owner_menu_id is null) <> (restaurant_menu_id is null))
);
create unique index purchase_owner_component_identity_idx on public.purchase_owner_menu_components
  (user_id,coalesce(owner_menu_id,restaurant_menu_id),role,name);
create unique index purchase_line_source_owner_idx on public.purchase_price_source_lines(user_id,purchase_source_id,id);
create table public.purchase_owner_menu_component_sources (
  user_id uuid not null references auth.users(id), purchase_source_id uuid not null, purchase_source_line_id uuid not null,
  canonical_fingerprint text not null check(canonical_fingerprint ~ '^[0-9a-f]{64}$'),
  nutrition_client_key text not null check(length(btrim(nutrition_client_key)) between 1 and 200),
  component_id uuid not null, food_evidence_refs jsonb not null check(jsonb_typeof(food_evidence_refs) = 'array' and jsonb_array_length(food_evidence_refs) > 0),
  facts_fingerprint text not null check(facts_fingerprint ~ '^[0-9a-f]{64}$'), created_at timestamptz not null default now(),
  primary key(user_id,purchase_source_id,canonical_fingerprint,nutrition_client_key),
  unique(user_id,canonical_fingerprint,nutrition_client_key),
  foreign key(user_id,purchase_source_id,purchase_source_line_id) references public.purchase_price_source_lines(user_id,purchase_source_id,id),
  foreign key(user_id,component_id) references public.purchase_owner_menu_components(user_id,id)
);
create index purchase_owner_component_sources_parent_idx on public.purchase_owner_menu_component_sources(user_id,purchase_source_line_id,component_id);
create index purchase_owner_component_sources_component_idx on public.purchase_owner_menu_component_sources(user_id,component_id);
create index purchase_owner_components_owner_menu_idx on public.purchase_owner_menu_components(user_id,owner_menu_id) where owner_menu_id is not null;
create index purchase_owner_components_global_menu_idx on public.purchase_owner_menu_components(restaurant_menu_id) where restaurant_menu_id is not null;
do $tables$
declare t text;
begin
  foreach t in array array['purchase_owner_platforms','purchase_owner_platform_sources','purchase_owner_menu_components','purchase_owner_menu_component_sources'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy owner_read on public.%I for select to authenticated using (user_id = (select auth.uid()))',t);
    execute format('create trigger immutable before update or delete on public.%I for each row execute function public.reject_purchase_price_observation_mutation()',t);
  end loop;
end;
$tables$;

-- One search API for both clients, scoped by persisted evidence and branch/source compatibility.
create function public.search_purchase_owner_identity_v1(p_purchase_source_id uuid,p_line_key text,p_entity text,p_query text)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare actor uuid := (select auth.uid()); s public.purchase_price_sources%rowtype; l public.purchase_price_source_lines%rowtype;
  choices jsonb := '[]'; selected jsonb; restaurant uuid; menu uuid;
begin
  if actor is null then raise exception 'authenticated purchase owner required' using errcode = '42501'; end if;
  select * into s from public.purchase_price_sources where id = p_purchase_source_id and user_id = actor;
  if not found then raise exception 'purchase source not owned' using errcode = '42501'; end if;
  select * into l from public.purchase_price_source_lines where purchase_source_id = s.id and source_line_key = p_line_key and user_id = actor;
  if not found then raise exception 'purchase line not owned' using errcode = '42501'; end if;
  if p_query is null or length(p_query) > 200 then raise exception 'invalid query' using errcode = '22023'; end if;
  select b.restaurant_id,b.menu_id into restaurant,menu from public.purchase_owner_menu_sources b where b.user_id = actor and b.purchase_source_line_id = l.id;
  if restaurant is null then select b.restaurant_id into restaurant from public.purchase_owner_restaurant_sources b
    join public.merchant_identity_candidates c on c.id = b.merchant_candidate_id and c.user_id = b.user_id
    where b.user_id = actor and b.purchase_source_id = s.id and c.merchant_name = l.line_seller_name
      and c.branch_name is not distinct from l.line_seller_branch_name and c.source_namespace is not distinct from l.line_seller_source_namespace
      and c.source_code is not distinct from l.line_seller_source_code and c.review_status <> 'rejected'; end if;
  if p_entity = 'restaurant' then
    select coalesce(jsonb_agg(jsonb_build_object('id',row->'restaurantId','name',row->'merchantName','branchName',row->'branchName',
      'sourceNamespace',row->'sourceNamespace','sourceCode',row->'sourceCode')), '[]')
      into choices from jsonb_array_elements(public.private_purchase_owner_restaurant_choices_v1(l.id,p_query)) row;
    choices := choices || (select coalesce(jsonb_agg(jsonb_build_object('id',loc.id,'name',r.canonical_name,
      'branchName',loc.location_label,'sourceNamespace',loc.source_namespace,'sourceCode',loc.source_location_code,'identityKind','global_verified') order by r.canonical_name,loc.id),'[]')
      from public.restaurants r join public.restaurant_locations loc on loc.restaurant_id = r.id
      where r.status = 'active' and r.review_status = 'verified' and r.verification_status = 'verified'
        and loc.review_status = 'verified' and loc.verification_status = 'verified'
        and (l.line_seller_branch_name is null or loc.location_label = l.line_seller_branch_name)
        and (l.line_seller_source_namespace is null or (loc.source_namespace = l.line_seller_source_namespace and loc.source_location_code = l.line_seller_source_code))
        and public.private_purchase_identity_label_matches_v1(concat_ws(' ',r.canonical_name,loc.location_label),p_query));
    select jsonb_build_object('id',id,'name',merchant_name,'branchName',branch_name,'sourceNamespace',source_namespace,'sourceCode',source_code) into selected from public.purchase_owner_restaurants where user_id = actor and id = restaurant;
  elsif p_entity = 'menu' then
    if restaurant is not null then choices := public.private_purchase_owner_menu_choices_v1(l.id,restaurant,p_query); end if;
    choices := choices || (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.canonical_name,
      'branchName',m.serving_label,'identityKind','global_verified') order by m.canonical_name,m.id),'[]')
      from public.purchase_owner_restaurants r join public.restaurant_menus m on m.restaurant_id = r.resolved_restaurant_id
      join public.restaurants gr on gr.id = r.resolved_restaurant_id and gr.status = 'active' and gr.review_status = 'verified' and gr.verification_status = 'verified'
      join public.restaurant_locations gl on gl.id = r.resolved_restaurant_location_id and gl.restaurant_id = gr.id and gl.review_status = 'verified' and gl.verification_status = 'verified'
      where r.user_id = actor and r.id = restaurant and m.status = 'active' and m.review_status = 'verified' and m.verification_status = 'verified'
        and (l.option_text is null or l.option_text = m.serving_label)
        and public.private_purchase_identity_label_matches_v1(concat_ws(' ',m.canonical_name,m.serving_label),p_query));
    select jsonb_build_object('id',id,'name',menu_name) into selected from public.purchase_owner_menus where user_id = actor and id = menu;
  elsif p_entity = 'platform' then
    select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'branchName',p.code) order by p.created_at,p.id),'[]') into choices
      from public.purchase_owner_platforms p where p.user_id = actor and (s.platform_code is null or p.code = s.platform_code)
      and (public.private_purchase_identity_label_matches_v1(p.name,p_query) or exists (
        select 1 from public.purchase_owner_platform_sources b join public.purchase_price_sources alias on alias.id = b.purchase_source_id and alias.user_id = b.user_id
        where b.user_id = actor and b.platform_id = p.id and (s.platform_code is null or alias.platform_code = s.platform_code)
          and public.private_purchase_identity_label_matches_v1(alias.platform_name,p_query)));
    select jsonb_build_object('id',p.id,'name',p.name) into selected from public.purchase_owner_platform_sources b
      join public.purchase_owner_platforms p on p.user_id = b.user_id and p.id = b.platform_id where b.user_id = actor and b.purchase_source_id = s.id;
  else raise exception 'invalid identity entity' using errcode = '22023'; end if;
  return jsonb_build_object('entity',p_entity,'query',p_query,'choices',choices,'selected',selected,
    'status',case when selected is not null then 'owner_confirmed' when p_entity = 'menu' and restaurant is null then 'restaurant_required' else 'needs_selection' end);
end;
$function$;
revoke all on function public.search_purchase_owner_identity_v1(uuid,text,text,text) from public,anon;
grant execute on function public.search_purchase_owner_identity_v1(uuid,text,text,text) to authenticated;

create function public.resolve_purchase_owner_platform_v1(p_purchase_source_id uuid,p_platform_id uuid,p_create boolean,p_user_verified boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare actor uuid := (select auth.uid()); s public.purchase_price_sources%rowtype; selected uuid; choices uuid[];
begin
  if actor is null then raise exception 'authenticated purchase owner required' using errcode = '42501'; end if;
  if p_user_verified is distinct from true then raise exception 'current purchase review required' using errcode = '22023'; end if;
  select * into s from public.purchase_price_sources where id = p_purchase_source_id and user_id = actor for update;
  if not found then raise exception 'purchase source not owned' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':owner-platforms',0));
  select platform_id into selected from public.purchase_owner_platform_sources where user_id = actor and purchase_source_id = s.id;
  if selected is not null then
    if p_platform_id is not null and p_platform_id <> selected then raise exception 'platform source binding immutable' using errcode = '23505'; end if;
    return public.get_purchase_price_ingestion_response_v1(s.id);
  end if;
  if p_platform_id is not null then
    select id into selected from public.purchase_owner_platforms where user_id = actor and id = p_platform_id and (s.platform_code is null or code = s.platform_code);
    if selected is null then raise exception 'platform not owned or code conflict' using errcode = '42501'; end if;
  else
    select array_agg(distinct p.id) into choices from public.purchase_owner_platforms p where p.user_id = actor
      and (s.platform_code is null or p.code = s.platform_code) and (p.name = s.platform_name or exists (
        select 1 from public.purchase_owner_platform_sources b join public.purchase_price_sources alias on alias.id = b.purchase_source_id and alias.user_id = b.user_id
        where b.user_id = actor and b.platform_id = p.id and alias.platform_name = s.platform_name and alias.platform_code is not distinct from s.platform_code));
    if cardinality(choices) = 1 then selected := choices[1];
    elsif cardinality(choices) > 1 then return public.get_purchase_price_ingestion_response_v1(s.id);
    elsif p_create is true then
      insert into public.purchase_owner_platforms(user_id,name,code) values(actor,s.platform_name,s.platform_code) returning id into selected;
    else return public.get_purchase_price_ingestion_response_v1(s.id); end if;
  end if;
  insert into public.purchase_owner_platform_sources(user_id,purchase_source_id,platform_id) values(actor,s.id,selected);
  return public.get_purchase_price_ingestion_response_v1(s.id);
end;
$function$;
revoke all on function public.resolve_purchase_owner_platform_v1(uuid,uuid,boolean,boolean) from public,anon;
grant execute on function public.resolve_purchase_owner_platform_v1(uuid,uuid,boolean,boolean) to authenticated;

create function public.resolve_user_confirmed_purchase_restaurant_line_v1(
  p_purchase_source_id uuid, p_line_key text, p_merchant_candidate_id uuid, p_user_verified boolean,
  p_owner_restaurant_id uuid, p_owner_menu_id uuid, p_resolution_action text
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid := (select auth.uid()); v_source public.purchase_price_sources%rowtype;
  v_line public.purchase_price_source_lines%rowtype; v_candidate public.merchant_identity_candidates%rowtype;
  v_restaurant_id uuid; v_menu_id uuid; v_menu_candidate jsonb; v_response jsonb; v_result jsonb;
  v_binding_id uuid; v_menu_fingerprint text; v_choices jsonb; v_choice_count integer;
  v_restaurant public.purchase_owner_restaurants%rowtype; v_menu public.purchase_owner_menus%rowtype; v_menu_choices jsonb;
begin
  if v_actor is null then raise exception 'authenticated purchase owner required' using errcode = '42501'; end if;
  if p_resolution_action not in ('legacy','review','select_restaurant','create_restaurant','select_menu','create_menu') or p_resolution_action is null then raise exception 'invalid resolution action' using errcode = '22023'; end if;
  if p_user_verified is distinct from true then raise exception 'current purchase review required' using errcode = '22023'; end if;
  -- Serializes all lines of this purchase, including first restaurant creation and retries.
  select source.* into v_source from public.purchase_price_sources source
    where source.id = p_purchase_source_id and source.user_id = v_actor for update;
  if not found then raise exception 'purchase source not available' using errcode = '42501'; end if;
  select line.* into v_line from public.purchase_price_source_lines line
    where line.purchase_source_id = v_source.id and line.user_id = v_actor and line.source_line_key = p_line_key for update;
  if not found then raise exception 'purchase line not available' using errcode = '42501'; end if;
  if (select count(*) from public.purchase_price_source_lines where purchase_source_id = v_source.id and source_line_key = p_line_key) <> 1 then
    raise exception 'ambiguous purchase line key' using errcode = '22023'; end if;
  -- Lock order is source -> owner -> candidate (including any explicitly selected anchor).
  -- Taking candidate locks before the shared owner lock can deadlock across independent purchases.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text || ':owner-restaurants', 0));
  select candidate.* into v_candidate from public.merchant_identity_candidates candidate
    where candidate.id = p_merchant_candidate_id and candidate.user_id = v_actor for update;
  if not found then raise exception 'merchant candidate not available' using errcode = '42501'; end if;
  if v_candidate.origin <> 'merchant_only' or not v_candidate.user_verified or v_candidate.review_status = 'rejected'
    or v_candidate.business_kind <> 'food_service' or v_line.line_seller_business_kind is distinct from 'food_service'
    or v_candidate.merchant_name is distinct from v_line.line_seller_name
    or v_candidate.branch_name is distinct from v_line.line_seller_branch_name
    or v_candidate.source_namespace is distinct from v_line.line_seller_source_namespace
    or v_candidate.source_code is distinct from v_line.line_seller_source_code
    -- V4 seller currently has no address/phone/BNR fields. Do not accept extra evidence from the caller.
    or v_candidate.address is not null or v_candidate.phone is not null or v_candidate.business_registration_number is not null then
    raise exception 'candidate facts must match persisted purchase seller' using errcode = '22023'; end if;
  if p_owner_restaurant_id is not null and not exists(select 1 from public.purchase_owner_restaurants
    where user_id = v_actor and id = p_owner_restaurant_id) then
    raise exception 'private restaurant choice not owned' using errcode = '42501'; end if;
  if p_owner_menu_id is not null and not exists(select 1 from public.purchase_owner_menus where user_id = v_actor and id = p_owner_menu_id) then raise exception 'private menu choice not owned' using errcode = '42501'; end if;
  if v_source.purchase_kind <> 'restaurant' or v_source.transaction_state <> 'settled'
    or v_line.line_seller_status <> 'confirmed' or v_line.price_status <> 'itemized'
    or coalesce(v_source.ordered_on, v_source.paid_on) is null
    or coalesce(v_line.unit_price_krw, v_line.gross_price_krw, v_line.net_price_krw) is null then
    raise exception 'purchase line not eligible for recovery' using errcode = '22023'; end if;
  v_response := public.get_purchase_price_ingestion_response_v1(v_source.id);
  select value into v_result from jsonb_array_elements(v_response -> 'lineResults') where value ->> 'lineKey' = p_line_key;
  if v_result ->> 'observationCreated' = 'true' then
    if p_owner_restaurant_id is not null and v_result #>> '{ownerConfirmedIds,restaurantId}' is distinct from p_owner_restaurant_id::text then
      raise exception 'resolved source identity cannot be replaced' using errcode = '23505'; end if;
    if p_owner_menu_id is not null and v_result #>> '{ownerConfirmedIds,restaurantMenuId}' is distinct from p_owner_menu_id::text then raise exception 'resolved menu cannot be replaced' using errcode = '23505'; end if;
    return v_response;
  end if;
  -- Only a real source pair and verified hierarchy may use the old exact path.
  -- In particular candidate.matched_* (which can contain name/branch suggestions) grants no authority here.
  if v_line.line_seller_source_namespace is not null and exists (
    select 1 from public.restaurant_locations l join public.restaurants r on r.id = l.restaurant_id
    where l.source_namespace = v_line.line_seller_source_namespace and l.source_location_code = v_line.line_seller_source_code
      and r.canonical_name = v_line.line_seller_name and l.location_label is not distinct from v_line.line_seller_branch_name
      and r.status = 'active' and r.review_status = 'verified' and r.verification_status = 'verified'
      and l.review_status = 'verified' and l.verification_status = 'verified') then
    return public.resolve_ocr_purchase_restaurant_line_v1(v_source.id, p_line_key, true);
  end if;
  select restaurant.* into v_restaurant from public.purchase_owner_restaurant_sources binding
    join public.purchase_owner_restaurants restaurant on restaurant.id = binding.restaurant_id and restaurant.user_id = binding.user_id
    where binding.user_id = v_actor and binding.purchase_source_id = v_source.id and binding.merchant_candidate_id = v_candidate.id;
  if found then
    if p_owner_restaurant_id is not null and p_owner_restaurant_id <> v_restaurant.id then
      raise exception 'source already bound to another private restaurant' using errcode = '23505'; end if;
  else
    v_choices := public.private_purchase_owner_restaurant_choices_v1(v_line.id);
    v_choice_count := jsonb_array_length(v_choices);
    if p_owner_restaurant_id is not null then
      if not exists(select 1 from jsonb_array_elements(public.private_purchase_owner_restaurant_choices_v1(v_line.id,'')) choice where choice ->> 'restaurantId' = p_owner_restaurant_id::text) then
        raise exception 'private restaurant choice not available for owner seller facts' using errcode = '42501'; end if;
      select * into v_restaurant from public.purchase_owner_restaurants where user_id = v_actor and id = p_owner_restaurant_id;
    elsif v_choice_count = 1 then
      select * into v_restaurant from public.purchase_owner_restaurants
        where user_id = v_actor and id = (v_choices #>> '{0,restaurantId}')::uuid
          and (merchant_candidate_id = v_candidate.id or exists(select 1 from public.purchase_owner_restaurant_sources binding
            where binding.user_id = v_actor and binding.restaurant_id = purchase_owner_restaurants.id and binding.merchant_candidate_id = v_candidate.id));
    end if;
    if p_owner_restaurant_id is null and (v_choice_count > 1 or (v_choice_count = 1 and v_restaurant.id is null)) then
      -- Current canonical review is not consent to guessing which physical place was purchased.
      return jsonb_set(v_response, '{lineResults}', (select jsonb_agg(case when row ->> 'lineKey' = p_line_key
        then row || jsonb_build_object('authorityStatus','needs_review','reason','owner_restaurant_selection_required',
          'reasonCode','owner_restaurant_selection_required','ownerRestaurantChoices',v_choices) else row end)
        from jsonb_array_elements(v_response -> 'lineResults') row));
    end if;
    if v_restaurant.id is null and p_resolution_action not in ('legacy','create_restaurant') then
      return jsonb_set(v_response,'{lineResults}',(select jsonb_agg(case when row->>'lineKey' = p_line_key then
        row || jsonb_build_object('authorityStatus','needs_review','reasonCode','owner_restaurant_selection_required',
          'reason','owner_restaurant_selection_required','ownerRestaurantChoices',v_choices) else row end)
        from jsonb_array_elements(v_response->'lineResults') row));
    end if;
    if v_restaurant.id is null then
      insert into public.purchase_owner_restaurants(user_id, merchant_candidate_id, merchant_name, branch_name, source_namespace, source_code)
        values(v_actor, v_candidate.id, v_candidate.merchant_name, v_candidate.branch_name, v_candidate.source_namespace, v_candidate.source_code)
        returning * into v_restaurant;
    end if;
    insert into public.purchase_owner_restaurant_sources(user_id, purchase_source_id, restaurant_id, merchant_candidate_id)
      values(v_actor, v_source.id, v_restaurant.id, v_candidate.id) returning id into v_binding_id;
  end if;
  v_restaurant_id := v_restaurant.id;
  perform 1 from public.merchant_identity_candidates where id = v_restaurant.merchant_candidate_id
    and user_id = v_actor and review_status <> 'rejected' for update;
  if not found then
    raise exception 'private restaurant anchor was rejected' using errcode = '23514'; end if;
  if v_binding_id is null then
    select id into v_binding_id from public.purchase_owner_restaurant_sources where user_id = v_actor
      and purchase_source_id = v_source.id and merchant_candidate_id = v_candidate.id;
  end if;
  v_menu_fingerprint := encode(extensions.digest(jsonb_build_object('menuName', v_line.product_name,
    'servingLabel', v_line.option_text)::text, 'sha256'), 'hex');
  -- Reuse #62 menu fingerprints and immutable source bindings as owner aliases.
  v_menu_choices := public.private_purchase_owner_menu_choices_v1(v_line.id,v_restaurant_id,null);
  if p_owner_menu_id is not null then
    if not exists(select 1 from jsonb_array_elements(public.private_purchase_owner_menu_choices_v1(v_line.id,v_restaurant_id,'')) c where c->>'id' = p_owner_menu_id::text) then
      raise exception 'menu serving/restaurant choice incompatible' using errcode = '42501'; end if;
    select * into v_menu from public.purchase_owner_menus where user_id = v_actor and id = p_owner_menu_id;
  elsif jsonb_array_length(v_menu_choices) = 1 then
    select * into v_menu from public.purchase_owner_menus where user_id = v_actor and id = (v_menu_choices #>> '{0,id}')::uuid;
  end if;
  if jsonb_array_length(v_menu_choices) > 1 and p_owner_menu_id is null or
    (v_menu.id is null and p_resolution_action not in ('legacy','create_menu')) then
    return jsonb_set(public.get_purchase_price_ingestion_response_v1(v_source.id),'{lineResults}',
      (select jsonb_agg(case when row->>'lineKey' = p_line_key then row || jsonb_build_object('authorityStatus','needs_review',
        'reasonCode','owner_menu_selection_required','reason','owner_menu_selection_required','ownerMenuChoices',v_menu_choices,
        'ownerRestaurantId',v_restaurant_id,'ownerRestaurantLocationId',v_restaurant.location_id) else row end)
      from jsonb_array_elements(v_response->'lineResults') row));
  end if;
  if v_menu.id is null then
    v_menu_candidate := public.submit_restaurant_menu_candidate_v1('owner-menu:' || v_restaurant_id::text || ':' || v_menu_fingerprint,
      null,null,v_restaurant.merchant_candidate_id,v_line.product_name,
      jsonb_strip_nulls(jsonb_build_object('serving_label',v_line.option_text)),true);
    if v_menu_candidate->>'reviewStatus' = 'rejected' then raise exception 'menu candidate was rejected' using errcode = '23514'; end if;
    select * into v_menu from public.purchase_owner_menus where user_id = v_actor and restaurant_id = v_restaurant_id and facts_fingerprint = v_menu_fingerprint;
    if v_menu.id is null then
      insert into public.purchase_owner_menus(user_id,restaurant_id,menu_name,serving_label,facts_fingerprint,menu_candidate_id)
        values(v_actor,v_restaurant_id,v_line.product_name,v_line.option_text,v_menu_fingerprint,(v_menu_candidate->>'candidateId')::uuid) returning * into v_menu;
    end if;
  end if;
  v_menu_id := v_menu.id;
  insert into public.purchase_owner_menu_sources(user_id, purchase_source_line_id, restaurant_id, restaurant_source_binding_id, menu_id)
    values(v_actor, v_line.id, v_restaurant_id, v_binding_id, v_menu_id);
  insert into public.purchase_owner_price_observations(user_id, purchase_source_line_id, menu_id, observed_on,
    quantity, unit_price_krw, gross_price_krw, discount_price_krw, net_price_krw)
    values(v_actor, v_line.id, v_menu_id, coalesce(v_source.ordered_on, v_source.paid_on), v_line.quantity,
      v_line.unit_price_krw, v_line.gross_price_krw, v_line.discount_price_krw, v_line.net_price_krw);
  return public.get_purchase_price_ingestion_response_v1(v_source.id);
end;
$function$;

revoke all on function public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid,text,uuid,boolean,uuid,uuid,text) from public,anon;
grant execute on function public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid,text,uuid,boolean,uuid,uuid,text) to authenticated;
-- Existing 4/5 argument clients retain their exact behavior and history.
create or replace function public.resolve_user_confirmed_purchase_restaurant_line_v1(
  p_purchase_source_id uuid,p_line_key text,p_merchant_candidate_id uuid,p_user_verified boolean,p_owner_restaurant_id uuid
) returns jsonb language sql security invoker set search_path = '' as $function$
  select public.resolve_user_confirmed_purchase_restaurant_line_v1(p_purchase_source_id,p_line_key,p_merchant_candidate_id,
    p_user_verified,p_owner_restaurant_id,null,'legacy');
$function$;

create function public.register_purchase_menu_components_v1(p_purchase_source_id uuid,p_line_key text,p_canonical_fingerprint text,p_components jsonb,p_user_verified boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare actor uuid := (select auth.uid()); l public.purchase_price_source_lines%rowtype; row jsonb; parent jsonb;
  owner_menu uuid; global_menu uuid; component uuid; fingerprint text; existing public.purchase_owner_menu_component_sources%rowtype;
begin
  if actor is null then raise exception 'authenticated purchase owner required' using errcode = '42501'; end if;
  if p_user_verified is distinct from true or p_canonical_fingerprint !~ '^[0-9a-f]{64}$' or p_canonical_fingerprint is null
    or jsonb_typeof(p_components) is distinct from 'array' or jsonb_array_length(p_components) > 100 then
    raise exception 'invalid reviewed components' using errcode = '22023'; end if;
  perform 1 from public.purchase_price_sources where id = p_purchase_source_id and user_id = actor for update;
  if not found then raise exception 'purchase source not owned' using errcode = '42501'; end if;
  select * into l from public.purchase_price_source_lines where purchase_source_id = p_purchase_source_id and source_line_key = p_line_key and user_id = actor for update;
  if not found then raise exception 'parent purchase line not owned' using errcode = '42501'; end if;
  select value into parent from jsonb_array_elements(public.get_purchase_price_ingestion_response_v1(p_purchase_source_id)->'lineResults') where value->>'lineKey' = p_line_key;
  if parent->>'observationCreated' <> 'true' then raise exception 'parent menu resolution required' using errcode = '22023'; end if;
  if parent->>'authorityStatus' = 'owner_confirmed' then owner_menu := (parent #>> '{ownerConfirmedIds,restaurantMenuId}')::uuid;
  elsif parent->>'authorityStatus' = 'exact' then global_menu := (parent #>> '{authoritativeIds,restaurantMenuId}')::uuid;
  else raise exception 'parent menu resolution required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':owner-components',0));
  if (select count(distinct item->>'nutritionClientKey') from jsonb_array_elements(p_components) item) <> jsonb_array_length(p_components) then
    raise exception 'duplicate nutrition component' using errcode = '22023'; end if;
  for row in select value from jsonb_array_elements(p_components) loop
    if jsonb_typeof(row) <> 'object' or (select array_agg(key order by key) from jsonb_object_keys(row) key) <> array['evidenceRefs','name','nutritionClientKey','role']
      or jsonb_typeof(row->'nutritionClientKey') is distinct from 'string' or length(btrim(row->>'nutritionClientKey')) not between 1 and 200
      or jsonb_typeof(row->'name') is distinct from 'string' or length(btrim(row->>'name')) not between 1 and 500
      or row->>'role' not in ('side','complimentary_side','sauce','beverage','other') or row->>'role' is null
      or jsonb_typeof(row->'evidenceRefs') is distinct from 'array' or jsonb_array_length(row->'evidenceRefs') = 0
      or exists(select 1 from jsonb_array_elements(row->'evidenceRefs') ref where jsonb_typeof(ref) <> 'string' or length(btrim(ref#>>'{}')) = 0) then
      raise exception 'invalid food-photo component facts' using errcode = '22023'; end if;
    fingerprint := encode(extensions.digest(row::text,'sha256'),'hex');
    select * into existing from public.purchase_owner_menu_component_sources where user_id = actor and purchase_source_id = p_purchase_source_id
      and canonical_fingerprint = p_canonical_fingerprint and nutrition_client_key = row->>'nutritionClientKey';
    if found then
      if existing.purchase_source_line_id <> l.id or existing.facts_fingerprint <> fingerprint then raise exception 'immutable component binding conflict' using errcode = '23505'; end if;
      continue;
    end if;
    select id into component from public.purchase_owner_menu_components where user_id = actor
      and owner_menu_id is not distinct from owner_menu and restaurant_menu_id is not distinct from global_menu and role = row->>'role' and name = row->>'name';
    if component is null then insert into public.purchase_owner_menu_components(user_id,owner_menu_id,restaurant_menu_id,name,role)
      values(actor,owner_menu,global_menu,row->>'name',row->>'role') returning id into component; end if;
    insert into public.purchase_owner_menu_component_sources(user_id,purchase_source_id,purchase_source_line_id,canonical_fingerprint,nutrition_client_key,component_id,food_evidence_refs,facts_fingerprint)
      values(actor,p_purchase_source_id,l.id,p_canonical_fingerprint,row->>'nutritionClientKey',component,row->'evidenceRefs',fingerprint);
  end loop;
  return public.get_purchase_price_ingestion_response_v1(p_purchase_source_id);
end;
$function$;
revoke all on function public.register_purchase_menu_components_v1(uuid,text,text,jsonb,boolean) from public,anon;
grant execute on function public.register_purchase_menu_components_v1(uuid,text,text,jsonb,boolean) to authenticated;

alter function public.private_purchase_price_line_response_v1(uuid,jsonb) rename to private_purchase_price_line_owner_response_v1;
create function public.private_purchase_price_line_response_v1(p_purchase_source_id uuid,p_base_response jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare actor uuid := (select auth.uid()); response jsonb; row jsonb; rows jsonb := '[]'; l public.purchase_price_source_lines%rowtype; restaurant uuid; components jsonb; platform jsonb;
begin
  response := public.private_purchase_price_line_owner_response_v1(p_purchase_source_id,p_base_response);
  for row in select value from jsonb_array_elements(response->'lineResults') loop
    select * into l from public.purchase_price_source_lines where user_id = actor and purchase_source_id = p_purchase_source_id and source_line_key = row->>'lineKey';
    restaurant := null;
    select b.restaurant_id into restaurant from public.purchase_owner_restaurant_sources b
      join public.merchant_identity_candidates c on c.id = b.merchant_candidate_id and c.user_id = b.user_id
      where b.user_id = actor and b.purchase_source_id = p_purchase_source_id and c.merchant_name = l.line_seller_name
        and c.branch_name is not distinct from l.line_seller_branch_name and c.source_namespace is not distinct from l.line_seller_source_namespace
        and c.source_code is not distinct from l.line_seller_source_code and c.review_status <> 'rejected';
    if restaurant is not null and row->>'observationCreated' <> 'true' then
      row := row || jsonb_build_object('ownerRestaurantId',restaurant,'ownerRestaurantLocationId',(select location_id from public.purchase_owner_restaurants where user_id = actor and id = restaurant),
        'reasonCode','owner_menu_selection_required','reason','owner_menu_selection_required',
        'ownerMenuChoices',public.private_purchase_owner_menu_choices_v1(l.id,restaurant,null));
    end if;
    rows := rows || jsonb_build_array(row);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'role',c.role,'lineKey',li.source_line_key,
    'nutritionClientKey',b.nutrition_client_key,'canonicalFingerprint',b.canonical_fingerprint,'evidenceRefs',b.food_evidence_refs,
    'parentOwnerMenuId',c.owner_menu_id,'parentRestaurantMenuId',c.restaurant_menu_id) order by b.canonical_fingerprint,b.nutrition_client_key),'[]') into components
    from public.purchase_owner_menu_component_sources b join public.purchase_owner_menu_components c on c.id = b.component_id and c.user_id = b.user_id
    join public.purchase_price_source_lines li on li.id = b.purchase_source_line_id and li.user_id = b.user_id
    where b.user_id = actor and b.purchase_source_id = p_purchase_source_id;
  select jsonb_build_object('id',p.id,'name',p.name,'authorityStatus','owner_confirmed') into platform from public.purchase_owner_platform_sources b
    join public.purchase_owner_platforms p on p.id = b.platform_id and p.user_id = b.user_id where b.user_id = actor and b.purchase_source_id = p_purchase_source_id;
  return response || jsonb_build_object('lineResults',rows,'menuComponents',components,'platformIdentity',platform);
end;
$function$;
revoke all on function public.private_purchase_price_line_response_v1(uuid,jsonb) from public,anon,authenticated;
do $refresh$
begin
  execute pg_get_functiondef('public.get_purchase_price_ingestion_response_v1(uuid)'::regprocedure);
  execute pg_get_functiondef('public.ingest_verified_purchase_price_observation_v1(text,jsonb)'::regprocedure);
end;
$refresh$;
notify pgrst, 'reload schema';

-- V1 remains byte-compatible for older strict readers.
-- Selecting a public registry row creates/reuses an owner-confirmed mapping. It never
-- grants the source pair the existing exact/global publication authority.
create function public.resolve_purchase_global_identity_v1(p_purchase_source_id uuid,p_line_key text,p_entity text,p_identity_id uuid,p_user_verified boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare actor uuid := (select auth.uid()); s public.purchase_price_sources%rowtype; source_line public.purchase_price_source_lines%rowtype;
  location public.restaurant_locations%rowtype; global_restaurant public.restaurants%rowtype; global_menu public.restaurant_menus%rowtype;
  owner_restaurant public.purchase_owner_restaurants%rowtype; owner_menu public.purchase_owner_menus%rowtype;
  candidate uuid; anchor uuid; proposal jsonb; fingerprint text; response jsonb; resolved jsonb;
begin
  if actor is null then raise exception 'authenticated purchase owner required' using errcode = '42501'; end if;
  if p_user_verified is distinct from true then raise exception 'current purchase review required' using errcode = '22023'; end if;
  select * into s from public.purchase_price_sources where id = p_purchase_source_id and user_id = actor for update;
  if not found then raise exception 'purchase source not owned' using errcode = '42501'; end if;
  select * into source_line from public.purchase_price_source_lines where user_id = actor and purchase_source_id = s.id and source_line_key = p_line_key for update;
  if not found then raise exception 'purchase line not owned' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':owner-restaurants',0));
  response := public.get_purchase_price_ingestion_response_v1(s.id);
  select value into resolved from jsonb_array_elements(response->'lineResults') where value->>'lineKey' = p_line_key;
  if resolved->>'observationCreated' = 'true' then return response; end if;
  if p_entity = 'restaurant' then
    select loc.* into location from public.restaurant_locations loc join public.restaurants r on r.id = loc.restaurant_id
      where loc.id = p_identity_id and loc.review_status = 'verified' and loc.verification_status = 'verified'
        and r.status = 'active' and r.review_status = 'verified' and r.verification_status = 'verified'
        and (source_line.line_seller_branch_name is null or loc.location_label = source_line.line_seller_branch_name)
        and (source_line.line_seller_source_namespace is null or (loc.source_namespace = source_line.line_seller_source_namespace and loc.source_location_code = source_line.line_seller_source_code));
    if not found then raise exception 'public location incompatible or unverified' using errcode = '42501'; end if;
    select * into global_restaurant from public.restaurants where id = location.restaurant_id;
  elsif p_entity = 'menu' then
    select r.* into owner_restaurant from public.purchase_owner_restaurant_sources b join public.purchase_owner_restaurants r on r.id = b.restaurant_id and r.user_id = b.user_id
      join public.merchant_identity_candidates c on c.id = b.merchant_candidate_id and c.user_id = b.user_id
      where b.user_id = actor and b.purchase_source_id = s.id and c.merchant_name = source_line.line_seller_name
        and c.branch_name is not distinct from source_line.line_seller_branch_name and c.source_namespace is not distinct from source_line.line_seller_source_namespace
        and c.source_code is not distinct from source_line.line_seller_source_code and c.review_status <> 'rejected';
    select m.* into global_menu from public.restaurant_menus m
      join public.restaurants gr on gr.id = m.restaurant_id and gr.status = 'active' and gr.review_status = 'verified' and gr.verification_status = 'verified'
      join public.restaurant_locations gl on gl.id = owner_restaurant.resolved_restaurant_location_id and gl.restaurant_id = gr.id and gl.review_status = 'verified' and gl.verification_status = 'verified'
      where m.id = p_identity_id and m.restaurant_id = owner_restaurant.resolved_restaurant_id
      and m.status = 'active' and m.review_status = 'verified' and m.verification_status = 'verified'
      and (source_line.option_text is null or source_line.option_text = m.serving_label);
    if not found then raise exception 'public menu incompatible or unverified' using errcode = '42501'; end if;
  else raise exception 'invalid global identity entity' using errcode = '22023'; end if;
  candidate := (public.submit_merchant_identity_candidate_v1('purchase-global:' || s.id::text || ':' || source_line.source_line_key,
    jsonb_strip_nulls(jsonb_build_object('merchant_name',source_line.line_seller_name,'branch_name',source_line.line_seller_branch_name,
      'business_kind','food_service','source_namespace',source_line.line_seller_source_namespace,'source_location_code',source_line.line_seller_source_code)),true)->>'candidateId')::uuid;
  if p_entity = 'restaurant' then
    if (select count(*) from public.purchase_owner_restaurants where user_id = actor and resolved_restaurant_id = global_restaurant.id and resolved_restaurant_location_id = location.id) > 1 then
      raise exception 'choose an existing owner restaurant mapping' using errcode = '22023'; end if;
    select * into owner_restaurant from public.purchase_owner_restaurants where user_id = actor and resolved_restaurant_id = global_restaurant.id and resolved_restaurant_location_id = location.id;
    if owner_restaurant.id is null then
      -- Registry anchor facts and observed purchase facts are separate candidates/bindings.
      anchor := (public.submit_merchant_identity_candidate_v1('purchase-registry:' || location.id::text,
        jsonb_strip_nulls(jsonb_build_object('merchant_name',global_restaurant.canonical_name,'branch_name',location.location_label,
          'business_kind','food_service','source_namespace',location.source_namespace,'source_location_code',location.source_location_code)),true)->>'candidateId')::uuid;
      select * into owner_restaurant from public.purchase_owner_restaurants where user_id = actor and merchant_candidate_id = anchor;
      if owner_restaurant.id is null then
        insert into public.purchase_owner_restaurants(user_id,merchant_candidate_id,merchant_name,branch_name,source_namespace,source_code,resolved_restaurant_id,resolved_restaurant_location_id)
          values(actor,anchor,global_restaurant.canonical_name,location.location_label,location.source_namespace,location.source_location_code,global_restaurant.id,location.id) returning * into owner_restaurant;
      elsif owner_restaurant.resolved_restaurant_id is null then
        update public.purchase_owner_restaurants set resolved_restaurant_id = global_restaurant.id,resolved_restaurant_location_id = location.id
          where user_id = actor and id = owner_restaurant.id returning * into owner_restaurant;
      elsif owner_restaurant.resolved_restaurant_id <> global_restaurant.id or owner_restaurant.resolved_restaurant_location_id <> location.id then
        raise exception 'registry mapping conflict' using errcode = '23505';
      end if;
    end if;
    return public.resolve_user_confirmed_purchase_restaurant_line_v1(s.id,p_line_key,candidate,true,owner_restaurant.id,null,'select_restaurant');
  end if;
  if (select count(*) from public.purchase_owner_menus where user_id = actor and restaurant_id = owner_restaurant.id and resolved_restaurant_menu_id = global_menu.id and serving_label is not distinct from source_line.option_text) > 1 then
    raise exception 'choose an existing owner menu mapping' using errcode = '22023'; end if;
  select * into owner_menu from public.purchase_owner_menus where user_id = actor and restaurant_id = owner_restaurant.id and resolved_restaurant_menu_id = global_menu.id and serving_label is not distinct from source_line.option_text;
  if owner_menu.id is null then
    fingerprint := encode(extensions.digest(jsonb_build_object('registryMenu',global_menu.id,'serving',source_line.option_text)::text,'sha256'),'hex');
    proposal := public.submit_restaurant_menu_candidate_v1('owner-global-menu:' || owner_restaurant.id::text || ':' || fingerprint,
      null,null,owner_restaurant.merchant_candidate_id,source_line.product_name,jsonb_strip_nulls(jsonb_build_object('serving_label',source_line.option_text)),true);
    if proposal->>'reviewStatus' = 'rejected' then raise exception 'menu candidate rejected' using errcode = '23514'; end if;
    insert into public.purchase_owner_menus(user_id,restaurant_id,menu_name,serving_label,facts_fingerprint,menu_candidate_id,resolved_restaurant_id,resolved_restaurant_menu_id,resolved_catalog_product_id)
      values(actor,owner_restaurant.id,global_menu.canonical_name,source_line.option_text,fingerprint,(proposal->>'candidateId')::uuid,global_menu.restaurant_id,global_menu.id,global_menu.catalog_product_id) returning * into owner_menu;
  end if;
  return public.resolve_user_confirmed_purchase_restaurant_line_v1(s.id,p_line_key,candidate,true,owner_restaurant.id,owner_menu.id,'select_menu');
end;
$function$;
revoke all on function public.resolve_purchase_global_identity_v1(uuid,text,text,uuid,boolean) from public,anon;
grant execute on function public.resolve_purchase_global_identity_v1(uuid,text,text,uuid,boolean) to authenticated;

create function public.get_my_owner_confirmed_restaurants_v2()
returns jsonb language plpgsql stable security invoker set search_path = '' as $function$
declare response jsonb; restaurants jsonb;
begin
  response := public.get_my_owner_confirmed_restaurants_v1();
  select coalesce(jsonb_agg(r || jsonb_build_object('menus',(select coalesce(jsonb_agg(m || jsonb_build_object('components',
    (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'role',c.role) order by c.role,c.name,c.id),'[]')
      from public.purchase_owner_menu_components c where c.user_id = (select auth.uid()) and c.owner_menu_id = (m->>'id')::uuid))),'[]')
    from jsonb_array_elements(r->'menus') m))),'[]') into restaurants from jsonb_array_elements(response->'restaurants') r;
  return response || jsonb_build_object('schemaVersion','owner-restaurant-read.v2','restaurants',restaurants);
end;
$function$;
revoke all on function public.get_my_owner_confirmed_restaurants_v2() from public,anon;
grant execute on function public.get_my_owner_confirmed_restaurants_v2() to authenticated;
