-- Manufacturer product identity has its own review record, independent of
-- receipts, sellers, prices and personal product candidates.
create table public.manufacturer_product_publications (
  source_namespace text not null,
  manufacturer_sku text not null,
  catalog_product_id uuid not null unique references public.catalog_products(id) on delete restrict,
  reviewed_facts jsonb not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  primary key (source_namespace, manufacturer_sku)
);

alter table public.manufacturer_product_publications enable row level security;
revoke all on public.manufacturer_product_publications from public, anon, authenticated;
create index manufacturer_product_publications_approver_idx
  on public.manufacturer_product_publications(approved_by);

create function public.publish_manufacturer_product_v1(p_product jsonb, p_reviewed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := pg_catalog.btrim(p_product ->> 'product_name');
  v_brand_name text := pg_catalog.btrim(p_product ->> 'brand_name');
  v_sku text := pg_catalog.btrim(p_product ->> 'manufacturer_sku');
  v_url text := pg_catalog.btrim(p_product ->> 'manufacturer_url');
  v_specification text := pg_catalog.btrim(p_product ->> 'specification');
  v_unit text := pg_catalog.btrim(p_product ->> 'content_unit');
  v_keys constant text[] := array[
    'product_name', 'brand_name', 'manufacturer_sku', 'manufacturer_url',
    'specification', 'content_amount', 'content_unit', 'package_count'
  ];
  v_url_parts text[];
  v_namespace text;
  v_amount numeric;
  v_package_count numeric;
  v_facts jsonb;
  v_existing public.manufacturer_product_publications%rowtype;
  v_brand_id uuid;
  v_standard_id uuid;
  v_catalog_id uuid;
begin
  if v_actor is null or (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'Manufacturer publication requires administrator access.' using errcode = '42501';
  end if;
  if p_reviewed is distinct from true then
    raise exception 'Confirm the manufacturer product identity and specification.' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_product) is distinct from 'object'
    or not (p_product ?& v_keys)
    or p_product - v_keys <> '{}'::jsonb
  then
    raise exception 'Manufacturer publication accepts only public product fields.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_each(p_product) as field
    where pg_catalog.jsonb_typeof(field.value) <> case
      when field.key in ('content_amount', 'package_count') then 'number'
      else 'string'
    end
  ) then
    raise exception 'Manufacturer product fields have invalid types.' using errcode = '22023';
  end if;

  v_amount := (p_product ->> 'content_amount')::numeric;
  v_package_count := (p_product ->> 'package_count')::numeric;
  v_url_parts := pg_catalog.regexp_match(
    v_url, '^https://([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,})(/[^?#[:space:][:cntrl:]]+)$'
  );
  if pg_catalog.length(v_name) not between 1 and 200
    or pg_catalog.length(v_brand_name) not between 1 and 120
    or pg_catalog.length(v_specification) not between 1 and 120
    or pg_catalog.concat(v_name, v_brand_name, v_specification) ~ '[[:cntrl:]]'
    or v_sku !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'
    or v_url_parts is null
    or pg_catalog.length(v_url) > 1000
    or v_amount <= 0 or v_amount > 1000000 or pg_catalog.round(v_amount, 3) <> v_amount
    or v_unit not in ('each', 'g', 'ml')
    or (v_unit = 'each' and pg_catalog.trunc(v_amount) <> v_amount)
    or v_package_count not between 1 and 1000 or pg_catalog.trunc(v_package_count) <> v_package_count
  then
    raise exception 'Manufacturer URL, SKU or exact product specification is invalid.' using errcode = '22023';
  end if;

  v_namespace := pg_catalog.regexp_replace(pg_catalog.lower(v_url_parts[1]), '^www\.', '');
  v_facts := pg_catalog.jsonb_build_object(
    'product_name', v_name, 'brand_name', v_brand_name, 'manufacturer_sku', v_sku,
    'manufacturer_url', v_url, 'specification', v_specification,
    'content_amount', v_amount, 'content_unit', v_unit, 'package_count', v_package_count
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manufacturer-product:' || v_namespace || ':' || v_sku, 0)
  );
  select * into v_existing
  from public.manufacturer_product_publications
  where source_namespace = v_namespace and manufacturer_sku = v_sku;
  if found then
    if v_existing.reviewed_facts is distinct from v_facts then
      raise exception 'This manufacturer SKU already has different approved facts.' using errcode = '23505';
    end if;
    if not exists (
      select 1 from public.catalog_products as catalog
      join public.standard_products as standard on standard.id = catalog.standard_product_id
      where catalog.id = v_existing.catalog_product_id and catalog.status = 'active' and standard.status = 'active'
        and catalog.verification_status = 'verified' and standard.verification_status = 'verified'
        and catalog.specification_status = 'verified'
    ) then
      raise exception 'This publication requires catalog review.' using errcode = '23514';
    end if;
    return pg_catalog.jsonb_build_object(
      'status', 'already_published', 'catalog_product_id', v_existing.catalog_product_id
    );
  end if;

  select brand.id, brand.canonical_name into v_brand_id, v_brand_name
  from public.brands as brand
  where brand.normalized_name = public.normalize_brand_name(v_facts ->> 'brand_name')
     or exists (
       select 1 from public.brand_aliases as alias
       where alias.brand_id = brand.id
         and alias.normalized_alias = public.normalize_brand_name(v_facts ->> 'brand_name')
     );
  if not found then
    insert into public.brands (canonical_name, official_site_url, created_by)
    values (v_facts ->> 'brand_name', 'https://' || v_url_parts[1], v_actor)
    on conflict (normalized_name) do nothing;

    select brand.id, brand.canonical_name into strict v_brand_id, v_brand_name
    from public.brands as brand
    where brand.normalized_name = public.normalize_brand_name(v_facts ->> 'brand_name');
  end if;
  if not exists (select 1 from public.brands where id = v_brand_id and status = 'active') then
    raise exception 'This manufacturer brand requires catalog review.' using errcode = '23514';
  end if;

  insert into public.standard_products (
    purchase_type, canonical_name, brand, brand_id, product_reference_url, status, verification_status, created_by
  ) values ('retail_product', v_name, v_brand_name, v_brand_id, v_url, 'active', 'verified', v_actor)
  returning id into v_standard_id;

  insert into public.catalog_products (
    standard_product_id, purchase_type, canonical_name, brand, specification,
    specification_status, content_amount, content_unit, package_count, listing_reference_url,
    status, verification_status, created_by
  ) values (
    v_standard_id, 'retail_product', v_name, v_brand_name, v_specification,
    'verified', v_amount, v_unit, v_package_count::integer, v_url, 'active', 'verified', v_actor
  ) returning id into v_catalog_id;

  insert into public.manufacturer_product_publications (
    source_namespace, manufacturer_sku, catalog_product_id, reviewed_facts, approved_by
  ) values (v_namespace, v_sku, v_catalog_id, v_facts, v_actor);

  return pg_catalog.jsonb_build_object('status', 'published', 'catalog_product_id', v_catalog_id);
end;
$$;

create function public.search_public_manufacturer_products_v1(p_query text, p_limit integer default 20)
returns table (
  catalog_product_id uuid,
  product_name text,
  brand_name text,
  specification text,
  manufacturer_sku text,
  manufacturer_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select catalog.id, catalog.canonical_name, standard.brand, catalog.specification,
    publication.manufacturer_sku, publication.reviewed_facts ->> 'manufacturer_url'
  from public.manufacturer_product_publications as publication
  join public.catalog_products as catalog on catalog.id = publication.catalog_product_id
  join public.standard_products as standard on standard.id = catalog.standard_product_id
  where catalog.status = 'active' and standard.status = 'active'
    and catalog.verification_status = 'verified' and standard.verification_status = 'verified'
    and catalog.specification_status = 'verified'
    and pg_catalog.length(pg_catalog.btrim(p_query)) between 1 and 200
    and pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.concat_ws(' ', catalog.canonical_name, standard.brand, catalog.specification, publication.manufacturer_sku)),
      pg_catalog.lower(pg_catalog.btrim(p_query))
    ) > 0
  order by catalog.canonical_name, catalog.id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.publish_manufacturer_product_v1(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.publish_manufacturer_product_v1(jsonb, boolean) to authenticated;
revoke all on function public.search_public_manufacturer_products_v1(text, integer) from public, anon, authenticated;
grant execute on function public.search_public_manufacturer_products_v1(text, integer) to anon, authenticated;

comment on function public.publish_manufacturer_product_v1(jsonb, boolean) is
  'Admin-approved catalog publication from a manufacturer product page and SKU. Independent of purchases, sellers, prices, and nutrition.';
comment on function public.search_public_manufacturer_products_v1(text, integer) is
  'Public search of approved manufacturer products with a product specification and source, including products without a price observation.';
