-- Shared institution facts only. Payment/prescription/source documents stay private.
create table if not exists public.pricetrace_care_places (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('hospital','pharmacy')),
  name text not null check (char_length(name) between 1 and 200),
  address text not null check (char_length(address) between 1 and 500),
  phone text not null default '' check (char_length(phone) <= 60),
  identity_key text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.pricetrace_care_place_registrations (
  user_id uuid not null references auth.users(id),
  request_id uuid not null,
  place_id uuid not null references public.pricetrace_care_places(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key(user_id, request_id)
);
create index if not exists care_places_category_created on public.pricetrace_care_places(category,created_at desc) where active;
create index if not exists care_registrations_place on public.pricetrace_care_place_registrations(place_id);
alter table public.pricetrace_care_places enable row level security;
alter table public.pricetrace_care_place_registrations enable row level security;
revoke all on public.pricetrace_care_places, public.pricetrace_care_place_registrations from public,anon,authenticated;
grant select on public.pricetrace_care_place_registrations to authenticated;
create policy care_registrations_owner_read on public.pricetrace_care_place_registrations
  for select to authenticated using (user_id = (select auth.uid()));

-- No owner/source/payment fields are present in this public response.
create or replace function public.search_care_places_v1(p_query text default '', p_category text default null, p_limit integer default 30)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(item order by created_at desc, id), '[]'::jsonb)
  from (
    select p.id, p.created_at, jsonb_build_object('schema_version','care-place.v1',
      'place_id',p.id,'category',p.category,'name',p.name,'address',p.address,'phone',p.phone) item
    from public.pricetrace_care_places p
    where p.active and (p_category is null or p.category=p_category)
      and (coalesce(btrim(p_query),'')='' or strpos(lower(p.name || ' ' || p.address),lower(btrim(p_query))) > 0)
    order by p.created_at desc,p.id limit least(greatest(coalesce(p_limit,30),1),100)
  ) found;
$$;
create or replace function public.get_care_place_v1(p_place_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('schema_version','care-place.v1','place_id',id,
    'category',category,'name',name,'address',address,'phone',phone)
  from public.pricetrace_care_places where id=p_place_id and active;
$$;
create or replace function public.register_care_place_v1(p_request_id uuid, p_place jsonb, p_public_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid(); v_payload jsonb; v_old public.pricetrace_care_place_registrations%rowtype;
  v_id uuid; v_key text; v_category text; v_name text; v_address text; v_phone text;
begin
  if v_owner is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_public_confirmed is distinct from true or p_request_id is null then
    raise exception 'Confirm institution information publication' using errcode='22023'; end if;
  if jsonb_typeof(p_place) is distinct from 'object' or exists(
    select 1 from jsonb_object_keys(p_place) k where k not in ('category','name','address','phone')) then
    raise exception 'Only institution fields are accepted' using errcode='22023'; end if;
  if jsonb_typeof(p_place->'category') is distinct from 'string'
    or jsonb_typeof(p_place->'name') is distinct from 'string'
    or jsonb_typeof(p_place->'address') is distinct from 'string'
    or (p_place ? 'phone' and jsonb_typeof(p_place->'phone') is distinct from 'string') then
    raise exception 'Invalid institution field types' using errcode='22023'; end if;
  v_category:=p_place->>'category'; v_name:=btrim(p_place->>'name');
  v_address:=btrim(p_place->>'address'); v_phone:=btrim(coalesce(p_place->>'phone',''));
  if v_category not in ('hospital','pharmacy') or char_length(v_name) not between 1 and 200
    or char_length(v_address) not between 1 and 500 or char_length(v_phone)>60 then
    raise exception 'Check institution category, name and address' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('category',v_category,'name',v_name,'address',v_address,'phone',v_phone);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text || p_request_id::text,0));
  select * into v_old from public.pricetrace_care_place_registrations where user_id=v_owner and request_id=p_request_id;
  if found then
    if v_old.payload<>v_payload then raise exception 'Request content changed; use a new request' using errcode='23505'; end if;
    return jsonb_build_object('place',public.get_care_place_v1(v_old.place_id),'duplicate',true);
  end if;
  -- User confirms the exact name/address. Similar names are never automatically merged.
  v_key:=v_category || ':' || lower(regexp_replace(v_name,'\s+',' ','g')) || ':' || lower(regexp_replace(v_address,'\s+',' ','g'));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key,1));
  select id into v_id from public.pricetrace_care_places where identity_key=v_key and active;
  if v_id is null then
    if exists(select 1 from public.pricetrace_care_places where identity_key=v_key) then
      raise exception 'Institution is archived; review is required' using errcode='22023'; end if;
    insert into public.pricetrace_care_places(category,name,address,phone,identity_key)
    values(v_category,v_name,v_address,v_phone,v_key) returning id into v_id;
  end if;
  insert into public.pricetrace_care_place_registrations(user_id,request_id,place_id,payload)
    values(v_owner,p_request_id,v_id,v_payload);
  return jsonb_build_object('place',public.get_care_place_v1(v_id),'duplicate',
    exists(select 1 from public.pricetrace_care_place_registrations where place_id=v_id and (user_id,request_id)<>(v_owner,p_request_id)));
end;
$$;
revoke all on function public.search_care_places_v1(text,text,integer), public.get_care_place_v1(uuid),
  public.register_care_place_v1(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.search_care_places_v1(text,text,integer),public.get_care_place_v1(uuid) to anon,authenticated;
grant execute on function public.register_care_place_v1(uuid,jsonb,boolean) to authenticated;
