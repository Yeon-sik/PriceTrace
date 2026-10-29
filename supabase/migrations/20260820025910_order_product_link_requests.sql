-- A screenshot remains local. This inbox receives only the minimum product
-- identity needed for an authenticated user to request a shared catalog link.
create table public.order_product_link_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  request_fingerprint text not null check (
    request_fingerprint ~ '^sha256:[a-f0-9]{64}$'
  ),
  request_kind text not null check (
    request_kind in ('link_existing', 'create_variant', 'register_new')
  ),
  platform text not null check (
    platform in ('coupang', 'iherb', 'myprotein', 'naver')
  ),
  source_label text not null check (
    length(btrim(source_label)) between 1 and 100
  ),
  seller_label text check (
    seller_label is null or length(btrim(seller_label)) between 1 and 300
  ),
  source_product_code text check (
    source_product_code is null
    or length(btrim(source_product_code)) between 1 and 128
  ),
  product_name text not null check (
    length(btrim(product_name)) between 1 and 500
  ),
  option_text text check (
    option_text is null or length(btrim(option_text)) between 1 and 500
  ),
  suggested_standard_product_id uuid references public.standard_products(id) on delete restrict,
  suggested_catalog_product_id uuid references public.catalog_products(id) on delete restrict,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'withdrawn')
  ),
  resolved_catalog_product_id uuid references public.catalog_products(id) on delete restrict,
  review_note text check (
    review_note is null or length(review_note) <= 1000
  ),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_request_id),
  unique (user_id, request_fingerprint),
  check (
    (request_kind = 'link_existing' and suggested_catalog_product_id is not null)
    or (
      request_kind = 'create_variant'
      and suggested_standard_product_id is not null
      and suggested_catalog_product_id is null
    )
    or (
      request_kind = 'register_new'
      and suggested_standard_product_id is null
      and suggested_catalog_product_id is null
    )
  ),
  check (
    (status in ('pending', 'withdrawn')
      and resolved_catalog_product_id is null
      and reviewed_by is null
      and reviewed_at is null)
    or (status = 'approved'
      and resolved_catalog_product_id is not null
      and reviewed_by is not null
      and reviewed_at is not null)
    or (status = 'rejected'
      and resolved_catalog_product_id is null
      and reviewed_by is not null
      and reviewed_at is not null)
  )
);

comment on table public.order_product_link_requests is
  'PII-minimized user request inbox for linking an online-order product to the shared exact catalog. Raw screenshots, OCR text, order numbers, dates, prices, and payment data are forbidden by omission.';
comment on column public.order_product_link_requests.source_label is
  'Exact source namespace used together with source_product_code. It is not a product-name inference.';

create index order_product_link_requests_user_created_idx
  on public.order_product_link_requests(user_id, created_at desc);
create index order_product_link_requests_status_created_idx
  on public.order_product_link_requests(status, created_at desc);
create index order_product_link_requests_suggested_standard_idx
  on public.order_product_link_requests(suggested_standard_product_id)
  where suggested_standard_product_id is not null;
create index order_product_link_requests_suggested_catalog_idx
  on public.order_product_link_requests(suggested_catalog_product_id)
  where suggested_catalog_product_id is not null;
create index order_product_link_requests_resolved_catalog_idx
  on public.order_product_link_requests(resolved_catalog_product_id)
  where resolved_catalog_product_id is not null;
create index order_product_link_requests_reviewed_by_idx
  on public.order_product_link_requests(reviewed_by)
  where reviewed_by is not null;

alter table public.order_product_link_requests enable row level security;

revoke all on table public.order_product_link_requests from public, anon, authenticated;
grant select, insert on table public.order_product_link_requests to authenticated;
grant update (status) on table public.order_product_link_requests to authenticated;

create policy "users read their order product link requests"
  on public.order_product_link_requests
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "admins read all order product link requests"
  on public.order_product_link_requests
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "users create their order product link requests"
  on public.order_product_link_requests
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and resolved_catalog_product_id is null
    and review_note is null
    and reviewed_by is null
    and reviewed_at is null
  );

create policy "users withdraw their pending order product link requests"
  on public.order_product_link_requests
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and status = 'pending'
  )
  with check (
    (select auth.uid()) = user_id
    and status = 'withdrawn'
    and resolved_catalog_product_id is null
    and review_note is null
    and reviewed_by is null
    and reviewed_at is null
  );

create function public.set_order_product_link_request_updated_at_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_order_product_link_request_updated_at_v1
before update on public.order_product_link_requests
for each row execute function public.set_order_product_link_request_updated_at_v1();

revoke all on function public.set_order_product_link_request_updated_at_v1()
  from public, anon, authenticated;

create function public.admin_review_order_product_link_request_v1(
  p_request_id uuid,
  p_decision text,
  p_resolved_catalog_product_id uuid default null,
  p_review_note text default null
)
returns table (
  request_id uuid,
  request_status text,
  catalog_product_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.order_product_link_requests%rowtype;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected')
    or (p_review_note is not null and length(p_review_note) > 1000)
  then
    raise exception 'A supported decision and review note are required.'
      using errcode = '23514';
  end if;

  select request.*
  into v_request
  from public.order_product_link_requests as request
  where request.id = p_request_id
  for update;

  if not found
  then
    raise exception 'The product link request does not exist.'
      using errcode = '23503';
  end if;

  if v_request.status <> 'pending'
  then
    raise exception 'Only a pending product link request can be reviewed.'
      using errcode = '23514';
  end if;

  if p_decision = 'approved'
  then
    if p_resolved_catalog_product_id is null
      or v_request.source_product_code is null
      or not exists (
        select 1
        from public.catalog_products as catalog
        inner join public.standard_products as standard
          on standard.id = catalog.standard_product_id
        where catalog.id = p_resolved_catalog_product_id
          and catalog.status = 'active'
          and standard.status = 'active'
      )
      or not exists (
        select 1
        from public.source_product_mappings as mapping
        where mapping.source_label = v_request.source_label
          and mapping.source_product_code = v_request.source_product_code
          and mapping.catalog_product_id = p_resolved_catalog_product_id
          and mapping.review_status = 'verified'
      )
    then
      raise exception 'Approval requires an existing verified source identity to exact-catalog mapping.'
        using errcode = '23514';
    end if;
  elsif p_resolved_catalog_product_id is not null
  then
    raise exception 'A rejected request cannot resolve to a catalog product.'
      using errcode = '23514';
  end if;

  update public.order_product_link_requests
  set
    status = p_decision,
    resolved_catalog_product_id = case
      when p_decision = 'approved' then p_resolved_catalog_product_id
      else null
    end,
    review_note = nullif(btrim(p_review_note), ''),
    reviewed_by = v_user_id,
    reviewed_at = now()
  where id = p_request_id;

  return query
  select
    p_request_id,
    p_decision,
    case when p_decision = 'approved' then p_resolved_catalog_product_id else null end;
end;
$$;

comment on function public.admin_review_order_product_link_request_v1(uuid, text, uuid, text) is
  'Approves only after an admin has established a verified source_label plus source_product_code mapping to the exact catalog product. It never creates a mapping from a name match.';

revoke all on function public.admin_review_order_product_link_request_v1(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_review_order_product_link_request_v1(uuid, text, uuid, text)
  to authenticated;
