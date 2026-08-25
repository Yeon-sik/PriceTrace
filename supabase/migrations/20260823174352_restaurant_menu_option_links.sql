-- Keep a restaurant add-on as its own exact menu identity and store the
-- parent-child relationship separately. This avoids changing catalog keys or
-- treating a name-only guess as a new menu identity.

create table public.restaurant_menu_option_links (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  parent_menu_id uuid not null,
  option_menu_id uuid not null,
  link_source text not null
    check (link_source in ('automatic', 'manual')),
  confidence numeric(4,3) not null
    check (confidence >= 0 and confidence <= 1),
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (restaurant_id, parent_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict,
  foreign key (restaurant_id, option_menu_id)
    references public.restaurant_menus(restaurant_id, id) on delete restrict,
  unique (restaurant_id, option_menu_id),
  check (parent_menu_id <> option_menu_id)
);

comment on table public.restaurant_menu_option_links is
  'Exact restaurant menu option relationship. The option keeps its own catalog identity; one option has at most one parent menu per restaurant.';

comment on column public.restaurant_menu_option_links.link_source is
  'automatic is a deterministic same-receipt inference; manual is an administrator-selected exact menu relationship.';

create index restaurant_menu_option_links_parent_idx
  on public.restaurant_menu_option_links(restaurant_id, parent_menu_id, option_menu_id);

alter table public.restaurant_menu_option_links enable row level security;
revoke all on public.restaurant_menu_option_links from public, anon, authenticated;

create function public.restaurant_menu_name_looks_like_option(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    btrim(p_name) ~* '(추가|토핑|사리|곱빼기|곱배기|extra|add[[:space:]_-]*on)',
    false
  );
$function$;

comment on function public.restaurant_menu_name_looks_like_option(text) is
  'Conservative option-name marker used only as one part of automatic same-receipt inference.';
revoke all on function public.restaurant_menu_name_looks_like_option(text)
  from public, anon, authenticated;

create function public.auto_link_restaurant_menu_options_for_receipt(
  p_restaurant_id uuid,
  p_receipt_id uuid,
  p_created_by uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_option record;
  v_parent_count integer;
  v_parent_menu_id uuid;
  v_parent_receipt_item_id text;
  v_inserted integer := 0;
  v_row_count integer;
begin
  if p_restaurant_id is null or p_receipt_id is null then
    return 0;
  end if;

  for v_option in
    select distinct
      option_observation.restaurant_id,
      option_observation.owner_user_id,
      option_observation.receipt_id,
      option_observation.restaurant_menu_id as option_menu_id,
      option_observation.receipt_item_id as option_receipt_item_id,
      option_observation.verified_by
    from public.restaurant_menu_receipt_observations as option_observation
    inner join public.restaurant_menus as option_menu
      on option_menu.restaurant_id = option_observation.restaurant_id
      and option_menu.id = option_observation.restaurant_menu_id
    inner join public.receipt_items as option_item
      on option_item.user_id = option_observation.owner_user_id
      and option_item.id = option_observation.receipt_item_id
      and option_item.receipt_id = option_observation.receipt_id
    inner join public.store_products as option_store_product
      on option_store_product.user_id = option_item.user_id
      and option_store_product.id = option_item.store_product_id
    inner join public.products as option_product
      on option_product.user_id = option_store_product.user_id
      and option_product.id = option_store_product.product_id
    where option_observation.restaurant_id = p_restaurant_id
      and option_observation.receipt_id = p_receipt_id
      and option_observation.verification_status = 'verified'
      and option_menu.status = 'active'
      and option_menu.review_status = 'verified'
      and option_product.purchase_type = 'menu_item'
      and (
        coalesce(option_product.category_tags, '{}'::text[])
          && array['service', 'option', 'add_on', 'addon']::text[]
        or public.restaurant_menu_name_looks_like_option(option_menu.canonical_name)
      )
  loop
    v_parent_count := 0;
    v_parent_menu_id := null;
    v_parent_receipt_item_id := null;

    select count(*)
    into v_parent_count
    from (
      select distinct parent_observation.restaurant_menu_id
      from public.restaurant_menu_receipt_observations as parent_observation
      inner join public.restaurant_menus as parent_menu
        on parent_menu.restaurant_id = parent_observation.restaurant_id
        and parent_menu.id = parent_observation.restaurant_menu_id
      inner join public.receipt_items as parent_item
        on parent_item.user_id = parent_observation.owner_user_id
        and parent_item.id = parent_observation.receipt_item_id
        and parent_item.receipt_id = parent_observation.receipt_id
      inner join public.store_products as parent_store_product
        on parent_store_product.user_id = parent_item.user_id
        and parent_store_product.id = parent_item.store_product_id
      inner join public.products as parent_product
        on parent_product.user_id = parent_store_product.user_id
        and parent_product.id = parent_store_product.product_id
      where parent_observation.restaurant_id = v_option.restaurant_id
        and parent_observation.owner_user_id = v_option.owner_user_id
        and parent_observation.receipt_id = v_option.receipt_id
        and parent_observation.verification_status = 'verified'
        and parent_observation.restaurant_menu_id <> v_option.option_menu_id
        and parent_menu.status = 'active'
        and parent_menu.review_status = 'verified'
        and parent_product.purchase_type = 'menu_item'
        and not (
          coalesce(parent_product.category_tags, '{}'::text[])
            && array['service', 'option', 'add_on', 'addon']::text[]
          or public.restaurant_menu_name_looks_like_option(parent_menu.canonical_name)
        )
    ) as parent_candidates;

    if v_parent_count <> 1 then
      continue;
    end if;

    select parent_observation.restaurant_menu_id, parent_observation.receipt_item_id
    into v_parent_menu_id, v_parent_receipt_item_id
    from public.restaurant_menu_receipt_observations as parent_observation
    inner join public.restaurant_menus as parent_menu
      on parent_menu.restaurant_id = parent_observation.restaurant_id
      and parent_menu.id = parent_observation.restaurant_menu_id
    inner join public.receipt_items as parent_item
      on parent_item.user_id = parent_observation.owner_user_id
      and parent_item.id = parent_observation.receipt_item_id
      and parent_item.receipt_id = parent_observation.receipt_id
    inner join public.store_products as parent_store_product
      on parent_store_product.user_id = parent_item.user_id
      and parent_store_product.id = parent_item.store_product_id
    inner join public.products as parent_product
      on parent_product.user_id = parent_store_product.user_id
      and parent_product.id = parent_store_product.product_id
    where parent_observation.restaurant_id = v_option.restaurant_id
      and parent_observation.owner_user_id = v_option.owner_user_id
      and parent_observation.receipt_id = v_option.receipt_id
      and parent_observation.verification_status = 'verified'
      and parent_observation.restaurant_menu_id <> v_option.option_menu_id
      and parent_menu.status = 'active'
      and parent_menu.review_status = 'verified'
      and parent_product.purchase_type = 'menu_item'
      and not (
        coalesce(parent_product.category_tags, '{}'::text[])
          && array['service', 'option', 'add_on', 'addon']::text[]
        or public.restaurant_menu_name_looks_like_option(parent_menu.canonical_name)
      )
    order by parent_observation.receipt_item_id
    limit 1;

    insert into public.restaurant_menu_option_links (
      restaurant_id,
      parent_menu_id,
      option_menu_id,
      link_source,
      confidence,
      evidence_snapshot,
      created_by
    ) values (
      v_option.restaurant_id,
      v_parent_menu_id,
      v_option.option_menu_id,
      'automatic',
      0.950,
      jsonb_build_object(
        'schemaVersion', 'restaurant-menu-option-link-evidence.v1',
        'rule', 'option-line-and-single-base-menu-on-receipt',
        'receiptId', v_option.receipt_id,
        'optionReceiptItemId', v_option.option_receipt_item_id,
        'parentReceiptItemId', v_parent_receipt_item_id
      ),
      coalesce(p_created_by, v_option.verified_by)
    )
    on conflict (restaurant_id, option_menu_id) do nothing;

    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
  end loop;

  return v_inserted;
end;
$function$;

comment on function public.auto_link_restaurant_menu_options_for_receipt(uuid, uuid, uuid) is
  'Deterministically links an option line to the only verified non-option menu on the same receipt. It never replaces a prior manual or automatic link.';
revoke all on function public.auto_link_restaurant_menu_options_for_receipt(uuid, uuid, uuid)
  from public, anon, authenticated;

create function public.auto_link_restaurant_menu_options_after_observation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.auto_link_restaurant_menu_options_for_receipt(
    new.restaurant_id,
    new.receipt_id,
    coalesce(auth.uid(), new.verified_by)
  );
  return new;
end;
$function$;

create trigger restaurant_menu_receipt_observations_auto_option_link
after insert on public.restaurant_menu_receipt_observations
for each row execute function public.auto_link_restaurant_menu_options_after_observation();

revoke all on function public.auto_link_restaurant_menu_options_after_observation()
  from public, anon, authenticated;

create function public.admin_auto_link_restaurant_menu_options_v1(
  p_restaurant_id uuid
)
returns table (
  id uuid,
  restaurant_id uuid,
  parent_menu_id uuid,
  option_menu_id uuid,
  link_source text,
  confidence numeric
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_receipt_id uuid;
begin
  if auth.uid() is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  for v_receipt_id in
    select distinct observation.receipt_id
    from public.restaurant_menu_receipt_observations as observation
    where observation.restaurant_id = p_restaurant_id
  loop
    perform public.auto_link_restaurant_menu_options_for_receipt(
      p_restaurant_id,
      v_receipt_id,
      auth.uid()
    );
  end loop;

  return query
  select
    link.id,
    link.restaurant_id,
    link.parent_menu_id,
    link.option_menu_id,
    link.link_source,
    link.confidence
  from public.restaurant_menu_option_links as link
  where link.restaurant_id = p_restaurant_id
  order by link.option_menu_id;
end;
$function$;

comment on function public.admin_auto_link_restaurant_menu_options_v1(uuid) is
  'Admin-only deterministic backfill of option links from already registered verified receipt observations. No historical link is created unless the same receipt has exactly one non-option menu.';
revoke all on function public.admin_auto_link_restaurant_menu_options_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_auto_link_restaurant_menu_options_v1(uuid)
  to authenticated;

create function public.admin_set_restaurant_menu_option_link_v1(
  p_restaurant_id uuid,
  p_parent_menu_id uuid,
  p_option_menu_id uuid
)
returns table (
  id uuid,
  restaurant_id uuid,
  parent_menu_id uuid,
  option_menu_id uuid,
  link_source text,
  confidence numeric
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  if p_restaurant_id is null
    or p_parent_menu_id is null
    or p_option_menu_id is null
    or p_parent_menu_id = p_option_menu_id
  then
    raise exception '서로 다른 부모 메뉴와 옵션 메뉴가 필요합니다.' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.restaurant_menus as menu
    where menu.restaurant_id = p_restaurant_id
      and menu.id = p_parent_menu_id
      and menu.status = 'active'
      and menu.review_status = 'verified'
  ) or not exists (
    select 1
    from public.restaurant_menus as menu
    where menu.restaurant_id = p_restaurant_id
      and menu.id = p_option_menu_id
      and menu.status = 'active'
      and menu.review_status = 'verified'
  ) then
    raise exception '검증된 동일 음식점의 정확한 메뉴 identity만 연결할 수 있습니다.'
      using errcode = '23503';
  end if;

  return query
  insert into public.restaurant_menu_option_links (
    restaurant_id,
    parent_menu_id,
    option_menu_id,
    link_source,
    confidence,
    evidence_snapshot,
    created_by,
    updated_at
  ) values (
    p_restaurant_id,
    p_parent_menu_id,
    p_option_menu_id,
    'manual',
    1.000,
    jsonb_build_object(
      'schemaVersion', 'restaurant-menu-option-link-manual.v1',
      'action', 'administrator-selected-exact-menu-ids'
    ),
    auth.uid(),
    now()
  )
  on conflict (restaurant_id, option_menu_id) do update
  set parent_menu_id = excluded.parent_menu_id,
      link_source = 'manual',
      confidence = 1.000,
      evidence_snapshot = excluded.evidence_snapshot,
      created_by = excluded.created_by,
      updated_at = now()
  returning
    restaurant_menu_option_links.id,
    restaurant_menu_option_links.restaurant_id,
    restaurant_menu_option_links.parent_menu_id,
    restaurant_menu_option_links.option_menu_id,
    restaurant_menu_option_links.link_source,
    restaurant_menu_option_links.confidence;
end;
$function$;

comment on function public.admin_set_restaurant_menu_option_link_v1(uuid, uuid, uuid) is
  'Admin-only exact menu option link. Manual selection replaces an automatic parent for the same option menu.';
revoke all on function public.admin_set_restaurant_menu_option_link_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_restaurant_menu_option_link_v1(uuid, uuid, uuid)
  to authenticated;

create function public.admin_clear_restaurant_menu_option_link_v1(
  p_restaurant_id uuid,
  p_option_menu_id uuid
)
returns table (
  restaurant_id uuid,
  option_menu_id uuid,
  cleared boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  delete from public.restaurant_menu_option_links as link
  where link.restaurant_id = p_restaurant_id
    and link.option_menu_id = p_option_menu_id;

  return query select p_restaurant_id, p_option_menu_id, found;
end;
$function$;

comment on function public.admin_clear_restaurant_menu_option_link_v1(uuid, uuid) is
  'Admin-only removal of one exact restaurant menu option relationship.';
revoke all on function public.admin_clear_restaurant_menu_option_link_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_clear_restaurant_menu_option_link_v1(uuid, uuid)
  to authenticated;

-- Add option relationships to the current public detail contract while keeping
-- older v1 payloads valid through the domain default.
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
      legacy.payload - 'schemaVersion' - 'namespace' - 'revision',
      '{restaurant,category}',
      coalesce(
        public.restaurant_category_document(restaurant.category_id),
        'null'::jsonb
      ),
      true
    ) as document
    from legacy
    inner join public.restaurants as restaurant
      on restaurant.id = p_restaurant_id
    where legacy.payload is not null
  ),
  enriched as (
    select jsonb_set(
      base.document,
      '{optionLinks}',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', link.id,
              'parentMenuId', link.parent_menu_id,
              'optionMenuId', link.option_menu_id,
              'source', link.link_source,
              'confidence', link.confidence
            )
            order by link.option_menu_id
          )
          from public.restaurant_menu_option_links as link
          inner join public.restaurant_menus as parent_menu
            on parent_menu.restaurant_id = link.restaurant_id
            and parent_menu.id = link.parent_menu_id
          inner join public.restaurant_menus as option_menu
            on option_menu.restaurant_id = link.restaurant_id
            and option_menu.id = link.option_menu_id
          where link.restaurant_id = p_restaurant_id
            and parent_menu.status = 'active'
            and parent_menu.review_status = 'verified'
            and option_menu.status = 'active'
            and option_menu.review_status = 'verified'
        ),
        '[]'::jsonb
      ),
      true
    ) as document
    from base_document as base
  )
  select jsonb_build_object(
    'schemaVersion', 'restaurant-detail.v2',
    'namespace', 'pricetrace',
    'revision', 'sha256:' || encode(
      extensions.digest(
        pg_catalog.convert_to(enriched.document::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'restaurant', enriched.document -> 'restaurant',
    'locations', enriched.document -> 'locations',
    'menus', enriched.document -> 'menus',
    'optionLinks', enriched.document -> 'optionLinks'
  )
  from enriched;
$$;

comment on function public.get_restaurant_detail_v2(uuid) is
  'restaurant-detail.v2: verified restaurant detail with exact menu identities and persisted option links.';
revoke all on function public.get_restaurant_detail_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_detail_v2(uuid)
  to anon, authenticated;
