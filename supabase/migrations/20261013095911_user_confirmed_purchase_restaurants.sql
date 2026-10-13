-- Evidence-scoped identities deliberately do not enter the global restaurant/catalog tables.
-- A name alone cannot identify a branch across purchases or across owners.
create table public.purchase_owner_restaurants (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  purchase_source_id uuid not null,
  merchant_candidate_id uuid not null references public.merchant_identity_candidates(id),
  created_at timestamptz not null default now(),
  unique (user_id, purchase_source_id, merchant_candidate_id),
  unique (user_id, id),
  foreign key (user_id, purchase_source_id) references public.purchase_price_sources(user_id, id)
);
create table public.purchase_owner_menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  restaurant_id uuid not null,
  purchase_source_line_id uuid not null unique,
  menu_candidate_id uuid not null references public.restaurant_menu_identity_candidates(id),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, restaurant_id) references public.purchase_owner_restaurants(user_id, id),
  foreign key (user_id, purchase_source_line_id) references public.purchase_price_source_lines(user_id, id)
);
create table public.purchase_owner_price_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  purchase_source_line_id uuid not null unique,
  menu_id uuid not null unique,
  observed_on date not null,
  quantity integer check (quantity > 0),
  unit_price_krw integer check (unit_price_krw >= 0),
  gross_price_krw integer check (gross_price_krw >= 0),
  discount_price_krw integer check (discount_price_krw >= 0),
  net_price_krw integer check (net_price_krw >= 0),
  created_at timestamptz not null default now(),
  foreign key (user_id, menu_id) references public.purchase_owner_menus(user_id, id),
  foreign key (user_id, purchase_source_line_id) references public.purchase_price_source_lines(user_id, id)
);
do $tables$
declare t text;
begin
  foreach t in array array['purchase_owner_restaurants', 'purchase_owner_menus', 'purchase_owner_price_observations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy owner_read on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create trigger immutable before update or delete on public.%I for each row execute function public.reject_purchase_price_observation_mutation()', t);
    execute format('create index on public.%I(user_id)', t);
  end loop;
end;
$tables$;

alter function public.private_purchase_price_line_response_v1(uuid, jsonb)
  rename to private_purchase_price_line_verified_response_v1;
create function public.private_purchase_price_line_response_v1(p_purchase_source_id uuid, p_base_response jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_response jsonb; v_row jsonb; v_rows jsonb := '[]'; v_ids jsonb := '[]'; v_identity record;
begin
  v_response := public.private_purchase_price_line_verified_response_v1(p_purchase_source_id, p_base_response);
  for v_row in select value from jsonb_array_elements(v_response -> 'lineResults') loop
    select restaurant.id as restaurant_id, restaurant.location_id, menu.id as menu_id,
      menu.menu_candidate_id, observation.id as observation_id into v_identity
    from public.purchase_owner_restaurants restaurant
    join public.purchase_owner_menus menu on menu.restaurant_id = restaurant.id and menu.user_id = restaurant.user_id
    join public.purchase_owner_price_observations observation on observation.menu_id = menu.id and observation.user_id = menu.user_id
    join public.purchase_price_source_lines line on line.id = menu.purchase_source_line_id and line.user_id = menu.user_id
    join public.merchant_identity_candidates merchant on merchant.id = restaurant.merchant_candidate_id and merchant.review_status <> 'rejected'
    join public.restaurant_menu_identity_candidates proposal on proposal.id = menu.menu_candidate_id and proposal.review_status <> 'rejected'
    where restaurant.user_id = (select auth.uid()) and restaurant.purchase_source_id = p_purchase_source_id
      and line.source_line_key = v_row ->> 'lineKey' and line.line_ordinal::text = v_row ->> 'lineOrdinal';
    if found then
      v_row := v_row || jsonb_build_object('authorityStatus', 'owner_confirmed', 'merchantResolutionStatus', 'owner_confirmed',
        'menuResolutionStatus', 'owner_confirmed', 'authoritativeIds', null, 'reason', null, 'reasonCode', null,
        'observationCreated', true, 'observationStatus', 'created', 'observationId', v_identity.observation_id,
        'observationType', 'purchase_owner_price_observation', 'ownerConfirmedIds', jsonb_build_object(
          'restaurantId', v_identity.restaurant_id, 'restaurantLocationId', v_identity.location_id,
          'restaurantMenuId', v_identity.menu_id, 'menuCandidateId', v_identity.menu_candidate_id));
    end if;
    if v_row ->> 'observationCreated' = 'true' then v_ids := v_ids || jsonb_build_array(v_row -> 'observationId'); end if;
    v_rows := v_rows || jsonb_build_array(v_row);
  end loop;
  return v_response || jsonb_build_object('lineResults', v_rows, 'observationIds', v_ids,
    'observationCount', jsonb_array_length(v_ids), 'observationCreated', jsonb_array_length(v_ids) > 0);
end;
$function$;
revoke all on function public.private_purchase_price_line_response_v1(uuid, jsonb) from public, anon, authenticated;

create function public.resolve_user_confirmed_purchase_restaurant_line_v1(
  p_purchase_source_id uuid, p_line_key text, p_merchant_candidate_id uuid, p_user_verified boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid := (select auth.uid()); v_source public.purchase_price_sources%rowtype;
  v_line public.purchase_price_source_lines%rowtype; v_candidate public.merchant_identity_candidates%rowtype;
  v_restaurant_id uuid; v_menu_id uuid; v_menu_candidate jsonb; v_response jsonb; v_result jsonb;
begin
  if v_actor is null then raise exception 'authenticated purchase owner required' using errcode = '42501'; end if;
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
  select candidate.* into v_candidate from public.merchant_identity_candidates candidate
    where candidate.id = p_merchant_candidate_id and candidate.user_id = v_actor;
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
  if v_source.purchase_kind <> 'restaurant' or v_source.transaction_state <> 'settled'
    or v_line.line_seller_status <> 'confirmed' or v_line.price_status <> 'itemized'
    or coalesce(v_source.ordered_on, v_source.paid_on) is null
    or coalesce(v_line.unit_price_krw, v_line.gross_price_krw, v_line.net_price_krw) is null then
    raise exception 'purchase line not eligible for recovery' using errcode = '22023'; end if;
  v_response := public.get_purchase_price_ingestion_response_v1(v_source.id);
  select value into v_result from jsonb_array_elements(v_response -> 'lineResults') where value ->> 'lineKey' = p_line_key;
  if v_result ->> 'observationCreated' = 'true' then return v_response; end if;
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
  select id into v_restaurant_id from public.purchase_owner_restaurants
    where user_id = v_actor and purchase_source_id = v_source.id and merchant_candidate_id = v_candidate.id;
  if not found then
    insert into public.purchase_owner_restaurants(user_id, purchase_source_id, merchant_candidate_id)
      values (v_actor, v_source.id, v_candidate.id) returning id into v_restaurant_id;
  end if;
  -- Reuse the existing private proposal system. No name-based menu/global catalogue merge.
  v_menu_candidate := public.submit_restaurant_menu_candidate_v1('purchase-line:' || v_line.id::text,
    null, null, v_candidate.id, v_line.product_name,
    jsonb_strip_nulls(jsonb_build_object('serving_label', v_line.option_text)), true);
  if v_menu_candidate ->> 'reviewStatus' = 'rejected' then
    raise exception 'menu candidate was rejected' using errcode = '23514'; end if;
  insert into public.purchase_owner_menus(user_id, restaurant_id, purchase_source_line_id, menu_candidate_id)
    values(v_actor, v_restaurant_id, v_line.id, (v_menu_candidate ->> 'candidateId')::uuid) returning id into v_menu_id;
  insert into public.purchase_owner_price_observations(user_id, purchase_source_line_id, menu_id, observed_on,
    quantity, unit_price_krw, gross_price_krw, discount_price_krw, net_price_krw)
    values(v_actor, v_line.id, v_menu_id, coalesce(v_source.ordered_on, v_source.paid_on), v_line.quantity,
      v_line.unit_price_krw, v_line.gross_price_krw, v_line.discount_price_krw, v_line.net_price_krw);
  return public.get_purchase_price_ingestion_response_v1(v_source.id);
end;
$function$;
revoke all on function public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid, text, uuid, boolean) to authenticated;

-- An older client must not create a second observation for a privately resolved line.
alter function public.resolve_ocr_purchase_restaurant_line_v1(uuid, text, boolean, jsonb)
  rename to private_resolve_ocr_purchase_restaurant_line_verified_v1;
revoke all on function public.private_resolve_ocr_purchase_restaurant_line_verified_v1(uuid,text,boolean,jsonb) from public, anon, authenticated;
create function public.resolve_ocr_purchase_restaurant_line_v1(
  p_purchase_source_id uuid, p_line_key text, p_user_verified boolean, p_merchant jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
begin
  if (select auth.uid()) is null then raise exception 'authenticated purchase owner required' using errcode = '42501'; end if;
  if p_user_verified is distinct from true then raise exception 'purchase identity review required' using errcode = '22023'; end if;
  -- Share the new writer's lock, so concurrent legacy/new recovery cannot race.
  perform 1 from public.purchase_price_sources where id = p_purchase_source_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'purchase source not available' using errcode = '42501'; end if;
  if exists(select 1 from public.purchase_owner_price_observations observation
    join public.purchase_price_source_lines line on line.id = observation.purchase_source_line_id
    where observation.user_id = (select auth.uid()) and line.purchase_source_id = p_purchase_source_id and line.source_line_key = p_line_key) then
    if p_merchant is not null then raise exception 'private purchase identity cannot be replaced by merchant override' using errcode = '23514'; end if;
    return public.get_purchase_price_ingestion_response_v1(p_purchase_source_id);
  end if;
  return public.private_resolve_ocr_purchase_restaurant_line_verified_v1(p_purchase_source_id,p_line_key,p_user_verified,p_merchant);
end;
$function$;
revoke all on function public.resolve_ocr_purchase_restaurant_line_v1(uuid,text,boolean,jsonb) from public, anon;
grant execute on function public.resolve_ocr_purchase_restaurant_line_v1(uuid,text,boolean,jsonb) to authenticated;
-- Refresh SQL callers after the response helper rename (including pooled sessions).
do $refresh$
begin
  execute pg_catalog.pg_get_functiondef('public.get_purchase_price_ingestion_response_v1(uuid)'::regprocedure);
  execute pg_catalog.pg_get_functiondef('public.ingest_verified_purchase_price_observation_v1(text,jsonb)'::regprocedure);
  execute pg_catalog.pg_get_functiondef('public.resolve_ocr_purchase_restaurant_line_v1(uuid,text,boolean,jsonb)'::regprocedure);
end;
$refresh$;
notify pgrst, 'reload schema';
