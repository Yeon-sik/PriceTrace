-- A legacy verified receipt may already have an immutable Menu observation
-- bound to a verified `pricetrace-db-store` Location. Its identity facts can be
-- missing while the owner-reviewed source receipt contains them. The newer
-- strong-signal resolver otherwise creates another Location and conflicts with
-- that immutable observation. Recover only this exact server-store identity;
-- names are consistency checks and never UUID selectors.
create or replace function public.private_restore_ocr_legacy_store_source_facts_v1(
  p_resolution_id uuid,
  p_merchant jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_candidate public.merchant_identity_candidates%rowtype;
  v_source public.verified_receipt_sources%rowtype;
  v_location public.restaurant_locations%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_store_id uuid;
  v_lock_key text;
  v_location_ids uuid[];
  v_observation record;
  v_source_line_ids text[];
  v_name text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'name', p_merchant ->> 'merchant_name', '')), '');
  v_branch text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'branch_name', '')), '');
  v_address text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'address', '')), '');
  v_phone text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'phone', '')), '');
  v_namespace text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'catalog_namespace', p_merchant ->> 'source_namespace', '')), '');
  v_code text := nullif(pg_catalog.btrim(coalesce(p_merchant ->> 'merchant_id', p_merchant ->> 'source_location_code', '')), '');
  v_bnr text := nullif(pg_catalog.regexp_replace(coalesce(p_merchant ->> 'business_registration_number', ''), '[^0-9]', '', 'g'), '');
begin
  if v_actor is null then
    raise exception 'authenticated OCR receipt owner required' using errcode = '42501';
  end if;
  select candidate.* into v_candidate
  from public.merchant_identity_candidates as candidate
  where candidate.id = p_resolution_id and candidate.user_id = v_actor
    and candidate.origin = 'receipt_ingestion' and candidate.review_status = 'needs_ocr_resolution'
  for update;
  if not found or v_candidate.receipt_id is null then
    raise exception 'OCR merchant resolution is not available to this user' using errcode = '42501';
  end if;
  select receipt.store_id into v_store_id
  from public.receipts as receipt
  where receipt.id = v_candidate.receipt_id and receipt.user_id = v_actor;
  if not found then
    raise exception 'receipt is not owned by the authenticated user' using errcode = '42501';
  end if;

  -- Use the normal resolver's exact sorted locks before touching a Location.
  -- A concurrent fresh ingestion cannot create a duplicate from these signals
  -- while this transaction restores the already-bound server-store identity.
  for v_lock_key in
    select lock_keys.value
    from pg_catalog.unnest(array[
      case when v_namespace is not null and v_code is not null then 'restaurant-source:' || v_namespace || ':' || v_code end,
      case when v_bnr is not null then 'restaurant-business-number:' || v_bnr end,
      case when v_branch is not null and v_address is not null and v_phone is not null
        then 'restaurant-contact:' || v_name || ':' || v_branch || ':' || v_address || ':' || v_phone end
    ]) as lock_keys(value)
    where lock_keys.value is not null
    order by lock_keys.value
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lock_key, 0));
  end loop;

  select pg_catalog.array_agg(distinct location.id) into v_location_ids
  from public.restaurant_locations as location
  inner join public.restaurant_menu_receipt_observations as observation
    on observation.restaurant_id = location.restaurant_id
    and observation.restaurant_location_id = location.id
    and observation.owner_user_id = v_actor and observation.receipt_id = v_candidate.receipt_id
  where location.source_namespace = 'pricetrace-db-store'
    and location.source_location_code = v_store_id::text;
  if coalesce(pg_catalog.cardinality(v_location_ids), 0) = 0 then
    return;
  end if;
  if pg_catalog.cardinality(v_location_ids) <> 1 then
    raise exception 'legacy receipt server-store identity is not unique; OCR source review is required'
      using errcode = '23514';
  end if;
  select location.* into v_location
  from public.restaurant_locations as location
  where location.id = v_location_ids[1]
  for update;
  select restaurant.* into v_restaurant
  from public.restaurants as restaurant
  where restaurant.id = v_location.restaurant_id;
  if v_location.created_by is distinct from v_actor
    or v_restaurant.status <> 'active' or v_restaurant.review_status <> 'verified'
    or v_restaurant.verification_status <> 'verified'
    or v_location.review_status <> 'verified' or v_location.verification_status <> 'verified' then
    raise exception 'legacy receipt server-store authority is not owned and verified; OCR source review is required'
      using errcode = '23514';
  end if;

  select source.* into v_source
  from public.verified_receipt_sources as source
  where source.user_id = v_actor and source.receipt_id = v_candidate.receipt_id
    and source.source_fingerprint = v_candidate.source_fingerprint
    and source.transcription_status = 'user_verified';
  if not found or v_name is null
    or p_merchant ->> 'business_kind' is distinct from 'food_service'
    or v_source.business_kind is distinct from 'food_service'
    or pg_catalog.btrim(v_source.merchant_name) is distinct from v_name
    or nullif(pg_catalog.btrim(v_source.branch_name), '') is distinct from v_branch
    or nullif(pg_catalog.btrim(v_source.address), '') is distinct from v_address
    or nullif(pg_catalog.btrim(v_source.phone), '') is distinct from v_phone
    or nullif(pg_catalog.btrim(v_source.catalog_namespace), '') is distinct from v_namespace
    or nullif(pg_catalog.btrim(v_source.merchant_id), '') is distinct from v_code
    or nullif(pg_catalog.regexp_replace(coalesce(v_source.business_registration_number, ''), '[^0-9]', '', 'g'), '')
      is distinct from v_bnr
    or (v_bnr is not null and pg_catalog.length(v_bnr) <> 10)
    or (v_bnr is null and (v_branch is null or v_address is null or v_phone is null)) then
    raise exception 'legacy receipt approved source facts differ from the archived verified source; OCR source review is required'
      using errcode = '23514';
  end if;
  if v_restaurant.canonical_name is distinct from v_name
    or v_location.location_label is distinct from v_branch
    or (nullif(pg_catalog.btrim(v_location.address), '') is not null
      and pg_catalog.btrim(v_location.address) is distinct from v_address)
    or (nullif(pg_catalog.btrim(v_location.phone), '') is not null
      and pg_catalog.btrim(v_location.phone) is distinct from v_phone)
    or (v_bnr is not null
      and nullif(pg_catalog.regexp_replace(coalesce(v_location.business_registration_number, ''), '[^0-9]', '', 'g'), '') is not null
      and pg_catalog.regexp_replace(v_location.business_registration_number, '[^0-9]', '', 'g') is distinct from v_bnr) then
    raise exception 'legacy receipt server-store facts conflict; OCR source review is required' using errcode = '23514';
  end if;

  -- Prove every immutable link belongs to this exact private server receipt,
  -- item and price observation. Missing legacy sourceLineId is accepted only
  -- with the original server hash mapping, not an array index or a name.
  for v_observation in
    select observation.*, item.id as owned_item_id, price.id as owned_price_id
    from public.restaurant_menu_receipt_observations as observation
    left join public.receipt_items as item
      on item.user_id = v_actor and item.receipt_id = v_candidate.receipt_id
      and item.id = observation.receipt_item_id
    left join public.price_observations as price
      on price.user_id = v_actor and price.receipt_item_id = item.id
      and price.id = observation.price_observation_id
    where observation.owner_user_id = v_actor and observation.receipt_id = v_candidate.receipt_id
  loop
    if v_observation.restaurant_id is distinct from v_location.restaurant_id
      or v_observation.restaurant_location_id is distinct from v_location.id
      or v_observation.verified_by is distinct from v_actor
      or v_observation.verification_status is distinct from 'verified'
      or v_observation.owned_item_id is null or v_observation.owned_price_id is null
      or v_observation.evidence_snapshot ->> 'storeId' is distinct from v_store_id::text
      or v_observation.evidence_snapshot ->> 'receiptItemId' is distinct from v_observation.receipt_item_id
      or v_observation.evidence_snapshot ->> 'priceObservationId' is distinct from v_observation.price_observation_id::text then
      raise exception 'legacy receipt observation server-store binding conflicts; OCR source review is required'
        using errcode = '23514';
    end if;
    select pg_catalog.array_agg(source_line.source_line_id) into v_source_line_ids
    from public.verified_receipt_source_lines as source_line
    where source_line.user_id = v_actor and source_line.receipt_id = v_candidate.receipt_id
      and pg_catalog.encode(extensions.digest(
        v_candidate.receipt_id::text || ':' || source_line.source_line_id, 'sha256'
      ), 'hex') = v_observation.receipt_item_id;
    if coalesce(pg_catalog.cardinality(v_source_line_ids), 0) <> 1
      or (nullif(v_observation.evidence_snapshot ->> 'sourceLineId', '') is not null
        and v_observation.evidence_snapshot ->> 'sourceLineId' is distinct from v_source_line_ids[1]) then
      raise exception 'legacy receipt observation source-line binding conflicts; OCR source review is required'
        using errcode = '23514';
    end if;
  end loop;

  -- Check the same strong signals as the normal resolver before adding missing
  -- contact facts. Never merge another existing Location into this one.
  if exists (
    select 1 from public.restaurant_locations as location
    inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
    where location.id <> v_location.id and (
      (v_namespace is not null and v_code is not null
        and location.source_namespace = v_namespace and location.source_location_code = v_code)
      or (v_bnr is not null
        and pg_catalog.regexp_replace(coalesce(location.business_registration_number, ''), '[^0-9]', '', 'g') = v_bnr)
      or (restaurant.canonical_name = v_name and location.location_label = v_branch
        and location.address = v_address and location.phone = v_phone)
    )
  ) then
    raise exception 'legacy receipt source identity also matches another Location; OCR source review is required'
      using errcode = '23514';
  end if;

  -- Source namespace/code and every nonblank fact remain unchanged. Restore a
  -- missing business number only when its normalized original/approved source
  -- values match exactly. Missing branch labels stay NULL, never invented.
  update public.restaurant_locations
  set address = case when nullif(pg_catalog.btrim(address), '') is null then v_address else address end,
      phone = case when nullif(pg_catalog.btrim(phone), '') is null then v_phone else phone end,
      business_registration_number = case when nullif(pg_catalog.btrim(business_registration_number), '') is null
        then v_bnr else business_registration_number end,
      updated_at = pg_catalog.now()
  where id = v_location.id
    and ((nullif(pg_catalog.btrim(address), '') is null and v_address is not null)
      or (nullif(pg_catalog.btrim(phone), '') is null and v_phone is not null)
      or (nullif(pg_catalog.btrim(business_registration_number), '') is null and v_bnr is not null));
end;
$function$;

revoke all on function public.private_restore_ocr_legacy_store_source_facts_v1(uuid, jsonb)
  from public, anon, authenticated;

-- Insert one private recovery call before the existing strong-signal resolver.
-- Reapplication recognizes the exact completed patch; unexpected drift fails.
do $migration$
declare
  v_definition text;
  v_anchor text := '  v_identity := public.private_resolve_verified_receipt_merchant_v2(';
  v_call text := '  perform public.private_restore_ocr_legacy_store_source_facts_v1(p_resolution_id, p_merchant);';
begin
  select pg_catalog.pg_get_functiondef(
    'public.resolve_ocr_merchant_identity_v1(uuid, jsonb, boolean)'::regprocedure
  ) into v_definition;
  v_definition := pg_catalog.replace(v_definition, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10));
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_anchor, '')))
    / pg_catalog.length(v_anchor) <> 1 then
    raise exception 'OCR merchant resolution strong resolver anchor is not unique';
  end if;
  if pg_catalog.strpos(v_definition, v_call) = 0 then
    execute pg_catalog.replace(v_definition, v_anchor, v_call || pg_catalog.chr(10) || v_anchor);
  elsif pg_catalog.strpos(v_definition, v_call || pg_catalog.chr(10) || v_anchor) = 0
    or (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_call, '')))
      / pg_catalog.length(v_call) <> 1 then
    raise exception 'OCR merchant resolution legacy recovery patch has unexpected drift';
  end if;
end;
$migration$;
