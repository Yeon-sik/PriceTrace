-- Brand identities and existing product registration contracts are preserved.
alter table public.brands
  add column parent_brand_id uuid references public.brands(id) on delete restrict,
  add constraint brands_parent_not_self check (parent_brand_id is distinct from id);
create index brands_parent_brand_id_idx on public.brands(parent_brand_id);

-- Serialize hierarchy writes. An actual row update also prevents write skew
-- under REPEATABLE READ (a concurrent writer must retry its transaction).
-- This is an internal mutex, never an API table or a source of brand facts.
create table public.brand_hierarchy_write_guard (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0
);
insert into public.brand_hierarchy_write_guard(singleton) values (true);
alter table public.brand_hierarchy_write_guard enable row level security;
revoke all on public.brand_hierarchy_write_guard from public, anon, authenticated;

create function public.serialize_brand_identity_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.brand_hierarchy_write_guard set revision = revision + 1 where singleton;
  return new;
end;
$$;
revoke all on function public.serialize_brand_identity_write() from public, anon, authenticated;
-- Alphabetical trigger ordering takes this lock before the existing canonical
-- and alias validators, preserving their cross-table uniqueness checks too.
create trigger a_serialize_brand_identity_write before insert or update of canonical_name, parent_brand_id on public.brands
for each row execute function public.serialize_brand_identity_write();
create trigger a_serialize_brand_identity_write before insert or update of alias_name, brand_id on public.brand_aliases
for each row execute function public.serialize_brand_identity_write();

create function public.validate_brand_hierarchy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_brand_id is not null and exists (
    with recursive ancestors as (
      select b.id, b.parent_brand_id from public.brands b where b.id = new.parent_brand_id
      union
      select b.id, b.parent_brand_id from public.brands b
      join ancestors a on b.id = a.parent_brand_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'Brand hierarchy cannot contain a cycle.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_brand_hierarchy() from public, anon, authenticated;
create trigger validate_brand_hierarchy before insert or update of parent_brand_id on public.brands
for each row execute function public.validate_brand_hierarchy();

create function public.get_public_brand_catalog_v1(
  p_query text default null, p_limit integer default 50, p_offset integer default 0
)
returns table (
  brand_id uuid, canonical_name text, parent_brand_id uuid, parent_canonical_name text,
  matched_name text, match_kind text, logo_url text, official_site_url text
)
language sql stable security invoker set search_path = '' as $$
  with query as (
    select public.normalize_brand_name(coalesce(p_query, '')) as value
  ), candidates as (
    select b.id, b.canonical_name as matched_name, 'canonical'::text as match_kind,
      case when q.value = '' or b.normalized_name = q.value then 1
           when starts_with(b.normalized_name, q.value) then 3 else 5 end as rank
    from public.brands b cross join query q
    where b.status = 'active' and (q.value = '' or strpos(b.normalized_name, q.value) > 0)
    union all
    select a.brand_id, a.alias_name, 'alias'::text,
      case when a.normalized_alias = q.value then 2
           when starts_with(a.normalized_alias, q.value) then 4 else 6 end
    from public.brand_aliases a join public.brands b on b.id = a.brand_id cross join query q
    where b.status = 'active' and q.value <> '' and strpos(a.normalized_alias, q.value) > 0
  ), best as (
    select distinct on (c.id) c.* from candidates c
    order by c.id, c.rank, c.matched_name collate "C"
  )
  select b.id, b.canonical_name, b.parent_brand_id, parent.canonical_name,
    best.matched_name, best.match_kind, b.logo_url, b.official_site_url
  from best join public.brands b on b.id = best.id
  left join public.brands parent on parent.id = b.parent_brand_id and parent.status = 'active'
  order by best.rank, b.canonical_name collate "C", b.id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset least(greatest(coalesce(p_offset, 0), 0), 1000000);
$$;
revoke all on function public.get_public_brand_catalog_v1(text, integer, integer) from public;
grant execute on function public.get_public_brand_catalog_v1(text, integer, integer) to anon, authenticated;

-- v5 wraps the existing v4 projection: no internal/unverified product can be
-- newly published, and the v1-v4 functions and their wire shapes are untouched.
create function public.get_public_exact_standard_product_catalog_v5()
returns table (
  source_label text, source_product_code text, catalog_product_id uuid,
  standard_product_id uuid, standard_name text, brand_name text,
  standard_category_id uuid, standard_category_slug text, standard_category_name text,
  content_amount numeric, content_unit text, package_count integer, reference_unit integer,
  coupang_listed_price_krw integer, coupang_quantity integer, coupang_content_amount numeric,
  coupang_content_unit text, coupang_max_bundle_quantity integer,
  coupang_max_bundle_listed_price_krw integer, coupang_product_url text,
  coupang_observed_at timestamptz,
  brand_id uuid, parent_brand_id uuid, parent_brand_name text
)
language sql stable security definer set search_path = '' as $$
  select catalog.*, standard.brand_id, brand.parent_brand_id, parent.canonical_name
  from public.get_public_exact_standard_product_catalog_v4() catalog
  join public.standard_products standard on standard.id = catalog.standard_product_id
  left join public.brands brand on brand.id = standard.brand_id and brand.status = 'active'
  left join public.brands parent on parent.id = brand.parent_brand_id and parent.status = 'active'
  order by catalog.standard_name, catalog.source_label, catalog.source_product_code, catalog.catalog_product_id;
$$;
revoke all on function public.get_public_exact_standard_product_catalog_v5() from public;
grant execute on function public.get_public_exact_standard_product_catalog_v5() to anon, authenticated;

comment on column public.brands.parent_brand_id is
  'Explicit administrator-managed parent; null means root. Never inferred from manufacturer or names.';
comment on function public.get_public_brand_catalog_v1(text, integer, integer) is
  'Active canonical brands; canonical/alias exact, prefix, contains ranking; limit 1..200, offset 0..1000000.';
comment on function public.get_public_exact_standard_product_catalog_v5() is
  'Unchanged v4 public projection plus direct canonical brand identity and its immediate active parent.';

-- Later approval-gating migrations revoked direct brand writes. Keep those
-- revokes: these narrowly scoped admin endpoints do not register products.
create table public.brand_admin_actions (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null,
  action text not null check (action in ('create', 'update', 'add_alias', 'delete_alias')),
  payload jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.brand_admin_actions enable row level security;
revoke all on public.brand_admin_actions from public, anon, authenticated;
grant select on public.brand_admin_actions to authenticated;
create policy "admins read brand actions" on public.brand_admin_actions for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create function public.admin_save_brand_v1(
  p_brand_id uuid, p_canonical_name text, p_parent_brand_id uuid,
  p_logo_url text, p_official_site_url text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(p_brand_id, gen_random_uuid());
  v_before jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  update public.brand_hierarchy_write_guard set revision = revision + 1 where singleton;
  if p_brand_id is null then
    insert into public.brands(id, canonical_name, parent_brand_id, logo_url, official_site_url, created_by)
    values(v_id, btrim(p_canonical_name), p_parent_brand_id, p_logo_url, p_official_site_url, auth.uid());
  else
    select to_jsonb(b) into v_before from public.brands b where b.id = v_id for update;
    if not found then raise exception 'Brand does not exist.' using errcode = '23503'; end if;
    update public.brands set canonical_name = btrim(p_canonical_name), parent_brand_id = p_parent_brand_id,
      logo_url = p_logo_url, official_site_url = p_official_site_url, updated_at = now() where id = v_id;
  end if;
  insert into public.brand_admin_actions(brand_id, action, payload, created_by)
  select v_id, case when p_brand_id is null then 'create' else 'update' end,
    jsonb_build_object('before', v_before, 'after', to_jsonb(b)), auth.uid() from public.brands b where b.id = v_id;
  return v_id;
end;
$$;

create function public.admin_add_brand_alias_v1(p_brand_id uuid, p_alias_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_alias_id uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  insert into public.brand_aliases(brand_id, alias_name, created_by)
    values(p_brand_id, btrim(p_alias_name), auth.uid()) returning id into v_alias_id;
  insert into public.brand_admin_actions(brand_id, action, payload, created_by)
    values(p_brand_id, 'add_alias', jsonb_build_object('aliasId', v_alias_id, 'aliasName', btrim(p_alias_name)), auth.uid());
  return v_alias_id;
end;
$$;

create function public.admin_delete_brand_alias_v1(p_brand_id uuid, p_alias_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  delete from public.brand_aliases where id = p_alias_id and brand_id = p_brand_id returning alias_name into v_name;
  if not found then raise exception 'Brand alias does not exist.' using errcode = '23503'; end if;
  insert into public.brand_admin_actions(brand_id, action, payload, created_by)
    values(p_brand_id, 'delete_alias', jsonb_build_object('aliasId', p_alias_id, 'aliasName', v_name), auth.uid());
  return p_alias_id;
end;
$$;
revoke all on function public.admin_save_brand_v1(uuid, text, uuid, text, text) from public, anon;
revoke all on function public.admin_add_brand_alias_v1(uuid, text) from public, anon;
revoke all on function public.admin_delete_brand_alias_v1(uuid, uuid) from public, anon;
grant execute on function public.admin_save_brand_v1(uuid, text, uuid, text, text) to authenticated;
grant execute on function public.admin_add_brand_alias_v1(uuid, text) to authenticated;
grant execute on function public.admin_delete_brand_alias_v1(uuid, uuid) to authenticated;
