-- Admin-only restaurant profile and source-location registration/update.
-- New records remain unverified so they cannot enter the public directory
-- until an evidence review promotes them.

create function public.get_admin_restaurant_profiles_v1(
  p_query text default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'PT 관리자 인증이 필요합니다.' using errcode = '42501';
  end if;

  return (
    with profile_rows as (
      select
        restaurant.id,
        restaurant.canonical_name,
        restaurant.legal_name,
        restaurant.cuisine_type,
        restaurant.official_site_url,
        restaurant.review_status,
        restaurant.status,
        restaurant.verification_status,
        restaurant.created_at,
        restaurant.updated_at,
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', location.id,
              'sourceNamespace', location.source_namespace,
              'sourceLocationCode', location.source_location_code,
              'locationLabel', location.location_label,
              'officialUrl', location.official_url,
              'reviewStatus', location.review_status,
              'verificationStatus', location.verification_status
            )
            order by location.location_label nulls last, location.id
          )
          from public.restaurant_locations as location
          where location.restaurant_id = restaurant.id
        ), '[]'::jsonb) as locations
      from public.restaurants as restaurant
      where restaurant.status = 'active'
        and (
          nullif(btrim(p_query), '') is null
          or restaurant.canonical_name ilike '%' || btrim(p_query) || '%'
          or coalesce(restaurant.legal_name, '') ilike '%' || btrim(p_query) || '%'
          or coalesce(restaurant.cuisine_type, '') ilike '%' || btrim(p_query) || '%'
          or exists (
            select 1
            from public.restaurant_locations as search_location
            where search_location.restaurant_id = restaurant.id
              and (
                search_location.source_location_code ilike '%' || btrim(p_query) || '%'
                or coalesce(search_location.location_label, '') ilike '%' || btrim(p_query) || '%'
              )
          )
        )
      order by restaurant.canonical_name, restaurant.id
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    )
    select jsonb_build_object(
      'schemaVersion', 'admin-restaurant-profile.v1',
      'profiles', coalesce(jsonb_agg(
        jsonb_build_object(
          'id', profile_rows.id,
          'canonicalName', profile_rows.canonical_name,
          'legalName', profile_rows.legal_name,
          'cuisineType', profile_rows.cuisine_type,
          'officialSiteUrl', profile_rows.official_site_url,
          'reviewStatus', profile_rows.review_status,
          'status', profile_rows.status,
          'verificationStatus', profile_rows.verification_status,
          'createdAt', profile_rows.created_at,
          'updatedAt', profile_rows.updated_at,
          'locations', profile_rows.locations
        )
        order by profile_rows.canonical_name, profile_rows.id
      ), '[]'::jsonb)
    )
    from profile_rows
  );
end;
$function$;
comment on function public.get_admin_restaurant_profiles_v1(text, integer) is
  'Admin-only list of active restaurant profiles and all source locations, including unverified records.';
revoke all on function public.get_admin_restaurant_profiles_v1(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_admin_restaurant_profiles_v1(text, integer)
  to authenticated;
create function public.admin_upsert_restaurant_profile_v1(
  p_restaurant_id uuid,
  p_canonical_name text,
  p_legal_name text,
  p_cuisine_type text,
  p_official_site_url text,
  p_source_namespace text,
  p_source_location_code text,
  p_location_label text,
  p_location_official_url text
)
returns table (
  restaurant_id uuid,
  restaurant_location_id uuid,
  created boolean,
  verification_status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_restaurant_id uuid := p_restaurant_id;
  v_location_id uuid;
  v_location_restaurant_id uuid;
  v_created boolean := false;
  v_verification_status text;
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'PT 관리자 인증이 필요합니다.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_canonical_name, ''))) = 0
    or length(btrim(coalesce(p_source_namespace, ''))) = 0
    or length(btrim(coalesce(p_source_location_code, ''))) = 0
  then
    raise exception '식당 Brand와 source identity는 필수입니다.' using errcode = '23514';
  end if;

  if (p_official_site_url is not null and btrim(p_official_site_url) <> ''
      and btrim(p_official_site_url) !~ '^https?://')
    or (p_location_official_url is not null and btrim(p_location_official_url) <> ''
      and btrim(p_location_official_url) !~ '^https?://')
  then
    raise exception '공식 URL은 http 또는 https 주소여야 합니다.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      btrim(p_source_namespace) || ':' || btrim(p_source_location_code),
      0
    )
  );

  select location.id, location.restaurant_id
  into v_location_id, v_location_restaurant_id
  from public.restaurant_locations as location
  where location.source_namespace = btrim(p_source_namespace)
    and location.source_location_code = btrim(p_source_location_code)
  for update;

  if v_restaurant_id is not null then
    perform 1
    from public.restaurants as restaurant
    where restaurant.id = v_restaurant_id
      and restaurant.status = 'active'
    for update;
    if not found then
      raise exception '수정할 식당을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
  elsif v_location_restaurant_id is not null then
    v_restaurant_id := v_location_restaurant_id;
  end if;

  if v_location_restaurant_id is not null
    and v_restaurant_id <> v_location_restaurant_id
  then
    raise exception 'source identity가 다른 식당에 이미 연결되어 있습니다.' using errcode = '23505';
  end if;

  if v_restaurant_id is null then
    insert into public.restaurants (
      canonical_name,
      legal_name,
      cuisine_type,
      official_site_url,
      review_status,
      status,
      verification_status,
      created_by
    ) values (
      btrim(p_canonical_name),
      nullif(btrim(p_legal_name), ''),
      nullif(btrim(p_cuisine_type), ''),
      nullif(btrim(p_official_site_url), ''),
      'pending',
      'active',
      'unverified',
      v_user_id
    ) returning id into v_restaurant_id;
    v_created := true;
  else
    update public.restaurants
    set canonical_name = btrim(p_canonical_name),
        legal_name = nullif(btrim(p_legal_name), ''),
        cuisine_type = nullif(btrim(p_cuisine_type), ''),
        official_site_url = nullif(btrim(p_official_site_url), ''),
        updated_at = v_now
    where id = v_restaurant_id;
  end if;

  if v_location_id is null then
    insert into public.restaurant_locations (
      restaurant_id,
      source_namespace,
      source_location_code,
      location_label,
      official_url,
      review_status,
      verification_status,
      created_by
    ) values (
      v_restaurant_id,
      btrim(p_source_namespace),
      btrim(p_source_location_code),
      nullif(btrim(p_location_label), ''),
      nullif(btrim(p_location_official_url), ''),
      'pending',
      'unverified',
      v_user_id
    ) returning id into v_location_id;
  else
    update public.restaurant_locations
    set location_label = nullif(btrim(p_location_label), ''),
        official_url = nullif(btrim(p_location_official_url), '')
    where id = v_location_id
      and restaurant_id = v_restaurant_id;
  end if;

  select restaurant.verification_status
  into v_verification_status
  from public.restaurants as restaurant
  where restaurant.id = v_restaurant_id;

  return query
  select v_restaurant_id, v_location_id, v_created, v_verification_status, v_now;
end;
$function$;
comment on function public.admin_upsert_restaurant_profile_v1(uuid, text, text, text, text, text, text, text, text) is
  'Admin-only create/update of a restaurant profile and one exact source location. New records remain unverified.';
revoke all on function public.admin_upsert_restaurant_profile_v1(uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_upsert_restaurant_profile_v1(uuid, text, text, text, text, text, text, text, text)
  to authenticated;
