-- Fully migrated local Supabase: supabase db query --local --file supabase/tests/restaurant_menu_identity_candidates.sql
-- Also executed against PostgreSQL/PGlite by the migration test with explicit upstream/auth fixtures.
-- All fixtures and decisions are rolled back. No linked or production database is used.
begin;
create temporary table proposal_test_ids (
  owner_id uuid, other_id uuid, admin_id uuid, restaurant_id uuid, location_id uuid,
  other_restaurant_id uuid, other_location_id uuid, menu_id uuid, catalog_id uuid,
  candidate_id uuid, merchant_id uuid, child_id uuid, reject_id uuid
);
grant select, update on proposal_test_ids to authenticated;
do $test$
declare
  v_owner uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  v_restaurant uuid; v_location uuid; v_other_restaurant uuid; v_other_location uuid;
  v_standard uuid; v_catalog uuid; v_menu uuid; v_suffix text := gen_random_uuid()::text;
begin
  insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_owner, 'authenticated', 'authenticated', 'proposal-owner-' || v_suffix || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_other, 'authenticated', 'authenticated', 'proposal-other-' || v_suffix || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_admin, 'authenticated', 'authenticated', 'proposal-admin-' || v_suffix || '@example.invalid', '{"role":"admin"}'::jsonb, '{}'::jsonb, now(), now());
  insert into public.restaurants(canonical_name, review_status, reviewed_by, reviewed_at)
    values ('Proposal fixture ' || v_suffix, 'verified', v_admin, now()) returning id into v_restaurant;
  insert into public.restaurants(canonical_name, review_status, reviewed_by, reviewed_at)
    values ('Other fixture ' || v_suffix, 'verified', v_admin, now()) returning id into v_other_restaurant;
  insert into public.restaurant_locations(restaurant_id, source_namespace, source_location_code, review_status, reviewed_by, reviewed_at)
    values (v_restaurant, 'proposal-sql-test', v_suffix, 'verified', v_admin, now()) returning id into v_location;
  insert into public.restaurant_locations(restaurant_id, source_namespace, source_location_code, review_status, reviewed_by, reviewed_at)
    values (v_other_restaurant, 'proposal-sql-test', 'other-' || v_suffix, 'verified', v_admin, now()) returning id into v_other_location;
  insert into public.standard_products(purchase_type, canonical_name, created_by)
    values ('menu_item', 'Proposal standard ' || v_suffix, v_admin) returning id into v_standard;
  insert into public.catalog_products(standard_product_id, purchase_type, canonical_name, created_by)
    values (v_standard, 'menu_item', 'Proposal catalog ' || v_suffix, v_admin) returning id into v_catalog;
  insert into public.restaurant_menus(restaurant_id, catalog_product_id, canonical_name, review_status, reviewed_by, reviewed_at)
    values (v_restaurant, v_catalog, 'Already registered name', 'verified', v_admin, now()) returning id into v_menu;
  insert into proposal_test_ids(owner_id, other_id, admin_id, restaurant_id, location_id, other_restaurant_id,
    other_location_id, menu_id, catalog_id) values
    (v_owner, v_other, v_admin, v_restaurant, v_location, v_other_restaurant, v_other_location, v_menu, v_catalog);
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'app_metadata', jsonb_build_object('role', 'user'))::text, true);
end;
$test$;
set local role authenticated;
do $test$
declare t proposal_test_ids%rowtype; first jsonb; replay jsonb; merchant jsonb; child jsonb;
begin
  select * into t from proposal_test_ids;
  first := public.submit_restaurant_menu_candidate_v1('menu-1', t.restaurant_id, t.location_id,
    null, 'Already registered name', '{"serving_label":" 1회 ","raw_text":"private","catalog_product_id":"invented"}', true);
  if first ->> 'reviewStatus' <> 'pending' or first ->> 'resolutionStatus' <> 'unresolved'
    or first ->> 'catalogProductId' is not null or first -> 'metadata' <> '{"serving_label":"1회"}'::jsonb then
    raise exception 'names or unsafe facts were promoted to canonical/public identity';
  end if;
  replay := public.submit_restaurant_menu_candidate_v1('menu-1', t.restaurant_id, t.location_id,
    null, 'Already registered name', '{"serving_label":"1회"}', true);
  if replay ->> 'candidateId' <> first ->> 'candidateId' then raise exception 'idempotent replay duplicated proposal'; end if;
  begin
    perform public.submit_restaurant_menu_candidate_v1('menu-1', t.restaurant_id, t.location_id, null, 'Changed facts', '{}', true);
    raise exception 'changed fingerprint accepted'; exception when unique_violation then null;
  end;
  begin
    perform public.submit_restaurant_menu_candidate_v1('invalid-selector', t.restaurant_id, t.other_location_id, null, 'Menu', '{}', true);
    raise exception 'cross restaurant location accepted'; exception when check_violation then null;
  end;
  begin
    perform public.submit_restaurant_menu_candidate_v1('no-consent', t.restaurant_id, t.location_id, null, 'Menu', '{}', false);
    raise exception 'unconfirmed facts accepted'; exception when check_violation then null;
  end;
  merchant := public.submit_merchant_identity_candidate_v1('merchant-1',
    jsonb_build_object('merchant_name', 'Missing restaurant', 'business_kind', 'food_service'), true);
  child := public.submit_restaurant_menu_candidate_v1('merchant-menu-1', null, null,
    (merchant ->> 'candidateId')::uuid, 'Merchant proposal menu', '{}', true);
  update proposal_test_ids set candidate_id = (first ->> 'candidateId')::uuid,
    merchant_id = (merchant ->> 'candidateId')::uuid, child_id = (child ->> 'candidateId')::uuid;
  if jsonb_array_length(public.get_my_restaurant_menu_candidates_v1()) <> 2 then raise exception 'owner read lost proposals'; end if;
  begin
    update public.restaurant_menu_identity_candidates set review_status = 'accepted';
    raise exception 'normal user can mutate review state'; exception when insufficient_privilege then null;
  end;
  begin
    insert into public.restaurant_menu_identity_candidates(user_id, idempotency_key,
      request_fingerprint, restaurant_id, restaurant_location_id, proposed_menu_name)
      values(t.owner_id, 'direct-insert', repeat('a',64), t.restaurant_id, t.location_id, 'Menu');
    raise exception 'normal user can bypass sanitized submission'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_list_restaurant_menu_candidates_v1();
    raise exception 'normal user can list admin queue'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_resolve_restaurant_menu_candidate_v1((first ->> 'candidateId')::uuid, 'accept',
      t.restaurant_id, t.location_id, t.menu_id, t.catalog_id, null);
    raise exception 'normal user can self approve'; exception when insufficient_privilege then null;
  end;
  begin
    perform public.restaurant_menu_candidate_result_v1((first ->> 'candidateId')::uuid);
    raise exception 'internal helper is exposed'; exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.owner_id,
    'app_metadata', jsonb_build_object('role', 'user'), 'user_metadata', jsonb_build_object('role', 'admin'))::text, true);
  begin
    perform public.admin_list_restaurant_menu_candidates_v1();
    raise exception 'user metadata can escalate role'; exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', t.other_id::text, true);
  if (select count(*) from public.restaurant_menu_identity_candidates) <> 0
    or jsonb_array_length(public.get_my_restaurant_menu_candidates_v1()) <> 0
    or jsonb_array_length(public.get_my_dining_merchant_candidates_v1()) <> 0 then
    raise exception 'other owner can read private proposal';
  end if;
  begin
    perform public.submit_restaurant_menu_candidate_v1('foreign-merchant', null, null,
      (merchant ->> 'candidateId')::uuid, 'Menu', '{}', true);
    raise exception 'foreign merchant candidate accepted'; exception when check_violation then null;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_my_restaurant_menu_candidates_v1();
    raise exception 'null UID can read candidates'; exception when insufficient_privilege then null;
  end;
end;
$test$;
reset role;
do $test$
declare t proposal_test_ids%rowtype;
begin
  select * into t from proposal_test_ids;
  perform set_config('request.jwt.claim.sub', t.admin_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.admin_id, 'app_metadata', jsonb_build_object('role', 'admin'))::text, true);
end;
$test$;
set local role authenticated;
do $test$
declare t proposal_test_ids%rowtype; resolved jsonb;
begin
  select * into t from proposal_test_ids;
  if jsonb_array_length(public.admin_list_restaurant_menu_candidates_v1()) < 2 then raise exception 'admin queue missing proposals'; end if;
  begin
    perform public.admin_resolve_restaurant_menu_candidate_v1(t.candidate_id, 'accept', t.restaurant_id,
      t.location_id, t.menu_id, gen_random_uuid(), null);
    raise exception 'mismatched catalog accepted'; exception when check_violation then null;
  end;
  begin
    perform public.admin_resolve_restaurant_menu_candidate_v1(t.child_id, 'accept', t.restaurant_id,
      t.location_id, t.menu_id, t.catalog_id, null);
    raise exception 'unapproved merchant accepted'; exception when check_violation then null;
  end;
  resolved := public.admin_resolve_restaurant_menu_candidate_v1(t.candidate_id, 'accept', t.restaurant_id,
    t.location_id, t.menu_id, t.catalog_id, 'Exact verified selector');
  if resolved ->> 'reviewStatus' <> 'accepted' or resolved ->> 'resolutionStatus' <> 'exact'
    or (resolved ->> 'restaurantId')::uuid <> t.restaurant_id
    or (resolved ->> 'restaurantLocationId')::uuid <> t.location_id
    or (resolved ->> 'restaurantMenuId')::uuid <> t.menu_id
    or (resolved ->> 'catalogProductId')::uuid <> t.catalog_id then raise exception 'acceptance lost exact identity'; end if;
  perform public.admin_resolve_restaurant_menu_candidate_v1(t.candidate_id, 'accept', t.restaurant_id,
    t.location_id, t.menu_id, t.catalog_id, 'Replay');
  resolved := public.admin_resolve_restaurant_menu_candidate_v1(t.child_id, 'reject', null, null, null, null, 'Insufficient evidence');
  if resolved ->> 'reviewStatus' <> 'rejected' or resolved ->> 'catalogProductId' is not null then
    raise exception 'rejection assigned canonical identity'; end if;
  perform public.admin_resolve_merchant_identity_candidate_v1(t.merchant_id, t.restaurant_id, t.location_id, 'accept');
  perform set_config('request.jwt.claim.sub', t.owner_id::text, true);
  if jsonb_array_length(public.get_my_dining_merchant_candidates_v1()) <> 1
    or public.get_my_dining_merchant_candidates_v1() -> 0 ->> 'resolutionStatus' <> 'exact' then
    raise exception 'owner cannot retrieve approved merchant identity'; end if;
  if (select count(*) from public.restaurant_menu_identity_candidates where user_id = t.owner_id) <> 2 then
    raise exception 'review/replay created another candidate'; end if;
end;
$test$;
reset role;
do $test$
declare t proposal_test_ids%rowtype;
begin
  select * into t from proposal_test_ids;
  if (select count(*) from public.restaurant_menus where restaurant_id = t.restaurant_id) <> 1 then
    raise exception 'proposal or approval created a public menu'; end if;
  if has_function_privilege('anon', 'public.get_my_restaurant_menu_candidates_v1()', 'EXECUTE')
    or has_function_privilege('anon', 'public.submit_restaurant_menu_candidate_v1(text,uuid,uuid,uuid,text,jsonb,boolean)', 'EXECUTE')
    or has_table_privilege('anon', 'public.restaurant_menu_identity_candidates', 'SELECT') then
    raise exception 'anonymous proposal privilege leaked'; end if;
  raise notice 'RESTAURANT_MENU_PROPOSAL_SQL_PASS';
end;
$test$;
-- Approval is not an eternal grant: retired canonical targets must lose exact/publication IDs.
update public.catalog_products set status = 'archived' where id = (select catalog_id from proposal_test_ids);
set local role authenticated;
do $test$
declare candidates jsonb;
begin
  candidates := public.get_my_restaurant_menu_candidates_v1();
  if exists (select 1 from jsonb_array_elements(candidates) row
    where row ->> 'resolutionStatus' = 'exact' or row ->> 'catalogProductId' is not null) then
    raise exception 'archived canonical identity still reported as exact';
  end if;
end;
$test$;
reset role;
rollback;
