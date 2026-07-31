create function public.normalize_brand_name(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null check (length(btrim(canonical_name)) > 0),
  normalized_name text generated always as (public.normalize_brand_name(canonical_name)) stored,
  logo_url text check (logo_url is null or logo_url ~ '^https?://'),
  official_site_url text check (official_site_url is null or official_site_url ~ '^https?://'),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name)
);

create table public.brand_aliases (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  alias_name text not null check (length(btrim(alias_name)) > 0),
  normalized_alias text generated always as (public.normalize_brand_name(alias_name)) stored,
  locale text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (normalized_alias)
);

alter table public.standard_products
  add column brand_id uuid references public.brands(id) on delete set null;

create index standard_products_brand_idx
  on public.standard_products(brand_id, status);

create table public.standard_product_brand_evidence (
  id uuid primary key default gen_random_uuid(),
  standard_product_id uuid not null references public.standard_products(id) on delete restrict,
  catalog_product_id uuid references public.catalog_products(id) on delete set null,
  brand_id uuid not null references public.brands(id) on delete restrict,
  observed_name text not null check (length(btrim(observed_name)) > 0),
  normalized_observed_name text generated always as (public.normalize_brand_name(observed_name)) stored,
  source_type text not null check (source_type in ('receipt', 'official_store', 'manual', 'legacy_import')),
  source_label text,
  source_product_code text,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  observed_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index standard_product_brand_evidence_standard_idx
  on public.standard_product_brand_evidence(standard_product_id, observed_at desc);

create unique index standard_product_brand_evidence_identity_idx
  on public.standard_product_brand_evidence(
    standard_product_id,
    brand_id,
    source_type,
    normalized_observed_name,
    coalesce(source_label, ''),
    coalesce(source_product_code, ''),
    coalesce(source_url, '')
  );

-- Keep existing free-text values, but move identity to brands. A standard
-- product value wins over a child variant value when their normalized names
-- are equal.
with candidates as (
  select btrim(standard.brand) as canonical_name, 0 as priority
  from public.standard_products as standard
  where length(btrim(coalesce(standard.brand, ''))) > 0
  union all
  select btrim(catalog.brand) as canonical_name, 1 as priority
  from public.catalog_products as catalog
  where length(btrim(coalesce(catalog.brand, ''))) > 0
),
canonical_candidates as (
  select distinct on (public.normalize_brand_name(candidate.canonical_name))
    candidate.canonical_name
  from candidates as candidate
  order by public.normalize_brand_name(candidate.canonical_name), candidate.priority, candidate.canonical_name
)
insert into public.brands (canonical_name)
select candidate.canonical_name
from canonical_candidates as candidate
on conflict (normalized_name) do nothing;

update public.standard_products as standard
set
  brand_id = brand.id,
  brand = brand.canonical_name
from public.brands as brand
where length(btrim(coalesce(standard.brand, ''))) > 0
  and brand.normalized_name = public.normalize_brand_name(standard.brand);

-- If a family has no brand but all branded children agree, promote that one
-- brand to the family. Conflicting child values stay unassigned for review.
with child_brand as (
  select
    catalog.standard_product_id,
    min(public.normalize_brand_name(catalog.brand)) as normalized_name
  from public.catalog_products as catalog
  where length(btrim(coalesce(catalog.brand, ''))) > 0
  group by catalog.standard_product_id
  having count(distinct public.normalize_brand_name(catalog.brand)) = 1
)
update public.standard_products as standard
set
  brand_id = brand.id,
  brand = brand.canonical_name
from child_brand
inner join public.brands as brand on brand.normalized_name = child_brand.normalized_name
where standard.id = child_brand.standard_product_id
  and standard.brand_id is null;

insert into public.standard_product_brand_evidence (
  standard_product_id,
  brand_id,
  observed_name,
  source_type,
  source_label
)
select
  standard.id,
  standard.brand_id,
  standard.brand,
  'legacy_import',
  'standard_products.brand'
from public.standard_products as standard
where standard.brand_id is not null
  and length(btrim(coalesce(standard.brand, ''))) > 0
on conflict do nothing;

insert into public.standard_product_brand_evidence (
  standard_product_id,
  catalog_product_id,
  brand_id,
  observed_name,
  source_type,
  source_label
)
select
  catalog.standard_product_id,
  catalog.id,
  brand.id,
  catalog.brand,
  'legacy_import',
  'catalog_products.brand'
from public.catalog_products as catalog
inner join public.brands as brand
  on brand.normalized_name = public.normalize_brand_name(catalog.brand)
where length(btrim(coalesce(catalog.brand, ''))) > 0
on conflict do nothing;

comment on table public.brands is
  'Canonical brand identities. Product names remain independent from brand names.';
comment on table public.brand_aliases is
  'Alternate observed names such as BR, 배스킨라빈스, and Baskin Robbins.';
comment on column public.standard_products.brand_id is
  'Canonical family brand inherited by child catalog variants unless a future explicit override is introduced.';
comment on column public.standard_products.brand is
  'Legacy compatibility shadow of brands.canonical_name. New writes use brand_id.';
comment on column public.catalog_products.brand is
  'Legacy variant text retained for migration evidence. The effective brand is standard_products.brand_id.';
comment on table public.standard_product_brand_evidence is
  'Observed brand spellings and their receipt or official-store provenance, stored separately from canonical identity.';

create function public.validate_brand_canonical_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.brand_aliases as alias
    where alias.normalized_alias = public.normalize_brand_name(new.canonical_name)
      and alias.brand_id <> new.id
  )
  then
    raise exception 'The canonical brand name is already assigned as another brand alias.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger validate_brand_canonical_identity
before insert or update of canonical_name
on public.brands
for each row execute function public.validate_brand_canonical_identity();

create function public.validate_brand_alias_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.brands as brand
    where brand.normalized_name = public.normalize_brand_name(new.alias_name)
      and brand.id <> new.brand_id
  )
  then
    raise exception 'The brand alias is already assigned as another canonical brand name.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger validate_brand_alias_identity
before insert or update of alias_name, brand_id
on public.brand_aliases
for each row execute function public.validate_brand_alias_identity();

create function public.sync_standard_product_legacy_brand()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.brand_id is null
  then
    new.brand := null;
  else
    select brand.canonical_name
    into new.brand
    from public.brands as brand
    where brand.id = new.brand_id;
  end if;
  return new;
end;
$$;

create trigger sync_standard_product_legacy_brand
before insert or update of brand_id
on public.standard_products
for each row execute function public.sync_standard_product_legacy_brand();

create function public.propagate_brand_canonical_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.standard_products
  set
    brand = new.canonical_name,
    updated_at = now()
  where brand_id = new.id;
  return new;
end;
$$;

create trigger propagate_brand_canonical_name
after update of canonical_name
on public.brands
for each row execute function public.propagate_brand_canonical_name();

alter table public.brands enable row level security;
alter table public.brand_aliases enable row level security;
alter table public.standard_product_brand_evidence enable row level security;

grant select on public.brands, public.brand_aliases to anon, authenticated;
grant insert, update, delete on public.brands, public.brand_aliases to authenticated;
grant select, insert, update, delete on public.standard_product_brand_evidence to authenticated;

create policy "active brands are publicly readable"
  on public.brands for select to anon, authenticated
  using (status = 'active');
create policy "admins manage brands"
  on public.brands for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "active brand aliases are publicly readable"
  on public.brand_aliases for select to anon, authenticated
  using (
    exists (
      select 1
      from public.brands as brand
      where brand.id = brand_aliases.brand_id
        and brand.status = 'active'
    )
  );
create policy "admins manage brand aliases"
  on public.brand_aliases for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins manage brand evidence"
  on public.standard_product_brand_evidence for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create function public.register_standard_product_with_brand_and_coupang_offer(
  p_standard_product_id uuid,
  p_standard_name text,
  p_brand_name text,
  p_receipt_brand_name text,
  p_official_brand_name text,
  p_official_brand_source_label text,
  p_product_reference_url text,
  p_listing_name text,
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
  standard_product_id uuid,
  catalog_product_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_standard_product_id uuid;
  v_catalog_product_id uuid;
  v_brand_id uuid;
  v_normalized_brand_name text := public.normalize_brand_name(p_brand_name);
begin
  select
    registered.standard_product_id,
    registered.catalog_product_id
  into
    v_standard_product_id,
    v_catalog_product_id
  from public.register_standard_product_with_coupang_offer(
    p_standard_product_id,
    p_standard_name,
    p_product_reference_url,
    p_listing_name,
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
  ) as registered;

  if v_standard_product_id is null or v_catalog_product_id is null
  then
    raise exception 'The standard product registration returned no product.'
      using errcode = '40001';
  end if;

  if length(v_normalized_brand_name) > 0
  then
    select candidate.brand_id
    into v_brand_id
    from (
      select brand.id as brand_id, 0 as match_priority
      from public.brands as brand
      where brand.normalized_name = v_normalized_brand_name
        and brand.status = 'active'
      union all
      select alias.brand_id, 1 as match_priority
      from public.brand_aliases as alias
      inner join public.brands as brand on brand.id = alias.brand_id
      where alias.normalized_alias = v_normalized_brand_name
        and brand.status = 'active'
    ) as candidate
    order by candidate.match_priority
    limit 1;

    if v_brand_id is null
    then
      insert into public.brands (canonical_name, created_by)
      values (btrim(p_brand_name), v_user_id)
      on conflict (normalized_name)
      do update set updated_at = now()
      returning id into v_brand_id;
    end if;

    update public.standard_products
    set
      brand_id = v_brand_id,
      updated_at = now()
    where id = v_standard_product_id;
  else
    select standard.brand_id
    into v_brand_id
    from public.standard_products as standard
    where standard.id = v_standard_product_id;
  end if;

  if (
    length(public.normalize_brand_name(p_receipt_brand_name)) > 0
    or length(public.normalize_brand_name(p_official_brand_name)) > 0
  ) and v_brand_id is null
  then
    raise exception 'Observed brand evidence requires a canonical brand.'
      using errcode = '23514';
  end if;

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
      created_by
    )
    select distinct
      v_standard_product_id,
      v_catalog_product_id,
      v_brand_id,
      btrim(p_receipt_brand_name),
      'receipt',
      btrim(source.source_label),
      btrim(p_source_product_code),
      v_user_id
    from unnest(p_source_labels) as source(source_label)
    where length(btrim(source.source_label)) > 0
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
      v_user_id
    )
    on conflict do nothing;
  end if;

  return query
  select v_standard_product_id, v_catalog_product_id;
end;
$$;

comment on function public.register_standard_product_with_brand_and_coupang_offer(
  uuid, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Atomically registers a standard family, inherited canonical brand, observed brand provenance, sellable variant, source mappings, and Coupang offer.';

revoke all on function public.normalize_brand_name(text) from public;
revoke all on function public.validate_brand_canonical_identity() from public;
revoke all on function public.validate_brand_alias_identity() from public;
revoke all on function public.sync_standard_product_legacy_brand() from public;
revoke all on function public.propagate_brand_canonical_name() from public;
revoke all on function public.register_standard_product_with_brand_and_coupang_offer(
  uuid, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public;

grant execute on function public.normalize_brand_name(text) to anon, authenticated, service_role;
grant execute on function public.register_standard_product_with_brand_and_coupang_offer(
  uuid, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) to authenticated;
