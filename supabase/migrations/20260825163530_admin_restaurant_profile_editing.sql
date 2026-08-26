-- Administrator-only restaurant profile maintenance. Contact facts are scoped to
-- one exact restaurant location, require a provenance URL, and never mutate
-- receipt evidence or the location source identity.
alter table public.restaurant_locations
  add column business_registration_number text,
  add column address text,
  add column phone text,
  add column profile_source_url text,
  add column profile_verified_at timestamptz,
  add column profile_updated_by uuid references auth.users(id) on delete set null,
  add constraint restaurant_locations_business_registration_number_check
    check (
      business_registration_number is null
      or business_registration_number ~ '^\\d{3}-\\d{2}-\\d{5}$'
    ),
  add constraint restaurant_locations_profile_source_url_check
    check (profile_source_url is null or profile_source_url ~ '^https?://');

create table public.restaurant_profile_update_audits (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  restaurant_location_id uuid not null,
  source_url text not null check (source_url ~ '^https?://'),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict
);

alter table public.restaurant_profile_update_audits enable row level security;
revoke all on public.restaurant_profile_update_audits from public, anon, authenticated;
grant select on public.restaurant_profile_update_audits to authenticated;
create policy "admins read restaurant profile update audits"
  on public.restaurant_profile_update_audits for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create function public.reject_restaurant_profile_update_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Restaurant profile update audits are append-only.' using errcode = '55000';
end;
$$;

create trigger restaurant_profile_update_audits_append_only
before update or delete on public.restaurant_profile_update_audits
for each row execute function public.reject_restaurant_profile_update_audit_mutation();

revoke all on function public.reject_restaurant_profile_update_audit_mutation()
  from public, anon, authenticated;

create function public.admin_list_restaurant_profile_editors_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_payload jsonb;
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(document order by document ->> 'canonicalName', document ->> 'id'), '[]'::jsonb)
  into v_payload
  from (
    select jsonb_build_object(
      'id', restaurant.id,
      'canonicalName', restaurant.canonical_name,
      'legalName', restaurant.legal_name,
      'cuisineType', restaurant.cuisine_type,
      'officialSiteUrl', restaurant.official_site_url,
      'locations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', location.id,
          'sourceLabel', location.source_namespace,
          'sourceRestaurantCode', location.source_location_code,
          'locationLabel', location.location_label,
          'officialUrl', location.official_url,
          'businessRegistrationNumber', location.business_registration_number,
          'address', location.address,
          'phone', location.phone,
          'profileSourceUrl', location.profile_source_url
        ) order by location.location_label nulls last, location.id)
        from public.restaurant_locations as location
        where location.restaurant_id = restaurant.id
      ), '[]'::jsonb)
    ) as document
    from public.restaurants as restaurant
    where restaurant.status = 'active'
  ) as documents;

  return v_payload;
end;
$$;

create function public.admin_update_restaurant_profile_editor_v1(
  p_restaurant_id uuid,
  p_restaurant_location_id uuid,
  p_canonical_name text,
  p_legal_name text,
  p_cuisine_type text,
  p_official_site_url text,
  p_location_label text,
  p_location_official_url text,
  p_business_registration_number text,
  p_address text,
  p_phone text,
  p_source_url text
)
returns table (
  restaurant_id uuid,
  restaurant_location_id uuid,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_registration_number text := nullif(
    regexp_replace(coalesce(p_business_registration_number, ''), '\\D', '', 'g'),
    ''
  );
  v_source_url text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_updated_at timestamptz;
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  if p_restaurant_id is null or p_restaurant_location_id is null
    or length(btrim(coalesce(p_canonical_name, ''))) = 0
  then
    raise exception '음식점과 지점, 음식점명은 필수입니다.' using errcode = '23514';
  end if;

  if v_source_url is null or v_source_url !~ '^https?://' then
    raise exception '수정 근거 URL은 HTTP(S) 주소여야 합니다.' using errcode = '23514';
  end if;

  if v_business_registration_number is not null and length(v_business_registration_number) <> 10 then
    raise exception '사업자등록번호는 숫자 10자리여야 합니다.' using errcode = '23514';
  end if;

  if (nullif(btrim(coalesce(p_official_site_url, '')), '') is not null and p_official_site_url !~ '^https?://')
    or (nullif(btrim(coalesce(p_location_official_url, '')), '') is not null and p_location_official_url !~ '^https?://')
  then
    raise exception '공식 URL은 HTTP(S) 주소여야 합니다.' using errcode = '23514';
  end if;

  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'canonicalName', restaurant.canonical_name,
      'legalName', restaurant.legal_name,
      'cuisineType', restaurant.cuisine_type,
      'officialSiteUrl', restaurant.official_site_url
    ),
    'location', jsonb_build_object(
      'locationLabel', location.location_label,
      'officialUrl', location.official_url,
      'businessRegistrationNumber', location.business_registration_number,
      'address', location.address,
      'phone', location.phone,
      'profileSourceUrl', location.profile_source_url
    )
  )
  into v_before_snapshot
  from public.restaurants as restaurant
  inner join public.restaurant_locations as location
    on location.restaurant_id = restaurant.id
  where restaurant.id = p_restaurant_id
    and location.id = p_restaurant_location_id
  for update of restaurant, location;

  if v_before_snapshot is null then
    raise exception '선택한 음식점 지점을 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  update public.restaurants
  set canonical_name = btrim(p_canonical_name),
      legal_name = nullif(btrim(coalesce(p_legal_name, '')), ''),
      cuisine_type = nullif(btrim(coalesce(p_cuisine_type, '')), ''),
      official_site_url = nullif(btrim(coalesce(p_official_site_url, '')), ''),
      updated_at = now()
  where id = p_restaurant_id;

  update public.restaurant_locations
  set location_label = nullif(btrim(coalesce(p_location_label, '')), ''),
      official_url = nullif(btrim(coalesce(p_location_official_url, '')), ''),
      business_registration_number = case
        when v_business_registration_number is null then null
        else substr(v_business_registration_number, 1, 3) || '-' || substr(v_business_registration_number, 4, 2) || '-' || substr(v_business_registration_number, 6, 5)
      end,
      address = nullif(btrim(coalesce(p_address, '')), ''),
      phone = nullif(btrim(coalesce(p_phone, '')), ''),
      profile_source_url = v_source_url,
      profile_verified_at = now(),
      profile_updated_by = v_user_id
  where id = p_restaurant_location_id
    and restaurant_id = p_restaurant_id
  returning profile_verified_at into v_updated_at;

  select jsonb_build_object(
    'restaurant', jsonb_build_object(
      'canonicalName', restaurant.canonical_name,
      'legalName', restaurant.legal_name,
      'cuisineType', restaurant.cuisine_type,
      'officialSiteUrl', restaurant.official_site_url
    ),
    'location', jsonb_build_object(
      'locationLabel', location.location_label,
      'officialUrl', location.official_url,
      'businessRegistrationNumber', location.business_registration_number,
      'address', location.address,
      'phone', location.phone,
      'profileSourceUrl', location.profile_source_url
    )
  )
  into v_after_snapshot
  from public.restaurants as restaurant
  inner join public.restaurant_locations as location
    on location.restaurant_id = restaurant.id
  where restaurant.id = p_restaurant_id
    and location.id = p_restaurant_location_id;

  if v_before_snapshot is distinct from v_after_snapshot then
    insert into public.restaurant_profile_update_audits (
      restaurant_id,
      restaurant_location_id,
      source_url,
      before_snapshot,
      after_snapshot,
      updated_by
    ) values (
      p_restaurant_id,
      p_restaurant_location_id,
      v_source_url,
      v_before_snapshot,
      v_after_snapshot,
      v_user_id
    );
  end if;

  return query select p_restaurant_id, p_restaurant_location_id, v_updated_at;
end;
$$;

revoke all on function public.admin_list_restaurant_profile_editors_v1()
  from public, anon, authenticated;
revoke all on function public.admin_update_restaurant_profile_editor_v1(uuid, uuid, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_list_restaurant_profile_editors_v1() to authenticated;
grant execute on function public.admin_update_restaurant_profile_editor_v1(uuid, uuid, text, text, text, text, text, text, text, text, text, text) to authenticated;
