-- Coupang observations describe their own commercial offer through price,
-- quantity, content amount, and content unit. They belong to a standard
-- product family and do not require an exact receipt/catalog variant.

drop trigger if exists validate_exact_coupang_price_variant
  on public.standard_product_coupang_prices;

drop function if exists public.validate_exact_coupang_price_variant();

alter table public.standard_product_coupang_prices
  drop constraint if exists standard_product_coupang_prices_new_rows_require_catalog;

comment on column public.standard_product_coupang_prices.catalog_product_id is
  'Optional legacy provenance only. Coupang price ownership and comparison use standard_product_id plus the observation offer fields.';

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
    select standard.id
    into v_standard_product_id
    from public.standard_products as standard
    where standard.id = p_target_id
      and standard.status = 'active';

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
      raise exception 'A complete standard-product Coupang observation is required.'
        using errcode = '23514';
    end if;

    insert into public.standard_product_coupang_prices (
      standard_product_id,
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
  ),
  latest_coupang as (
    select distinct on (price.standard_product_id)
      price.standard_product_id,
      price.listed_price_krw,
      price.quantity,
      price.content_amount,
      price.content_unit,
      price.max_bundle_quantity,
      price.max_bundle_listed_price_krw,
      price.product_url,
      price.observed_at
    from public.standard_product_coupang_prices as price
    order by price.standard_product_id, price.observed_at desc, price.created_at desc, price.id desc
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
  left join latest_coupang as coupang on coupang.standard_product_id = standard.id
  order by standard.canonical_name, mapping.source_label, mapping.source_product_code;
$$;

comment on function public.get_public_exact_standard_product_catalog_v2() is
  'Returns exact receipt/catalog mappings with the latest self-describing Coupang observation shared by standard product family.';

revoke all on function public.admin_manage_standard_catalog(text, uuid, jsonb, text) from public;
grant execute on function public.admin_manage_standard_catalog(text, uuid, jsonb, text) to authenticated;

revoke all on function public.get_public_exact_standard_product_catalog_v2() from public;
grant execute on function public.get_public_exact_standard_product_catalog_v2() to anon, authenticated;
