-- Receipt merchant SKUs and official-channel product codes belong to different
-- namespaces. Patch the internal V3 validator so both identities remain frozen
-- without incorrectly requiring their raw codes to be equal. Keep the client
-- and database exact-name rule identical: remove ASCII spaces only.
do $migration$
declare
  v_signature regprocedure :=
    'public.register_standard_product_link_strict_v3(text,text,text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_definition text;
  v_original_definition text;
begin
  select pg_get_functiondef(v_signature)
  into v_definition;
  v_original_definition := v_definition;

  v_definition := replace(
    v_definition,
    'or coalesce(v_official ->> ''sourceProductCode'', '''') <> btrim(p_source_product_code)',
    'or coalesce(v_official ->> ''sourceProductCode'', '''') = '''''
  );
  v_definition := replace(
    v_definition,
    '''remove_unicode_whitespace_only''',
    '''remove_ascii_space_only'''
  );
  v_definition := replace(
    v_definition,
    'regexp_replace(p_receipt_product_name, ''[[:space:]]+'', '''', ''g'')',
    'replace(p_receipt_product_name, '' '', '''')'
  );
  v_definition := replace(
    v_definition,
    'regexp_replace(p_listing_name, ''[[:space:]]+'', '''', ''g'')',
    'replace(p_listing_name, '' '', '''')'
  );

  if v_definition = v_original_definition
    or position(
      'coalesce(v_official ->> ''sourceProductCode'', '''') = '''''
      in v_definition
    ) = 0
    or position('''remove_ascii_space_only''' in v_definition) = 0
  then
    raise exception 'The strict V3 function did not match the expected patch contract.';
  end if;

  execute v_definition;
end;
$migration$;

create table public.standard_product_link_approvals (
  id uuid primary key default gen_random_uuid(),
  case_id text not null check (length(btrim(case_id)) > 0),
  input_fingerprint text not null check (input_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  target_fingerprint text not null unique check (target_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  approval_statement text not null,
  approval_policy text not null check (
    approval_policy = 'authenticated_admin_explicit_second_step'
  ),
  proposal_input jsonb not null,
  proposal_target jsonb not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  consumed_execution_id uuid unique references public.standard_product_link_executions(id) on delete restrict,
  consumed_at timestamptz
);

alter table public.standard_product_link_approvals enable row level security;

grant select on public.standard_product_link_approvals to authenticated;

create policy "admins read standard product link approvals"
  on public.standard_product_link_approvals for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table public.standard_catalog_admin_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in (
    'update_standard_name',
    'update_catalog_variant',
    'delete_catalog_variant',
    'update_source_mapping',
    'delete_source_mapping',
    'record_coupang_price'
  )),
  target_id uuid not null,
  payload jsonb not null,
  confirmation text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.standard_catalog_admin_actions enable row level security;

grant select on public.standard_catalog_admin_actions to authenticated;

create policy "admins read standard catalog actions"
  on public.standard_catalog_admin_actions for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create function public.admin_manage_standard_catalog(
  p_action text,
  p_target_id uuid,
  p_payload jsonb,
  p_confirmation text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_action_id uuid;
  v_standard_product_id uuid;
  v_content_unit text;
  v_max_bundle_quantity integer;
  v_max_bundle_price integer;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if p_action not in (
    'update_standard_name',
    'update_catalog_variant',
    'delete_catalog_variant',
    'update_source_mapping',
    'delete_source_mapping',
    'record_coupang_price'
  )
    or p_target_id is null
    or coalesce(jsonb_typeof(p_payload), '') <> 'object'
    or p_confirmation <> 'CONFIRM_STANDARD_CATALOG_ACTION:' || p_action || ':' || p_target_id::text
  then
    raise exception 'A supported action, target, payload, and exact confirmation are required.'
      using errcode = '23514';
  end if;

  if p_action = 'update_standard_name'
  then
    if coalesce(length(btrim(p_payload ->> 'canonicalName')), 0) = 0
    then
      raise exception 'A canonical standard product name is required.'
        using errcode = '23514';
    end if;
    update public.standard_products
    set
      canonical_name = btrim(p_payload ->> 'canonicalName'),
      updated_at = now()
    where id = p_target_id
      and status = 'active';

  elsif p_action = 'update_catalog_variant'
  then
    if coalesce(length(btrim(p_payload ->> 'canonicalName')), 0) = 0
      or coalesce(p_payload ->> 'specificationStatus', '') not in ('verified', 'placeholder')
      or coalesce((p_payload ->> 'contentAmount')::numeric, 0) <= 0
      or coalesce(p_payload ->> 'contentUnit', '') not in ('g', 'ml', 'each')
      or coalesce((p_payload ->> 'packageCount')::integer, 0) <= 0
      or coalesce((p_payload ->> 'referenceUnit')::integer, 0) not in (10, 100, 1000)
      or coalesce(p_payload ->> 'listingReferenceUrl', '') !~ '^https?://'
    then
      raise exception 'A complete catalog variant payload is required.'
        using errcode = '23514';
    end if;
    update public.catalog_products
    set
      canonical_name = btrim(p_payload ->> 'canonicalName'),
      specification = nullif(btrim(p_payload ->> 'specification'), ''),
      specification_status = p_payload ->> 'specificationStatus',
      content_amount = (p_payload ->> 'contentAmount')::numeric,
      content_unit = p_payload ->> 'contentUnit',
      package_count = (p_payload ->> 'packageCount')::integer,
      reference_unit = (p_payload ->> 'referenceUnit')::integer,
      listing_reference_url = p_payload ->> 'listingReferenceUrl',
      updated_at = now()
    where id = p_target_id
      and status = 'active';

  elsif p_action = 'delete_catalog_variant'
  then
    delete from public.catalog_products
    where id = p_target_id;

  elsif p_action = 'update_source_mapping'
  then
    if coalesce(length(btrim(p_payload ->> 'sourceLabel')), 0) = 0
      or coalesce(length(btrim(p_payload ->> 'sourceProductCode')), 0) = 0
    then
      raise exception 'A source label and product code are required.'
        using errcode = '23514';
    end if;
    update public.source_product_mappings
    set
      source_label = btrim(p_payload ->> 'sourceLabel'),
      source_product_code = btrim(p_payload ->> 'sourceProductCode'),
      reviewed_by = v_user_id,
      reviewed_at = now(),
      updated_at = now()
    where id = p_target_id;

  elsif p_action = 'delete_source_mapping'
  then
    delete from public.source_product_mappings
    where id = p_target_id;

  elsif p_action = 'record_coupang_price'
  then
    select catalog.standard_product_id
    into v_standard_product_id
    from public.catalog_products as catalog
    where catalog.id = p_target_id
      and catalog.status = 'active';

    v_content_unit := p_payload ->> 'contentUnit';
    v_max_bundle_quantity := (p_payload ->> 'maxBundleQuantity')::integer;
    v_max_bundle_price := (p_payload ->> 'maxBundleListedPriceKrw')::integer;

    if v_standard_product_id is null
      or coalesce(p_payload ->> 'productUrl', '') !~ '^https?://'
      or coalesce((p_payload ->> 'listedPriceKrw')::integer, 0) <= 0
      or coalesce((p_payload ->> 'quantity')::integer, 0) <= 0
      or coalesce((p_payload ->> 'contentAmount')::numeric, 0) <= 0
      or coalesce(v_content_unit, '') not in ('g', 'ml', 'each')
      or (v_max_bundle_quantity is null) <> (v_max_bundle_price is null)
      or (
        v_max_bundle_quantity is not null
        and (v_max_bundle_quantity <= 1 or v_max_bundle_price <= 0)
      )
    then
      raise exception 'A complete exact-variant Coupang observation is required.'
        using errcode = '23514';
    end if;

    insert into public.standard_product_coupang_prices (
      standard_product_id,
      catalog_product_id,
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
      p_target_id,
      p_payload ->> 'productUrl',
      (p_payload ->> 'listedPriceKrw')::integer,
      (p_payload ->> 'quantity')::integer,
      (p_payload ->> 'contentAmount')::numeric,
      v_content_unit,
      v_max_bundle_quantity,
      v_max_bundle_price,
      now(),
      v_user_id
    );
  end if;

  if not found
  then
    raise exception 'The requested catalog target does not exist.'
      using errcode = '23503';
  end if;

  insert into public.standard_catalog_admin_actions (
    action,
    target_id,
    payload,
    confirmation,
    created_by
  )
  values (
    p_action,
    p_target_id,
    p_payload,
    p_confirmation,
    v_user_id
  )
  returning id into v_action_id;

  return v_action_id;
end;
$$;

create function public.approve_and_register_standard_product_link_strict_v4(
  p_idempotency_key text,
  p_case_id text,
  p_input_fingerprint text,
  p_target_fingerprint text,
  p_input_canonical_json text,
  p_target_canonical_json text,
  p_approval_statement text,
  p_receipt_id text,
  p_receipt_item_id text,
  p_receipt_observed_at timestamptz,
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
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_input jsonb;
  v_target jsonb;
  v_approval_id uuid;
  v_approval record;
  v_registered record;
  v_brand_id uuid;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  begin
    v_input := p_input_canonical_json::jsonb;
    v_target := p_target_canonical_json::jsonb;
  exception
    when others then
      raise exception 'Canonical proposal JSON is invalid.'
        using errcode = '22023';
  end;

  if coalesce(v_target -> 'approvalPolicy' ->> 'mode', '')
      <> 'authenticated_admin_explicit_second_step'
    or coalesce(v_target -> 'approvalPolicy' ->> 'requiredStatementPrefix', '')
      <> 'APPROVE_STANDARD_PRODUCT_LINK'
    or coalesce(
      (v_target -> 'approvalPolicy' ->> 'oneTimeTargetFingerprint')::boolean,
      false
    ) is not true
    or p_approval_statement
      <> 'APPROVE_STANDARD_PRODUCT_LINK:' || p_target_fingerprint
  then
    raise exception 'An explicit item-specific approval statement is required.'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'standard-link-approval:' || p_target_fingerprint,
      0
    )
  );

  select *
  into v_approval
  from public.standard_product_link_approvals as approval
  where approval.target_fingerprint = p_target_fingerprint
  for update;

  if found
  then
    if v_approval.case_id <> btrim(p_case_id)
      or v_approval.input_fingerprint <> p_input_fingerprint
      or v_approval.approval_statement <> p_approval_statement
      or v_approval.proposal_input <> v_input
      or v_approval.proposal_target <> v_target
      or v_approval.approved_by <> v_user_id
    then
      raise exception 'The target fingerprint belongs to another approval.'
        using errcode = '23505';
    end if;
    v_approval_id := v_approval.id;
  else
    insert into public.standard_product_link_approvals (
      case_id,
      input_fingerprint,
      target_fingerprint,
      approval_statement,
      approval_policy,
      proposal_input,
      proposal_target,
      approved_by
    )
    values (
      btrim(p_case_id),
      p_input_fingerprint,
      p_target_fingerprint,
      p_approval_statement,
      'authenticated_admin_explicit_second_step',
      v_input,
      v_target,
      v_user_id
    )
    returning id into v_approval_id;
  end if;

  select *
  into v_registered
  from public.register_standard_product_link_strict_v3(
    p_idempotency_key,
    p_case_id,
    p_input_fingerprint,
    p_target_fingerprint,
    p_input_canonical_json,
    p_target_canonical_json,
    p_receipt_id,
    p_receipt_item_id,
    p_receipt_observed_at,
    p_standard_product_id,
    p_catalog_product_id,
    p_standard_name,
    p_brand_name,
    p_receipt_brand_name,
    p_official_brand_name,
    p_official_brand_source_label,
    p_product_reference_url,
    p_listing_name,
    p_receipt_product_name,
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
  );

  select standard.brand_id
  into v_brand_id
  from public.standard_products as standard
  where standard.id = v_registered.standard_product_id
    and standard.status = 'active';

  if v_brand_id is null
    or not exists (
      select 1
      from public.brands as brand
      where brand.id = v_brand_id
        and brand.status = 'active'
        and brand.normalized_name = public.normalize_brand_name(p_brand_name)
    )
    or not exists (
      select 1
      from public.standard_product_brand_evidence as evidence
      where evidence.standard_product_id = v_registered.standard_product_id
        and evidence.catalog_product_id = v_registered.catalog_product_id
        and evidence.brand_id = v_brand_id
        and evidence.source_type = 'official_store'
        and evidence.observed_name = btrim(p_official_brand_name)
        and evidence.source_label = btrim(p_official_brand_source_label)
        and evidence.source_url = p_product_reference_url
    )
    or (
      length(public.normalize_brand_name(p_receipt_brand_name)) > 0
      and not exists (
        select 1
        from public.standard_product_brand_evidence as evidence
        where evidence.standard_product_id = v_registered.standard_product_id
          and evidence.catalog_product_id = v_registered.catalog_product_id
          and evidence.brand_id = v_brand_id
          and evidence.source_type = 'receipt'
          and evidence.observed_name = btrim(p_receipt_brand_name)
          and evidence.source_label = btrim(p_source_labels[1])
          and evidence.source_product_code = btrim(p_source_product_code)
      )
    )
  then
    raise exception 'The approved brand or its required evidence changed.'
      using errcode = '40001';
  end if;

  update public.standard_product_link_approvals
  set
    consumed_execution_id = v_registered.execution_id,
    consumed_at = coalesce(consumed_at, now())
  where id = v_approval_id
    and (
      consumed_execution_id is null
      or consumed_execution_id = v_registered.execution_id
    );

  if not found
    or not exists (
      select 1
      from public.standard_product_link_approvals as approval
      where approval.id = v_approval_id
        and approval.consumed_execution_id = v_registered.execution_id
    )
  then
    raise exception 'The approval was consumed by another execution.'
      using errcode = '40001';
  end if;

  return query
  select
    v_registered.execution_id,
    v_registered.standard_product_id,
    v_registered.catalog_product_id,
    v_registered.replayed;
end;
$$;

comment on function public.approve_and_register_standard_product_link_strict_v4(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) is
  'Records and atomically consumes an explicit item-specific approval before applying a frozen receipt, official listing, exact variant, brand evidence, and Coupang offer.';

revoke all on function public.admin_manage_standard_catalog(
  text, uuid, jsonb, text
) from public;
grant execute on function public.admin_manage_standard_catalog(
  text, uuid, jsonb, text
) to authenticated;

revoke all on function public.approve_and_register_standard_product_link_strict_v4(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from public;
grant execute on function public.approve_and_register_standard_product_link_strict_v4(
  text, text, text, text, text, text, text, text, text, timestamptz, uuid, uuid,
  text, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) to authenticated;

revoke execute on function public.register_standard_product_link_strict_v3(
  text, text, text, text, text, text, text, text, timestamptz, uuid, uuid, text,
  text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from anon, authenticated;

revoke insert, update, delete on public.brands from anon, authenticated;
revoke insert, update, delete on public.brand_aliases from anon, authenticated;
revoke insert, update, delete on public.standard_products from anon, authenticated;
revoke insert, update, delete on public.catalog_products from anon, authenticated;
revoke insert, update, delete on public.source_product_mappings from anon, authenticated;
revoke insert, update, delete on public.standard_product_brand_evidence from anon, authenticated;
revoke insert, update, delete on public.standard_product_coupang_prices from anon, authenticated;
revoke insert, update, delete on public.standard_product_link_executions from anon, authenticated;
revoke insert, update, delete on public.standard_product_link_approvals from anon, authenticated;
revoke insert, update, delete on public.standard_product_official_links from anon, authenticated;
revoke insert, update, delete on public.standard_product_official_link_evidence from anon, authenticated;
revoke insert, update, delete on public.standard_catalog_admin_actions from anon, authenticated;
