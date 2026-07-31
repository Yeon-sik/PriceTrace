-- Require a complete, independently reviewed LinkProposal at the final write
-- boundary and make receipt source identities immutable.

alter table public.standard_product_link_approvals
  add column if not exists user_approval_text text;

-- Restore the contract normalization used by the LinkProposal validator.
do $migration$
declare
  v_signature regprocedure :=
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
begin
  select pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  v_definition := replace(
    v_definition,
    '''remove_ascii_space_only''',
    '''remove_unicode_whitespace_only'''
  );
  v_definition := replace(
    v_definition,
    'replace(p_receipt_product_name, '' '', '''')',
    'regexp_replace(p_receipt_product_name, ''[[:space:]]+'', '''', ''g'')'
  );
  v_definition := replace(
    v_definition,
    'replace(p_listing_name, '' '', '''')',
    'regexp_replace(p_listing_name, ''[[:space:]]+'', '''', ''g'')'
  );

  if v_definition = v_original_definition
    or position('''remove_unicode_whitespace_only''' in v_definition) = 0
    or position(
      'regexp_replace(p_receipt_product_name, ''[[:space:]]+'', '''', ''g'')'
      in v_definition
    ) = 0
  then
    raise exception 'The strict V3 function did not match the Unicode whitespace patch contract.';
  end if;

  execute v_definition;
end;
$migration$;

create or replace function public.admin_manage_standard_catalog(
  p_action text,
  p_target_id uuid,
  p_payload jsonb,
  p_confirmation text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_action_id uuid;
  v_standard_product_id uuid;
  v_content_unit text;
  v_max_bundle_quantity integer;
  v_max_bundle_price integer;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if p_action not in (
    'update_standard_name',
    'update_catalog_variant',
    'delete_catalog_variant',
    'delete_source_mapping',
    'record_coupang_price'
  )
    or p_target_id is null
    or coalesce(jsonb_typeof(p_payload), '') <> 'object'
    or p_confirmation <> 'CONFIRM_STANDARD_CATALOG_ACTION:' || p_action || ':' || p_target_id::text
  then
    raise exception 'A supported action, target, payload, and exact confirmation are required.'
      using errcode = '23514';
  end if;

  if p_action = 'update_standard_name'
  then
    if coalesce(length(btrim(p_payload ->> 'canonicalName')), 0) = 0
    then
      raise exception 'A canonical standard product name is required.'
        using errcode = '23514';
    end if;
    update public.standard_products
    set
      canonical_name = btrim(p_payload ->> 'canonicalName'),
      updated_at = now()
    where id = p_target_id
      and status = 'active';

  elsif p_action = 'update_catalog_variant'
  then
    if coalesce(length(btrim(p_payload ->> 'canonicalName')), 0) = 0
      or coalesce(p_payload ->> 'specificationStatus', '') not in ('verified', 'placeholder')
      or coalesce((p_payload ->> 'contentAmount')::numeric, 0) <= 0
      or coalesce(p_payload ->> 'contentUnit', '') not in ('g', 'ml', 'each')
      or coalesce((p_payload ->> 'packageCount')::integer, 0) <= 0
      or coalesce((p_payload ->> 'referenceUnit')::integer, 0) not in (10, 100, 1000)
      or coalesce(p_payload ->> 'listingReferenceUrl', '') !~ '^https?://'
    then
      raise exception 'A complete catalog variant payload is required.'
        using errcode = '23514';
    end if;
    update public.catalog_products
    set
      canonical_name = btrim(p_payload ->> 'canonicalName'),
      specification = nullif(btrim(p_payload ->> 'specification'), ''),
      specification_status = p_payload ->> 'specificationStatus',
      content_amount = (p_payload ->> 'contentAmount')::numeric,
      content_unit = p_payload ->> 'contentUnit',
      package_count = (p_payload ->> 'packageCount')::integer,
      reference_unit = (p_payload ->> 'referenceUnit')::integer,
      listing_reference_url = p_payload ->> 'listingReferenceUrl',
      updated_at = now()
    where id = p_target_id
      and status = 'active';

  elsif p_action = 'delete_catalog_variant'
  then
    delete from public.catalog_products
    where id = p_target_id;

  elsif p_action = 'delete_source_mapping'
  then
    delete from public.source_product_mappings
    where id = p_target_id;

  elsif p_action = 'record_coupang_price'
  then
    select catalog.standard_product_id
    into v_standard_product_id
    from public.catalog_products as catalog
    where catalog.id = p_target_id
      and catalog.status = 'active';

    v_content_unit := p_payload ->> 'contentUnit';
    v_max_bundle_quantity := (p_payload ->> 'maxBundleQuantity')::integer;
    v_max_bundle_price := (p_payload ->> 'maxBundleListedPriceKrw')::integer;

    if v_standard_product_id is null
      or coalesce(p_payload ->> 'productUrl', '') !~ '^https?://'
      or coalesce((p_payload ->> 'listedPriceKrw')::integer, 0) <= 0
      or coalesce((p_payload ->> 'quantity')::integer, 0) <= 0
      or coalesce((p_payload ->> 'contentAmount')::numeric, 0) <= 0
      or coalesce(v_content_unit, '') not in ('g', 'ml', 'each')
      or (v_max_bundle_quantity is null) <> (v_max_bundle_price is null)
      or (
        v_max_bundle_quantity is not null
        and (v_max_bundle_quantity <= 1 or v_max_bundle_price <= 0)
      )
    then
      raise exception 'A complete exact-variant Coupang observation is required.'
        using errcode = '23514';
    end if;

    insert into public.standard_product_coupang_prices (
      standard_product_id,
      catalog_product_id,
      product_url,
      listed_price_krw,
      quantity,
      content_amount,
      content_unit,
      max_bundle_quantity,
      max_bundle_listed_price_krw,
      observed_at,
      created_by
    )
    values (
      v_standard_product_id,
      p_target_id,
      p_payload ->> 'productUrl',
      (p_payload ->> 'listedPriceKrw')::integer,
      (p_payload ->> 'quantity')::integer,
      (p_payload ->> 'contentAmount')::numeric,
      v_content_unit,
      v_max_bundle_quantity,
      v_max_bundle_price,
      now(),
      v_user_id
    );
  end if;

  if not found
  then
    raise exception 'The requested catalog target does not exist.'
      using errcode = '23503';
  end if;

  insert into public.standard_catalog_admin_actions (
    action,
    target_id,
    payload,
    confirmation,
    created_by
  )
  values (
    p_action,
    p_target_id,
    p_payload,
    p_confirmation,
    v_user_id
  )
  returning id into v_action_id;

  return v_action_id;
end;
$$;

create function public.approve_and_register_standard_product_link_strict_v5(
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
  v_input jsonb;
  v_target jsonb;
  v_receipt jsonb;
  v_official jsonb;
  v_specification_check jsonb;
  v_review jsonb;
  v_decision jsonb;
  v_evidence jsonb;
  v_specification_match text[];
  v_expected_approval_statement text;
  v_effect_text text;
  v_registered record;
begin
  begin
    v_input := p_input_canonical_json::jsonb;
    v_target := p_target_canonical_json::jsonb;
  exception
    when others then
      raise exception 'Canonical LinkProposal JSON is invalid.'
        using errcode = '22023';
  end;

  v_receipt := v_input -> 'receipt';
  v_official := v_input -> 'officialListing';
  v_specification_check := v_target -> 'officialSpecificationCheck';
  v_review := v_target -> 'review';
  v_decision := v_target -> 'decision';
  v_evidence := v_target -> 'evidence';

  if coalesce(v_target -> 'approvalPolicy' ->> 'statementTemplateVersion', '')
      <> 'link-approval-ko-v1'
    or coalesce(v_target -> 'sameChannelNameRule' ->> 'normalization', '')
      <> 'remove_unicode_whitespace_only'
    or regexp_replace(p_receipt_product_name, '[[:space:]]+', '', 'g')
      <> regexp_replace(p_listing_name, '[[:space:]]+', '', 'g')
  then
    raise exception 'The approved same-channel exact-name contract is invalid.'
      using errcode = '23514';
  end if;

  if coalesce(v_review ->> 'verdict', '') <> 'approve'
    or coalesce(v_review ->> 'reviewerAgent', '')
      <> 'pricetrace_independent_reviewer'
    or coalesce(v_review ->> 'evidenceQuality', '') <> 'sufficient'
    or coalesce(jsonb_typeof(v_review -> 'conflicts'), '') <> 'array'
    or jsonb_array_length(v_review -> 'conflicts') <> 0
    or coalesce(v_decision ->> 'confidence', '') <> 'high'
    or coalesce(jsonb_typeof(v_decision -> 'matchedFields'), '') <> 'array'
    or jsonb_array_length(v_decision -> 'matchedFields') = 0
    or coalesce(jsonb_typeof(v_decision -> 'conflictingFields'), '') <> 'array'
    or jsonb_array_length(v_decision -> 'conflictingFields') <> 0
    or coalesce(jsonb_typeof(v_decision -> 'missingFields'), '') <> 'array'
    or jsonb_array_length(v_decision -> 'missingFields') <> 0
  then
    raise exception 'A sufficient independent approval review without conflicts or missing fields is required.'
      using errcode = '23514';
  end if;

  if coalesce(jsonb_typeof(v_evidence), '') <> 'array'
    or not exists (
      select 1
      from jsonb_array_elements(v_evidence) as item
      where item ->> 'sourceType' = 'receipt'
        and item ->> 'authority' = 'transactional'
        and item ->> 'sourceId'
          = btrim(p_receipt_id) || ':' || btrim(p_receipt_item_id)
        and jsonb_array_length(item -> 'claims') > 0
        and jsonb_array_length(item -> 'sourceRefs') > 0
    )
    or not exists (
      select 1
      from jsonb_array_elements(v_evidence) as item
      where item ->> 'sourceType' = 'official_channel'
        and item ->> 'authority' = 'primary'
        and item ->> 'sourceId'
          = (v_official ->> 'channelId') || ':'
          || (v_official ->> 'sourceProductCodeNamespace') || ':'
          || (v_official ->> 'sourceProductCode')
        and jsonb_array_length(item -> 'claims') > 0
        and jsonb_array_length(item -> 'sourceRefs') > 0
    )
    or not exists (
      select 1
      from jsonb_array_elements(v_evidence) as item
      where item ->> 'sourceType' = 'coupang'
        and item ->> 'url' = p_coupang_product_url
        and jsonb_array_length(item -> 'claims') > 0
        and jsonb_array_length(item -> 'sourceRefs') > 0
    )
  then
    raise exception 'Receipt, primary official-channel, and exact-option Coupang evidence are required.'
      using errcode = '23514';
  end if;

  v_specification_match := regexp_match(
    btrim(v_official ->> 'specificationTextRaw'),
    '^([0-9]+(?:[.][0-9]+)?)[[:space:]]*(g|ml|each|개)$',
    'i'
  );

  if v_specification_match is null
    or v_specification_match[1]::numeric is distinct from p_content_amount
    or (
      p_content_unit <> 'each'
      and lower(v_specification_match[2]) <> p_content_unit
    )
    or (
      p_content_unit = 'each'
      and lower(v_specification_match[2]) not in ('each', '개')
    )
    or p_specification_status <> 'verified'
    or (v_specification_check ->> 'parsedContentAmount')::numeric
      is distinct from p_content_amount
    or coalesce(v_specification_check ->> 'parsedContentUnit', '')
      <> p_content_unit
    or (v_specification_check ->> 'parsedPackageCount')::integer
      is distinct from p_package_count
    or coalesce((v_specification_check ->> 'matchesTarget')::boolean, false)
      is not true
    or (
      v_specification_check ->> 'packageCountBasis'
        = 'default_one_absent_count'
      and p_package_count <> 1
    )
    or coalesce(v_specification_check ->> 'packageCountBasis', '')
      not in ('explicit', 'default_one_absent_count')
    or p_coupang_content_amount is distinct from p_content_amount
    or p_coupang_content_unit <> p_content_unit
  then
    raise exception 'The official specification or exact Coupang option does not match the target variant.'
      using errcode = '23514';
  end if;

  select string_agg(value, ',' order by ordinal)
  into v_effect_text
  from jsonb_array_elements_text(v_target -> 'plannedEffects')
    with ordinality as effect(value, ordinal);

  v_expected_approval_statement :=
    '영수증 ' || btrim(p_source_labels[1]) || '/' || btrim(p_source_product_code)
    || ' · 공식 ' || (v_official ->> 'channelId') || '/'
    || (v_official ->> 'sourceProductCodeNamespace') || ':'
    || (v_official ->> 'sourceProductCode')
    || ' · ' || btrim(p_brand_name) || ' ' || btrim(p_standard_name)
    || ' / ' || btrim(p_listing_name)
    || ' · ' || v_effect_text
    || ' 연결을 승인합니다. [' || p_target_fingerprint || ']';

  if p_approval_statement <> v_expected_approval_statement
  then
    raise exception 'The full item-specific approval statement is required.'
      using errcode = '42501';
  end if;

  select *
  into v_registered
  from public.approve_and_register_standard_product_link_strict_v4(
    p_idempotency_key,
    p_case_id,
    p_input_fingerprint,
    p_target_fingerprint,
    p_input_canonical_json,
    p_target_canonical_json,
    'APPROVE_STANDARD_PRODUCT_LINK:' || p_target_fingerprint,
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

  update public.standard_product_link_approvals
  set user_approval_text = coalesce(user_approval_text, p_approval_statement)
  where target_fingerprint = p_target_fingerprint
    and (
      user_approval_text is null
      or user_approval_text = p_approval_statement
    );

  if not found
  then
    raise exception 'The approval text belongs to another execution.'
      using errcode = '40001';
  end if;

  return query
  select
    v_registered.execution_id,
    v_registered.standard_product_id,
    v_registered.catalog_product_id,
    v_registered.replayed;
end;
$$;

comment on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates a complete independently reviewed LinkProposal, exact official specification, complete evidence bundle, and full user approval text before applying V4.';

revoke all on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public;
grant execute on function public.approve_and_register_standard_product_link_strict_v5(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) to authenticated;

revoke execute on function public.approve_and_register_standard_product_link_strict_v4(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from anon, authenticated;
