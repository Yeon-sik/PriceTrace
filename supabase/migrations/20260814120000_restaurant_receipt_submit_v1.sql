-- The OCR app submits only user-verified restaurant facts. Images, OCR text,
-- payment details, and the local receipt JSON remain on the device.

create table public.restaurant_receipt_submission_requests (
  idempotency_key text primary key
    check (length(btrim(idempotency_key)) between 1 and 200),
  request_fingerprint text not null
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  receipt_id uuid not null references public.receipts(id) on delete restrict,
  item_count integer not null check (item_count > 0),
  created_at timestamptz not null default now()
);

alter table public.restaurant_receipt_submission_requests enable row level security;
revoke all on public.restaurant_receipt_submission_requests from public, anon, authenticated;

create or replace function public.submit_restaurant_receipt_v1(
  p_idempotency_key text,
  p_document_id text,
  p_restaurant_name text,
  p_branch_name text,
  p_observed_on date,
  p_total_price_krw integer,
  p_items jsonb
)
returns table (
  receipt_id uuid,
  replayed boolean,
  item_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_fingerprint text;
  v_existing public.restaurant_receipt_submission_requests%rowtype;
  v_store_id uuid;
  v_receipt_id uuid;
  v_item_count integer;
  v_items_total_price_krw integer := 0;
  v_item record;
  v_product_id uuid;
  v_store_product_id uuid;
  v_receipt_item_id text;
  v_index integer := 0;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) not between 1 and 200 then
    raise exception 'idempotency key must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_document_id, ''))) not between 1 and 200 then
    raise exception 'document id must contain 1 to 200 characters' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_restaurant_name, ''))) not between 1 and 500 then
    raise exception 'restaurant name is required' using errcode = '22023';
  end if;
  if p_total_price_krw is null or p_total_price_krw < 0 then
    raise exception 'restaurant receipt total must be non-negative' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'restaurant receipt items must be a JSON array' using errcode = '22023';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 200 then
    raise exception 'restaurant receipt must contain 1 to 200 items' using errcode = '22023';
  end if;

  v_fingerprint := encode(
    extensions.digest(
      jsonb_build_object(
        'document_id', p_document_id,
        'restaurant_name', btrim(p_restaurant_name),
        'branch_name', nullif(btrim(coalesce(p_branch_name, '')), ''),
        'observed_on', p_observed_on,
        'total_price_krw', p_total_price_krw,
        'items', p_items
      )::text,
      'sha256'
    ),
    'hex'
  );

  select * into v_existing
  from public.restaurant_receipt_submission_requests
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception 'idempotency key mismatch' using errcode = '23505';
    end if;
    return query select v_existing.receipt_id, true, v_existing.item_count;
    return;
  end if;

  for v_item in
    select * from jsonb_to_recordset(p_items) as item(
      line_id text,
      description text,
      quantity integer,
      unit_price_krw integer,
      total_price_krw integer,
      line_type text
    )
  loop
    if length(btrim(coalesce(v_item.line_id, ''))) not between 1 and 200
       or length(btrim(coalesce(v_item.description, ''))) not between 1 and 500
       or v_item.quantity is null or v_item.quantity <= 0
       or v_item.unit_price_krw is null or v_item.unit_price_krw < 0
       or v_item.total_price_krw is null
       or v_item.total_price_krw <> v_item.unit_price_krw * v_item.quantity
       or length(btrim(coalesce(v_item.line_type, ''))) = 0
    then
      raise exception 'restaurant receipt item is invalid' using errcode = '22023';
    end if;
    v_items_total_price_krw := v_items_total_price_krw + v_item.total_price_krw;
  end loop;

  -- A user-verified receipt is not accepted when its line totals do not
  -- reconcile to the declared grand total. Discounts/tax/service charges are
  -- intentionally unsupported by this v1 payload; a later contract must add
  -- explicit fields instead of silently absorbing the difference.
  if v_items_total_price_krw <> p_total_price_krw then
    raise exception 'restaurant receipt item total mismatch' using errcode = '23514';
  end if;

  insert into public.stores (user_id, name, merchant_name, branch_name, business_kind)
  values (
    v_user_id,
    btrim(p_restaurant_name),
    btrim(p_restaurant_name),
    nullif(btrim(coalesce(p_branch_name, '')), ''),
    'food_service'
  )
  on conflict (user_id, name) do update set
    merchant_name = excluded.merchant_name,
    branch_name = coalesce(excluded.branch_name, public.stores.branch_name),
    business_kind = 'food_service'
  returning id into v_store_id;

  insert into public.receipts (
    user_id, store_id, purchased_at, transaction_number, currency, total_price_krw
  ) values (
    v_user_id,
    v_store_id,
    p_observed_on,
    'ocr-restaurant:' || btrim(p_idempotency_key),
    'KRW',
    p_total_price_krw
  ) returning id into v_receipt_id;

  for v_item in
    select row_number() over ()::integer as item_index, *
    from jsonb_to_recordset(p_items) as item(
      line_id text,
      description text,
      quantity integer,
      unit_price_krw integer,
      total_price_krw integer,
      line_type text
    )
  loop
    v_index := v_item.item_index;
    insert into public.products (user_id, name, purchase_type, category_tags)
    values (v_user_id, btrim(v_item.description), 'menu_item', array[btrim(v_item.line_type)])
    on conflict (user_id, name) do update set
      purchase_type = 'menu_item';
    select id into v_product_id
    from public.products
    where user_id = v_user_id and name = btrim(v_item.description);

    select id into v_store_product_id
    from public.store_products
    where user_id = v_user_id
      and store_id = v_store_id
      and product_id = v_product_id
      and store_product_code is null
    limit 1;
    if v_store_product_id is null then
      insert into public.store_products (user_id, store_id, product_id, store_product_code)
      values (v_user_id, v_store_id, v_product_id, null)
      returning id into v_store_product_id;
    end if;

    v_receipt_item_id := encode(
      extensions.digest(p_document_id || ':' || p_idempotency_key || ':' || v_item.line_id, 'sha256'),
      'hex'
    );
    insert into public.receipt_items (
      id, user_id, receipt_id, store_product_id, unit_price_krw,
      purchased_quantity, total_price_krw, purchase_numbers
    ) values (
      v_receipt_item_id,
      v_user_id,
      v_receipt_id,
      v_store_product_id,
      v_item.unit_price_krw,
      v_item.quantity,
      v_item.total_price_krw,
      array[v_index]
    );
    insert into public.price_observations (
      user_id, store_product_id, receipt_item_id, observed_at,
      unit_price_krw, quantity, catalog_product_id, measurement_unit,
      location_label, verification_status, verified_at
    ) values (
      v_user_id,
      v_store_product_id,
      v_receipt_item_id,
      p_observed_on,
      v_item.unit_price_krw,
      v_item.quantity,
      null,
      'each',
      coalesce(nullif(btrim(p_branch_name), ''), btrim(p_restaurant_name)),
      'verified',
      now()
    );
  end loop;

  insert into public.restaurant_receipt_submission_requests (
    idempotency_key, request_fingerprint, receipt_id, item_count
  ) values (btrim(p_idempotency_key), v_fingerprint, v_receipt_id, v_item_count);

  return query select v_receipt_id, false, v_item_count;
end;
$$;

comment on function public.submit_restaurant_receipt_v1(text, text, text, text, date, integer, jsonb) is
  'Atomically stores user-verified restaurant name, date, menu prices, and option rows without uploading images or OCR text.';

revoke all on function public.submit_restaurant_receipt_v1(text, text, text, text, date, integer, jsonb)
  from public, anon;
grant execute on function public.submit_restaurant_receipt_v1(text, text, text, text, date, integer, jsonb)
  to authenticated;
