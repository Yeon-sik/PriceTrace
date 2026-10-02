-- Publish an owner-created FitnessApp dining-out menu into the PT restaurant catalog.
-- The caller must be a PT administrator. The source food id is the idempotent
-- boundary; restaurant names are never used as a cross-system identity.

create table public.fitness_dining_out_publications (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 1 and 200),
  nutrition_food_id text not null unique check (length(btrim(nutrition_food_id)) between 1 and 200),
  nutrition_revision integer not null default 1 check (nutrition_revision > 0),
  request_payload jsonb not null,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  restaurant_location_id uuid not null,
  restaurant_menu_id uuid not null,
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict
);
alter table public.fitness_dining_out_publications enable row level security;
revoke all on public.fitness_dining_out_publications from anon, authenticated;
create index fitness_dining_out_publications_restaurant_idx
  on public.fitness_dining_out_publications(restaurant_id, restaurant_menu_id);
create or replace function public.admin_publish_fitness_dining_out_v1(
  p_idempotency_key text,
  p_nutrition_food_id text,
  p_nutrition_revision integer,
  p_restaurant_id uuid,
  p_restaurant_name text,
  p_restaurant_location_id uuid,
  p_source_location_namespace text,
  p_source_location_code text,
  p_location_label text,
  p_restaurant_menu_id uuid,
  p_catalog_product_id uuid,
  p_menu_name text,
  p_menu_category_label text,
  p_serving_label text
)
returns table (
  restaurant_id uuid,
  restaurant_location_id uuid,
  restaurant_menu_id uuid,
  catalog_product_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_request jsonb;
  v_existing public.fitness_dining_out_publications%rowtype;
  v_restaurant_id uuid := p_restaurant_id;
  v_restaurant_location_id uuid := p_restaurant_location_id;
  v_restaurant_menu_id uuid := p_restaurant_menu_id;
  v_catalog_product_id uuid := p_catalog_product_id;
  v_source_restaurant_id uuid;
  v_menu_restaurant_id uuid;
  v_standard_product_id uuid;
begin
  if v_user_id is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'PT 관리자 인증이 필요합니다.' using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_idempotency_key, ''))) not between 1 and 200
    or length(btrim(coalesce(p_nutrition_food_id, ''))) = 0
    or p_nutrition_revision is null
    or p_nutrition_revision < 1
    or length(btrim(coalesce(p_restaurant_name, ''))) = 0
    or length(btrim(coalesce(p_source_location_namespace, ''))) = 0
    or length(btrim(coalesce(p_source_location_code, ''))) = 0
    or length(btrim(coalesce(p_menu_name, ''))) = 0
    or length(btrim(coalesce(p_serving_label, ''))) = 0
  then
    raise exception 'FT 식당·지점 source identity·메뉴 정보가 올바르지 않습니다.'
      using errcode = '23514';
  end if;

  if btrim(p_source_location_namespace) not in ('fitnessapp', 'pricetrace')
     or (
       btrim(p_source_location_namespace) = 'pricetrace'
       and (
         p_restaurant_id is null
         or p_restaurant_location_id is null
         or p_restaurant_menu_id is null
         or p_catalog_product_id is null
       )
     ) then
    raise exception 'FitnessApp 신규 identity 또는 완전한 PriceTrace identity만 허용됩니다.'
      using errcode = '23514';
  end if;

  v_request := jsonb_build_object(
    'nutritionFoodId', btrim(p_nutrition_food_id),
    'nutritionRevision', p_nutrition_revision,
    'restaurantId', p_restaurant_id,
    'restaurantName', btrim(p_restaurant_name),
    'restaurantLocationId', p_restaurant_location_id,
    'sourceLocationNamespace', btrim(p_source_location_namespace),
    'sourceLocationCode', btrim(p_source_location_code),
    'locationLabel', nullif(btrim(p_location_label), ''),
    'restaurantMenuId', p_restaurant_menu_id,
    'catalogProductId', p_catalog_product_id,
    'menuName', btrim(p_menu_name),
    'menuCategoryLabel', nullif(btrim(p_menu_category_label), ''),
    'servingLabel', btrim(p_serving_label)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(btrim(p_idempotency_key), 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      btrim(p_source_location_namespace) || ':' || btrim(p_source_location_code),
      0
    )
  );

  select publication.*
  into v_existing
  from public.fitness_dining_out_publications as publication
  where publication.idempotency_key = btrim(p_idempotency_key)
     or publication.nutrition_food_id = btrim(p_nutrition_food_id)
  for update;

  if found then
    if v_existing.request_payload <> v_request then
      raise exception '동일한 FT 메뉴에 다른 공개 요청이 이미 존재합니다.' using errcode = '23505';
    end if;
    return query
    select
      v_existing.restaurant_id,
      v_existing.restaurant_location_id,
      v_existing.restaurant_menu_id,
      v_existing.catalog_product_id,
      true;
    return;
  end if;

  if v_restaurant_id is not null then
    perform 1
    from public.restaurants as restaurant
    where restaurant.id = v_restaurant_id
      and restaurant.status = 'active'
      and restaurant.canonical_name = btrim(p_restaurant_name)
    for update;
    if not found then
      raise exception '요청한 PT 식당을 찾을 수 없거나 이름이 다릅니다.' using errcode = 'P0002';
    end if;
  end if;

  select location.restaurant_id, location.id
  into v_source_restaurant_id, v_restaurant_location_id
  from public.restaurant_locations as location
  where location.source_namespace = btrim(p_source_location_namespace)
    and location.source_location_code = btrim(p_source_location_code)
  for update;

  if v_source_restaurant_id is not null then
    if v_restaurant_id is not null and v_restaurant_id <> v_source_restaurant_id then
      raise exception 'FT 지점 identity가 다른 PT 식당에 이미 연결되어 있습니다.' using errcode = '23505';
    end if;
    v_restaurant_id := v_source_restaurant_id;
  end if;

  if v_restaurant_id is null then
    insert into public.restaurants (
      canonical_name,
      review_status,
      status,
      verification_status,
      created_by,
      reviewed_by,
      reviewed_at
    ) values (
      btrim(p_restaurant_name),
      'verified',
      'active',
      'verified',
      v_user_id,
      v_user_id,
      v_now
    ) returning id into v_restaurant_id;
  end if;

  if v_restaurant_location_id is not null then
    perform 1
    from public.restaurant_locations as location
    where location.id = v_restaurant_location_id
      and location.restaurant_id = v_restaurant_id
      and location.source_namespace = btrim(p_source_location_namespace)
      and location.source_location_code = btrim(p_source_location_code)
    for update;
    if not found then
      raise exception '요청한 PT 지점 identity가 식당과 일치하지 않습니다.' using errcode = '23514';
    end if;
  else
    insert into public.restaurant_locations (
      restaurant_id,
      source_namespace,
      source_location_code,
      location_label,
      review_status,
      verification_status,
      created_by,
      reviewed_by,
      reviewed_at
    ) values (
      v_restaurant_id,
      btrim(p_source_location_namespace),
      btrim(p_source_location_code),
      nullif(btrim(p_location_label), ''),
      'verified',
      'verified',
      v_user_id,
      v_user_id,
      v_now
    ) returning id into v_restaurant_location_id;
  end if;

  update public.restaurants
  set review_status = 'verified',
      verification_status = 'verified',
      reviewed_by = v_user_id,
      reviewed_at = v_now,
      updated_at = v_now
  where id = v_restaurant_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_restaurant_id::text || ':' || lower(btrim(p_menu_name)) || ':' || btrim(p_serving_label),
      0
    )
  );

  if v_restaurant_menu_id is not null then
    select menu.restaurant_id, menu.catalog_product_id
    into v_menu_restaurant_id, v_catalog_product_id
    from public.restaurant_menus as menu
    where menu.id = v_restaurant_menu_id
      and menu.status = 'active'
      and menu.canonical_name = btrim(p_menu_name)
    for update;
    if not found or v_menu_restaurant_id <> v_restaurant_id then
      raise exception '요청한 PT 메뉴 identity가 식당과 일치하지 않습니다.' using errcode = '23514';
    end if;
    if p_catalog_product_id is not null and p_catalog_product_id <> v_catalog_product_id then
      raise exception 'PT 메뉴와 catalog product identity가 일치하지 않습니다.' using errcode = '23514';
    end if;
  elsif v_catalog_product_id is not null then
    select menu.id, menu.restaurant_id
    into v_restaurant_menu_id, v_menu_restaurant_id
    from public.restaurant_menus as menu
    where menu.catalog_product_id = v_catalog_product_id
      and menu.status = 'active'
    for update;
    if not found or v_menu_restaurant_id <> v_restaurant_id then
      raise exception '요청한 catalog product가 식당 메뉴와 일치하지 않습니다.' using errcode = '23514';
    end if;
  else
    select menu.id, menu.catalog_product_id
    into v_restaurant_menu_id, v_catalog_product_id
    from public.restaurant_menus as menu
    where menu.restaurant_id = v_restaurant_id
      and menu.status = 'active'
      and menu.canonical_name = btrim(p_menu_name)
      and menu.serving_label = btrim(p_serving_label)
    for update;

    if not found then
      insert into public.standard_products (
        purchase_type,
        canonical_name,
        brand,
        status,
        created_by,
        verification_status
      ) values (
        'menu_item',
        btrim(p_menu_name),
        btrim(p_restaurant_name),
        'active',
        v_user_id,
        'verified'
      ) returning id into v_standard_product_id;

      insert into public.catalog_products (
        standard_product_id,
        purchase_type,
        canonical_name,
        brand,
        specification,
        specification_status,
        content_amount,
        content_unit,
        package_count,
        reference_unit,
        attributes,
        status,
        created_by,
        verification_status
      ) values (
        v_standard_product_id,
        'menu_item',
        btrim(p_menu_name),
        btrim(p_restaurant_name),
        btrim(p_serving_label),
        'placeholder',
        1,
        'each',
        1,
        100,
        jsonb_build_object(
          'restaurantId', v_restaurant_id,
          'registrationSource', 'fitnessapp-publication',
          'nutritionFoodId', btrim(p_nutrition_food_id)
        ),
        'active',
        v_user_id,
        'verified'
      ) returning id into v_catalog_product_id;

      insert into public.restaurant_menus (
        restaurant_id,
        catalog_product_id,
        canonical_name,
        category_label,
        serving_label,
        review_status,
        status,
        verification_status,
        created_by,
        reviewed_by,
        reviewed_at
      ) values (
        v_restaurant_id,
        v_catalog_product_id,
        btrim(p_menu_name),
        nullif(btrim(p_menu_category_label), ''),
        btrim(p_serving_label),
        'verified',
        'active',
        'verified',
        v_user_id,
        v_user_id,
        v_now
      ) returning id into v_restaurant_menu_id;

      update public.catalog_products
      set attributes = attributes || jsonb_build_object('restaurantMenuId', v_restaurant_menu_id),
          updated_at = v_now
      where id = v_catalog_product_id;
    end if;
  end if;

  update public.restaurant_locations
  set review_status = 'verified',
      verification_status = 'verified',
      reviewed_by = v_user_id,
      reviewed_at = v_now
  where id = v_restaurant_location_id;

  update public.restaurant_menus
  set review_status = 'verified',
      verification_status = 'verified',
      reviewed_by = v_user_id,
      reviewed_at = v_now,
      updated_at = v_now
  where id = v_restaurant_menu_id;

  insert into public.fitness_dining_out_publications (
    idempotency_key,
    nutrition_food_id,
    nutrition_revision,
    request_payload,
    restaurant_id,
    restaurant_location_id,
    restaurant_menu_id,
    catalog_product_id,
    created_by,
    created_at,
    updated_at
  ) values (
    btrim(p_idempotency_key),
    btrim(p_nutrition_food_id),
    p_nutrition_revision,
    v_request,
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    v_catalog_product_id,
    v_user_id,
    v_now,
    v_now
  );

  return query
  select
    v_restaurant_id,
    v_restaurant_location_id,
    v_restaurant_menu_id,
    v_catalog_product_id,
    false;
end;
$function$;
comment on function public.admin_publish_fitness_dining_out_v1(
  text, text, integer, uuid, text, uuid, text, text, text, uuid, uuid, text, text, text
) is
  'PT-admin-only, idempotent publication of an owner-created FitnessApp dining-out menu. Existing exact restaurant identities reuse the restaurant; otherwise restaurant and menu identities are created and verified together.';
revoke all on function public.admin_publish_fitness_dining_out_v1(
  text, text, integer, uuid, text, uuid, text, text, text, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.admin_publish_fitness_dining_out_v1(
  text, text, integer, uuid, text, uuid, text, text, text, uuid, uuid, text, text, text
) to authenticated;
