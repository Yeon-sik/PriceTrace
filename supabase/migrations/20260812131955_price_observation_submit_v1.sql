-- Price observation submission v1 deliberately separates public observations
-- from the existing user-owned price_observations receipt projection.
-- No receipt, line item, OCR, transaction, payment, or submitter identity is
-- stored in this contract.

create table public.price_observation_sources (
  id uuid primary key default gen_random_uuid(),
  source_namespace text not null check (length(btrim(source_namespace)) > 0),
  source_store_code text not null check (length(btrim(source_store_code)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  location_label text,
  status text not null default 'active' check (status in ('active', 'archived')),
  review_status text not null default 'pending' check (review_status in ('pending', 'verified', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_namespace, source_store_code),
  check (location_label is null or length(btrim(location_label)) > 0)
);

comment on table public.price_observation_sources is
  'Admin-curated public seller/location identity. It is distinct from user-owned stores.';

create table public.public_price_observations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.price_observation_sources(id) on delete restrict,
  observed_on date not null,
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  unit_price_krw integer not null check (unit_price_krw >= 0),
  verification_status text not null default 'user_verified'
    check (verification_status in ('user_verified', 'rejected')),
  created_at timestamptz not null default now(),
  unique (store_id, observed_on, catalog_product_id, unit_price_krw)
);

comment on table public.public_price_observations is
  'Minimal public price observation. User-verified source evidence stays on the submitting device.';

create table public.price_observation_submission_requests (
  idempotency_key text primary key check (length(btrim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  public_price_observation_id uuid not null references public.public_price_observations(id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.price_observation_submission_requests is
  'Replay guard. It stores only an opaque key, a one-way request fingerprint, and the public observation id.';

create index price_observation_sources_verified_idx
  on public.price_observation_sources(display_name, id)
  where status = 'active' and review_status = 'verified';

create index public_price_observations_catalog_date_idx
  on public.public_price_observations(catalog_product_id, observed_on desc, store_id)
  where verification_status = 'user_verified';

create index public_price_observations_store_date_idx
  on public.public_price_observations(store_id, observed_on desc, catalog_product_id)
  where verification_status = 'user_verified';

alter table public.price_observation_sources enable row level security;
alter table public.public_price_observations enable row level security;
alter table public.price_observation_submission_requests enable row level security;

-- The public surface is the explicitly versioned RPC below. Direct table
-- access would allow clients to bypass exact identity and deduplication rules.
revoke all on table public.price_observation_sources from public, anon, authenticated;
revoke all on table public.public_price_observations from public, anon, authenticated;
revoke all on table public.price_observation_submission_requests from public, anon, authenticated;

create or replace function public.submit_price_observation_v1(
  p_idempotency_key text,
  p_store_id uuid,
  p_observed_on date,
  p_catalog_product_id uuid,
  p_unit_price_krw integer
)
returns table (
  observation_id uuid,
  replayed boolean,
  applied_action text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_request_fingerprint text;
  v_existing_fingerprint text;
  v_existing_observation_id uuid;
  v_observation_id uuid;
  v_request_inserted_id text;
  v_inserted_new_observation boolean := false;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if length(v_idempotency_key) not between 1 and 200 then
    raise exception 'The idempotency key must contain 1 to 200 characters.' using errcode = '22023';
  end if;

  if p_store_id is null or p_observed_on is null or p_catalog_product_id is null then
    raise exception 'store_id, observed_on, and catalog_product_id are required.' using errcode = '22023';
  end if;

  if p_unit_price_krw is null or p_unit_price_krw < 0 then
    raise exception 'unit_price_krw must be a non-negative KRW integer.' using errcode = '22023';
  end if;

  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        pg_catalog.concat_ws(
          '|',
          p_store_id::text,
          p_observed_on::text,
          p_catalog_product_id::text,
          p_unit_price_krw::text
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select request.request_fingerprint, request.public_price_observation_id
    into v_existing_fingerprint, v_existing_observation_id
  from public.price_observation_submission_requests as request
  where request.idempotency_key = v_idempotency_key;

  if v_existing_observation_id is not null then
    if v_existing_fingerprint <> v_request_fingerprint then
      raise exception 'The idempotency key was already used for another request.' using errcode = '23505';
    end if;

    return query select v_existing_observation_id, true, 'replayed'::text;
    return;
  end if;

  if not exists (
    select 1
    from public.price_observation_sources as source
    where source.id = p_store_id
      and source.status = 'active'
      and source.review_status = 'verified'
  ) then
    raise exception 'The store is not an approved public observation source.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.catalog_products as catalog
    where catalog.id = p_catalog_product_id
      and catalog.purchase_type = 'retail_product'
      and catalog.status = 'active'
  ) then
    raise exception 'The catalog_product_id is not an active retail product.' using errcode = '22023';
  end if;

  insert into public.public_price_observations (
    store_id,
    observed_on,
    catalog_product_id,
    unit_price_krw,
    verification_status
  ) values (
    p_store_id,
    p_observed_on,
    p_catalog_product_id,
    p_unit_price_krw,
    'user_verified'
  )
  on conflict (store_id, observed_on, catalog_product_id, unit_price_krw) do nothing
  returning id into v_observation_id;

  if v_observation_id is null then
    select observation.id
      into v_observation_id
    from public.public_price_observations as observation
    where observation.store_id = p_store_id
      and observation.observed_on = p_observed_on
      and observation.catalog_product_id = p_catalog_product_id
      and observation.unit_price_krw = p_unit_price_krw;
  else
    v_inserted_new_observation := true;
  end if;

  insert into public.price_observation_submission_requests (
    idempotency_key,
    request_fingerprint,
    public_price_observation_id
  ) values (
    v_idempotency_key,
    v_request_fingerprint,
    v_observation_id
  )
  on conflict (idempotency_key) do nothing
  returning idempotency_key into v_request_inserted_id;

  if v_request_inserted_id is null then
    select request.request_fingerprint, request.public_price_observation_id
      into v_existing_fingerprint, v_existing_observation_id
    from public.price_observation_submission_requests as request
    where request.idempotency_key = v_idempotency_key;

    if v_existing_fingerprint <> v_request_fingerprint then
      raise exception 'The idempotency key was already used for another request.' using errcode = '23505';
    end if;

    return query select v_existing_observation_id, true, 'replayed'::text;
    return;
  end if;

  return query select v_observation_id, false,
    case when v_inserted_new_observation then 'created' else 'deduplicated' end;
end;
$$;

comment on function public.submit_price_observation_v1(text, uuid, date, uuid, integer) is
  'Accepts only a verified exact store/product/date/KRW observation and never accepts receipt or submitter identity fields.';

revoke all on function public.submit_price_observation_v1(text, uuid, date, uuid, integer) from public;
grant execute on function public.submit_price_observation_v1(text, uuid, date, uuid, integer) to authenticated;

create or replace function public.get_price_observation_sources_v1()
returns table (
  store_id uuid,
  source_namespace text,
  source_store_code text,
  display_name text,
  location_label text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    source.id,
    source.source_namespace,
    source.source_store_code,
    source.display_name,
    source.location_label
  from public.price_observation_sources as source
  where source.status = 'active'
    and source.review_status = 'verified'
  order by source.display_name, source.location_label nulls first, source.id;
$$;

comment on function public.get_price_observation_sources_v1() is
  'Returns only approved public store identities. User-owned stores are not exposed.';

revoke all on function public.get_price_observation_sources_v1() from public;
grant execute on function public.get_price_observation_sources_v1() to anon, authenticated;

create or replace function public.get_price_observations_v1(
  p_catalog_product_id uuid default null,
  p_store_id uuid default null,
  p_limit integer default 100
)
returns table (
  observation_id uuid,
  store_id uuid,
  source_namespace text,
  source_store_code text,
  store_name text,
  location_label text,
  observed_on date,
  catalog_product_id uuid,
  unit_price_krw integer,
  verification_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    observation.id,
    observation.store_id,
    source.source_namespace,
    source.source_store_code,
    source.display_name,
    source.location_label,
    observation.observed_on,
    observation.catalog_product_id,
    observation.unit_price_krw,
    observation.verification_status
  from public.public_price_observations as observation
  inner join public.price_observation_sources as source
    on source.id = observation.store_id
  inner join public.catalog_products as catalog
    on catalog.id = observation.catalog_product_id
  where observation.verification_status = 'user_verified'
    and source.status = 'active'
    and source.review_status = 'verified'
    and catalog.status = 'active'
    and catalog.purchase_type = 'retail_product'
    and (p_catalog_product_id is null or observation.catalog_product_id = p_catalog_product_id)
    and (p_store_id is null or observation.store_id = p_store_id)
  order by observation.observed_on desc, observation.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
$$;

comment on function public.get_price_observations_v1(uuid, uuid, integer) is
  'Returns public verified observations without receipt, transaction, OCR, payment, or submitter identity.';

revoke all on function public.get_price_observations_v1(uuid, uuid, integer) from public;
grant execute on function public.get_price_observations_v1(uuid, uuid, integer) to anon, authenticated;
