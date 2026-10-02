-- Forward-only alignment of the receipt.v2 source facts and observation gate.
alter table public.verified_receipt_sources
  alter column items_gross_amount_minor drop not null,
  alter column discount_amount_minor drop not null,
  alter column tax_amount_minor drop not null,
  alter column fee_amount_minor drop not null,
  alter column tip_amount_minor drop not null,
  alter column rounding_amount_minor drop not null;

alter table public.verified_receipt_source_lines
  alter column gross_amount_minor drop not null,
  alter column discount_amount_minor drop not null,
  alter column tax_amount_minor drop not null;

-- Patch the deployed function so later identity and benefit handling is retained.
-- Every target is checked; schema drift fails the migration before deployment.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.submit_verified_receipt_v2_legacy(text, jsonb)'::regprocedure)
    into v_definition;

  v_old := 'or jsonb_typeof(line -> ''gross_amount_minor'') is distinct from ''number''';
  v_new := 'or coalesce(jsonb_typeof(line -> ''gross_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'gross source validation target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'or jsonb_typeof(line -> ''discount_amount_minor'') is distinct from ''number''';
  v_new := 'or coalesce(jsonb_typeof(line -> ''discount_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'discount source validation target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'or jsonb_typeof(line -> ''tax_amount_minor'') is distinct from ''number''';
  v_new := 'or coalesce(jsonb_typeof(line -> ''tax_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'tax source validation target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- Nullable amounts retain their receipt.v2 non-negative bounds when known.
  v_old := 'or (line ->> ''tax_amount_minor'')::integer < 0';
  v_new := v_old || chr(10)
    || '      or (line ->> ''unit_price_amount_minor'')::integer < 0' || chr(10)
    || '      or (line ->> ''tax_rate_percent'')::numeric < 0';
  if position(v_old in v_definition) = 0 then raise exception 'known line monetary bounds target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'or jsonb_typeof(line -> ''identifiers'') is distinct from ''array''';
  v_new := 'or coalesce(jsonb_typeof(line -> ''unit_price_amount_minor''), ''missing'') not in (''number'', ''null'')' || chr(10)
    || '      or coalesce(jsonb_typeof(line -> ''net_amount_minor''), ''missing'') not in (''number'', ''null'')' || chr(10)
    || '      or coalesce(jsonb_typeof(line -> ''tax_rate_percent''), ''missing'') not in (''number'', ''null'')' || chr(10)
    || '      ' || v_old;
  if position(v_old in v_definition) = 0 then raise exception 'optional monetary validation target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '        coalesce(jsonb_typeof(line -> ''net_amount_minor''), ''null'') <> ''number''' || chr(10)
    || '        or (line ->> ''gross_amount_minor'')::numeric';
  v_new := '        (line ->> ''net_amount_minor'') is not null' || chr(10)
    || '        and (line ->> ''gross_amount_minor'') is not null' || chr(10)
    || '        and (line ->> ''discount_amount_minor'') is not null' || chr(10)
    || '        and (line ->> ''tax_amount_minor'') is not null' || chr(10)
    || '        and ((line ->> ''gross_amount_minor'')::numeric';
  if position(v_old in v_definition) = 0 then raise exception 'line reconciliation target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := '          <> (line ->> ''net_amount_minor'')::numeric';
  v_new := '          <> (line ->> ''net_amount_minor'')::numeric)';
  if position(v_old in v_definition) = 0 then raise exception 'line reconciliation close target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'jsonb_typeof(v_totals -> ''items_gross_amount_minor'') is distinct from ''number''';
  v_new := 'coalesce(jsonb_typeof(v_totals -> ''items_gross_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'items gross totals target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'jsonb_typeof(v_totals -> ''discount_amount_minor'') is distinct from ''number''';
  v_new := 'coalesce(jsonb_typeof(v_totals -> ''discount_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'discount totals target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'jsonb_typeof(v_totals -> ''tax_amount_minor'') is distinct from ''number''';
  v_new := 'coalesce(jsonb_typeof(v_totals -> ''tax_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'tax totals target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'jsonb_typeof(v_totals -> ''fee_amount_minor'') is distinct from ''number''';
  v_new := 'coalesce(jsonb_typeof(v_totals -> ''fee_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'fee totals target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'jsonb_typeof(v_totals -> ''tip_amount_minor'') is distinct from ''number''';
  v_new := 'coalesce(jsonb_typeof(v_totals -> ''tip_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'tip totals target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'jsonb_typeof(v_totals -> ''rounding_amount_minor'') is distinct from ''number''';
  v_new := 'coalesce(jsonb_typeof(v_totals -> ''rounding_amount_minor''), ''missing'') not in (''number'', ''null'')';
  if position(v_old in v_definition) = 0 then raise exception 'rounding totals target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'coalesce(sum(case when line."type" in (''product'', ''service'') then coalesce(line.gross_amount_minor, 0) else 0 end), 0),' || chr(10)
    || '    coalesce(sum(coalesce(line.discount_amount_minor, 0)), 0),' || chr(10)
    || '    coalesce(sum(coalesce(line.tax_amount_minor, 0)), 0),' || chr(10)
    || '    coalesce(sum(case when line."type" = ''refund'' then coalesce(line.net_amount_minor, 0) else 0 end), 0)';
  v_new := 'sum(case when line."type" in (''product'', ''service'') then line.gross_amount_minor else 0 end),' || chr(10)
    || '    sum(line.discount_amount_minor),' || chr(10)
    || '    sum(line.tax_amount_minor),' || chr(10)
    || '    sum(case when line."type" = ''refund'' then line.net_amount_minor else 0 end)';
  if position(v_old in v_definition) = 0 then raise exception 'nullable line aggregate target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := 'v_grand_total := (v_totals ->> ''grand_total_amount_minor'')::integer;';
  v_new := v_old || chr(10)
    || '  if v_items_gross < 0 or v_total_discount < 0 or v_total_tax < 0 then' || chr(10)
    || '    raise exception ''non-negative receipt.v2 totals are required'' using errcode = ''22023'';' || chr(10)
    || '  end if;';
  if position(v_old in v_definition) = 0 then raise exception 'known totals monetary bounds target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'if v_gross <> v_items_gross or v_discount <> v_total_discount or v_tax <> v_total_tax or v_expected <> v_grand_total then';
  v_new := 'if (v_items_gross is not null and not exists (' || chr(10)
    || '      select 1 from jsonb_array_elements(p_receipt -> ''line_items'') as line' || chr(10)
    || '      where line ->> ''type'' in (''product'', ''service'') and line ->> ''gross_amount_minor'' is null' || chr(10)
    || '    ) and v_gross <> v_items_gross)' || chr(10)
    || '    or (v_total_discount is not null and not exists (' || chr(10)
    || '      select 1 from jsonb_array_elements(p_receipt -> ''line_items'') as line' || chr(10)
    || '      where line ->> ''discount_amount_minor'' is null' || chr(10)
    || '    ) and v_discount <> v_total_discount)' || chr(10)
    || '    or (v_total_tax is not null and not exists (' || chr(10)
    || '      select 1 from jsonb_array_elements(p_receipt -> ''line_items'') as line' || chr(10)
    || '      where line ->> ''tax_amount_minor'' is null' || chr(10)
    || '    ) and v_tax <> v_total_tax)' || chr(10)
    || '    or (v_expected is not null and not exists (' || chr(10)
    || '      select 1 from jsonb_array_elements(p_receipt -> ''line_items'') as line' || chr(10)
    || '      where line ->> ''type'' = ''refund'' and line ->> ''net_amount_minor'' is null' || chr(10)
    || '    ) and v_expected <> v_grand_total) then';
  if position(v_old in v_definition) = 0 then raise exception 'complete-only totals target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  -- Names and branch labels alone do not identify a restaurant location.
  v_old := 'if v_restaurant_id is null and v_branch_name is not null then';
  v_new := 'if v_restaurant_id is null and v_branch_name is not null and (v_address is not null or v_phone is not null) then';
  if position(v_old in v_definition) = 0 then raise exception 'restaurant contact gate target missing'; end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end;
$migration$;

comment on function public.submit_verified_receipt_v2_legacy(text, jsonb) is
  'Stores nullable verified receipt.v2 facts; observation creation is eligible-line only.';
-- Enrichment runs for new ingestions and retries, so both paths report
-- observation eligibility without changing stored source facts.
do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.private_enrich_verified_receipt_ingestion_v2(jsonb, jsonb)'::regprocedure)
    into v_definition;
  v_old := '      ''observationId'', v_observation_id,';
  v_new := v_old || chr(10)
    || '      ''observationCreated'', v_observation_id is not null,' || chr(10)
    || '      ''observationStatus'', case' || chr(10)
    || '        when v_line_type not in (''product'', ''service'') then ''semantic_only''' || chr(10)
    || '        when v_base_line ->> ''benefitKind'' is not null then ''benefit_source_only''' || chr(10)
    || '        when v_observation_id is not null then ''created''' || chr(10)
    || '        else ''insufficient_source_facts''' || chr(10)
    || '      end,';
  if position(v_old in v_definition) = 0 then
    raise exception 'observation response target missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;

-- The source tables remain private. Only trusted administrators can review
-- pending candidates; existing accept/reject RPCs retain their own checks.
create or replace function public.admin_list_pending_merchant_identity_candidates_v1()
returns table (
  candidate_id uuid,
  origin text,
  merchant_name text,
  branch_name text,
  business_registration_number text,
  address text,
  phone text,
  business_kind text,
  source_namespace text,
  source_code text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator authentication is required.' using errcode = '42501';
  end if;

  return query
    select candidate.id, candidate.origin, candidate.merchant_name,
           candidate.branch_name, candidate.business_registration_number,
           candidate.address, candidate.phone, candidate.business_kind,
           candidate.source_namespace, candidate.source_code, candidate.created_at
    from public.merchant_identity_candidates as candidate
    where candidate.review_status = 'pending'
    order by candidate.created_at desc, candidate.id
    limit 200;
end;
$function$;

revoke all on function public.admin_list_pending_merchant_identity_candidates_v1()
  from public, anon, authenticated;
grant execute on function public.admin_list_pending_merchant_identity_candidates_v1()
  to authenticated;
-- Owners can confirm that their verified OCR merchant facts arrived while
-- remaining outside the verified restaurant catalog.
create or replace function public.get_my_pending_merchant_identity_candidates_v1()
returns table (
  candidate_id uuid,
  origin text,
  merchant_name text,
  branch_name text,
  business_registration_number text,
  address text,
  phone text,
  business_kind text,
  source_namespace text,
  source_code text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  return query
    select candidate.id, candidate.origin, candidate.merchant_name,
           candidate.branch_name, candidate.business_registration_number,
           candidate.address, candidate.phone, candidate.business_kind,
           candidate.source_namespace, candidate.source_code, candidate.created_at
    from public.merchant_identity_candidates as candidate
    where candidate.user_id = v_user_id
      and candidate.business_kind = 'food_service'
      and candidate.review_status = 'pending'
    order by candidate.created_at desc, candidate.id
    limit 200;
end;
$function$;

revoke all on function public.get_my_pending_merchant_identity_candidates_v1()
  from public, anon, authenticated;
grant execute on function public.get_my_pending_merchant_identity_candidates_v1()
  to authenticated;