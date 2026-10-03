-- Read-only database smoke after the getter migration is deployed.
-- Run as a database administrator able to SET ROLE, against an existing
-- verified receipt. No source facts, auth users, or downstream rows are written.
-- This verifies database role/owner isolation, not an HTTP/JWT signature flow.
begin transaction read only;

do $test$
declare
  v_owner_id uuid;
  v_receipt_id uuid;
  v_response jsonb;
begin
  select content.user_id, content.receipt_id, content.response
  into v_owner_id, v_receipt_id, v_response
  from public.verified_receipt_ingestion_contents as content
  inner join public.receipts as receipt
    on receipt.id = content.receipt_id and receipt.user_id = content.user_id
  where (select count(*) from public.verified_receipt_ingestion_contents as sibling
    where sibling.user_id = content.user_id and sibling.receipt_id = content.receipt_id) = 1
  order by content.created_at desc, content.receipt_id
  limit 1;
  if v_receipt_id is null then
    raise exception 'An existing unique verified receipt response is required for this read-only smoke.';
  end if;
  if has_function_privilege('anon', 'public.get_verified_receipt_ingestion_response_v1(uuid)', 'execute')
    or not has_function_privilege('authenticated', 'public.get_verified_receipt_ingestion_response_v1(uuid)', 'execute') then
    raise exception 'Getter API execution privileges are incorrect.';
  end if;
  perform set_config('ocr.checkpoint_test.owner_id', v_owner_id::text, true);
  perform set_config('ocr.checkpoint_test.receipt_id', v_receipt_id::text, true);
  perform set_config('ocr.checkpoint_test.expected_response', v_response::text, true);
  perform set_config('ocr.checkpoint_test.foreign_owner_id', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
end;
$test$;

set local role authenticated;
do $test$
begin
  if public.get_verified_receipt_ingestion_response_v1(
    current_setting('ocr.checkpoint_test.receipt_id')::uuid
  ) is distinct from current_setting('ocr.checkpoint_test.expected_response')::jsonb then
    raise exception 'Owner getter did not return the exact saved server response.';
  end if;
  begin
    perform public.get_verified_receipt_ingestion_response_v1(null);
    raise exception 'Null selector unexpectedly succeeded.';
  exception when invalid_parameter_value then
    null;
  end;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('ocr.checkpoint_test.foreign_owner_id'), 'role', 'authenticated'
  )::text, true);
  begin
    perform public.get_verified_receipt_ingestion_response_v1(current_setting('ocr.checkpoint_test.receipt_id')::uuid);
    raise exception 'Another owner unexpectedly read the receipt response.';
  exception when no_data_found then
    null;
  end;

  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.get_verified_receipt_ingestion_response_v1(current_setting('ocr.checkpoint_test.receipt_id')::uuid);
    raise exception 'A session without a user unexpectedly read the response.';
  exception when insufficient_privilege then
    null;
  end;
end;
$test$;

reset role;
set local role anon;
do $test$
begin
  begin
    perform public.get_verified_receipt_ingestion_response_v1(current_setting('ocr.checkpoint_test.receipt_id')::uuid);
    raise exception 'Anonymous execution unexpectedly succeeded.';
  exception when insufficient_privilege then
    null;
  end;
end;
$test$;
reset role;

select 'OCR_VERIFIED_RECEIPT_CHECKPOINT_READ_PASS' as result;
rollback;
