-- Confirmed restaurant-level fulfilment availability. A missing record means
-- "not confirmed", never that the restaurant does not offer the mode.
create table public.restaurant_fulfillment_evidence (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  fulfillment_type text not null check (fulfillment_type in ('delivery', 'takeout', 'dine_in')),
  evidence_type text not null check (evidence_type in ('receipt', 'manual')),
  receipt_observation_id uuid references public.restaurant_menu_receipt_observations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (
    (evidence_type = 'receipt' and receipt_observation_id is not null)
    or (evidence_type = 'manual' and receipt_observation_id is null)
  )
);

comment on table public.restaurant_fulfillment_evidence is
  'Append-only admin-verified restaurant availability evidence. Absence is unknown, not unavailable.';

create unique index restaurant_fulfillment_receipt_evidence_unique
  on public.restaurant_fulfillment_evidence(restaurant_id, fulfillment_type, receipt_observation_id)
  where receipt_observation_id is not null;
create unique index restaurant_fulfillment_manual_evidence_unique
  on public.restaurant_fulfillment_evidence(restaurant_id, fulfillment_type)
  where evidence_type = 'manual';
create index restaurant_fulfillment_evidence_restaurant_idx
  on public.restaurant_fulfillment_evidence(restaurant_id, fulfillment_type, verified_at desc);

alter table public.restaurant_fulfillment_evidence enable row level security;
revoke all on public.restaurant_fulfillment_evidence from public, anon, authenticated;
grant select on public.restaurant_fulfillment_evidence to authenticated;
create policy "admins read restaurant fulfilment evidence"
  on public.restaurant_fulfillment_evidence for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create function public.admin_confirm_restaurant_fulfillment_manual_v1(
  p_restaurant_id uuid,
  p_fulfillment_type text
)
returns table (
  restaurant_id uuid,
  fulfillment_type text,
  evidence_type text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_evidence_id uuid;
begin
  if v_actor is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if (select auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception '관리자 권한이 필요합니다.';
  end if;
  if p_fulfillment_type is null or p_fulfillment_type not in ('delivery', 'takeout', 'dine_in') then
    raise exception '지원하지 않는 음식점 이용 방식입니다.';
  end if;
  if not exists (
    select 1 from public.restaurants
    where id = p_restaurant_id and status = 'active' and review_status = 'verified'
  ) then
    raise exception '검증된 활성 음식점을 선택하세요.';
  end if;

  select id into v_evidence_id
  from public.restaurant_fulfillment_evidence
  where restaurant_id = p_restaurant_id
    and fulfillment_type = p_fulfillment_type
    and evidence_type = 'manual';

  if v_evidence_id is null then
    insert into public.restaurant_fulfillment_evidence (
      restaurant_id, fulfillment_type, evidence_type, created_by, verified_by
    ) values (
      p_restaurant_id, p_fulfillment_type, 'manual', v_actor, v_actor
    ) returning id into v_evidence_id;
    replayed := false;
  else
    replayed := true;
  end if;

  restaurant_id := p_restaurant_id;
  fulfillment_type := p_fulfillment_type;
  evidence_type := 'manual';
  return next;
end;
$$;

create function public.admin_confirm_restaurant_fulfillment_from_receipt_v1(
  p_restaurant_id uuid,
  p_receipt_observation_id uuid,
  p_fulfillment_type text
)
returns table (
  restaurant_id uuid,
  fulfillment_type text,
  evidence_type text,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_evidence_id uuid;
begin
  if v_actor is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if (select auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception '관리자 권한이 필요합니다.';
  end if;
  if p_fulfillment_type is null or p_fulfillment_type not in ('delivery', 'takeout', 'dine_in') then
    raise exception '지원하지 않는 음식점 이용 방식입니다.';
  end if;
  if not exists (
    select 1
    from public.restaurant_menu_receipt_observations
    where id = p_receipt_observation_id
      and restaurant_id = p_restaurant_id
      and verification_status = 'verified'
  ) then
    raise exception '선택한 검증 영수증 관측이 음식점과 일치하지 않습니다.';
  end if;

  select id into v_evidence_id
  from public.restaurant_fulfillment_evidence
  where restaurant_id = p_restaurant_id
    and fulfillment_type = p_fulfillment_type
    and receipt_observation_id = p_receipt_observation_id;

  if v_evidence_id is null then
    insert into public.restaurant_fulfillment_evidence (
      restaurant_id, fulfillment_type, evidence_type, receipt_observation_id, created_by, verified_by
    ) values (
      p_restaurant_id, p_fulfillment_type, 'receipt', p_receipt_observation_id, v_actor, v_actor
    ) returning id into v_evidence_id;
    replayed := false;
  else
    replayed := true;
  end if;

  restaurant_id := p_restaurant_id;
  fulfillment_type := p_fulfillment_type;
  evidence_type := 'receipt';
  return next;
end;
$$;

comment on function public.admin_confirm_restaurant_fulfillment_manual_v1(uuid, text) is
  'Admin-only direct confirmation of one restaurant fulfilment mode.';
comment on function public.admin_confirm_restaurant_fulfillment_from_receipt_v1(uuid, uuid, text) is
  'Admin-only confirmation of one restaurant fulfilment mode from a verified restaurant receipt observation.';
revoke all on function public.admin_confirm_restaurant_fulfillment_manual_v1(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_confirm_restaurant_fulfillment_from_receipt_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_confirm_restaurant_fulfillment_manual_v1(uuid, text) to authenticated;
grant execute on function public.admin_confirm_restaurant_fulfillment_from_receipt_v1(uuid, uuid, text) to authenticated;

-- Keep v2 payload names stable. The projection exposes no receipt, user, or
-- evidence IDs; it only says which restaurant-level modes were confirmed.
create or replace function public.get_restaurant_directory_v2(
  p_query text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with legacy as (
    select public.get_restaurant_directory_v1(null, 200) as payload
  ),
  enriched as (
    select
      entry.ordinality,
      restaurant.id as restaurant_id,
      jsonb_set(
        jsonb_set(
          entry.document - 'revision',
          '{restaurant,category}',
          coalesce(public.restaurant_category_document(restaurant.category_id), 'null'::jsonb),
          true
        ),
        '{restaurant,fulfillmentModes}',
        coalesce((
          select jsonb_agg(jsonb_build_object('type', chosen.fulfillment_type, 'evidence', chosen.evidence_type)
            order by case chosen.fulfillment_type when 'delivery' then 1 when 'takeout' then 2 else 3 end)
          from (
            select distinct on (evidence.fulfillment_type)
              evidence.fulfillment_type, evidence.evidence_type
            from public.restaurant_fulfillment_evidence as evidence
            where evidence.restaurant_id = restaurant.id
            order by evidence.fulfillment_type,
              case evidence.evidence_type when 'receipt' then 1 else 2 end,
              evidence.verified_at desc, evidence.id desc
          ) as chosen
        ), '[]'::jsonb),
        true
      ) as document
    from legacy
    cross join lateral jsonb_array_elements(legacy.payload -> 'restaurants')
      with ordinality as entry(document, ordinality)
    inner join public.restaurants as restaurant
      on restaurant.id = (entry.document -> 'restaurant' ->> 'id')::uuid
  ),
  filtered as (
    select enriched.*
    from enriched
    where nullif(pg_catalog.btrim(p_query), '') is null
      or coalesce(enriched.document -> 'restaurant' ->> 'brand', '') ilike '%' || pg_catalog.btrim(p_query) || '%'
      or coalesce(enriched.document -> 'restaurant' ->> 'legalName', '') ilike '%' || pg_catalog.btrim(p_query) || '%'
      or coalesce(enriched.document -> 'restaurant' ->> 'cuisineType', '') ilike '%' || pg_catalog.btrim(p_query) || '%'
      or exists (
        select 1 from jsonb_array_elements(coalesce(enriched.document -> 'restaurant' -> 'category' -> 'path', '[]'::jsonb)) as category_node(document)
        where coalesce(category_node.document ->> 'name', '') ilike '%' || pg_catalog.btrim(p_query) || '%'
      )
      or exists (
        select 1 from jsonb_array_elements(coalesce(enriched.document -> 'locations', '[]'::jsonb)) as location(document)
        where coalesce(location.document ->> 'locationLabel', '') ilike '%' || pg_catalog.btrim(p_query) || '%'
          or coalesce(location.document ->> 'sourceLabel', '') ilike '%' || pg_catalog.btrim(p_query) || '%'
      )
      or exists (
        select 1 from public.restaurant_menus as search_menu
        where search_menu.restaurant_id = enriched.restaurant_id
          and search_menu.status = 'active' and search_menu.review_status = 'verified'
          and (search_menu.canonical_name ilike '%' || pg_catalog.btrim(p_query) || '%'
            or coalesce(search_menu.category_label, '') ilike '%' || pg_catalog.btrim(p_query) || '%')
      )
    order by enriched.document -> 'restaurant' ->> 'brand', enriched.ordinality
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  ),
  versioned as (
    select filtered.ordinality,
      jsonb_set(filtered.document, '{revision}', to_jsonb('sha256:' || encode(extensions.digest(pg_catalog.convert_to(filtered.document::text, 'UTF8'), 'sha256'), 'hex')), true) as document
    from filtered
  ),
  directory as (
    select coalesce(jsonb_agg(versioned.document order by versioned.ordinality), '[]'::jsonb) as documents from versioned
  )
  select jsonb_build_object(
    'schemaVersion', 'restaurant-directory.v2', 'namespace', 'pricetrace',
    'revision', 'sha256:' || encode(extensions.digest(pg_catalog.convert_to(directory.documents::text, 'UTF8'), 'sha256'), 'hex'),
    'restaurants', directory.documents
  ) from directory;
$$;

create or replace function public.get_restaurant_detail_v2(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with legacy as (
    select public.get_restaurant_detail_v1(p_restaurant_id) as payload
  ),
  base_document as (
    select jsonb_set(
      jsonb_set(
        legacy.payload - 'schemaVersion' - 'namespace' - 'revision',
        '{restaurant,category}', coalesce(public.restaurant_category_document(restaurant.category_id), 'null'::jsonb), true
      ),
      '{restaurant,fulfillmentModes}',
      coalesce((
        select jsonb_agg(jsonb_build_object('type', chosen.fulfillment_type, 'evidence', chosen.evidence_type)
          order by case chosen.fulfillment_type when 'delivery' then 1 when 'takeout' then 2 else 3 end)
        from (
          select distinct on (evidence.fulfillment_type) evidence.fulfillment_type, evidence.evidence_type
          from public.restaurant_fulfillment_evidence as evidence
          where evidence.restaurant_id = restaurant.id
          order by evidence.fulfillment_type,
            case evidence.evidence_type when 'receipt' then 1 else 2 end,
            evidence.verified_at desc, evidence.id desc
        ) as chosen
      ), '[]'::jsonb), true
    ) as document
    from legacy
    inner join public.restaurants as restaurant on restaurant.id = p_restaurant_id
    where legacy.payload is not null
  ),
  enriched as (
    select jsonb_set(
      base.document, '{optionLinks}',
      coalesce((
        select jsonb_agg(jsonb_build_object('id', link.id, 'parentMenuId', link.parent_menu_id, 'optionMenuId', link.option_menu_id, 'source', link.link_source, 'confidence', link.confidence) order by link.option_menu_id)
        from public.restaurant_menu_option_links as link
        inner join public.restaurant_menus as parent_menu on parent_menu.restaurant_id = link.restaurant_id and parent_menu.id = link.parent_menu_id
        inner join public.restaurant_menus as option_menu on option_menu.restaurant_id = link.restaurant_id and option_menu.id = link.option_menu_id
        where link.restaurant_id = p_restaurant_id
          and parent_menu.status = 'active' and parent_menu.review_status = 'verified'
          and option_menu.status = 'active' and option_menu.review_status = 'verified'
      ), '[]'::jsonb), true
    ) as document from base_document as base
  )
  select jsonb_build_object(
    'schemaVersion', 'restaurant-detail.v2', 'namespace', 'pricetrace',
    'revision', 'sha256:' || encode(extensions.digest(pg_catalog.convert_to(enriched.document::text, 'UTF8'), 'sha256'), 'hex'),
    'restaurant', enriched.document -> 'restaurant', 'locations', enriched.document -> 'locations',
    'menus', enriched.document -> 'menus', 'optionLinks', enriched.document -> 'optionLinks'
  ) from enriched;
$$;

comment on function public.get_restaurant_directory_v2(text, integer) is
  'restaurant-directory.v2: verified restaurant directory with category and confirmed fulfilment modes.';
comment on function public.get_restaurant_detail_v2(uuid) is
  'restaurant-detail.v2: verified restaurant detail with category, confirmed fulfilment modes, and persisted option links.';
revoke all on function public.get_restaurant_directory_v2(text, integer) from public, anon, authenticated;
revoke all on function public.get_restaurant_detail_v2(uuid) from public, anon, authenticated;
grant execute on function public.get_restaurant_directory_v2(text, integer) to anon, authenticated;
grant execute on function public.get_restaurant_detail_v2(uuid) to anon, authenticated;
