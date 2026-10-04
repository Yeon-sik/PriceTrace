-- Same deployed signature/authorization/decision semantics. RETURNS TABLE names also become
-- PL/pgSQL variables; qualify relation columns so the existing food-service approval can execute.
create or replace function public.admin_resolve_merchant_identity_candidate_v1(
  p_candidate_id uuid, p_restaurant_id uuid, p_restaurant_location_id uuid, p_decision text
)
returns table(candidate_id uuid, review_status text, restaurant_id uuid, restaurant_location_id uuid)
language plpgsql security definer set search_path = '' as $function$
declare v_existing public.merchant_identity_candidates%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;
  if p_decision not in ('accept', 'reject') then
    raise exception 'candidate decision must be accept or reject' using errcode = '22023';
  end if;
  select candidate.* into v_existing from public.merchant_identity_candidates candidate where candidate.id = p_candidate_id;
  if not found then raise exception 'pending merchant identity candidate not found' using errcode = 'P0002'; end if;
  if p_decision = 'accept' and (p_restaurant_id is null
    or (v_existing.business_kind = 'food_service' and p_restaurant_location_id is null)
    or (p_restaurant_location_id is not null and not exists (
      select 1 from public.restaurant_locations location
      where location.id = p_restaurant_location_id and location.restaurant_id = p_restaurant_id
    ))) then raise exception 'accepted candidate requires an exact restaurant and location identity' using errcode = '23514'; end if;
  update public.merchant_identity_candidates candidate set
    review_status = case when p_decision = 'accept' then 'accepted' else 'rejected' end,
    matched_restaurant_id = case when p_decision = 'accept' then p_restaurant_id else null end,
    matched_restaurant_location_id = case when p_decision = 'accept' then p_restaurant_location_id else null end,
    updated_at = now()
  where candidate.id = p_candidate_id and candidate.review_status = 'pending';
  if not found then
    if (p_decision = 'accept' and v_existing.review_status = 'accepted'
      and v_existing.matched_restaurant_id = p_restaurant_id
      and v_existing.matched_restaurant_location_id is not distinct from p_restaurant_location_id)
      or (p_decision = 'reject' and v_existing.review_status = 'rejected') then
      return query select v_existing.id, v_existing.review_status,
        v_existing.matched_restaurant_id, v_existing.matched_restaurant_location_id;
      return;
    end if;
    raise exception 'merchant identity candidate was already resolved' using errcode = '23514';
  end if;
  return query select candidate.id, candidate.review_status, candidate.matched_restaurant_id,
    candidate.matched_restaurant_location_id from public.merchant_identity_candidates candidate where candidate.id = p_candidate_id;
end;
$function$;
revoke all on function public.admin_resolve_merchant_identity_candidate_v1(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_resolve_merchant_identity_candidate_v1(uuid, uuid, uuid, text) to authenticated;
