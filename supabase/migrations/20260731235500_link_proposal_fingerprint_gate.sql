alter table public.standard_product_link_executions
  add column proposal_input jsonb,
  add column proposal_target jsonb;

create table public.standard_product_official_links (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null check (length(btrim(channel_id)) > 0),
  source_product_code_namespace text not null check (length(btrim(source_product_code_namespace)) > 0),
  source_product_code text not null check (length(btrim(source_product_code)) > 0),
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (channel_id, source_product_code_namespace, source_product_code)
);

create table public.standard_product_official_link_evidence (
  id uuid primary key default gen_random_uuid(),
  official_link_id uuid not null references public.standard_product_official_links(id) on delete restrict,
  snapshot_id uuid not null,
  snapshot_hash text not null check (snapshot_hash ~ '^sha256:[a-f0-9]{64}$'),
  source_name_raw text not null check (length(btrim(source_name_raw)) > 0),
  specification_text_raw text not null check (length(btrim(specification_text_raw)) > 0),
  source_refs jsonb not null check (jsonb_typeof(source_refs) = 'array' and jsonb_array_length(source_refs) > 0),
  product_reference_url text not null check (product_reference_url ~ '^https?://'),
  link_execution_id uuid not null unique references public.standard_product_link_executions(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.standard_product_official_links enable row level security;
alter table public.standard_product_official_link_evidence enable row level security;

grant select on public.standard_product_official_links,
  public.standard_product_official_link_evidence to authenticated;

create policy "admins read standard product official links"
  on public.standard_product_official_links for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins read standard product official link evidence"
  on public.standard_product_official_link_evidence for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create function public.canonical_jsonb_text(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_type = 'object'
  then
    select '{' || coalesce(
      string_agg(
        to_jsonb(entry.key)::text || ':' || public.canonical_jsonb_text(entry.value),
        ',' order by entry.key collate "C"
      ),
      ''
    ) || '}'
    into v_result
    from jsonb_each(p_value) as entry(key, value);
    return v_result;
  elsif v_type = 'array'
  then
    select '[' || coalesce(
      string_agg(public.canonical_jsonb_text(entry.value), ',' order by entry.ordinality),
      ''
    ) || ']'
    into v_result
    from jsonb_array_elements(p_value) with ordinality as entry(value, ordinality);
    return v_result;
  end if;
  return p_value::text;
end;
$$;

create function public.register_standard_product_link_strict_v3(
  p_idempotency_key text,
  p_case_id text,
  p_input_fingerprint text,
  p_target_fingerprint text,
  p_input_canonical_json text,
  p_target_canonical_json text,
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
  v_receipt jsonb;
  v_official jsonb;
  v_rule jsonb;
  v_identity jsonb;
  v_brand_evidence jsonb;
  v_decision jsonb;
  v_offer jsonb;
  v_expected_action text;
  v_expected_effects jsonb := '[]'::jsonb;
  v_registered record;
  v_stored_input jsonb;
  v_stored_target jsonb;
  v_official_link_id uuid;
  v_existing_catalog_product_id uuid;
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
      raise exception 'Canonical proposal JSON is invalid.'
        using errcode = '22023';
  end;

  if public.canonical_jsonb_text(v_input) <> p_input_canonical_json
    or public.canonical_jsonb_text(v_target) <> p_target_canonical_json
  then
    raise exception 'Proposal JSON is not canonical.'
      using errcode = '23514';
  end if;

  if 'sha256:' || encode(
    extensions.digest(convert_to(p_input_canonical_json, 'UTF8'), 'sha256'),
    'hex'
  ) <> p_input_fingerprint
    or 'sha256:' || encode(
      extensions.digest(convert_to(p_target_canonical_json, 'UTF8'), 'sha256'),
      'hex'
    ) <> p_target_fingerprint
  then
    raise exception 'Proposal fingerprint validation failed.'
      using errcode = '23514';
  end if;

  if btrim(p_idempotency_key)
    <> 'standard-product-link:' || substring(p_target_fingerprint from 8)
  then
    raise exception 'The idempotency key must be derived from the target fingerprint.'
      using errcode = '23514';
  end if;

  v_receipt := v_input -> 'receipt';
  v_official := v_input -> 'officialListing';
  v_rule := v_target -> 'sameChannelNameRule';
  v_identity := v_target -> 'normalizedIdentity';
  v_brand_evidence := v_target -> 'brandEvidence';
  v_decision := v_target -> 'decision';
  v_offer := v_target -> 'coupangOffer';

  if v_target ->> 'caseId' <> btrim(p_case_id)
    or v_target ->> 'inputFingerprint' <> p_input_fingerprint
    or coalesce(v_receipt ->> 'receiptId', '') <> btrim(p_receipt_id)
    or coalesce(v_receipt ->> 'receiptItemId', '') <> btrim(p_receipt_item_id)
    or coalesce(v_receipt ->> 'receiptRevision', '') = ''
    or (v_receipt ->> 'observedAt')::timestamptz <> p_receipt_observed_at
    or coalesce(v_receipt ->> 'sourceLabel', '') <> btrim(p_source_labels[1])
    or coalesce(v_receipt ->> 'sourceProductCode', '') <> btrim(p_source_product_code)
    or coalesce(v_receipt ->> 'sourceNameRaw', '') <> p_receipt_product_name
    or (v_receipt ->> 'unitPriceKrw')::integer < 0
    or (v_receipt ->> 'quantity')::integer <= 0
    or coalesce(v_receipt ->> 'sourceCatalogNamespace', '') <> coalesce(v_official ->> 'channelId', '')
    or coalesce(v_official ->> 'channelId', '') = ''
    or coalesce(v_official ->> 'sourceProductCodeNamespace', '') = ''
    or coalesce(v_official ->> 'sourceProductCode', '') <> btrim(p_source_product_code)
    or coalesce(v_official ->> 'snapshotId', '') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    or coalesce(v_official ->> 'snapshotHash', '') !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(v_official ->> 'sourceNameRaw', '') <> p_listing_name
    or coalesce(v_official ->> 'specificationTextRaw', '') = ''
    or coalesce(jsonb_typeof(v_official -> 'sourceRefs'), '') <> 'array'
    or jsonb_array_length(v_official -> 'sourceRefs') = 0
  then
    raise exception 'Frozen receipt or official listing does not match the requested write.'
      using errcode = '23514';
  end if;

  if coalesce(v_rule ->> 'normalization', '') <> 'remove_unicode_whitespace_only'
    or coalesce((v_rule ->> 'sameChannel')::boolean, false) is not true
    or coalesce((v_rule ->> 'exactNameMatch')::boolean, false) is not true
    or coalesce(v_rule ->> 'outcome', '') <> 'apply_official_identity'
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> regexp_replace(p_receipt_product_name, '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedOfficialName', '')
      <> regexp_replace(p_listing_name, '[[:space:]]+', '', 'g')
    or coalesce(v_rule ->> 'normalizedReceiptName', '')
      <> coalesce(v_rule ->> 'normalizedOfficialName', '')
    or v_rule -> 'importedOfficialFields'
      <> '["brand","contentAmount","contentUnit","packageCount"]'::jsonb
  then
    raise exception 'The same-channel exact-name rule is not an approved apply decision.'
      using errcode = '23514';
  end if;

  if p_catalog_product_id is not null
  then
    v_expected_action := 'reuse_variant';
  elsif p_standard_product_id is not null
  then
    v_expected_action := 'create_variant';
  else
    v_expected_action := 'create_family_and_variant';
  end if;

  v_expected_effects := v_expected_effects || jsonb_build_array(
    case when p_standard_product_id is null
      then 'create_standard_family' else 'reuse_standard_family' end
  );
  v_expected_effects := v_expected_effects || jsonb_build_array(
    case when p_catalog_product_id is null
      then 'create_catalog_variant' else 'reuse_catalog_variant' end
  );
  v_expected_effects := v_expected_effects || '[
    "link_official_listing",
    "verify_receipt_mapping",
    "register_coupang_offer"
  ]'::jsonb;

  if coalesce(v_identity ->> 'brand', '') <> coalesce(btrim(p_brand_name), '')
    or coalesce(v_identity ->> 'productFamilyName', '') <> btrim(p_standard_name)
    or coalesce(v_identity ->> 'variantName', '') <> btrim(p_listing_name)
    or coalesce(v_identity ->> 'specificationStatus', '') <> p_specification_status
    or (v_identity ->> 'contentAmount')::numeric is distinct from p_content_amount
    or coalesce(v_identity ->> 'contentUnit', '') <> p_content_unit
    or (v_identity ->> 'packageCount')::integer is distinct from p_package_count
    or (v_identity ->> 'referenceUnit')::integer is distinct from p_reference_unit
    or not (v_identity ? 'gtin')
    or coalesce(jsonb_typeof(v_identity -> 'gtin'), '') <> 'null'
    or coalesce(v_brand_evidence ->> 'canonicalName', '') <> coalesce(btrim(p_brand_name), '')
    or (v_brand_evidence ->> 'receiptObservedName')
      is distinct from nullif(btrim(p_receipt_brand_name), '')
    or coalesce(v_brand_evidence ->> 'officialObservedName', '')
      <> coalesce(btrim(p_official_brand_name), '')
    or coalesce(v_brand_evidence ->> 'officialObservedName', '') = ''
    or coalesce(v_brand_evidence ->> 'officialSourceLabel', '')
      <> coalesce(btrim(p_official_brand_source_label), '')
    or coalesce(v_brand_evidence ->> 'officialSourceLabel', '') = ''
    or coalesce(v_brand_evidence ->> 'productReferenceUrl', '') <> p_product_reference_url
    or coalesce(v_decision ->> 'action', '') <> v_expected_action
    or (v_decision ->> 'standardProductId') is distinct from p_standard_product_id::text
    or (v_decision ->> 'catalogProductId') is distinct from p_catalog_product_id::text
    or (v_decision ->> 'proposedStandardName')
      is distinct from (
        case when p_standard_product_id is null then btrim(p_standard_name) else null end
      )
    or (v_decision ->> 'proposedVariantName')
      is distinct from (
        case when p_catalog_product_id is null then btrim(p_listing_name) else null end
      )
    or coalesce(v_decision ->> 'confidence', '') <> 'high'
    or v_decision -> 'matchedFields'
      <> '["brand","productFamilyName","contentAmount","contentUnit","packageCount"]'::jsonb
    or v_decision -> 'conflictingFields' <> '[]'::jsonb
    or v_decision -> 'missingFields' <> '[]'::jsonb
    or v_target -> 'plannedEffects' <> v_expected_effects
    or coalesce(v_offer ->> 'productUrl', '') <> p_coupang_product_url
    or (v_offer ->> 'listedPriceKrw')::integer is distinct from p_coupang_listed_price_krw
    or (v_offer ->> 'quantity')::integer is distinct from p_coupang_quantity
    or (v_offer ->> 'contentAmount')::numeric is distinct from p_coupang_content_amount
    or coalesce(v_offer ->> 'contentUnit', '') <> p_coupang_content_unit
    or (v_offer ->> 'maxBundleQuantity')::integer is distinct from p_coupang_max_bundle_quantity
    or (v_offer ->> 'maxBundleListedPriceKrw')::integer is distinct from p_coupang_max_bundle_listed_price_krw
  then
    raise exception 'Proposal target does not exactly match the requested effects.'
      using errcode = '23514';
  end if;

  select *
  into v_registered
  from public.register_standard_product_link_strict_v2(
    p_idempotency_key,
    p_case_id,
    p_input_fingerprint,
    p_target_fingerprint,
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

  update public.standard_product_link_executions
  set
    proposal_input = v_input,
    proposal_target = v_target
  where id = v_registered.execution_id
    and proposal_input is null
    and proposal_target is null;

  select execution.proposal_input, execution.proposal_target
  into v_stored_input, v_stored_target
  from public.standard_product_link_executions as execution
  where execution.id = v_registered.execution_id
  for update;

  if v_stored_input is distinct from v_input
    or v_stored_target is distinct from v_target
  then
    raise exception 'The execution ledger belongs to another LinkProposal.'
      using errcode = '23505';
  end if;

  select link.id, link.catalog_product_id
  into v_official_link_id, v_existing_catalog_product_id
  from public.standard_product_official_links as link
  where link.channel_id = v_official ->> 'channelId'
    and link.source_product_code_namespace = v_official ->> 'sourceProductCodeNamespace'
    and link.source_product_code = v_official ->> 'sourceProductCode'
  for update;

  if v_official_link_id is null
  then
    if v_registered.replayed
    then
      raise exception 'The replayed execution is missing its official listing link.'
        using errcode = '40001';
    end if;
    insert into public.standard_product_official_links (
      channel_id,
      source_product_code_namespace,
      source_product_code,
      catalog_product_id,
      created_by
    )
    values (
      v_official ->> 'channelId',
      v_official ->> 'sourceProductCodeNamespace',
      v_official ->> 'sourceProductCode',
      v_registered.catalog_product_id,
      v_user_id
    )
    returning id into v_official_link_id;
  elsif v_existing_catalog_product_id <> v_registered.catalog_product_id
  then
    raise exception 'The official listing is already linked to another catalog variant.'
      using errcode = '23505';
  end if;

  insert into public.standard_product_official_link_evidence (
    official_link_id,
    snapshot_id,
    snapshot_hash,
    source_name_raw,
    specification_text_raw,
    source_refs,
    product_reference_url,
    link_execution_id,
    created_by
  )
  values (
    v_official_link_id,
    (v_official ->> 'snapshotId')::uuid,
    v_official ->> 'snapshotHash',
    v_official ->> 'sourceNameRaw',
    v_official ->> 'specificationTextRaw',
    v_official -> 'sourceRefs',
    p_product_reference_url,
    v_registered.execution_id,
    v_user_id
  )
  on conflict (link_execution_id) do nothing;

  if not exists (
    select 1
    from public.standard_product_official_link_evidence as evidence
    where evidence.link_execution_id = v_registered.execution_id
      and evidence.official_link_id = v_official_link_id
      and evidence.snapshot_id = (v_official ->> 'snapshotId')::uuid
      and evidence.snapshot_hash = v_official ->> 'snapshotHash'
      and evidence.source_name_raw = v_official ->> 'sourceNameRaw'
      and evidence.specification_text_raw = v_official ->> 'specificationTextRaw'
      and evidence.source_refs = v_official -> 'sourceRefs'
      and evidence.product_reference_url = p_product_reference_url
  )
  then
    raise exception 'The official listing evidence does not match the frozen LinkProposal.'
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

comment on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Validates canonical LinkProposal input and target hashes, freezes the proposal, and atomically applies one exact receipt, official listing, variant, and Coupang observation.';

revoke all on function public.canonical_jsonb_text(jsonb) from public;
revoke all on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public;

grant execute on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) to authenticated;

revoke execute on function public.register_standard_product_link_strict_v2(
  text, text, text, text, text, text, timestamptz, uuid, uuid, text, text, text,
  text, text, text, text, text, text, numeric, text, integer, integer, text,
  text[], text, integer, integer, numeric, text, integer, integer
) from anon, authenticated;
