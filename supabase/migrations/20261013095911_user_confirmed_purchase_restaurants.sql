-- Undeployed feature migration. Private reusable identities stay outside the global catalogue.
-- Candidate fingerprints contain seller facts, not purchase IDs. Bindings preserve each evidence source.
create table public.purchase_owner_restaurants (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  merchant_candidate_id uuid not null references public.merchant_identity_candidates(id),
  merchant_name text not null,
  branch_name text,
  source_namespace text,
  source_code text,
  resolved_restaurant_id uuid references public.restaurants(id),
  resolved_restaurant_location_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, merchant_candidate_id),
  unique (user_id, id),
  check ((source_namespace is null) = (source_code is null)),
  check ((resolved_restaurant_id is null) = (resolved_restaurant_location_id is null)),
  foreign key (resolved_restaurant_id, resolved_restaurant_location_id)
    references public.restaurant_locations(restaurant_id, id)
);
create table public.purchase_owner_restaurant_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  purchase_source_id uuid not null,
  restaurant_id uuid not null,
  merchant_candidate_id uuid not null references public.merchant_identity_candidates(id),
  created_at timestamptz not null default now(),
  unique (user_id, purchase_source_id, merchant_candidate_id),
  unique (user_id, restaurant_id, id),
  foreign key (user_id, purchase_source_id) references public.purchase_price_sources(user_id, id),
  foreign key (user_id, restaurant_id) references public.purchase_owner_restaurants(user_id, id)
);
create table public.purchase_owner_menus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  restaurant_id uuid not null,
  menu_name text not null,
  serving_label text,
  facts_fingerprint text not null check (facts_fingerprint ~ '^[0-9a-f]{64}$'),
  menu_candidate_id uuid not null references public.restaurant_menu_identity_candidates(id),
  resolved_restaurant_id uuid references public.restaurants(id),
  resolved_restaurant_menu_id uuid,
  resolved_catalog_product_id uuid references public.catalog_products(id),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, restaurant_id, id),
  unique (user_id, restaurant_id, facts_fingerprint),
  foreign key (user_id, restaurant_id) references public.purchase_owner_restaurants(user_id, id),
  check ((resolved_restaurant_id is null) = (resolved_restaurant_menu_id is null)),
  check ((resolved_restaurant_menu_id is null) = (resolved_catalog_product_id is null)),
  foreign key (resolved_restaurant_id, resolved_restaurant_menu_id)
    references public.restaurant_menus(restaurant_id, id)
);
create table public.purchase_owner_menu_sources (
  user_id uuid not null references auth.users(id),
  purchase_source_line_id uuid primary key,
  restaurant_id uuid not null,
  restaurant_source_binding_id uuid not null,
  menu_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, purchase_source_line_id, menu_id),
  foreign key (user_id, restaurant_id, restaurant_source_binding_id)
    references public.purchase_owner_restaurant_sources(user_id, restaurant_id, id),
  foreign key (user_id, restaurant_id, menu_id) references public.purchase_owner_menus(user_id, restaurant_id, id),
  foreign key (user_id, purchase_source_line_id) references public.purchase_price_source_lines(user_id, id)
);
create table public.purchase_owner_price_observations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  purchase_source_line_id uuid not null unique,
  menu_id uuid not null,
  observed_on date not null,
  quantity integer check (quantity > 0),
  unit_price_krw integer check (unit_price_krw >= 0),
  gross_price_krw integer check (gross_price_krw >= 0),
  discount_price_krw integer check (discount_price_krw >= 0),
  net_price_krw integer check (net_price_krw >= 0),
  created_at timestamptz not null default now(),
  foreign key (user_id, menu_id) references public.purchase_owner_menus(user_id, id),
  foreign key (user_id, purchase_source_line_id, menu_id)
    references public.purchase_owner_menu_sources(user_id, purchase_source_line_id, menu_id)
);
create index purchase_owner_restaurants_name_idx on public.purchase_owner_restaurants(user_id, merchant_name, branch_name);
create index purchase_owner_restaurants_candidate_idx on public.purchase_owner_restaurants(merchant_candidate_id);
create index purchase_owner_restaurants_resolved_idx on public.purchase_owner_restaurants(resolved_restaurant_id, resolved_restaurant_location_id);
create index purchase_owner_restaurant_sources_restaurant_idx on public.purchase_owner_restaurant_sources(user_id, restaurant_id);
create index purchase_owner_restaurant_sources_candidate_idx on public.purchase_owner_restaurant_sources(merchant_candidate_id);
create index purchase_owner_menus_candidate_idx on public.purchase_owner_menus(menu_candidate_id);
create index purchase_owner_menus_resolved_idx on public.purchase_owner_menus(resolved_restaurant_id, resolved_restaurant_menu_id);
create index purchase_owner_menus_resolved_catalog_idx on public.purchase_owner_menus(resolved_catalog_product_id);
create index purchase_owner_menu_sources_binding_idx on public.purchase_owner_menu_sources(restaurant_source_binding_id);
create index purchase_owner_menu_sources_menu_idx on public.purchase_owner_menu_sources(user_id, menu_id);
create index purchase_owner_observations_history_idx on public.purchase_owner_price_observations(user_id, menu_id, observed_on desc, id);
do $tables$
declare t text;
begin
  foreach t in array array['purchase_owner_restaurants', 'purchase_owner_restaurant_sources', 'purchase_owner_menus', 'purchase_owner_menu_sources', 'purchase_owner_price_observations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy owner_read on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    -- Identity tables allow a future privileged consolidation writer to set nullable mappings.
    -- Evidence bindings and observations remain immutable. Clients have no write grants on any table.
    if t not in ('purchase_owner_restaurants', 'purchase_owner_menus') then
      execute format('create trigger immutable before update or delete on public.%I for each row execute function public.reject_purchase_price_observation_mutation()', t);
    end if;
    execute format('create index on public.%I(user_id)', t);
  end loop;
end;
$tables$;

create function public.private_guard_purchase_owner_identity_v1()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'DELETE' then raise exception 'private identity history is immutable' using errcode = '23514'; end if;
  if (to_jsonb(new) - array['resolved_restaurant_id','resolved_restaurant_location_id','resolved_restaurant_menu_id','resolved_catalog_product_id'])
    is distinct from (to_jsonb(old) - array['resolved_restaurant_id','resolved_restaurant_location_id','resolved_restaurant_menu_id','resolved_catalog_product_id']) then
    raise exception 'private identity facts are immutable' using errcode = '23514'; end if;
  return new;
end;
$function$;
revoke all on function public.private_guard_purchase_owner_identity_v1() from public, anon, authenticated;
create trigger immutable_identity before update or delete on public.purchase_owner_restaurants
  for each row execute function public.private_guard_purchase_owner_identity_v1();
create trigger immutable_identity before update or delete on public.purchase_owner_menus
  for each row execute function public.private_guard_purchase_owner_identity_v1();

-- Suggestions stay private and never carry global authoritative IDs. Missing facts broaden
-- suggestions, but only an explicit owner choice can link a source to a richer/different anchor.
create function public.private_purchase_owner_restaurant_choices_v1(p_source_line_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('restaurantId', restaurant.id,
    'restaurantLocationId', restaurant.location_id, 'merchantName', restaurant.merchant_name,
    'branchName', restaurant.branch_name, 'sourceNamespace', restaurant.source_namespace,
    'sourceCode', restaurant.source_code) order by restaurant.created_at, restaurant.id), '[]'::jsonb)
  from public.purchase_price_source_lines line
  join public.purchase_price_sources source on source.id = line.purchase_source_id and source.user_id = line.user_id
  join public.purchase_owner_restaurants restaurant on restaurant.user_id = line.user_id
    and restaurant.merchant_name = line.line_seller_name
    and (line.line_seller_branch_name is null or restaurant.branch_name = line.line_seller_branch_name)
    and (line.line_seller_source_namespace is null or
      (restaurant.source_namespace = line.line_seller_source_namespace and restaurant.source_code = line.line_seller_source_code))
  join public.merchant_identity_candidates candidate on candidate.id = restaurant.merchant_candidate_id
    and candidate.user_id = restaurant.user_id and candidate.review_status <> 'rejected'
  where line.id = p_source_line_id and line.user_id = (select auth.uid())
    and source.purchase_kind = 'restaurant' and source.transaction_state = 'settled'
    and line.line_seller_status = 'confirmed' and line.price_status = 'itemized'
    and coalesce(source.ordered_on, source.paid_on) is not null
    and coalesce(line.unit_price_krw, line.gross_price_krw, line.net_price_krw) is not null;
$function$;
revoke all on function public.private_purchase_owner_restaurant_choices_v1(uuid) from public, anon, authenticated;

alter function public.private_purchase_price_line_response_v1(uuid, jsonb)
  rename to private_purchase_price_line_verified_response_v1;
create function public.private_purchase_price_line_response_v1(p_purchase_source_id uuid, p_base_response jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_response jsonb; v_row jsonb; v_rows jsonb := '[]'; v_ids jsonb := '[]'; v_identity record;
  v_line public.purchase_price_source_lines%rowtype; v_choices jsonb;
begin
  v_response := public.private_purchase_price_line_verified_response_v1(p_purchase_source_id, p_base_response);
  for v_row in select value from jsonb_array_elements(v_response -> 'lineResults') loop
    select restaurant.id as restaurant_id, restaurant.location_id, menu.id as menu_id,
      menu.menu_candidate_id, observation.id as observation_id into v_identity
    from public.purchase_owner_price_observations observation
    join public.purchase_price_source_lines line on line.id = observation.purchase_source_line_id and line.user_id = observation.user_id
    join public.purchase_owner_menus menu on menu.id = observation.menu_id and menu.user_id = observation.user_id
    join public.purchase_owner_restaurants restaurant on restaurant.id = menu.restaurant_id and restaurant.user_id = menu.user_id
    join public.merchant_identity_candidates merchant on merchant.id = restaurant.merchant_candidate_id and merchant.review_status <> 'rejected'
    join public.restaurant_menu_identity_candidates proposal on proposal.id = menu.menu_candidate_id and proposal.review_status <> 'rejected'
    where restaurant.user_id = (select auth.uid()) and line.purchase_source_id = p_purchase_source_id
      and line.source_line_key = v_row ->> 'lineKey' and line.line_ordinal::text = v_row ->> 'lineOrdinal';
    if found then
      v_row := v_row || jsonb_build_object('authorityStatus', 'owner_confirmed', 'merchantResolutionStatus', 'owner_confirmed',
        'menuResolutionStatus', 'owner_confirmed', 'authoritativeIds', null, 'reason', null, 'reasonCode', null,
        'observationCreated', true, 'observationStatus', 'created', 'observationId', v_identity.observation_id,
        'observationType', 'purchase_owner_price_observation', 'ownerConfirmedIds', jsonb_build_object(
          'restaurantId', v_identity.restaurant_id, 'restaurantLocationId', v_identity.location_id,
          'restaurantMenuId', v_identity.menu_id, 'menuCandidateId', v_identity.menu_candidate_id));
    elsif v_row ->> 'kind' = 'restaurant_purchase' and v_row ->> 'observationCreated' <> 'true' then
      select * into v_line from public.purchase_price_source_lines where user_id = (select auth.uid())
        and purchase_source_id = p_purchase_source_id and source_line_key = v_row ->> 'lineKey'
        and line_ordinal::text = v_row ->> 'lineOrdinal';
      v_choices := public.private_purchase_owner_restaurant_choices_v1(v_line.id);
      if jsonb_array_length(v_choices) > 0 then
        v_row := v_row || jsonb_build_object('ownerRestaurantChoices', v_choices);
      end if;
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
  p_purchase_source_id uuid, p_line_key text, p_merchant_candidate_id uuid, p_user_verified boolean,
  p_owner_restaurant_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_actor uuid := (select auth.uid()); v_source public.purchase_price_sources%rowtype;
  v_line public.purchase_price_source_lines%rowtype; v_candidate public.merchant_identity_candidates%rowtype;
  v_restaurant_id uuid; v_menu_id uuid; v_menu_candidate jsonb; v_response jsonb; v_result jsonb;
  v_binding_id uuid; v_menu_fingerprint text; v_choices jsonb; v_choice_count integer;
  v_restaurant public.purchase_owner_restaurants%rowtype; v_menu public.purchase_owner_menus%rowtype;
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
      if not exists(select 1 from jsonb_array_elements(v_choices) choice where choice ->> 'restaurantId' = p_owner_restaurant_id::text) then
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
  -- Stable owner-restaurant/menu-facts key: independent purchases reuse the same proposal.
  v_menu_candidate := public.submit_restaurant_menu_candidate_v1('owner-menu:' || v_restaurant_id::text || ':' || v_menu_fingerprint,
    null, null, v_restaurant.merchant_candidate_id, v_line.product_name,
    jsonb_strip_nulls(jsonb_build_object('serving_label', v_line.option_text)), true);
  if v_menu_candidate ->> 'reviewStatus' = 'rejected' then
    raise exception 'menu candidate was rejected' using errcode = '23514'; end if;
  select * into v_menu from public.purchase_owner_menus where user_id = v_actor
    and restaurant_id = v_restaurant_id and facts_fingerprint = v_menu_fingerprint;
  if found then
    if v_menu.menu_name is distinct from v_line.product_name or v_menu.serving_label is distinct from v_line.option_text then
      raise exception 'private menu fingerprint conflict' using errcode = '23505'; end if;
    v_menu_id := v_menu.id;
  else
    insert into public.purchase_owner_menus(user_id, restaurant_id, menu_name, serving_label, facts_fingerprint, menu_candidate_id)
      values(v_actor, v_restaurant_id, v_line.product_name, v_line.option_text, v_menu_fingerprint,
        (v_menu_candidate ->> 'candidateId')::uuid) returning id into v_menu_id;
  end if;
  insert into public.purchase_owner_menu_sources(user_id, purchase_source_line_id, restaurant_id, restaurant_source_binding_id, menu_id)
    values(v_actor, v_line.id, v_restaurant_id, v_binding_id, v_menu_id);
  insert into public.purchase_owner_price_observations(user_id, purchase_source_line_id, menu_id, observed_on,
    quantity, unit_price_krw, gross_price_krw, discount_price_krw, net_price_krw)
    values(v_actor, v_line.id, v_menu_id, coalesce(v_source.ordered_on, v_source.paid_on), v_line.quantity,
      v_line.unit_price_krw, v_line.gross_price_krw, v_line.discount_price_krw, v_line.net_price_krw);
  return public.get_purchase_price_ingestion_response_v1(v_source.id);
end;
$function$;
revoke all on function public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid, text, uuid, boolean, uuid) from public, anon;
grant execute on function public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid, text, uuid, boolean, uuid) to authenticated;
-- Preserve the four-argument API used by existing OCR clients.
create function public.resolve_user_confirmed_purchase_restaurant_line_v1(
  p_purchase_source_id uuid, p_line_key text, p_merchant_candidate_id uuid, p_user_verified boolean
) returns jsonb language sql security invoker set search_path = '' as $function$
  select public.resolve_user_confirmed_purchase_restaurant_line_v1(p_purchase_source_id, p_line_key,
    p_merchant_candidate_id, p_user_verified, null);
$function$;
revoke all on function public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid,text,uuid,boolean) from public, anon;
grant execute on function public.resolve_user_confirmed_purchase_restaurant_line_v1(uuid,text,uuid,boolean) to authenticated;

-- A separate read model: owner IDs never enter the public RestaurantDirectory/global exact types.
create function public.get_my_owner_confirmed_restaurants_v1()
returns jsonb language plpgsql stable security invoker set search_path = '' as $function$
declare v_actor uuid := (select auth.uid()); v_restaurants jsonb;
begin
  if v_actor is null then raise exception 'authenticated restaurant owner required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', restaurant.id, 'locationId', restaurant.location_id,
    'name', restaurant.merchant_name, 'branchName', restaurant.branch_name, 'authorityStatus', 'owner_confirmed',
    'menus', coalesce((select jsonb_agg(jsonb_build_object('id', menu.id, 'name', menu.menu_name,
      'servingLabel', menu.serving_label, 'priceHistory', coalesce((select jsonb_agg(jsonb_build_object(
        'id', observation.id, 'purchaseSourceLineId', observation.purchase_source_line_id,
        'observedOn', observation.observed_on, 'createdAt', observation.created_at, 'quantity', observation.quantity,
        'unitPriceKrw', observation.unit_price_krw, 'grossPriceKrw', observation.gross_price_krw,
        'discountPriceKrw', observation.discount_price_krw, 'netPriceKrw', observation.net_price_krw)
        order by observation.observed_on desc, observation.created_at desc, observation.id)
        from public.purchase_owner_price_observations observation
        where observation.user_id = v_actor and observation.menu_id = menu.id), '[]'::jsonb))
      order by menu.created_at, menu.id) from public.purchase_owner_menus menu
      where menu.user_id = v_actor and menu.restaurant_id = restaurant.id), '[]'::jsonb))
    order by restaurant.created_at desc, restaurant.id), '[]'::jsonb) into v_restaurants
  from public.purchase_owner_restaurants restaurant where restaurant.user_id = v_actor;
  return jsonb_build_object('schemaVersion', 'owner-restaurant-read.v1', 'ownerId', v_actor, 'restaurants', v_restaurants);
end;
$function$;
revoke all on function public.get_my_owner_confirmed_restaurants_v1() from public, anon;
grant execute on function public.get_my_owner_confirmed_restaurants_v1() to authenticated;
comment on table public.purchase_owner_restaurants is
  'Reusable owner-private restaurant/location anchored to seller-facts candidate. Nullable resolved mappings reserve future reviewed consolidation; never global publication authority.';
comment on table public.purchase_owner_menus is
  'Reusable menu within one owner restaurant, identified by exact menu/serving facts. Purchase lines and prices are independent evidence bindings.';

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
