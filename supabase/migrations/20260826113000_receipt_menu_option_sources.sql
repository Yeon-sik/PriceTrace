-- Preserve a receipt.v2 extractor's unambiguous option-to-main relationship
-- until both exact restaurant menus have passed administrator registration.
-- A side remains a distinct menu and is never an option parent candidate.

create table public.receipt_item_menu_option_sources (
  option_receipt_item_id text primary key references public.receipt_items(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id uuid not null,
  parent_receipt_item_id text not null,
  source text not null check (source in ('receipt_v2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (option_receipt_item_id <> parent_receipt_item_id),
  foreign key (user_id, receipt_id) references public.receipts(user_id, id) on delete cascade,
  foreign key (user_id, option_receipt_item_id) references public.receipt_items(user_id, id) on delete cascade,
  foreign key (user_id, parent_receipt_item_id) references public.receipt_items(user_id, id) on delete restrict
);

comment on table public.receipt_item_menu_option_sources is
  'User-owned, source-line relationship from a receipt.v2 option to its unambiguous main menu. It is not a catalog identity or a price rollup.';

alter table public.receipt_item_menu_option_sources enable row level security;
revoke all on public.receipt_item_menu_option_sources from public, anon, authenticated;
grant select, insert, update on public.receipt_item_menu_option_sources to authenticated;

create policy "receipt option sources own rows" on public.receipt_item_menu_option_sources
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create function public.validate_receipt_item_menu_option_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_option_receipt_id uuid;
  v_parent_receipt_id uuid;
begin
  select receipt_id into v_option_receipt_id
  from public.receipt_items
  where user_id = new.user_id and id = new.option_receipt_item_id;

  select receipt_id into v_parent_receipt_id
  from public.receipt_items
  where user_id = new.user_id and id = new.parent_receipt_item_id;

  if v_option_receipt_id is null
     or v_parent_receipt_id is null
     or v_option_receipt_id <> new.receipt_id
     or v_parent_receipt_id <> new.receipt_id then
    raise exception 'option source items must belong to the declared user receipt' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger receipt_item_menu_option_sources_validate
before insert or update on public.receipt_item_menu_option_sources
for each row execute function public.validate_receipt_item_menu_option_source();

revoke all on function public.validate_receipt_item_menu_option_source() from public, anon, authenticated;

create or replace function public.auto_link_restaurant_menu_options_for_receipt(
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
  v_explicit_parent_receipt_item_id text;
  v_link_rule text;
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
    v_explicit_parent_receipt_item_id := null;
    v_link_rule := null;

    select source.parent_receipt_item_id into v_explicit_parent_receipt_item_id
    from public.receipt_item_menu_option_sources as source
    where source.user_id = v_option.owner_user_id
      and source.receipt_id = v_option.receipt_id
      and source.option_receipt_item_id = v_option.option_receipt_item_id;

    if found then
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
        and parent_observation.receipt_item_id = v_explicit_parent_receipt_item_id
        and parent_observation.verification_status = 'verified'
        and parent_menu.status = 'active'
        and parent_menu.review_status = 'verified'
        and parent_product.purchase_type = 'menu_item'
        and not (coalesce(parent_product.category_tags, '{}'::text[]) && array['service', 'option', 'add_on', 'addon', 'side']::text[]
          or public.restaurant_menu_name_looks_like_option(parent_menu.canonical_name));

      if v_parent_menu_id is null then
        continue;
      end if;
      v_link_rule := 'receipt-v2-explicit-option-parent';
    else
      select count(*) into v_parent_count from (
        select distinct parent_observation.restaurant_menu_id
        from public.restaurant_menu_receipt_observations as parent_observation
        inner join public.restaurant_menus as parent_menu on parent_menu.restaurant_id = parent_observation.restaurant_id and parent_menu.id = parent_observation.restaurant_menu_id
        inner join public.receipt_items as parent_item on parent_item.user_id = parent_observation.owner_user_id and parent_item.id = parent_observation.receipt_item_id and parent_item.receipt_id = parent_observation.receipt_id
        inner join public.store_products as parent_store_product on parent_store_product.user_id = parent_item.user_id and parent_store_product.id = parent_item.store_product_id
        inner join public.products as parent_product on parent_product.user_id = parent_store_product.user_id and parent_product.id = parent_store_product.product_id
        where parent_observation.restaurant_id = v_option.restaurant_id
          and parent_observation.owner_user_id = v_option.owner_user_id
          and parent_observation.receipt_id = v_option.receipt_id
          and parent_observation.verification_status = 'verified'
          and parent_observation.restaurant_menu_id <> v_option.option_menu_id
          and parent_menu.status = 'active' and parent_menu.review_status = 'verified'
          and parent_product.purchase_type = 'menu_item'
          and not (coalesce(parent_product.category_tags, '{}'::text[]) && array['service', 'option', 'add_on', 'addon', 'side']::text[]
            or public.restaurant_menu_name_looks_like_option(parent_menu.canonical_name))
      ) as parent_candidates;
      if v_parent_count <> 1 then
        continue;
      end if;

      select parent_observation.restaurant_menu_id, parent_observation.receipt_item_id
      into v_parent_menu_id, v_parent_receipt_item_id
      from public.restaurant_menu_receipt_observations as parent_observation
      inner join public.restaurant_menus as parent_menu on parent_menu.restaurant_id = parent_observation.restaurant_id and parent_menu.id = parent_observation.restaurant_menu_id
      inner join public.receipt_items as parent_item on parent_item.user_id = parent_observation.owner_user_id and parent_item.id = parent_observation.receipt_item_id and parent_item.receipt_id = parent_observation.receipt_id
      inner join public.store_products as parent_store_product on parent_store_product.user_id = parent_item.user_id and parent_store_product.id = parent_item.store_product_id
      inner join public.products as parent_product on parent_product.user_id = parent_store_product.user_id and parent_product.id = parent_store_product.product_id
      where parent_observation.restaurant_id = v_option.restaurant_id
        and parent_observation.owner_user_id = v_option.owner_user_id
        and parent_observation.receipt_id = v_option.receipt_id
        and parent_observation.verification_status = 'verified'
        and parent_observation.restaurant_menu_id <> v_option.option_menu_id
        and parent_menu.status = 'active' and parent_menu.review_status = 'verified'
        and parent_product.purchase_type = 'menu_item'
        and not (coalesce(parent_product.category_tags, '{}'::text[]) && array['service', 'option', 'add_on', 'addon', 'side']::text[]
          or public.restaurant_menu_name_looks_like_option(parent_menu.canonical_name))
      order by parent_observation.receipt_item_id
      limit 1;
      v_link_rule := 'option-line-and-single-base-menu-on-receipt';
    end if;

    insert into public.restaurant_menu_option_links (
      restaurant_id, parent_menu_id, option_menu_id, link_source, confidence, evidence_snapshot, created_by
    ) values (
      v_option.restaurant_id, v_parent_menu_id, v_option.option_menu_id, 'automatic', 0.950,
      jsonb_build_object(
        'schemaVersion', 'restaurant-menu-option-link-evidence.v1',
        'rule', v_link_rule,
        'receiptId', v_option.receipt_id,
        'optionReceiptItemId', v_option.option_receipt_item_id,
        'parentReceiptItemId', v_parent_receipt_item_id
      ), coalesce(p_created_by, v_option.verified_by)
    ) on conflict (restaurant_id, option_menu_id) do nothing;

    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;
  end loop;
  return v_inserted;
end;
$function$;

comment on function public.auto_link_restaurant_menu_options_for_receipt(uuid, uuid, uuid) is
  'Links a verified option only to an exact receipt.v2 parent when supplied; otherwise it requires exactly one verified non-option, non-side menu on the same receipt.';
