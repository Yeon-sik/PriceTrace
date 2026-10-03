-- Read the current server response for an already-ingested receipt without
-- reconstructing a legacy request or invoking receipt ingestion again.
begin;

create or replace function public.get_verified_receipt_ingestion_response_v1(
  p_receipt_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_response_count bigint;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;
  if p_receipt_id is null then
    raise exception 'server-issued receipt ID is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.receipts as receipt
    where receipt.id = p_receipt_id and receipt.user_id = v_user_id
  ) then
    raise exception 'verified receipt response was not found' using errcode = 'P0002';
  end if;

  select pg_catalog.count(*) into v_response_count
  from public.verified_receipt_ingestion_contents as content
  where content.user_id = v_user_id and content.receipt_id = p_receipt_id;
  if v_response_count = 0 then
    raise exception 'verified receipt response was not found' using errcode = 'P0002';
  end if;
  if v_response_count <> 1 then
    raise exception 'verified receipt response selector is not unique' using errcode = '21000';
  end if;

  select content.response into v_response
  from public.verified_receipt_ingestion_contents as content
  where content.user_id = v_user_id and content.receipt_id = p_receipt_id;
  return v_response;
end;
$function$;

comment on function public.get_verified_receipt_ingestion_response_v1(uuid) is
  'Owner-authenticated read of the current sanitized receipt ingestion response. Recovers OCR resolution metadata and exact IDs without re-ingesting legacy source facts.';
revoke all on function public.get_verified_receipt_ingestion_response_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.get_verified_receipt_ingestion_response_v1(uuid)
  to authenticated;

commit;
