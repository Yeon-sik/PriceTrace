-- The V5 receipt enricher already records Menu observations. The merchant
-- resolution RPC also recorded them, using only evidence_fingerprint as its
-- conflict target. Legacy fingerprints can differ while the immutable receipt
-- observation is the same; that second INSERT then violated price_observation_id.
-- Reuse requires the exact server source-line mapping, authority, and receipt
-- facts. A contradictory immutable observation is rejected, never reassigned.

create or replace function public.private_record_ocr_receipt_menu_observations_v1(
  p_response jsonb,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_receipt_id uuid := nullif(p_response ->> 'receiptId', '')::uuid;
  v_restaurant_id uuid := nullif(p_response ->> 'restaurantId', '')::uuid;
  v_location_id uuid := nullif(p_response ->> 'restaurantLocationId', '')::uuid;
  v_source_namespace text := nullif(pg_catalog.btrim(coalesce(
    p_receipt -> 'merchant' ->> 'catalog_namespace',
    p_receipt -> 'merchant' ->> 'source_namespace', ''
  )), '');
  v_observed_on date;
  v_source_line public.verified_receipt_source_lines%rowtype;
  v_line record;
  v_receipt_item_id text;
  v_expected_item_id text;
  v_price_observation_id uuid;
  v_price_catalog_product_id uuid;
  v_price_attributes jsonb;
  v_menu_observation_id uuid;
  v_source_mapping_id uuid;
  v_unit_price integer;
  v_quantity integer;
  v_total_price integer;
  v_evidence_fingerprint text;
  v_existing public.restaurant_menu_receipt_observations%rowtype;
  v_existing_count integer;
  v_lines jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if v_receipt_id is null then
    return p_response;
  end if;
  if not exists (
    select 1 from public.receipts as receipt
    where receipt.user_id = v_user_id and receipt.id = v_receipt_id
  ) then
    raise exception 'receipt is not owned by the authenticated user' using errcode = '42501';
  end if;
  if p_response ->> 'merchantResolutionStatus' is distinct from 'exact'
    or v_restaurant_id is null or v_location_id is null then
    return p_response;
  end if;

  -- All receipt observation writers for this helper serialize on the exact
  -- owner/receipt identity. Existing rows remain append-only.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'pricetrace-ocr-receipt-observations-v1:' || v_user_id::text || ':' || v_receipt_id::text, 0
  ));

  select coalesce(source.issued_on, (source.issued_at at time zone 'Asia/Seoul')::date)
    into v_observed_on
  from public.verified_receipt_sources as source
  where source.user_id = v_user_id and source.receipt_id = v_receipt_id
    and source.transcription_status = 'user_verified';
  if v_observed_on is null then
    raise exception 'OCR-reviewed receipt date is required for a Menu observation' using errcode = '23514';
  end if;

  for v_line in
    select line.value, line.ordinality
    from jsonb_array_elements(coalesce(p_response -> 'lines', '[]'::jsonb))
      with ordinality as line(value, ordinality)
    order by line.ordinality
  loop
    v_menu_observation_id := null;
    if v_line.value ->> 'resolutionStatus' = 'resolved' then
      select source_line.* into v_source_line
      from public.verified_receipt_source_lines as source_line
      where source_line.user_id = v_user_id
        and source_line.receipt_id = v_receipt_id
        and source_line.source_line_id = v_line.value ->> 'sourceLineId'
        and source_line.line_type = 'product'
        and source_line.benefit_kind is null
        and source_line.restaurant_menu_id is not null
        and source_line.catalog_product_id is not null;
      if found then
        if (
          select pg_catalog.count(*)
          from jsonb_array_elements(coalesce(p_response -> 'lines', '[]'::jsonb)) as sibling(value)
          where sibling.value ->> 'sourceLineId' = v_source_line.source_line_id
        ) <> 1 then
          raise exception 'receipt Menu source-line mapping is not unique' using errcode = '23514';
        end if;

        v_receipt_item_id := nullif(v_line.value ->> 'receiptItemId', '');
        -- This is the original PT server receipt-item derivation, not a name,
        -- index, client UUID, or a new receipt ingestion.
        v_expected_item_id := pg_catalog.encode(extensions.digest(
          v_receipt_id::text || ':' || v_source_line.source_line_id, 'sha256'
        ), 'hex');
        if v_receipt_item_id is distinct from v_expected_item_id
          or nullif(v_line.value ->> 'restaurantMenuId', '')::uuid is distinct from v_source_line.restaurant_menu_id
          or nullif(v_line.value ->> 'catalogProductId', '')::uuid is distinct from v_source_line.catalog_product_id then
          raise exception 'receipt Menu source-line identity conflict' using errcode = '23514';
        end if;

        if not exists (
          select 1
          from public.restaurants as restaurant
          inner join public.restaurant_locations as location on location.restaurant_id = restaurant.id
          inner join public.restaurant_menus as menu on menu.restaurant_id = restaurant.id
          inner join public.catalog_products as catalog on catalog.id = menu.catalog_product_id
          where restaurant.id = v_restaurant_id and location.id = v_location_id
            and menu.id = v_source_line.restaurant_menu_id and catalog.id = v_source_line.catalog_product_id
            and restaurant.status = 'active' and restaurant.review_status = 'verified'
            and restaurant.verification_status = 'verified'
            and location.review_status = 'verified' and location.verification_status = 'verified'
            and menu.status = 'active' and menu.review_status = 'verified'
            and menu.verification_status = 'verified'
            and catalog.status = 'active' and catalog.purchase_type = 'menu_item'
            and catalog.verification_status = 'verified'
        ) then
          raise exception 'receipt Menu authority is not exact and verified' using errcode = '23514';
        end if;

        select observation.id, observation.catalog_product_id, observation.attributes,
               item.unit_price_krw, item.purchased_quantity, item.total_price_krw
          into strict v_price_observation_id, v_price_catalog_product_id, v_price_attributes,
               v_unit_price, v_quantity, v_total_price
        from public.receipt_items as item
        inner join public.price_observations as observation
          on observation.user_id = item.user_id and observation.receipt_item_id = item.id
        where item.user_id = v_user_id and item.receipt_id = v_receipt_id
          and item.id = v_receipt_item_id
        for update of observation;
        if (v_price_catalog_product_id is not null
            and v_price_catalog_product_id is distinct from v_source_line.catalog_product_id)
          or (nullif(v_price_attributes ->> 'sourceLineId', '') is not null
            and v_price_attributes ->> 'sourceLineId' is distinct from v_source_line.source_line_id)
          or (nullif(v_line.value ->> 'observationId', '') is not null
            and nullif(v_line.value ->> 'observationId', '')::uuid is distinct from v_price_observation_id) then
          raise exception 'receipt price observation source identity conflict' using errcode = '23514';
        end if;

        v_source_mapping_id := null;
        if v_source_line.merchant_sku is not null and v_source_namespace is not null then
          select mapping.id into v_source_mapping_id
          from public.restaurant_menu_source_mappings as mapping
          where mapping.restaurant_id = v_restaurant_id
            and mapping.restaurant_location_id = v_location_id
            and mapping.restaurant_menu_id = v_source_line.restaurant_menu_id
            and mapping.source_product_code_namespace = v_source_namespace
            and mapping.source_product_code = v_source_line.merchant_sku
            and mapping.review_status = 'verified' and mapping.verification_status = 'verified';
        end if;

        v_evidence_fingerprint := 'sha256:' || pg_catalog.encode(extensions.digest(jsonb_build_object(
          'receiptId', v_receipt_id, 'lineId', v_source_line.source_line_id,
          'restaurantLocationId', v_location_id, 'restaurantMenuId', v_source_line.restaurant_menu_id,
          'unitPriceKrw', v_unit_price, 'quantity', v_quantity, 'totalPriceKrw', v_total_price
        )::text, 'sha256'), 'hex');

        select pg_catalog.count(*) into v_existing_count
        from public.restaurant_menu_receipt_observations as observation
        where observation.price_observation_id = v_price_observation_id
          or (observation.owner_user_id = v_user_id and observation.receipt_id = v_receipt_id
            and observation.receipt_item_id = v_receipt_item_id)
          or observation.evidence_fingerprint = v_evidence_fingerprint;
        if v_existing_count > 1 then
          raise exception 'receipt Menu observation source identity is not unique' using errcode = '23514';
        end if;
        if v_existing_count = 1 then
          select observation.* into v_existing
          from public.restaurant_menu_receipt_observations as observation
          where observation.price_observation_id = v_price_observation_id
            or (observation.owner_user_id = v_user_id and observation.receipt_id = v_receipt_id
              and observation.receipt_item_id = v_receipt_item_id)
            or observation.evidence_fingerprint = v_evidence_fingerprint
          for key share;
          if v_existing.owner_user_id is distinct from v_user_id
            or v_existing.receipt_id is distinct from v_receipt_id
            or v_existing.receipt_item_id is distinct from v_receipt_item_id
            or v_existing.price_observation_id is distinct from v_price_observation_id
            or v_existing.restaurant_id is distinct from v_restaurant_id
            or v_existing.restaurant_location_id is distinct from v_location_id
            or v_existing.restaurant_menu_id is distinct from v_source_line.restaurant_menu_id
            or v_existing.observed_on is distinct from v_observed_on
            or v_existing.unit_price_krw is distinct from v_unit_price
            or v_existing.quantity is distinct from v_quantity
            or v_existing.total_price_krw is distinct from v_total_price
            or v_existing.time_precision is distinct from 'date'
            or v_existing.source_type is distinct from 'database_receipt'
            or v_existing.verification_status is distinct from 'verified'
            or (nullif(v_existing.evidence_snapshot ->> 'sourceLineId', '') is not null
              and v_existing.evidence_snapshot ->> 'sourceLineId' is distinct from v_source_line.source_line_id)
            or (nullif(v_existing.evidence_snapshot ->> 'receiptId', '') is not null
              and nullif(v_existing.evidence_snapshot ->> 'receiptId', '')::uuid is distinct from v_receipt_id) then
            raise exception 'receipt Menu observation identity conflict; OCR source review is required'
              using errcode = '23514';
          end if;
          v_menu_observation_id := v_existing.id;
        else
          insert into public.restaurant_menu_receipt_observations(
            restaurant_id, restaurant_location_id, restaurant_menu_id, source_menu_mapping_id,
            owner_user_id, price_observation_id, receipt_id, receipt_item_id, observed_on,
            unit_price_krw, quantity, total_price_krw, evidence_snapshot, evidence_fingerprint,
            verification_status, verified_by
          ) values (
            v_restaurant_id, v_location_id, v_source_line.restaurant_menu_id, v_source_mapping_id,
            v_user_id, v_price_observation_id, v_receipt_id, v_receipt_item_id, v_observed_on,
            v_unit_price, v_quantity, v_total_price,
            jsonb_build_object('schemaVersion', 'receipt.v2', 'receiptId', v_receipt_id,
              'sourceLineId', v_source_line.source_line_id,
              'sourceLineReferences', to_jsonb(v_source_line.source_line_references)),
            v_evidence_fingerprint, 'verified', v_user_id
          ) returning id into v_menu_observation_id;
        end if;

        -- Change only the server price projection when the immutable link has
        -- been proven compatible. Failed checks roll back the entire RPC.
        update public.price_observations
        set catalog_product_id = v_source_line.catalog_product_id
        where user_id = v_user_id and id = v_price_observation_id
          and catalog_product_id is distinct from v_source_line.catalog_product_id;
      end if;
    end if;
    v_lines := v_lines || jsonb_build_array(
      v_line.value || jsonb_build_object('restaurantObservationId', v_menu_observation_id)
    );
  end loop;

  return p_response || jsonb_build_object('lines', v_lines);
end;
$function$;

revoke all on function public.private_record_ocr_receipt_menu_observations_v1(jsonb, jsonb)
  from public, anon, authenticated;

-- Enrichment is the single observation writer. Keep owner-authenticated source
-- verification and update only the sanitized accepted response afterwards.
create or replace function public.resolve_ocr_merchant_identity_v1(
  p_resolution_id uuid,
  p_merchant jsonb,
  p_user_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_candidate public.merchant_identity_candidates%rowtype;
  v_identity jsonb;
  v_response jsonb;
  v_mini_receipt jsonb;
  v_response_count integer;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if not coalesce(p_user_verified, false) then
    raise exception 'OCR source facts require explicit user verification' using errcode = '22023';
  end if;

  select candidate.* into v_candidate
  from public.merchant_identity_candidates as candidate
  where candidate.id = p_resolution_id and candidate.user_id = v_user_id
    and candidate.origin = 'receipt_ingestion' and candidate.review_status = 'needs_ocr_resolution'
  for update;
  if not found or v_candidate.receipt_id is null then
    raise exception 'OCR merchant resolution is not available to this user' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.receipts as receipt
    where receipt.user_id = v_user_id and receipt.id = v_candidate.receipt_id
  ) then
    raise exception 'receipt is not owned by the authenticated user' using errcode = '42501';
  end if;
  select pg_catalog.count(*) into v_response_count
  from public.verified_receipt_ingestion_contents as content
  where content.user_id = v_user_id and content.receipt_id = v_candidate.receipt_id;
  if v_response_count = 0 then
    raise exception 'verified receipt response was not found' using errcode = 'P0002';
  end if;
  if v_response_count <> 1 then
    raise exception 'verified receipt response is not unique' using errcode = '21000';
  end if;

  v_identity := public.private_resolve_verified_receipt_merchant_v2(
    v_user_id, v_candidate.source_fingerprint,
    coalesce(v_candidate.idempotency_key, 'ocr-resolution:' || v_candidate.id::text),
    p_merchant, v_candidate.id
  );
  select content.response into v_response
  from public.verified_receipt_ingestion_contents as content
  where content.user_id = v_user_id and content.receipt_id = v_candidate.receipt_id;
  if v_response is null then
    raise exception 'verified receipt response was not found' using errcode = 'P0002';
  end if;

  v_response := v_response || jsonb_build_object(
    'restaurantId', nullif(v_identity ->> 'restaurantId', '')::uuid,
    'restaurantLocationId', nullif(v_identity ->> 'restaurantLocationId', '')::uuid,
    'merchantResolutionStatus', v_identity ->> 'status',
    'ocrResolution', jsonb_build_object(
      'schemaVersion', 'ocr-resolution.v1',
      'status', case when v_identity ->> 'status' = 'exact' then 'resolved' else 'needs_ocr_resolution' end,
      'resolutionId', v_candidate.id, 'reasonCode', v_identity ->> 'reasonCode',
      'requiredSourceFacts', coalesce(v_identity -> 'requiredSourceFacts', '[]'::jsonb)
    )
  );
  if v_identity ->> 'status' = 'exact' then
    select jsonb_build_object(
      'merchant', jsonb_build_object(
        'catalog_namespace', coalesce(p_merchant ->> 'catalog_namespace', p_merchant ->> 'source_namespace'),
        'merchant_id', coalesce(p_merchant ->> 'merchant_id', p_merchant ->> 'source_location_code')
      ),
      'line_items', coalesce(jsonb_agg(jsonb_build_object(
        'id', source_line.source_line_id, 'type', source_line.line_type,
        'description', source_line.description,
        'identifiers', case when source_line.merchant_sku is null then '[]'::jsonb else
          jsonb_build_array(jsonb_build_object('scheme', 'merchant_sku', 'value', source_line.merchant_sku)) end
      ) order by source_line.line_ordinal), '[]'::jsonb)
    ) into v_mini_receipt
    from public.verified_receipt_source_lines as source_line
    where source_line.user_id = v_user_id and source_line.receipt_id = v_candidate.receipt_id;
    v_response := public.private_enrich_verified_receipt_ingestion_v2(v_response, v_mini_receipt);
  end if;

  update public.verified_receipt_ingestion_contents
  set response = v_response
  where user_id = v_user_id and receipt_id = v_candidate.receipt_id;
  update public.verified_receipt_ingestion_requests
  set response = v_response
  where user_id = v_user_id and receipt_id = v_candidate.receipt_id;
  return v_response;
end;
$function$;

comment on function public.resolve_ocr_merchant_identity_v1(uuid, jsonb, boolean) is
  'OCR-only owner-authenticated source review; enrichment records or reuses exact immutable receipt Menu observations once.';
revoke all on function public.resolve_ocr_merchant_identity_v1(uuid, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.resolve_ocr_merchant_identity_v1(uuid, jsonb, boolean)
  to authenticated;
