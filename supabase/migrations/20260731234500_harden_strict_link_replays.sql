alter table public.standard_product_link_executions
  add column request_payload jsonb;

revoke insert, update, delete on public.standard_product_link_executions
  from authenticated;

drop policy "admins manage standard product link executions"
  on public.standard_product_link_executions;

create policy "admins read standard product link executions"
  on public.standard_product_link_executions for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

alter function public.register_standard_product_link_strict(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text, text,
  text, text, numeric, text, integer, integer, text, text[], text, integer,
  integer, numeric, text, integer, integer
) security definer;

revoke execute on function public.register_standard_product_link_strict(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text, text,
  text, text, numeric, text, integer, integer, text, text[], text, integer,
  integer, numeric, text, integer, integer
) from anon, authenticated;

create function public.register_standard_product_link_strict_v2(
  p_idempotency_key text,
  p_case_id text,
  p_input_fingerprint text,
  p_target_fingerprint text,
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
  v_source_labels text[];
  v_request_payload jsonb;
  v_registered record;
  v_stored_payload jsonb;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if coalesce(length(btrim(p_receipt_id)), 0) = 0
    or coalesce(length(btrim(p_receipt_item_id)), 0) = 0
    or p_receipt_observed_at is null
  then
    raise exception 'Receipt id, item id, and observation time are required.'
      using errcode = '23514';
  end if;

  select array_agg(source_label order by source_label)
  into v_source_labels
  from (
    select distinct btrim(source.source_label) as source_label
    from unnest(p_source_labels) as source(source_label)
    where length(btrim(source.source_label)) > 0
  ) as normalized;

  if coalesce(cardinality(v_source_labels), 0) <> 1
  then
    raise exception 'One approval can register exactly one receipt source identity.'
      using errcode = '23514';
  end if;

  v_request_payload := pg_catalog.jsonb_build_object(
    'caseId', btrim(p_case_id),
    'inputFingerprint', p_input_fingerprint,
    'targetFingerprint', p_target_fingerprint,
    'receipt', pg_catalog.jsonb_build_object(
      'id', btrim(p_receipt_id),
      'itemId', btrim(p_receipt_item_id),
      'observedAt', p_receipt_observed_at
    ),
    'expectedStandardProductId', p_standard_product_id,
    'expectedCatalogProductId', p_catalog_product_id,
    'standardName', btrim(p_standard_name),
    'brandName', nullif(btrim(p_brand_name), ''),
    'receiptBrandName', nullif(btrim(p_receipt_brand_name), ''),
    'officialBrandName', nullif(btrim(p_official_brand_name), ''),
    'officialBrandSourceLabel', nullif(btrim(p_official_brand_source_label), ''),
    'productReferenceUrl', p_product_reference_url,
    'listingName', btrim(p_listing_name),
    'receiptProductName', btrim(p_receipt_product_name),
    'specificationStatus', p_specification_status,
    'contentAmount', p_content_amount,
    'contentUnit', p_content_unit,
    'packageCount', p_package_count,
    'referenceUnit', p_reference_unit,
    'sourceProductCode', btrim(p_source_product_code),
    'sourceLabels', to_jsonb(v_source_labels),
    'coupangProductUrl', p_coupang_product_url,
    'coupangListedPriceKrw', p_coupang_listed_price_krw,
    'coupangQuantity', p_coupang_quantity,
    'coupangContentAmount', p_coupang_content_amount,
    'coupangContentUnit', p_coupang_content_unit,
    'coupangMaxBundleQuantity', p_coupang_max_bundle_quantity,
    'coupangMaxBundleListedPriceKrw', p_coupang_max_bundle_listed_price_krw
  );

  select *
  into v_registered
  from public.register_standard_product_link_strict(
    p_idempotency_key,
    p_case_id,
    p_input_fingerprint,
    p_target_fingerprint,
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
    v_source_labels,
    p_coupang_product_url,
    p_coupang_listed_price_krw,
    p_coupang_quantity,
    p_coupang_content_amount,
    p_coupang_content_unit,
    p_coupang_max_bundle_quantity,
    p_coupang_max_bundle_listed_price_krw
  );

  update public.standard_product_link_executions
  set request_payload = v_request_payload
  where id = v_registered.execution_id
    and request_payload is null;

  select execution.request_payload
  into v_stored_payload
  from public.standard_product_link_executions as execution
  where execution.id = v_registered.execution_id
    and execution.status = 'applied'
    and execution.standard_product_id = v_registered.standard_product_id
    and execution.catalog_product_id = v_registered.catalog_product_id
  for update;

  if not found or v_stored_payload is distinct from v_request_payload
  then
    raise exception 'The idempotency key does not match the frozen approved request.'
      using errcode = '23505';
  end if;

  if not exists (
    select 1
    from public.standard_products as standard
    where standard.id = v_registered.standard_product_id
      and standard.status = 'active'
      and regexp_replace(standard.canonical_name, '[[:space:]]+', '', 'g')
        = regexp_replace(p_standard_name, '[[:space:]]+', '', 'g')
  ) or not exists (
    select 1
    from public.catalog_products as catalog
    where catalog.id = v_registered.catalog_product_id
      and catalog.standard_product_id = v_registered.standard_product_id
      and catalog.status = 'active'
      and regexp_replace(catalog.canonical_name, '[[:space:]]+', '', 'g')
        = regexp_replace(p_listing_name, '[[:space:]]+', '', 'g')
      and catalog.specification_status = p_specification_status
      and catalog.content_amount is not distinct from p_content_amount
      and catalog.content_unit is not distinct from p_content_unit
      and catalog.package_count = p_package_count
      and catalog.reference_unit = p_reference_unit
  ) or not exists (
    select 1
    from public.source_product_mappings as mapping
    where mapping.source_label = v_source_labels[1]
      and mapping.source_product_code = btrim(p_source_product_code)
      and mapping.catalog_product_id = v_registered.catalog_product_id
      and mapping.review_status = 'verified'
  ) or not exists (
    select 1
    from public.standard_product_coupang_prices as price
    where price.link_execution_id = v_registered.execution_id
      and price.standard_product_id = v_registered.standard_product_id
      and price.catalog_product_id = v_registered.catalog_product_id
      and price.product_url = p_coupang_product_url
      and price.listed_price_krw = p_coupang_listed_price_krw
      and price.quantity = p_coupang_quantity
      and price.content_amount is not distinct from p_coupang_content_amount
      and price.content_unit is not distinct from p_coupang_content_unit
      and price.max_bundle_quantity is not distinct from p_coupang_max_bundle_quantity
      and price.max_bundle_listed_price_krw is not distinct from p_coupang_max_bundle_listed_price_krw
  )
  then
    raise exception 'The applied link no longer matches its frozen approved request.'
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

comment on function public.register_standard_product_link_strict_v2(
  text, text, text, text, text, text, timestamptz, uuid, uuid, text, text, text,
  text, text, text, text, text, text, numeric, text, integer, integer, text,
  text[], text, integer, integer, numeric, text, integer, integer
) is
  'Freezes one receipt item and one exact target payload, then validates every replay against the current applied mapping and exact-variant Coupang observation.';

revoke all on function public.register_standard_product_link_strict_v2(
  text, text, text, text, text, text, timestamptz, uuid, uuid, text, text, text,
  text, text, text, text, text, text, numeric, text, integer, integer, text,
  text[], text, integer, integer, numeric, text, integer, integer
) from public;

grant execute on function public.register_standard_product_link_strict_v2(
  text, text, text, text, text, text, timestamptz, uuid, uuid, text, text, text,
  text, text, text, text, text, text, numeric, text, integer, integer, text,
  text[], text, integer, integer, numeric, text, integer, integer
) to authenticated;

create or replace function public.get_public_exact_standard_product_catalog_v2()
returns table (
  source_label text,
  source_product_code text,
  catalog_product_id uuid,
  standard_product_id uuid,
  standard_name text,
  content_amount numeric,
  content_unit text,
  package_count integer,
  reference_unit integer,
  coupang_listed_price_krw integer,
  coupang_quantity integer,
  coupang_content_amount numeric,
  coupang_content_unit text,
  coupang_max_bundle_quantity integer,
  coupang_max_bundle_listed_price_krw integer,
  coupang_product_url text,
  coupang_observed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_mappings as (
    select distinct
      mapping.source_label,
      mapping.source_product_code,
      mapping.catalog_product_id
    from public.source_product_mappings as mapping
    where mapping.review_status = 'verified'
  ),
  eligible_catalog as (
    select
      catalog.id as catalog_product_id,
      catalog.standard_product_id,
      catalog.content_amount,
      catalog.content_unit,
      catalog.package_count,
      catalog.reference_unit
    from public.catalog_products as catalog
    inner join public.standard_products as standard on standard.id = catalog.standard_product_id
    where catalog.status = 'active'
      and standard.status = 'active'
      and catalog.specification_status = 'verified'
      and catalog.content_amount is not null
      and catalog.content_amount > 0
      and catalog.content_unit in ('g', 'ml', 'each')
      and catalog.package_count > 0
  )
  select
    mapping.source_label,
    mapping.source_product_code,
    catalog.catalog_product_id,
    standard.id as standard_product_id,
    standard.canonical_name as standard_name,
    catalog.content_amount,
    catalog.content_unit,
    catalog.package_count,
    catalog.reference_unit,
    coupang.listed_price_krw,
    coupang.quantity,
    coupang.content_amount,
    coupang.content_unit,
    coupang.max_bundle_quantity,
    coupang.max_bundle_listed_price_krw,
    coupang.product_url,
    coupang.observed_at
  from eligible_mappings as mapping
  inner join eligible_catalog as catalog on catalog.catalog_product_id = mapping.catalog_product_id
  inner join public.standard_products as standard on standard.id = catalog.standard_product_id
  left join lateral (
    select
      price.listed_price_krw,
      price.quantity,
      price.content_amount,
      price.content_unit,
      price.max_bundle_quantity,
      price.max_bundle_listed_price_krw,
      price.product_url,
      price.observed_at
    from public.standard_product_coupang_prices as price
    where price.catalog_product_id = catalog.catalog_product_id
    order by price.observed_at desc, price.created_at desc, price.id desc
    limit 1
  ) as coupang on true
  order by standard.canonical_name, mapping.source_label, mapping.source_product_code;
$$;

comment on function public.get_public_exact_standard_product_catalog_v2() is
  'Returns verified exact variants and only their own exact-variant Coupang observations. Ambiguous legacy family prices are never projected onto a variant.';
