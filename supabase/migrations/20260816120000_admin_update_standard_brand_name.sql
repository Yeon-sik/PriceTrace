-- Allow administrators to rename the canonical brand while editing a standard
-- product. The brand name is shared by every standard product using the brand.

create or replace function public.admin_update_standard_product_content_with_brand(
  p_standard_product_id uuid,
  p_canonical_name text,
  p_brand_id uuid,
  p_brand_name text,
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
  v_brand_name text := nullif(btrim(coalesce(p_brand_name, '')), '');
begin
  if v_user_id is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.'
      using errcode = '42501';
  end if;

  if p_standard_product_id is null
    or coalesce(length(btrim(p_canonical_name)), 0) = 0
    or p_confirmation <> 'CONFIRM_STANDARD_PRODUCT_CONTENT_WITH_BRAND:' || p_standard_product_id::text
  then
    raise exception 'A standard product, canonical name, and exact confirmation are required.'
      using errcode = '23514';
  end if;

  if p_brand_id is null
  then
    if v_brand_name is not null
    then
      raise exception 'A brand name requires a selected canonical brand.'
        using errcode = '23514';
    end if;
  else
    if v_brand_name is null
    then
      raise exception 'The selected canonical brand name is required.'
        using errcode = '23514';
    end if;

    perform 1
    from public.brands
    where id = p_brand_id
      and status = 'active';

    if not found
    then
      raise exception 'The selected canonical brand does not exist or is not active.'
        using errcode = '23503';
    end if;

    update public.brands
    set canonical_name = v_brand_name
    where id = p_brand_id;
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

comment on function public.admin_update_standard_product_content_with_brand(uuid, text, uuid, text, text) is
  'Allows an administrator to edit a standard product and, explicitly, its shared canonical brand name.';

revoke all on function public.admin_update_standard_product_content_with_brand(uuid, text, uuid, text, text) from public;
grant execute on function public.admin_update_standard_product_content_with_brand(uuid, text, uuid, text, text) to authenticated;
