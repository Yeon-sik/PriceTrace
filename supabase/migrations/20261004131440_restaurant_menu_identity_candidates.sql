-- Private, owner-bound proposals. Canonical registration remains an administrator operation.
create table public.restaurant_menu_identity_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  restaurant_id uuid references public.restaurants(id) on delete restrict,
  restaurant_location_id uuid,
  merchant_candidate_id uuid references public.merchant_identity_candidates(id) on delete restrict,
  proposed_menu_name text not null check (length(btrim(proposed_menu_name)) between 1 and 200),
  factual_metadata jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'rejected')),
  resolved_restaurant_id uuid references public.restaurants(id) on delete restrict,
  resolved_restaurant_location_id uuid,
  resolved_restaurant_menu_id uuid references public.restaurant_menus(id) on delete restrict,
  resolved_catalog_product_id uuid references public.catalog_products(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (restaurant_id, restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (resolved_restaurant_id, resolved_restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id) on delete restrict,
  foreign key (resolved_restaurant_id, resolved_restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict,
  check ((merchant_candidate_id is not null and restaurant_id is null and restaurant_location_id is null)
    or (merchant_candidate_id is null and restaurant_id is not null and restaurant_location_id is not null)),
  check ((review_status = 'accepted' and resolved_restaurant_id is not null
    and resolved_restaurant_location_id is not null and resolved_restaurant_menu_id is not null
    and resolved_catalog_product_id is not null and reviewed_by is not null and reviewed_at is not null)
    or (review_status <> 'accepted' and resolved_restaurant_id is null
    and resolved_restaurant_location_id is null and resolved_restaurant_menu_id is null
    and resolved_catalog_product_id is null)),
  check ((review_status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (review_status <> 'pending' and reviewed_by is not null and reviewed_at is not null))
);
comment on table public.restaurant_menu_identity_candidates is
  'Private user-confirmed menu proposals. Acceptance links an existing verified identity; it neither registers canonical menus nor publishes Nutrition.';
create index restaurant_menu_identity_candidates_review_idx
  on public.restaurant_menu_identity_candidates(review_status, created_at);
alter table public.restaurant_menu_identity_candidates enable row level security;
revoke all on public.restaurant_menu_identity_candidates from public, anon, authenticated;
grant select on public.restaurant_menu_identity_candidates to authenticated;
create policy restaurant_menu_candidate_owner_read on public.restaurant_menu_identity_candidates
  for select to authenticated using (user_id = (select auth.uid()));
-- No direct INSERT/UPDATE grant: submission/resolution use the checked RPCs below.

create function public.restaurant_menu_candidate_result_v1(p_candidate_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $function$
  select jsonb_build_object(
    'schemaVersion', 'restaurant-menu-candidate.v1', 'candidateId', candidate.id,
    'reviewStatus', candidate.review_status,
    'resolutionStatus', case when exact.id is not null then 'exact' else 'unresolved' end,
    'restaurantId', exact.restaurant_id, 'restaurantLocationId', exact.location_id,
    'restaurantMenuId', exact.id, 'catalogProductId', exact.catalog_product_id,
    'proposedRestaurantId', candidate.restaurant_id,
    'proposedRestaurantLocationId', candidate.restaurant_location_id,
    'merchantCandidateId', candidate.merchant_candidate_id,
    'menuName', candidate.proposed_menu_name, 'metadata', candidate.factual_metadata,
    'reviewNote', candidate.review_note, 'createdAt', candidate.created_at,
    'updatedAt', candidate.updated_at
  )
  from public.restaurant_menu_identity_candidates candidate
  left join lateral (
    select menu.id, menu.restaurant_id, location.id as location_id, menu.catalog_product_id
    from public.restaurant_menus menu
    join public.restaurants restaurant on restaurant.id = menu.restaurant_id
    join public.restaurant_locations location on location.restaurant_id = restaurant.id
    join public.catalog_products catalog on catalog.id = menu.catalog_product_id
    join public.standard_products standard on standard.id = catalog.standard_product_id
    where candidate.review_status = 'accepted'
      and menu.id = candidate.resolved_restaurant_menu_id
      and restaurant.id = candidate.resolved_restaurant_id
      and location.id = candidate.resolved_restaurant_location_id
      and catalog.id = candidate.resolved_catalog_product_id
      and restaurant.status = 'active' and restaurant.review_status = 'verified'
      and location.review_status = 'verified'
      and menu.status = 'active' and menu.review_status = 'verified'
      and catalog.status = 'active' and catalog.purchase_type = 'menu_item'
      and standard.status = 'active' and standard.purchase_type = 'menu_item'
  ) exact on true
  where candidate.id = p_candidate_id;
$function$;
revoke all on function public.restaurant_menu_candidate_result_v1(uuid) from public, anon, authenticated;

create function public.submit_restaurant_menu_candidate_v1(
  p_idempotency_key text, p_restaurant_id uuid, p_restaurant_location_id uuid,
  p_merchant_candidate_id uuid, p_menu_name text, p_metadata jsonb, p_user_verified boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_name text := btrim(coalesce(p_menu_name, ''));
  v_metadata jsonb := '{}'::jsonb;
  v_field text;
  v_value text;
  v_fingerprint text;
  v_candidate public.restaurant_menu_identity_candidates%rowtype;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_user_verified is distinct from true then raise exception 'user confirmation required' using errcode = '23514'; end if;
  if length(v_key) not between 1 and 200 or length(v_name) not between 1 and 200 then
    raise exception 'invalid proposal key or menu name' using errcode = '23514';
  end if;
  if p_merchant_candidate_id is not null then
    if p_restaurant_id is not null or p_restaurant_location_id is not null or not exists (
      select 1 from public.merchant_identity_candidates merchant
      where merchant.id = p_merchant_candidate_id and merchant.user_id = v_user_id
        and merchant.origin = 'merchant_only' and merchant.business_kind = 'food_service'
        and merchant.review_status in ('pending', 'accepted')
    ) then raise exception 'invalid owner merchant candidate selector' using errcode = '23514'; end if;
  elsif p_restaurant_id is null or p_restaurant_location_id is null or not exists (
    select 1 from public.restaurants restaurant
    join public.restaurant_locations location on location.restaurant_id = restaurant.id
    where restaurant.id = p_restaurant_id and location.id = p_restaurant_location_id
      and restaurant.status = 'active' and restaurant.review_status = 'verified'
      and location.review_status = 'verified'
  ) then raise exception 'verified restaurant/location selector required' using errcode = '23514'; end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'metadata must be an object' using errcode = '23514';
  end if;
  -- Drop all non-allowlisted payload, including Nutrition values, raw text and client UUIDs.
  foreach v_field in array array['serving_label', 'category_label', 'official_url'] loop
    if coalesce(p_metadata, '{}'::jsonb) ? v_field and p_metadata -> v_field <> 'null'::jsonb then
      if jsonb_typeof(p_metadata -> v_field) <> 'string' then
        raise exception 'factual metadata must contain text' using errcode = '23514';
      end if;
      v_value := nullif(btrim(p_metadata ->> v_field), '');
      if length(v_value) > (case when v_field = 'official_url' then 2048 else 200 end)
        or (v_field = 'official_url' and v_value !~ '^https?://[^[:space:]]+$') then
        raise exception 'invalid factual metadata' using errcode = '23514';
      end if;
      if v_value is not null then v_metadata := v_metadata || jsonb_build_object(v_field, v_value); end if;
    end if;
  end loop;
  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'restaurantId', p_restaurant_id, 'restaurantLocationId', p_restaurant_location_id,
    'merchantCandidateId', p_merchant_candidate_id, 'menuName', v_name,
    'metadata', v_metadata)::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.restaurant_menu_identity_candidates as candidate (
    user_id, idempotency_key, request_fingerprint, restaurant_id, restaurant_location_id,
    merchant_candidate_id, proposed_menu_name, factual_metadata
  ) values (v_user_id, v_key, v_fingerprint, p_restaurant_id, p_restaurant_location_id,
    p_merchant_candidate_id, v_name, v_metadata)
  on conflict (user_id, idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning * into v_candidate;
  if v_candidate.request_fingerprint <> v_fingerprint then
    raise exception 'idempotency key reused with different proposal' using errcode = '23505';
  end if;
  -- Names alone never become identity, even if only one existing menu has this name.
  return public.restaurant_menu_candidate_result_v1(v_candidate.id);
end;
$function$;

create function public.get_my_restaurant_menu_candidates_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(public.restaurant_menu_candidate_result_v1(candidate.id)
    order by candidate.created_at desc, candidate.id)
    from public.restaurant_menu_identity_candidates candidate where candidate.user_id = v_user_id), '[]'::jsonb);
end;
$function$;

-- The existing merchant submission/resolution RPCs remain unchanged. This owner read
-- supplies accepted identities after review; pending name matches are never exposed as exact.
create function public.get_my_dining_merchant_candidates_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'schemaVersion', 'merchant-only-candidate.v1', 'candidateId', merchant.id,
    'reviewStatus', merchant.review_status,
    'resolutionStatus', case when location.id is not null then 'exact' else 'unresolved' end,
    'restaurantId', restaurant.id, 'restaurantLocationId', location.id,
    'createdAt', merchant.created_at, 'updatedAt', merchant.updated_at
  ) order by merchant.created_at desc, merchant.id)
  from public.merchant_identity_candidates merchant
  left join public.restaurant_locations location on location.id = merchant.matched_restaurant_location_id
    and location.restaurant_id = merchant.matched_restaurant_id and location.review_status = 'verified'
    and merchant.review_status = 'accepted'
    and exists (select 1 from public.restaurants r where r.id = location.restaurant_id
      and r.status = 'active' and r.review_status = 'verified')
  left join public.restaurants restaurant on restaurant.id = location.restaurant_id
  where merchant.user_id = v_user_id and merchant.origin = 'merchant_only'
    and merchant.business_kind = 'food_service' and merchant.review_status in ('pending', 'accepted', 'rejected')), '[]'::jsonb);
end;
$function$;

create function public.admin_list_restaurant_menu_candidates_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(public.restaurant_menu_candidate_result_v1(candidate.id)
    order by candidate.created_at, candidate.id) from (
      select id, created_at from public.restaurant_menu_identity_candidates
      where review_status = 'pending' order by created_at, id limit 200
    ) candidate), '[]'::jsonb);
end;
$function$;

create function public.admin_resolve_restaurant_menu_candidate_v1(
  p_candidate_id uuid, p_decision text, p_restaurant_id uuid,
  p_restaurant_location_id uuid, p_restaurant_menu_id uuid, p_catalog_product_id uuid,
  p_review_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_admin uuid := (select auth.uid());
  v_candidate public.restaurant_menu_identity_candidates%rowtype;
begin
  if v_admin is null or coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'administrator required' using errcode = '42501';
  end if;
  if p_decision not in ('accept', 'reject') or p_decision is null or length(p_review_note) > 500 then
    raise exception 'invalid review decision' using errcode = '23514';
  end if;
  select * into v_candidate from public.restaurant_menu_identity_candidates
    where id = p_candidate_id for update;
  if not found then raise exception 'candidate not found' using errcode = 'P0002'; end if;
  if p_decision = 'accept' then
    if not exists (
      select 1 from public.restaurant_menus menu
      join public.restaurants restaurant on restaurant.id = menu.restaurant_id
      join public.restaurant_locations location on location.restaurant_id = restaurant.id
      join public.catalog_products catalog on catalog.id = menu.catalog_product_id
      join public.standard_products standard on standard.id = catalog.standard_product_id
      where restaurant.id = p_restaurant_id and location.id = p_restaurant_location_id
        and menu.id = p_restaurant_menu_id and catalog.id = p_catalog_product_id
        and restaurant.status = 'active' and restaurant.review_status = 'verified'
        and location.review_status = 'verified' and menu.status = 'active' and menu.review_status = 'verified'
        and catalog.status = 'active' and catalog.purchase_type = 'menu_item'
        and standard.status = 'active' and standard.purchase_type = 'menu_item'
    ) then raise exception 'verified exact menu identity required' using errcode = '23514'; end if;
    if (v_candidate.merchant_candidate_id is null and (
      v_candidate.restaurant_id <> p_restaurant_id or v_candidate.restaurant_location_id <> p_restaurant_location_id))
      or (v_candidate.merchant_candidate_id is not null and not exists (
        select 1 from public.merchant_identity_candidates merchant
        where merchant.id = v_candidate.merchant_candidate_id and merchant.user_id = v_candidate.user_id
          and merchant.review_status = 'accepted' and merchant.matched_restaurant_id = p_restaurant_id
          and merchant.matched_restaurant_location_id = p_restaurant_location_id
      )) then raise exception 'proposal restaurant selector mismatch or merchant not approved' using errcode = '23514'; end if;
  elsif p_restaurant_id is not null or p_restaurant_location_id is not null
    or p_restaurant_menu_id is not null or p_catalog_product_id is not null then
    raise exception 'rejection cannot assign identity' using errcode = '23514';
  end if;
  if v_candidate.review_status <> 'pending' then
    if (p_decision = 'reject' and v_candidate.review_status = 'rejected') or
      (p_decision = 'accept' and v_candidate.review_status = 'accepted'
        and v_candidate.resolved_restaurant_id = p_restaurant_id
        and v_candidate.resolved_restaurant_location_id = p_restaurant_location_id
        and v_candidate.resolved_restaurant_menu_id = p_restaurant_menu_id
        and v_candidate.resolved_catalog_product_id = p_catalog_product_id) then
      return public.restaurant_menu_candidate_result_v1(v_candidate.id);
    end if;
    raise exception 'candidate already reviewed' using errcode = '23514';
  end if;
  update public.restaurant_menu_identity_candidates set
    review_status = case when p_decision = 'accept' then 'accepted' else 'rejected' end,
    resolved_restaurant_id = p_restaurant_id, resolved_restaurant_location_id = p_restaurant_location_id,
    resolved_restaurant_menu_id = p_restaurant_menu_id, resolved_catalog_product_id = p_catalog_product_id,
    reviewed_by = v_admin, reviewed_at = now(), updated_at = now(), review_note = nullif(btrim(p_review_note), '')
  where id = v_candidate.id;
  return public.restaurant_menu_candidate_result_v1(v_candidate.id);
end;
$function$;

revoke all on function public.submit_restaurant_menu_candidate_v1(text, uuid, uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.get_my_restaurant_menu_candidates_v1() from public, anon, authenticated;
revoke all on function public.get_my_dining_merchant_candidates_v1() from public, anon, authenticated;
revoke all on function public.admin_list_restaurant_menu_candidates_v1() from public, anon, authenticated;
revoke all on function public.admin_resolve_restaurant_menu_candidate_v1(uuid, text, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.submit_restaurant_menu_candidate_v1(text, uuid, uuid, uuid, text, jsonb, boolean) to authenticated;
grant execute on function public.get_my_restaurant_menu_candidates_v1() to authenticated;
grant execute on function public.get_my_dining_merchant_candidates_v1() to authenticated;
grant execute on function public.admin_list_restaurant_menu_candidates_v1() to authenticated;
grant execute on function public.admin_resolve_restaurant_menu_candidate_v1(uuid, text, uuid, uuid, uuid, uuid, text) to authenticated;
