-- Allow administrators to correct the standard-product family name and
-- canonical brand together without editing the legacy brand shadow directly.

alter table public.standard_catalog_admin_actions
  drop constraint if exists standard_catalog_admin_actions_action_check;

alter table public.standard_catalog_admin_actions
  add constraint standard_catalog_admin_actions_action_check
  check (action in (
    'update_standard_name',
    'update_standard_content',
    'update_catalog_variant',
    'update_source_mapping',
    'delete_catalog_variant',
    'delete_source_mapping',
    'record_coupang_price'
  ));

create or replace function public.admin_update_standard_product_content(
  p_standard_product_id uuid,
  p_canonical_name text,
  p_brand_id uuid,
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
  v_brand_name text;
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if p_standard_product_id is null
    or coalesce(length(btrim(p_canonical_name)), 0) = 0
    or p_confirmation <> 'CONFIRM_STANDARD_PRODUCT_CONTENT:' || p_standard_product_id::text
  then
    raise exception 'A standard product, canonical name, and exact confirmation are required.'
      using errcode = '23514';
  end if;

  if p_brand_id is not null
  then
    select canonical_name
    into v_brand_name
    from public.brands
    where id = p_brand_id
      and status = 'active';

    if not found
    then
      raise exception 'The selected canonical brand does not exist or is not active.'
        using errcode = '23503';
    end if;
  end if;

  update public.standard_products
  set
    canonical_name = btrim(p_canonical_name),
    brand_id = p_brand_id,
    brand = v_brand_name,
    updated_at = now()
  where id = p_standard_product_id
    and status = 'active';

  if not found
  then
    raise exception 'The requested standard product does not exist.'
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
    'update_standard_content',
    p_standard_product_id,
    jsonb_build_object(
      'canonicalName', btrim(p_canonical_name),
      'brandId', p_brand_id,
      'brandName', v_brand_name
    ),
    p_confirmation,
    v_user_id
  )
  returning id into v_action_id;

  return v_action_id;
end;
$$;

revoke all on function public.admin_update_standard_product_content(uuid, text, uuid, text) from public;
grant execute on function public.admin_update_standard_product_content(uuid, text, uuid, text) to authenticated;
