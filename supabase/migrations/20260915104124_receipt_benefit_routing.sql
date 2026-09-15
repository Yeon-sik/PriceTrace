-- Forward-only receipt.v2 benefit routing.
-- The historical ingestion migrations are intentionally left unchanged. The
-- legacy implementation is patched from its deployed definition so the
-- existing validation, idempotency, ownership, and option-linking paths stay
-- intact while benefit lines stop at source/identity storage.

alter table public.verified_receipt_source_lines
  add column benefit_kind text;

alter table public.verified_receipt_source_lines
  add constraint verified_receipt_source_lines_benefit_kind_check
  check (benefit_kind is null or benefit_kind in ('included', 'complimentary', 'review_event', 'promotion', 'other'));

comment on column public.verified_receipt_source_lines.benefit_kind is
  'Explicit food_service source fact. It is never inferred from a zero or nominal price and excludes the line from normal price observations when present.';

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.submit_verified_receipt_v2_legacy(text, jsonb)'::regprocedure
  )
    into v_definition;
  if v_definition is null then
    raise exception 'submit_verified_receipt_v2_legacy is not deployed';
  end if;

  v_old := '  v_parent_receipt_item_id text;' || chr(10)
    || '  v_food_service jsonb;';
  v_new := v_old || chr(10)
    || '  v_benefit_kind text;';
  if position(v_old in v_definition) = 0 then
    raise exception 'submit_verified_receipt_v2_legacy declaration patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'where field_name not in (''role'', ''applies_to_line_id'')';
  v_new := 'where field_name not in (''role'', ''applies_to_line_id'', ''benefit_kind'')';
  if position(v_old in v_definition) = 0 then
    raise exception 'food_service key allowlist patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '        or ((line -> ''food_service'' ->> ''role'') <> ''option'' and line -> ''food_service'' ->> ''applies_to_line_id'' is not null)' || chr(10)
    || '      )';
  v_new := '        or ((line -> ''food_service'' ->> ''role'') <> ''option'' and line -> ''food_service'' ->> ''applies_to_line_id'' is not null)' || chr(10)
    || '        or (' || chr(10)
    || '          line -> ''food_service'' ? ''benefit_kind''' || chr(10)
    || '          and jsonb_typeof(line -> ''food_service'' -> ''benefit_kind'') not in (''string'', ''null'')' || chr(10)
    || '        )' || chr(10)
    || '        or (' || chr(10)
    || '          jsonb_typeof(line -> ''food_service'' -> ''benefit_kind'') = ''string''' || chr(10)
    || '          and line -> ''food_service'' ->> ''benefit_kind'' not in (''included'', ''complimentary'', ''review_event'', ''promotion'', ''other'')' || chr(10)
    || '        )' || chr(10)
    || '      )';
  if position(v_old in v_definition) = 0 then
    raise exception 'food_service invariant patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '    v_food_service := case when v_line -> ''food_service'' is null or v_line -> ''food_service'' = ''null''::jsonb then null else v_line -> ''food_service'' end;';
  v_new := v_old || chr(10)
    || '    v_benefit_kind := nullif(pg_catalog.btrim(coalesce(v_food_service ->> ''benefit_kind'', '''')), '''');';
  if position(v_old in v_definition) = 0 then
    raise exception 'benefit_kind extraction patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '        insert into public.price_observations(';
  v_new := '        if v_benefit_kind is null then' || chr(10)
    || '          insert into public.price_observations(';
  if position(v_old in v_definition) = 0 then
    raise exception 'price observation gate patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '          v_observation_ids := v_observation_ids || jsonb_build_array(v_observation_id);' || chr(10)
    || '        end if;' || chr(10)
    || '      end if;';
  v_new := '          v_observation_ids := v_observation_ids || jsonb_build_array(v_observation_id);' || chr(10)
    || '        end if;' || chr(10)
    || '        end if;' || chr(10)
    || '      end if;';
  if position(v_old in v_definition) = 0 then
    raise exception 'price observation gate close patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '      food_service_role, applies_to_source_line_id';
  v_new := '      food_service_role, applies_to_source_line_id, benefit_kind';
  if position(v_old in v_definition) = 0 then
    raise exception 'source line benefit column patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '      v_food_service ->> ''role'', v_food_service ->> ''applies_to_line_id''';
  v_new := '      v_food_service ->> ''role'', v_food_service ->> ''applies_to_line_id'', v_benefit_kind';
  if position(v_old in v_definition) = 0 then
    raise exception 'source line benefit value patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '      ''sourceLineId'', v_line_id, ''receiptItemId'', v_receipt_item_id,';
  v_new := '      ''sourceLineId'', v_line_id, ''benefitKind'', v_benefit_kind, ''receiptItemId'', v_receipt_item_id,';
  if position(v_old in v_definition) = 0 then
    raise exception 'ingestion response benefit field patch target not found';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end;
$migration$;

create or replace function public.submit_verified_receipt_v2(
  p_idempotency_key text,
  p_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_base_response jsonb;
begin
  v_base_response := public.submit_verified_receipt_v2_legacy(p_idempotency_key, p_receipt);
  return public.private_enrich_verified_receipt_ingestion_v2(v_base_response, p_receipt);
end;
$function$;

comment on function public.submit_verified_receipt_v2(text, jsonb) is
  'PriceTrace-owned, idempotent verified receipt.v2 ingestion. Food-service benefit facts remain in source lines and do not create normal price observations.';

revoke all on function public.submit_verified_receipt_v2(text, jsonb)
  from public, anon;
grant execute on function public.submit_verified_receipt_v2(text, jsonb)
  to authenticated;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'public.get_authenticated_identity_detail_v1(uuid, uuid, uuid, uuid)'::regprocedure
  )
    into v_definition;
  if v_definition is null then
    raise exception 'get_authenticated_identity_detail_v1 is not deployed';
  end if;

  v_old := '        ''foodServiceRole'', source_line.food_service_role,' || chr(10)
    || '        ''appliesToSourceLineId'', source_line.applies_to_source_line_id,';
  v_new := '        ''foodServiceRole'', source_line.food_service_role,' || chr(10)
    || '        ''appliesToSourceLineId'', source_line.applies_to_source_line_id,' || chr(10)
    || '        ''benefitKind'', source_line.benefit_kind,';
  if position(v_old in v_definition) = 0 then
    raise exception 'authenticated identity source line benefit patch target not found';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
