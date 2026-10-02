create or replace function public.admin_confirm_restaurant_fulfillment_manual_v1(
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
    select 1
    from public.restaurants as restaurant
    where restaurant.id = p_restaurant_id
      and restaurant.status = 'active'
      and restaurant.review_status = 'verified'
  ) then
    raise exception '검증된 활성 음식점을 선택하세요.';
  end if;

  select evidence.id into v_evidence_id
  from public.restaurant_fulfillment_evidence as evidence
  where evidence.restaurant_id = p_restaurant_id
    and evidence.fulfillment_type = p_fulfillment_type
    and evidence.evidence_type = 'manual';

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

create or replace function public.admin_confirm_restaurant_fulfillment_from_receipt_v1(
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
    from public.restaurant_menu_receipt_observations as observation
    where observation.id = p_receipt_observation_id
      and observation.restaurant_id = p_restaurant_id
      and observation.verification_status = 'verified'
  ) then
    raise exception '선택한 검증 영수증 관측이 음식점과 일치하지 않습니다.';
  end if;

  select evidence.id into v_evidence_id
  from public.restaurant_fulfillment_evidence as evidence
  where evidence.restaurant_id = p_restaurant_id
    and evidence.fulfillment_type = p_fulfillment_type
    and evidence.receipt_observation_id = p_receipt_observation_id;

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

revoke all on function public.admin_confirm_restaurant_fulfillment_manual_v1(uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_confirm_restaurant_fulfillment_from_receipt_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_confirm_restaurant_fulfillment_manual_v1(uuid, text)
  to authenticated;
grant execute on function public.admin_confirm_restaurant_fulfillment_from_receipt_v1(uuid, uuid, text)
  to authenticated;
