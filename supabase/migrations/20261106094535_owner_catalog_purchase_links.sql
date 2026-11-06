-- Connect an existing, immutable OCR purchase line to a catalog variant for its owner.
create table public.owner_catalog_purchase_links (
  user_id uuid not null,
  purchase_source_line_id uuid not null,
  catalog_product_id uuid not null references public.catalog_products(id) on delete restrict,
  connected_at timestamptz not null default now(),
  primary key (user_id, purchase_source_line_id),
  foreign key (user_id, purchase_source_line_id)
    references public.purchase_price_source_lines(user_id, id) on delete cascade
);

alter table public.owner_catalog_purchase_links enable row level security;
revoke all on public.owner_catalog_purchase_links from public, anon, authenticated;
create index owner_catalog_purchase_links_catalog_idx
  on public.owner_catalog_purchase_links(catalog_product_id, user_id);

create function public.get_my_catalog_purchase_context_v1(
  p_catalog_product_ids uuid[], p_query text default null
)
returns table (
  purchase_source_line_id uuid,
  catalog_product_id uuid,
  product_client_key text,
  product_name text,
  option_text text,
  quantity integer,
  platform_name text,
  seller_name text,
  ordered_on date,
  paid_on date,
  unit_price_krw integer,
  item_net_price_krw integer,
  order_total_krw integer,
  order_line_count integer,
  owner_connected boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with context as (
    select
      line.id as line_id, coalesce(line.catalog_product_id, link.catalog_product_id) as catalog_id,
      line.product_client_key, line.product_name, line.option_text, line.quantity, source.platform_name,
      line.line_seller_name as seller_name,
      source.ordered_on, source.paid_on,
      case when line.price_status = 'itemized' then line.unit_price_krw end as unit_price,
      case when line.price_status = 'itemized' then line.net_price_krw end as net_price,
      source.payment_total_price_krw as order_total,
      (count(*) over (partition by source.id))::integer as order_line_count,
      line.catalog_product_id is null and link.catalog_product_id is not null as owner_connected,
      source.created_at,
      nullif(pg_catalog.btrim(p_query), '') as query
    from public.purchase_price_source_lines as line
    join public.purchase_price_sources as source
      on source.id = line.purchase_source_id and source.user_id = line.user_id
    left join public.owner_catalog_purchase_links as link
      on link.user_id = line.user_id and link.purchase_source_line_id = line.id
    where line.user_id = (select auth.uid()) and source.purchase_kind = 'retail'
      and source.transaction_state = 'settled'
      and pg_catalog.cardinality(p_catalog_product_ids) between 1 and 50
  ), matching as (
    select context.*, row_number() over (
      partition by catalog_id
      order by coalesce(paid_on, ordered_on) desc nulls last, created_at desc, line_id
    ) as position
    from context
    where (query is null and catalog_id = any(p_catalog_product_ids))
       or (query is not null and pg_catalog.length(query) <= 200 and catalog_id is null
         and pg_catalog.cardinality(p_catalog_product_ids) = 1
         and pg_catalog.strpos(pg_catalog.lower(product_name), pg_catalog.lower(query)) > 0)
  )
  select line_id, catalog_id, product_client_key, product_name, option_text, quantity, platform_name,
    seller_name, ordered_on, paid_on, unit_price, net_price, order_total, order_line_count, owner_connected
  from matching
  where position <= 20
  order by coalesce(paid_on, ordered_on) desc nulls last, created_at desc, line_id;
$$;

create function public.set_my_catalog_purchase_link_v1(
  p_catalog_product_id uuid, p_purchase_source_line_id uuid, p_connected boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_original_catalog_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;
  if p_connected is null or p_catalog_product_id is null then
    raise exception 'An exact product and connection action are required.' using errcode = '22023';
  end if;

  select line.catalog_product_id into v_original_catalog_id
  from public.purchase_price_source_lines as line
  join public.purchase_price_sources as source
    on source.id = line.purchase_source_id and source.user_id = line.user_id
  where line.id = p_purchase_source_line_id and line.user_id = v_actor
    and source.purchase_kind = 'retail' and source.transaction_state = 'settled';
  if not found then
    raise exception 'This purchase record is unavailable to this account.' using errcode = '42501';
  end if;

  if not p_connected then
    delete from public.owner_catalog_purchase_links
    where user_id = v_actor and purchase_source_line_id = p_purchase_source_line_id
      and catalog_product_id = p_catalog_product_id;
    return false;
  end if;

  if not exists (
    select 1 from public.catalog_products as catalog
    join public.standard_products as standard on standard.id = catalog.standard_product_id
    where catalog.id = p_catalog_product_id and catalog.purchase_type = 'retail_product'
      and catalog.status = 'active' and standard.status = 'active'
      and catalog.verification_status = 'verified' and standard.verification_status = 'verified'
      and catalog.specification_status = 'verified'
  ) then
    raise exception 'An active, verified exact product is required.' using errcode = '22023';
  end if;

  if v_original_catalog_id is not null then
    if v_original_catalog_id = p_catalog_product_id then return true; end if;
    raise exception 'This purchase already identifies another product.' using errcode = '23505';
  end if;

  insert into public.owner_catalog_purchase_links (user_id, purchase_source_line_id, catalog_product_id)
  values (v_actor, p_purchase_source_line_id, p_catalog_product_id)
  on conflict (user_id, purchase_source_line_id) do nothing;
  if not exists (
    select 1 from public.owner_catalog_purchase_links
    where user_id = v_actor and purchase_source_line_id = p_purchase_source_line_id
      and catalog_product_id = p_catalog_product_id
  ) then
    raise exception 'This purchase is connected to another product.' using errcode = '23505';
  end if;
  return true;
end;
$$;

revoke all on function public.get_my_catalog_purchase_context_v1(uuid[], text) from public, anon, authenticated;
grant execute on function public.get_my_catalog_purchase_context_v1(uuid[], text) to authenticated;
revoke all on function public.set_my_catalog_purchase_link_v1(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_my_catalog_purchase_link_v1(uuid, uuid, boolean) to authenticated;

comment on function public.get_my_catalog_purchase_context_v1(uuid[], text) is
  'Owner-only OCR purchase context. Unit display price, item net price, and order payment are separate source facts.';
comment on function public.set_my_catalog_purchase_link_v1(uuid, uuid, boolean) is
  'Owner-confirmed connection from an immutable OCR retail purchase line to an exact product.';
