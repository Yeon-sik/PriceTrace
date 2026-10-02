-- Atomic admin upsert for one restaurant profile and all of its PT branch
-- identities. Existing source identities are preserved; new branches are
-- inserted into the same restaurant_locations table consumed by PT reads.

create function public.admin_upsert_restaurant_profile_with_locations_v1(
  p_restaurant_id uuid,
  p_canonical_name text,
  p_legal_name text,
  p_cuisine_type text,
  p_official_site_url text,
  p_locations jsonb
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
  v_restaurant_id uuid := p_restaurant_id;
  v_location_id uuid;
  v_source_restaurant_id uuid;
  v_location jsonb;
  v_source_namespace text;
  v_source_location_code text;
  v_location_label text;
  v_location_official_url text;
  v_created boolean := false;
  v_verification_status text;
  v_updated_at timestamptz := now();
  v_first_location_id uuid;
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'PT 관리자 인증이 필요합니다.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_canonical_name, ''))) = 0
    or jsonb_typeof(p_locations) <> 'array'
    or jsonb_array_length(p_locations) < 1
    or jsonb_array_length(p_locations) > 100
  then
    raise exception '식당 Brand와 최소 1개의 지점 정보가 필요합니다.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_locations) as location(
      source_namespace text,
      source_location_code text
    )
    group by btrim(location.source_namespace), btrim(location.source_location_code)
    having count(*) > 1
  ) then
    raise exception '같은 source identity를 여러 지점에 사용할 수 없습니다.' using errcode = '23505';
  end if;

  for v_location in select value from jsonb_array_elements(p_locations) as value loop
    v_source_namespace := btrim(coalesce(v_location ->> 'sourceNamespace', ''));
    v_source_location_code := btrim(coalesce(v_location ->> 'sourceLocationCode', ''));
    v_location_label := nullif(btrim(v_location ->> 'locationLabel'), '');
    v_location_official_url := nullif(btrim(v_location ->> 'locationOfficialUrl'), '');

    if length(v_source_namespace) = 0 or length(v_source_namespace) > 100
      or length(v_source_location_code) = 0 or length(v_source_location_code) > 200
    then
      raise exception '각 지점의 source namespace와 source location code는 필수입니다.'
        using errcode = '23514';
    end if;

    if (v_location_official_url is not null and v_location_official_url !~ '^https?://')
    then
      raise exception '지점 공식 URL은 http 또는 https 주소여야 합니다.' using errcode = '22023';
    end if;
  end loop;

  if v_restaurant_id is not null then
    perform 1
    from public.restaurants as restaurant
    where restaurant.id = v_restaurant_id
      and restaurant.status = 'active'
    for update;
    if not found then
      raise exception '수정할 식당을 찾을 수 없습니다.' using errcode = 'P0002';
    end if;
  else
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
  end if;

  update public.restaurants
  set canonical_name = btrim(p_canonical_name),
      legal_name = nullif(btrim(p_legal_name), ''),
      cuisine_type = nullif(btrim(p_cuisine_type), ''),
      official_site_url = nullif(btrim(p_official_site_url), ''),
      updated_at = v_updated_at
  where id = v_restaurant_id;

  for v_location in select value from jsonb_array_elements(p_locations) as value loop
    v_source_namespace := btrim(v_location ->> 'sourceNamespace');
    v_source_location_code := btrim(v_location ->> 'sourceLocationCode');
    v_location_label := nullif(btrim(v_location ->> 'locationLabel'), '');
    v_location_official_url := nullif(btrim(v_location ->> 'locationOfficialUrl'), '');

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_source_namespace || ':' || v_source_location_code,
        0
      )
    );

    select location.id, location.restaurant_id
    into v_location_id, v_source_restaurant_id
    from public.restaurant_locations as location
    where location.source_namespace = v_source_namespace
      and location.source_location_code = v_source_location_code
    for update;

    if v_source_restaurant_id is not null and v_source_restaurant_id <> v_restaurant_id then
      raise exception '지점 source identity가 다른 식당에 이미 연결되어 있습니다.'
        using errcode = '23505';
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
        v_source_namespace,
        v_source_location_code,
        v_location_label,
        v_location_official_url,
        'pending',
        'unverified',
        v_user_id
      ) returning id into v_location_id;
    else
      update public.restaurant_locations
      set location_label = v_location_label,
          official_url = v_location_official_url
      where id = v_location_id
        and restaurant_id = v_restaurant_id;
    end if;

    if v_first_location_id is null then
      v_first_location_id := v_location_id;
    end if;
  end loop;

  select restaurant.verification_status
  into v_verification_status
  from public.restaurants as restaurant
  where restaurant.id = v_restaurant_id;

  return query
  select v_restaurant_id, v_first_location_id, v_created, v_verification_status, v_updated_at;
end;
$function$;
comment on function public.admin_upsert_restaurant_profile_with_locations_v1(
  uuid, text, text, text, text, jsonb
) is
  'Admin-only atomic upsert of a restaurant profile and its complete PT restaurant_locations identity set.';
revoke all on function public.admin_upsert_restaurant_profile_with_locations_v1(
  uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_upsert_restaurant_profile_with_locations_v1(
  uuid, text, text, text, text, jsonb
) to authenticated;
