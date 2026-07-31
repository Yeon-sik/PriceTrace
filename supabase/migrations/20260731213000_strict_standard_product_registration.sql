-- Approval-preserving registration path.
-- Existing registration functions remain available for compatibility, but
-- new admin writes use this idempotent, collision-failing function.

create table public.standard_product_link_executions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique check (length(btrim(idempotency_key)) between 1 and 512),
  case_id text not null check (length(btrim(case_id)) > 0),
  input_fingerprint text not null check (input_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  target_fingerprint text not null check (target_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  status text not null check (status in ('in_progress', 'applied')),
  standard_product_id uuid references public.standard_products(id) on delete restrict,
  catalog_product_id uuid references public.catalog_products(id) on delete restrict,
  result jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  check (
    (
      status = 'in_progress'
      and standard_product_id is null
      and catalog_product_id is null
      and result is null
      and applied_at is null
    )
    or
    (
      status = 'applied'
      and standard_product_id is not null
      and catalog_product_id is not null
      and result is not null
      and applied_at is not null
    )
  )
);

alter table public.standard_product_link_executions enable row level security;

grant select, insert, update on public.standard_product_link_executions to authenticated;

create policy "admins manage standard product link executions"
  on public.standard_product_link_executions for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

alter table public.standard_product_coupang_prices
  add column catalog_product_id uuid references public.catalog_products(id) on delete restrict,
  add column link_execution_id uuid references public.standard_product_link_executions(id) on delete restrict;

create index standard_product_coupang_prices_catalog_idx
  on public.standard_product_coupang_prices(catalog_product_id, observed_at desc)
  where catalog_product_id is not null;

create unique index standard_product_coupang_prices_execution_uidx
  on public.standard_product_coupang_prices(link_execution_id)
  where link_execution_id is not null;

comment on column public.standard_product_coupang_prices.catalog_product_id is
  'Exact sellable variant for new Coupang observations. Legacy family-only rows remain nullable.';
comment on column public.standard_product_coupang_prices.link_execution_id is
  'Idempotent registration execution that created this observation.';

create function public.register_standard_product_link_strict(
  p_idempotency_key text,
  p_case_id text,
  p_input_fingerprint text,
  p_target_fingerprint text,
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
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_execution_id uuid;
  v_execution_case_id text;
  v_execution_input_fingerprint text;
  v_execution_target_fingerprint text;
  v_execution_status text;
  v_execution_standard_product_id uuid;
  v_execution_catalog_product_id uuid;
  v_standard_product_id uuid := p_standard_product_id;
  v_catalog_product_id uuid := p_catalog_product_id;
  v_brand_id uuid;
  v_brand_status text;
  v_existing_standard_brand_id uuid;
  v_existing_standard_name text;
  v_existing_catalog_name text;
  v_existing_catalog_standard_id uuid;
  v_existing_catalog_status text;
  v_existing_specification_status text;
  v_existing_content_amount numeric;
  v_existing_content_unit text;
  v_existing_package_count integer;
  v_existing_reference_unit integer;
  v_collision_id uuid;
  v_mapping_id uuid;
  v_mapping_catalog_product_id uuid;
  v_source_label text;
  v_observed_at timestamptz := now();
  v_normalized_brand_name text := public.normalize_brand_name(p_brand_name);
  v_normalized_standard_name text := regexp_replace(coalesce(p_standard_name, ''), '[[:space:]]+', '', 'g');
  v_normalized_listing_name text := regexp_replace(coalesce(p_listing_name, ''), '[[:space:]]+', '', 'g');
  v_normalized_receipt_name text := regexp_replace(coalesce(p_receipt_product_name, ''), '[[:space:]]+', '', 'g');
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if coalesce(length(btrim(p_idempotency_key)), 0) = 0
    or length(p_idempotency_key) > 512
    or coalesce(length(btrim(p_case_id)), 0) = 0
    or coalesce(p_input_fingerprint, '') !~ '^sha256:[a-f0-9]{64}$'
    or coalesce(p_target_fingerprint, '') !~ '^sha256:[a-f0-9]{64}$'
  then
    raise exception 'A valid case, idempotency key, and fingerprints are required.'
      using errcode = '23514';
  end if;

  if p_standard_product_id is null
    and p_catalog_product_id is not null
  then
    raise exception 'A reused catalog variant requires its standard product id.'
      using errcode = '23514';
  end if;

  if coalesce(length(btrim(p_standard_name)), 0) = 0
    or coalesce(length(btrim(p_listing_name)), 0) = 0
    or coalesce(length(btrim(p_receipt_product_name)), 0) = 0
    or coalesce(length(btrim(p_source_product_code)), 0) = 0
    or coalesce(p_product_reference_url, '') !~ '^https?://'
    or not exists (
      select 1
      from unnest(p_source_labels) as source(source_label)
      where length(btrim(source.source_label)) > 0
    )
  then
    raise exception 'Standard name, listing name, source identity, and reference URL are required.'
      using errcode = '23514';
  end if;

  if v_normalized_receipt_name <> v_normalized_listing_name
  then
    raise exception 'Receipt and official product names differ after whitespace removal.'
      using errcode = '23514';
  end if;

  if coalesce(p_specification_status, '') not in ('verified', 'placeholder')
    or coalesce(p_content_amount, 0) <= 0
    or coalesce(p_content_unit, '') not in ('g', 'ml', 'each')
    or coalesce(p_package_count, 0) <= 0
    or coalesce(p_reference_unit, 0) not in (10, 100, 1000)
  then
    raise exception 'A valid catalog specification is required.'
      using errcode = '23514';
  end if;

  if p_content_unit = 'each'
    and p_reference_unit <> 100
  then
    raise exception 'Each-based variants use the stored reference unit 100.'
      using errcode = '23514';
  end if;

  if coalesce(p_coupang_product_url, '') !~ '^https?://'
    or coalesce(p_coupang_listed_price_krw, 0) <= 0
    or coalesce(p_coupang_quantity, 0) <= 0
    or coalesce(p_coupang_content_amount, 0) <= 0
    or coalesce(p_coupang_content_unit, '') not in ('g', 'ml', 'each')
    or (p_coupang_max_bundle_quantity is null) <> (p_coupang_max_bundle_listed_price_krw is null)
    or (
      p_coupang_max_bundle_quantity is not null
      and (
        p_coupang_max_bundle_quantity <= 1
        or coalesce(p_coupang_max_bundle_listed_price_krw, 0) <= 0
      )
    )
  then
    raise exception 'A valid exact Coupang option is required.'
      using errcode = '23514';
  end if;

  if (
    length(public.normalize_brand_name(p_receipt_brand_name)) > 0
    or length(public.normalize_brand_name(p_official_brand_name)) > 0
  ) and length(v_normalized_brand_name) = 0
  then
    raise exception 'Observed brand evidence requires a canonical brand.'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('standard-link-execution:' || btrim(p_idempotency_key), 0)
  );

  select
    execution.id,
    execution.case_id,
    execution.input_fingerprint,
    execution.target_fingerprint,
    execution.status,
    execution.standard_product_id,
    execution.catalog_product_id
  into
    v_execution_id,
    v_execution_case_id,
    v_execution_input_fingerprint,
    v_execution_target_fingerprint,
    v_execution_status,
    v_execution_standard_product_id,
    v_execution_catalog_product_id
  from public.standard_product_link_executions as execution
  where execution.idempotency_key = btrim(p_idempotency_key)
  for update;

  if found
  then
    if v_execution_case_id <> btrim(p_case_id)
      or v_execution_input_fingerprint <> p_input_fingerprint
      or v_execution_target_fingerprint <> p_target_fingerprint
    then
      raise exception 'The idempotency key belongs to another approved target.'
        using errcode = '23505';
    end if;

    if v_execution_status <> 'applied'
      or v_execution_standard_product_id is null
      or v_execution_catalog_product_id is null
    then
      raise exception 'The previous execution has no verified applied result.'
        using errcode = '40001';
    end if;

    return query
    select
      v_execution_id,
      v_execution_standard_product_id,
      v_execution_catalog_product_id,
      true;
    return;
  end if;

  insert into public.standard_product_link_executions (
    idempotency_key,
    case_id,
    input_fingerprint,
    target_fingerprint,
    status,
    created_by
  )
  values (
    btrim(p_idempotency_key),
    btrim(p_case_id),
    p_input_fingerprint,
    p_target_fingerprint,
    'in_progress',
    v_user_id
  )
  returning id into v_execution_id;

  for v_source_label in
    select distinct btrim(source.source_label)
    from unnest(p_source_labels) as source(source_label)
    where length(btrim(source.source_label)) > 0
    order by btrim(source.source_label)
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'standard-link-source:' || v_source_label || ':' || btrim(p_source_product_code),
        0
      )
    );
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'standard-link-family:' || v_normalized_standard_name,
      0
    )
  );

  if length(v_normalized_brand_name) > 0
  then
    select candidate.brand_id
    into v_brand_id
    from (
      select brand.id as brand_id, 0 as match_priority
      from public.brands as brand
      where brand.normalized_name = v_normalized_brand_name
      union all
      select alias.brand_id, 1 as match_priority
      from public.brand_aliases as alias
      where alias.normalized_alias = v_normalized_brand_name
    ) as candidate
    order by candidate.match_priority
    limit 1;

    if v_brand_id is not null
    then
      select brand.status
      into v_brand_status
      from public.brands as brand
      where brand.id = v_brand_id
      for update;

      if v_brand_status <> 'active'
      then
        raise exception 'The matching brand exists but is not active.'
          using errcode = '23514';
      end if;
    else
      insert into public.brands (canonical_name, created_by)
      values (btrim(p_brand_name), v_user_id)
      returning id into v_brand_id;
    end if;
  end if;

  if v_standard_product_id is null
  then
    select standard.id
    into v_collision_id
    from public.standard_products as standard
    where standard.purchase_type = 'retail_product'
      and regexp_replace(standard.canonical_name, '[[:space:]]+', '', 'g') = v_normalized_standard_name
    order by standard.created_at, standard.id
    limit 1
    for update;

    if v_collision_id is not null
    then
      raise exception 'A whitespace-equivalent standard product already exists.'
        using errcode = '23505';
    end if;

    insert into public.standard_products (
      purchase_type,
      canonical_name,
      brand_id,
      product_reference_url,
      created_by
    )
    values (
      'retail_product',
      btrim(p_standard_name),
      v_brand_id,
      p_product_reference_url,
      v_user_id
    )
    returning id into v_standard_product_id;
  else
    select
      standard.canonical_name,
      standard.brand_id
    into
      v_existing_standard_name,
      v_existing_standard_brand_id
    from public.standard_products as standard
    where standard.id = v_standard_product_id
      and standard.purchase_type = 'retail_product'
      and standard.status = 'active'
    for update;

    if not found
    then
      raise exception 'The expected active standard product does not exist.'
        using errcode = '23503';
    end if;

    if regexp_replace(v_existing_standard_name, '[[:space:]]+', '', 'g') <> v_normalized_standard_name
    then
      raise exception 'The expected standard product name changed.'
        using errcode = '23514';
    end if;

    if v_existing_standard_brand_id is not null
      and v_brand_id is not null
      and v_existing_standard_brand_id <> v_brand_id
    then
      raise exception 'The expected standard product belongs to another brand.'
        using errcode = '23514';
    end if;

    if v_brand_id is null
    then
      v_brand_id := v_existing_standard_brand_id;
    elsif v_existing_standard_brand_id is null
    then
      update public.standard_products
      set
        brand_id = v_brand_id,
        updated_at = v_observed_at
      where id = v_standard_product_id;
    end if;
  end if;

  if v_catalog_product_id is null
  then
    select catalog.id
    into v_collision_id
    from public.catalog_products as catalog
    where catalog.standard_product_id = v_standard_product_id
      and catalog.purchase_type = 'retail_product'
      and regexp_replace(catalog.canonical_name, '[[:space:]]+', '', 'g') = v_normalized_listing_name
    order by catalog.created_at, catalog.id
    limit 1
    for update;

    if v_collision_id is not null
    then
      raise exception 'A whitespace-equivalent catalog variant already exists.'
        using errcode = '23505';
    end if;

    insert into public.catalog_products (
      standard_product_id,
      purchase_type,
      canonical_name,
      specification_status,
      content_amount,
      content_unit,
      package_count,
      reference_unit,
      listing_reference_url,
      created_by
    )
    values (
      v_standard_product_id,
      'retail_product',
      btrim(p_listing_name),
      p_specification_status,
      p_content_amount,
      p_content_unit,
      p_package_count,
      p_reference_unit,
      p_product_reference_url,
      v_user_id
    )
    returning id into v_catalog_product_id;
  else
    select
      catalog.standard_product_id,
      catalog.canonical_name,
      catalog.status,
      catalog.specification_status,
      catalog.content_amount,
      catalog.content_unit,
      catalog.package_count,
      catalog.reference_unit
    into
      v_existing_catalog_standard_id,
      v_existing_catalog_name,
      v_existing_catalog_status,
      v_existing_specification_status,
      v_existing_content_amount,
      v_existing_content_unit,
      v_existing_package_count,
      v_existing_reference_unit
    from public.catalog_products as catalog
    where catalog.id = v_catalog_product_id
      and catalog.purchase_type = 'retail_product'
    for update;

    if not found
      or v_existing_catalog_status <> 'active'
      or v_existing_catalog_standard_id <> v_standard_product_id
      or regexp_replace(v_existing_catalog_name, '[[:space:]]+', '', 'g') <> v_normalized_listing_name
      or v_existing_specification_status <> p_specification_status
      or v_existing_content_amount is distinct from p_content_amount
      or v_existing_content_unit is distinct from p_content_unit
      or v_existing_package_count <> p_package_count
      or v_existing_reference_unit <> p_reference_unit
    then
      raise exception 'The expected catalog variant changed or does not match the approved specification.'
        using errcode = '23514';
    end if;
  end if;

  for v_source_label in
    select distinct btrim(source.source_label)
    from unnest(p_source_labels) as source(source_label)
    where length(btrim(source.source_label)) > 0
    order by btrim(source.source_label)
  loop
    v_mapping_id := null;
    v_mapping_catalog_product_id := null;

    select mapping.id, mapping.catalog_product_id
    into v_mapping_id, v_mapping_catalog_product_id
    from public.source_product_mappings as mapping
    where mapping.source_label = v_source_label
      and mapping.source_product_code = btrim(p_source_product_code)
    for update;

    if v_mapping_id is not null
      and v_mapping_catalog_product_id <> v_catalog_product_id
    then
      raise exception 'The source identity is already mapped to another catalog variant.'
        using errcode = '23505';
    elsif v_mapping_id is null
    then
      insert into public.source_product_mappings (
        source_label,
        source_product_code,
        catalog_product_id,
        matching_method,
        confidence,
        review_status,
        created_by,
        reviewed_by,
        reviewed_at
      )
      values (
        v_source_label,
        btrim(p_source_product_code),
        v_catalog_product_id,
        'manual',
        1,
        'verified',
        v_user_id,
        v_user_id,
        v_observed_at
      );
    else
      update public.source_product_mappings
      set
        matching_method = 'manual',
        confidence = 1,
        review_status = 'verified',
        reviewed_by = v_user_id,
        reviewed_at = v_observed_at,
        updated_at = v_observed_at
      where id = v_mapping_id;
    end if;
  end loop;

  if length(public.normalize_brand_name(p_receipt_brand_name)) > 0
  then
    insert into public.standard_product_brand_evidence (
      standard_product_id,
      catalog_product_id,
      brand_id,
      observed_name,
      source_type,
      source_label,
      source_product_code,
      observed_at,
      created_by
    )
    select
      v_standard_product_id,
      v_catalog_product_id,
      v_brand_id,
      btrim(p_receipt_brand_name),
      'receipt',
      source.source_label,
      btrim(p_source_product_code),
      v_observed_at,
      v_user_id
    from (
      select distinct btrim(raw_source.source_label) as source_label
      from unnest(p_source_labels) as raw_source(source_label)
      where length(btrim(raw_source.source_label)) > 0
    ) as source
    on conflict do nothing;
  end if;

  if length(public.normalize_brand_name(p_official_brand_name)) > 0
  then
    insert into public.standard_product_brand_evidence (
      standard_product_id,
      catalog_product_id,
      brand_id,
      observed_name,
      source_type,
      source_label,
      source_url,
      observed_at,
      created_by
    )
    values (
      v_standard_product_id,
      v_catalog_product_id,
      v_brand_id,
      btrim(p_official_brand_name),
      'official_store',
      nullif(btrim(p_official_brand_source_label), ''),
      p_product_reference_url,
      v_observed_at,
      v_user_id
    )
    on conflict do nothing;
  end if;

  insert into public.standard_product_coupang_prices (
    standard_product_id,
    catalog_product_id,
    link_execution_id,
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
    v_catalog_product_id,
    v_execution_id,
    p_coupang_product_url,
    p_coupang_listed_price_krw,
    p_coupang_quantity,
    p_coupang_content_amount,
    p_coupang_content_unit,
    p_coupang_max_bundle_quantity,
    p_coupang_max_bundle_listed_price_krw,
    v_observed_at,
    v_user_id
  );

  update public.standard_product_link_executions
  set
    status = 'applied',
    standard_product_id = v_standard_product_id,
    catalog_product_id = v_catalog_product_id,
    result = pg_catalog.jsonb_build_object(
      'brandId', v_brand_id,
      'standardProductId', v_standard_product_id,
      'catalogProductId', v_catalog_product_id
    ),
    applied_at = v_observed_at
  where id = v_execution_id;

  return query
  select
    v_execution_id,
    v_standard_product_id,
    v_catalog_product_id,
    false;
end;
$$;

comment on table public.standard_product_link_executions is
  'Durable idempotency and fingerprint ledger for approved standard-product link writes.';
comment on function public.register_standard_product_link_strict(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text, text,
  text, text, numeric, text, integer, integer, text, text[], text, integer, integer,
  numeric, text, integer, integer
) is
  'Atomically creates or reuses an explicitly expected family and variant, fails on mapping collisions, stores exact-variant Coupang evidence, and replays an applied idempotency key without duplicate writes.';

revoke all on function public.register_standard_product_link_strict(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text, text,
  text, text, numeric, text, integer, integer, text, text[], text, integer, integer,
  numeric, text, integer, integer
) from public;

grant execute on function public.register_standard_product_link_strict(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text, text,
  text, text, numeric, text, integer, integer, text, text[], text, integer, integer,
  numeric, text, integer, integer
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
    coupang.content_amount as coupang_content_amount,
    coupang.content_unit as coupang_content_unit,
    coupang.max_bundle_quantity as coupang_max_bundle_quantity,
    coupang.max_bundle_listed_price_krw as coupang_max_bundle_listed_price_krw,
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
      or (
        price.catalog_product_id is null
        and price.standard_product_id = standard.id
      )
    order by
      (price.catalog_product_id is not null) desc,
      price.observed_at desc,
      price.created_at desc,
      price.id desc
    limit 1
  ) as coupang on true
  order by standard.canonical_name, mapping.source_label, mapping.source_product_code;
$$;

comment on function public.get_public_exact_standard_product_catalog_v2() is
  'Returns verified exact variants with variant-specific Coupang prices, falling back to legacy family-only observations when necessary.';
