-- Make the frozen official image part of the same approval-gated transaction
-- as family, variant, official-link, receipt-mapping, and Coupang writes.

do $migration$
declare
  v_signature regprocedure :=
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
  v_core_effects text := $fragment$
  v_expected_effects := v_expected_effects || '[
    "link_official_listing",
    "verify_receipt_mapping",
    "register_coupang_offer"
  ]'::jsonb;
$fragment$;
  v_image_aware_effects text := $fragment$
  v_expected_effects := v_expected_effects || '[
    "link_official_listing",
    "verify_receipt_mapping",
    "register_coupang_offer"
  ]'::jsonb;
  if v_target ? 'representativeImage'
  then
    v_expected_effects := v_expected_effects
      || '["update_representative_image"]'::jsonb;
  end if;
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  if pg_catalog.strpos(v_definition, v_core_effects) = 0
  then
    raise exception 'Unexpected V3 planned-effect validation contract.';
  end if;

  v_definition := pg_catalog.replace(
    v_definition,
    v_core_effects,
    v_image_aware_effects
  );

  if v_definition = v_original_definition
    or pg_catalog.strpos(v_definition, v_image_aware_effects) = 0
  then
    raise exception 'V3 image-effect patch did not produce the expected definition.';
  end if;

  execute v_definition;
end;
$migration$;

create function public.approve_and_register_standard_product_link_strict_v6(
  p_idempotency_key text,
  p_case_id text,
  p_input_fingerprint text,
  p_target_fingerprint text,
  p_input_canonical_json text,
  p_target_canonical_json text,
  p_approval_statement text,
  p_receipt_id text,
  p_receipt_item_id text,
  p_receipt_observed_at timestamptz,
  p_standard_product_id uuid,
  p_catalog_product_id uuid,
  p_standard_name text,
  p_brand_name text,
  p_receipt_brand_name text,
  p_official_brand_name text,
  p_official_brand_source_label text,
  p_product_reference_url text,
  p_listing_name text,
  p_receipt_product_name text,
  p_specification_status text,
  p_content_amount numeric,
  p_content_unit text,
  p_package_count integer,
  p_reference_unit integer,
  p_source_product_code text,
  p_source_labels text[],
  p_coupang_product_url text,
  p_coupang_listed_price_krw integer,
  p_coupang_quantity integer,
  p_coupang_content_amount numeric,
  p_coupang_content_unit text,
  p_coupang_max_bundle_quantity integer,
  p_coupang_max_bundle_listed_price_krw integer
)
returns table (
  execution_id uuid,
  standard_product_id uuid,
  catalog_product_id uuid,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_input jsonb;
  v_target jsonb;
  v_official_image jsonb;
  v_representative_image jsonb;
  v_expected_current jsonb;
  v_existing_image public.standard_product_images%rowtype;
  v_registered record;
  v_image_result jsonb;
  v_stored_result jsonb;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  begin
    v_input := p_input_canonical_json::jsonb;
    v_target := p_target_canonical_json::jsonb;
  exception
    when others then
      raise exception 'Canonical LinkProposal JSON is invalid.'
        using errcode = '22023';
  end;

  v_official_image := v_input -> 'officialListing' -> 'image';
  v_representative_image := v_target -> 'representativeImage';
  v_expected_current := v_representative_image -> 'expectedCurrent';

  if coalesce(jsonb_typeof(v_official_image), '') <> 'object'
    or coalesce(jsonb_typeof(v_representative_image), '') <> 'object'
    or coalesce(v_representative_image ->> 'scope', '')
      <> 'standard_product_family'
    or coalesce(v_representative_image ->> 'action', '')
      not in ('create', 'reuse_exact')
    or coalesce(v_representative_image ->> 'sourceType', '') <> 'external_url'
    or coalesce(v_official_image ->> 'url', '') !~ '^https://'
    or coalesce(v_official_image ->> 'contentHash', '')
      !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(v_official_image ->> 'mediaType', '')
      not in ('image/jpeg', 'image/png', 'image/webp')
    or coalesce((v_official_image ->> 'byteLength')::integer, 0) <= 0
    or v_representative_image ->> 'imageUrl'
      is distinct from v_official_image ->> 'url'
    or v_representative_image ->> 'contentHash'
      is distinct from v_official_image ->> 'contentHash'
    or v_representative_image ->> 'mediaType'
      is distinct from v_official_image ->> 'mediaType'
    or (v_representative_image ->> 'byteLength')::integer
      is distinct from (v_official_image ->> 'byteLength')::integer
    or not ((v_target -> 'plannedEffects') ? 'update_representative_image')
  then
    raise exception 'A matching frozen official family representative image is required.'
      using errcode = '23514';
  end if;

  if (
    v_representative_image ->> 'action' = 'create'
    and jsonb_typeof(v_expected_current) <> 'null'
  ) or (
    v_representative_image ->> 'action' = 'reuse_exact'
    and (
      coalesce(jsonb_typeof(v_expected_current), '') <> 'object'
      or coalesce(v_expected_current ->> 'sourceType', '') <> 'external_url'
      or v_expected_current ->> 'imageUrl'
        is distinct from v_representative_image ->> 'imageUrl'
    )
  )
  then
    raise exception 'Representative image expected-current state is invalid.'
      using errcode = '23514';
  end if;

  if coalesce(jsonb_typeof(v_target -> 'evidence'), '') <> 'array'
    or coalesce(
      jsonb_typeof(v_input -> 'officialListing' -> 'sourceRefs'),
      ''
    ) <> 'array'
  then
    raise exception 'Official image provenance arrays are required.'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_target -> 'evidence') as evidence(item)
    where evidence.item ->> 'sourceType' = 'official_channel'
      and evidence.item ->> 'authority' = 'primary'
      and evidence.item ->> 'sourceId'
        = (v_input -> 'officialListing' ->> 'channelId') || ':'
        || (v_input -> 'officialListing' ->> 'sourceProductCodeNamespace') || ':'
        || (v_input -> 'officialListing' ->> 'sourceProductCode')
      and exists (
        select 1
        from jsonb_array_elements_text(evidence.item -> 'sourceRefs')
          as evidence_ref(value)
        inner join jsonb_array_elements_text(
          v_input -> 'officialListing' -> 'sourceRefs'
        ) as official_ref(value)
          on official_ref.value = evidence_ref.value
      )
  )
  then
    raise exception 'The official image must retain matching primary snapshot provenance.'
      using errcode = '23514';
  end if;

  select *
  into v_registered
  from public.approve_and_register_standard_product_link_strict_v5(
    p_idempotency_key,
    p_case_id,
    p_input_fingerprint,
    p_target_fingerprint,
    p_input_canonical_json,
    p_target_canonical_json,
    p_approval_statement,
    p_receipt_id,
    p_receipt_item_id,
    p_receipt_observed_at,
    p_standard_product_id,
    p_catalog_product_id,
    p_standard_name,
    p_brand_name,
    p_receipt_brand_name,
    p_official_brand_name,
    p_official_brand_source_label,
    p_product_reference_url,
    p_listing_name,
    p_receipt_product_name,
    p_specification_status,
    p_content_amount,
    p_content_unit,
    p_package_count,
    p_reference_unit,
    p_source_product_code,
    p_source_labels,
    p_coupang_product_url,
    p_coupang_listed_price_krw,
    p_coupang_quantity,
    p_coupang_content_amount,
    p_coupang_content_unit,
    p_coupang_max_bundle_quantity,
    p_coupang_max_bundle_listed_price_krw
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'standard-representative-image:' || v_registered.standard_product_id::text,
      0
    )
  );

  select image.*
  into v_existing_image
  from public.standard_product_images as image
  where image.standard_product_id = v_registered.standard_product_id
  for update;

  v_image_result := pg_catalog.jsonb_build_object(
    'scope', 'standard_product_family',
    'sourceType', 'external_url',
    'imageUrl', v_representative_image ->> 'imageUrl',
    'contentHash', v_representative_image ->> 'contentHash',
    'mediaType', v_representative_image ->> 'mediaType',
    'byteLength', (v_representative_image ->> 'byteLength')::integer,
    'appliedAction', case
      when v_representative_image ->> 'action' = 'create'
        then 'created'
      else 'reused_exact'
    end
  );

  if v_registered.replayed
  then
    select execution.result -> 'representativeImage'
    into v_stored_result
    from public.standard_product_link_executions as execution
    where execution.id = v_registered.execution_id
    for update;

    if v_existing_image.standard_product_id is null
      or v_existing_image.source_type <> 'external_url'
      or v_existing_image.image_url <> v_representative_image ->> 'imageUrl'
      or v_stored_result is distinct from v_image_result
    then
      raise exception 'The replayed representative image no longer matches its approved result.'
        using errcode = '40001';
    end if;
  elsif v_existing_image.standard_product_id is null
  then
    if v_representative_image ->> 'action' <> 'create'
    then
      raise exception 'The expected representative image does not exist.'
        using errcode = '23505';
    end if;

    insert into public.standard_product_images (
      standard_product_id,
      source_type,
      image_url,
      created_by
    )
    values (
      v_registered.standard_product_id,
      'external_url',
      v_representative_image ->> 'imageUrl',
      v_user_id
    );
  else
    if v_representative_image ->> 'action' <> 'reuse_exact'
      or v_existing_image.source_type <> 'external_url'
      or v_existing_image.image_url <> v_representative_image ->> 'imageUrl'
    then
      raise exception 'A different representative image already exists; overwrite is not allowed.'
        using errcode = '23505';
    end if;
  end if;

  if not v_registered.replayed
  then
    update public.standard_product_link_executions
    set result = result || pg_catalog.jsonb_build_object(
      'representativeImage', v_image_result
    )
    where id = v_registered.execution_id;
  end if;

  return query
  select
    v_registered.execution_id,
    v_registered.standard_product_id,
    v_registered.catalog_product_id,
    v_registered.replayed;
end;
$$;

comment on function public.approve_and_register_standard_product_link_strict_v6(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Atomically applies one fully reviewed standard-product link and creates or exactly reuses its approved official family representative image without overwriting.';

revoke all on function public.approve_and_register_standard_product_link_strict_v6(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public;

grant execute on function public.approve_and_register_standard_product_link_strict_v6(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) to authenticated;

revoke execute on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from anon, authenticated;
