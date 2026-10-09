-- Downstream metadata only: never add server UUIDs to V4 source facts.
begin;

create function public.private_purchase_price_line_response_v1(
  p_purchase_source_id uuid,
  p_base_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_source public.purchase_price_sources%rowtype;
  v_line public.purchase_price_source_lines%rowtype;
  v_observation public.restaurant_menu_manual_observations%rowtype;
  v_base_line jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ids jsonb;
  v_status text;
  v_merchant_status text;
  v_menu_status text;
  v_reason text;
  v_count bigint;
  v_candidate_count bigint;
  v_location public.restaurant_locations%rowtype;
begin
  if v_owner is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  select source.* into v_source from public.purchase_price_sources as source
  where source.id = p_purchase_source_id and source.user_id = v_owner;
  if not found then
    raise exception 'purchase source was not found' using errcode = 'P0002';
  end if;
  if p_base_response ->> 'purchaseSourceId' is distinct from p_purchase_source_id::text then
    raise exception 'purchase response source mismatch' using errcode = '23514';
  end if;
  -- New responses are frozen in the existing append-only checkpoint tables.
  if p_base_response ->> 'lineAuthorityVersion' = 'purchase-line-authority.v1' then
    return p_base_response;
  end if;
  select count(*) into v_count from public.purchase_price_source_lines as line
  where line.purchase_source_id = p_purchase_source_id and line.user_id = v_owner;
  if jsonb_typeof(p_base_response -> 'lineResults') is distinct from 'array'
    or jsonb_array_length(p_base_response -> 'lineResults') <> v_count then
    raise exception 'purchase response line count mismatch' using errcode = '23514';
  end if;

  for v_line in
    select line.* from public.purchase_price_source_lines as line
    where line.purchase_source_id = p_purchase_source_id and line.user_id = v_owner
    order by line.line_ordinal
  loop
    select count(*), (jsonb_agg(item.value) -> 0) into v_count, v_base_line
    from jsonb_array_elements(p_base_response -> 'lineResults') as item(value)
    where item.value ->> 'lineOrdinal' = v_line.line_ordinal::text
      and item.value ->> 'lineKey' = v_line.source_line_key;
    if v_count <> 1
      or (v_base_line ->> 'observationCreated')::boolean
        is distinct from (v_line.observation_status = 'created')
      or (v_line.observation_status = 'created' and
        v_base_line ->> 'observationId' is distinct from
          coalesce(v_line.price_observation_id, v_line.restaurant_menu_manual_observation_id)::text)
    then
      raise exception 'purchase response line identity mismatch' using errcode = '23514';
    end if;
    v_ids := null;
    v_status := 'unresolved';
    v_merchant_status := 'unresolved';
    v_menu_status := 'unresolved';
    v_reason := v_line.observation_reason;

    if v_line.observation_status = 'created' then
      if v_source.purchase_kind = 'restaurant' then
        select observation.* into v_observation
        from public.restaurant_menu_manual_observations as observation
        where observation.id = v_line.restaurant_menu_manual_observation_id
          and observation.created_by = v_owner
          and observation.observation_kind = 'standalone_purchase'
          and observation.verification_status = 'verified'
          and observation.source_snapshot ->> 'purchaseSourceId' = p_purchase_source_id::text
          and observation.source_snapshot ->> 'purchaseLineOrdinal' = v_line.line_ordinal::text
          and observation.source_snapshot ->> 'catalogProductId' = v_line.catalog_product_id::text
          and observation.source_snapshot ->> 'standardProductId' = v_line.standard_product_id::text;
        if not found then
          raise exception 'purchase observation owner or source identity mismatch' using errcode = '23514';
        end if;
        -- V4 historically ignored a conflicting supplied branch label. Keep
        -- its financial result, but do not authorize Nutrition from that conflict.
        select location.* into v_location from public.restaurant_locations as location
        where location.id = v_observation.restaurant_location_id
          and location.restaurant_id = v_observation.restaurant_id;
        if v_line.line_seller_branch_name is not null and v_location.location_label is not null
          and v_line.line_seller_branch_name <> v_location.location_label then
          v_status := 'needs_review';
          v_merchant_status := 'needs_review';
          v_reason := 'restaurant_source_identity_conflict';
        elsif v_line.option_text is null then
          -- The legacy default serving label can create a price observation,
          -- but an unstated serving is insufficient downstream menu authority.
          v_merchant_status := 'exact';
          v_reason := 'restaurant_menu_serving_label_missing';
        else
          v_status := 'exact';
          v_merchant_status := 'exact';
          v_menu_status := 'exact';
          v_ids := jsonb_build_object(
            'restaurantId', v_observation.restaurant_id,
            'restaurantLocationId', v_observation.restaurant_location_id,
            'restaurantMenuId', v_observation.restaurant_menu_id,
            'catalogProductId', v_line.catalog_product_id,
            'standardProductId', v_line.standard_product_id
          );
        end if;
      else
        v_status := 'exact';
        v_ids := jsonb_build_object(
          'productId', v_line.product_id, 'storeProductId', v_line.store_product_id,
          'catalogProductId', v_line.catalog_product_id, 'standardProductId', v_line.standard_product_id
        );
      end if;
    elsif v_line.observation_reason in ('restaurant_authority_ambiguous', 'restaurant_source_identity_conflict') then
      v_status := 'needs_review';
      v_merchant_status := 'needs_review';
    elsif v_line.observation_reason = 'restaurant_menu_authority_ambiguous' then
      v_status := 'needs_review';
      v_merchant_status := 'exact';
      v_menu_status := 'needs_review';
    elsif v_line.observation_reason = 'restaurant_menu_authority_unresolved' then
      v_merchant_status := 'exact';
    elsif v_source.purchase_kind = 'restaurant'
      and v_line.observation_reason in ('restaurant_source_identity_missing', 'restaurant_authority_unresolved')
    then
      -- Candidate counts can only block authority. A unique name NEVER grants
      -- exact identity. No candidate IDs or other owners' purchase facts leak.
      select count(*) into v_candidate_count
      from public.restaurant_locations as location
      inner join public.restaurants as restaurant on restaurant.id = location.restaurant_id
      where restaurant.canonical_name = v_line.line_seller_name
        and (v_line.line_seller_branch_name is null or location.location_label = v_line.line_seller_branch_name)
        and restaurant.status = 'active' and restaurant.review_status = 'verified'
        and restaurant.verification_status = 'verified'
        and location.review_status = 'verified' and location.verification_status = 'verified';
      select location.* into v_location from public.restaurant_locations as location
      where location.source_namespace = v_line.line_seller_source_namespace
        and location.source_location_code = v_line.line_seller_source_code;
      if found then
        -- An existing source identity was rejected by the V4 authority gates:
        -- conflicting name/status/branch is reviewable, never exact.
        v_status := 'needs_review';
        v_merchant_status := 'needs_review';
        v_reason := 'restaurant_source_identity_conflict';
      elsif v_candidate_count > 1 then
        v_status := 'needs_review';
        v_merchant_status := 'needs_review';
        v_reason := 'restaurant_authority_ambiguous';
      end if;
    end if;

    select count(*) into v_count from public.purchase_price_source_lines as sibling
    where sibling.purchase_source_id = p_purchase_source_id and sibling.user_id = v_owner
      and sibling.source_line_key = v_line.source_line_key;
    if v_count <> 1 then
      -- Preserve legacy acceptance of duplicate keys, but fail closed downstream.
      v_status := 'needs_review';
      v_merchant_status := 'unresolved';
      v_menu_status := 'unresolved';
      v_ids := null;
      v_reason := 'duplicate_line_key';
    end if;
    v_results := v_results || jsonb_build_array(v_base_line || jsonb_build_object(
      'kind', v_source.kind,
      'sourceSaved', true,
      'sourceAcceptanceStatus', 'accepted',
      'observationStatus', v_line.observation_status,
      'reasonCode', v_reason,
      'authorityStatus', v_status,
      'merchantResolutionStatus', v_merchant_status,
      'menuResolutionStatus', v_menu_status,
      'authoritativeIds', v_ids
    ));
  end loop;
  return p_base_response || jsonb_build_object(
    'sourceSaved', true, 'sourceAcceptanceStatus', 'accepted',
    'lineAuthorityVersion', 'purchase-line-authority.v1', 'lineResults', v_results
  );
end;
$function$;
revoke all on function public.private_purchase_price_line_response_v1(uuid, jsonb)
  from public, anon, authenticated;

-- Attach metadata once, before the original response is persisted. Replay,
-- content deduplication, all input validation and financial writes stay intact.
do $migration$
declare
  v_definition text := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'public.ingest_verified_purchase_price_observation_v1(text,jsonb)'::regprocedure
  ), E'\r\n', E'\n');
  v_anchor text := E'  insert into public.purchase_price_observation_ingestion_contents (';
begin
  if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'purchase response checkpoint anchor is missing or ambiguous';
  end if;
  execute replace(v_definition, v_anchor,
    E'  v_response := public.private_purchase_price_line_response_v1(v_source_id, v_response);\n\n' || v_anchor);
end;
$migration$;

create function public.get_purchase_price_ingestion_response_v1(p_purchase_source_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_response jsonb;
  v_count bigint;
begin
  if v_owner is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if p_purchase_source_id is null then
    raise exception 'server-issued purchase source ID is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.purchase_price_sources as source
    where source.id = p_purchase_source_id and source.user_id = v_owner) then
    raise exception 'purchase response was not found' using errcode = 'P0002';
  end if;
  select count(*) into v_count from public.purchase_price_observation_ingestion_contents as content
  where content.purchase_source_id = p_purchase_source_id and content.user_id = v_owner;
  if v_count = 0 then
    raise exception 'purchase response was not found' using errcode = 'P0002';
  elsif v_count <> 1 then
    raise exception 'purchase response selector is not unique' using errcode = '21000';
  end if;
  select content.response into v_response from public.purchase_price_observation_ingestion_contents as content
  where content.purchase_source_id = p_purchase_source_id and content.user_id = v_owner;
  return public.private_purchase_price_line_response_v1(p_purchase_source_id, v_response);
end;
$function$;
comment on function public.get_purchase_price_ingestion_response_v1(uuid) is
  'Owner-only V4 checkpoint metadata read. Returns per-line acceptance, observation outcome and server-issued authority without modifying accepted purchase facts.';
revoke all on function public.get_purchase_price_ingestion_response_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.get_purchase_price_ingestion_response_v1(uuid) to authenticated;

commit;
