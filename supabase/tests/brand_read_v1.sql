-- Run locally after the migration. All fixtures and role changes roll back.
begin;

do $probe$
declare
  v_nongshim uuid := '93000000-0000-4000-8000-000000000001';
  v_archived uuid := '93000000-0000-4000-8000-000000000002';
  v_rank_exact uuid := '93000000-0000-4000-8000-000000000003';
  v_rank_prefix uuid := '93000000-0000-4000-8000-000000000004';
  v_alias_prefix uuid := '93000000-0000-4000-8000-000000000005';
  v_rank_contains uuid := '93000000-0000-4000-8000-000000000006';
  v_alias_contains uuid := '93000000-0000-4000-8000-000000000007';
  v_alias_exact uuid := '93000000-0000-4000-8000-000000000008';
  v_alias_exact_prefix uuid := '93000000-0000-4000-8000-000000000009';
  v_deduplicated uuid := '93000000-0000-4000-8000-000000000010';
  v_spaced uuid := '93000000-0000-4000-8000-000000000011';
  v_literal uuid := '93000000-0000-4000-8000-000000000012';
  v_updated_at timestamptz := '2026-10-28T00:00:00+00:00';
  v_payload jsonb;
  v_brand jsonb;
  v_ids text[];
  v_case record;
  v_role text;
  v_checks integer := 0;
begin
  insert into public.brands(id, canonical_name, status, updated_at) values
    (v_nongshim, '__brand_read_probe_농심', 'active', v_updated_at),
    (v_archived, '__brand_read_probe_archived', 'archived', v_updated_at),
    (v_rank_exact, '__brand_read_probe_rank', 'active', v_updated_at),
    (v_rank_prefix, '__brand_read_probe_rank Prefix', 'active', v_updated_at),
    (v_alias_prefix, '__brand_read_probe_owner A', 'active', v_updated_at),
    (v_rank_contains, 'x__brand_read_probe_rank', 'active', v_updated_at),
    (v_alias_contains, '__brand_read_probe_owner B', 'active', v_updated_at),
    (v_alias_exact, '__brand_read_probe_owner Z', 'active', v_updated_at),
    (v_alias_exact_prefix, '__brand_read_probe_exact_alias Prefix', 'active', v_updated_at),
    (v_deduplicated, '__brand_read_probe_duplicates', 'active', v_updated_at),
    (v_spaced, '__brand_read_probe_Spaced Brand', 'active', v_updated_at),
    (v_literal, '__brand_read_probe_%_literal', 'active', v_updated_at);

  insert into public.brand_aliases(brand_id, alias_name) values
    (v_nongshim, '__brand_read_probe_Nongshim'),
    (v_archived, '__brand_read_probe_archived_alias'),
    (v_rank_exact, '__brand_read_probe_rank'),
    (v_rank_prefix, '__brand_read_probe_rank Prefix Alias'),
    (v_alias_prefix, '__brand_read_probe_rank AliasPrefix'),
    (v_alias_contains, 'x__brand_read_probe_rank AliasContains'),
    (v_alias_exact, '__brand_read_probe_exact_alias'),
    (v_deduplicated, '__brand_read_probe_many B'),
    (v_deduplicated, '__brand_read_probe_many A'),
    (v_deduplicated, 'x__brand_read_probe_many Partial'),
    (v_spaced, '__brand_read_probe_Multi Word Alias');

  v_payload := public.get_brand_read_v1('__brand_read_probe_농심');
  if v_payload ->> 'contract_version' is distinct from 'brand_read.v1'
    or v_payload - array['contract_version', 'brands'] <> '{}'::jsonb
    or jsonb_typeof(v_payload -> 'brands') is distinct from 'array'
    or jsonb_array_length(v_payload -> 'brands') <> 1
  then
    raise exception 'brand_read.v1 envelope/canonical search failed: %', v_payload;
  end if;
  v_brand := v_payload -> 'brands' -> 0;
  if v_brand ->> 'brand_id' is distinct from v_nongshim::text
    or v_brand ->> 'canonical_name' is distinct from '__brand_read_probe_농심'
    or v_brand -> 'matched_alias' is distinct from 'null'::jsonb
    or (v_brand ->> 'updated_at')::timestamptz is distinct from v_updated_at
    or not (v_brand ?& array['brand_id', 'canonical_name', 'matched_alias', 'updated_at'])
    or v_brand - array['brand_id', 'canonical_name', 'matched_alias', 'updated_at'] <> '{}'::jsonb
  then
    raise exception 'brand_read.v1 public fields/privacy failed: %', v_brand;
  end if;
  v_checks := v_checks + 1;

  v_payload := public.get_brand_read_v1('__brand_read_probe_Nongshim');
  if jsonb_array_length(v_payload -> 'brands') <> 1
    or v_payload #>> '{brands,0,brand_id}' is distinct from v_nongshim::text
    or v_payload #>> '{brands,0,matched_alias}' is distinct from '__brand_read_probe_Nongshim'
  then raise exception 'brand_read.v1 exact alias failed: %', v_payload; end if;
  v_checks := v_checks + 1;

  v_payload := public.get_brand_read_v1(E' \t__BRAND_READ_PROBE_nONGSHIM\t\n ');
  if v_payload #>> '{brands,0,brand_id}' is distinct from v_nongshim::text
  then raise exception 'brand_read.v1 case/boundary whitespace failed: %', v_payload; end if;
  v_checks := v_checks + 1;

  v_payload := public.get_brand_read_v1(E'__BRAND_READ_PROBE_MULTI\t  WORD   ALIAS');
  if v_payload #>> '{brands,0,brand_id}' is distinct from v_spaced::text
    or v_payload #>> '{brands,0,matched_alias}' is distinct from '__brand_read_probe_Multi Word Alias'
  then raise exception 'brand_read.v1 internal whitespace failed: %', v_payload; end if;
  v_checks := v_checks + 1;

  v_payload := public.get_brand_read_v1(E' \t__BRAND_READ_PROBE_SPACED   BRAND\n ');
  if v_payload #>> '{brands,0,brand_id}' is distinct from v_spaced::text
    or v_payload #> '{brands,0,matched_alias}' is distinct from 'null'::jsonb
  then raise exception 'brand_read.v1 canonical case/whitespace failed: %', v_payload; end if;
  v_checks := v_checks + 1;

  for v_case in select * from (values
    ('__brand_read_probe_archived'), ('__brand_read_probe_archived_alias')
  ) as queries(query)
  loop
    v_payload := public.get_brand_read_v1(v_case.query);
    if v_payload -> 'brands' is distinct from '[]'::jsonb
    then raise exception 'brand_read.v1 archived brand/alias exposed: %', v_payload; end if;
    v_checks := v_checks + 1;
  end loop;

  for v_case in select * from (values
    (null::text), (''), ('   '), (E'\t\n\r ')
  ) as queries(query)
  loop
    v_payload := public.get_brand_read_v1(v_case.query, 50);
    if v_payload is distinct from jsonb_build_object('contract_version', 'brand_read.v1', 'brands', '[]'::jsonb)
    then raise exception 'brand_read.v1 blank query enumerated brands: %', v_payload; end if;
    v_checks := v_checks + 1;
  end loop;

  v_payload := public.get_brand_read_v1('__brand_read_probe_no_such_brand');
  if v_payload -> 'brands' is distinct from '[]'::jsonb
  then raise exception 'brand_read.v1 missing query failed: %', v_payload; end if;
  v_checks := v_checks + 1;

  v_payload := public.get_brand_read_v1('__brand_read_probe_rank');
  select array_agg(entry.value ->> 'brand_id' order by entry.ordinality) into v_ids
  from jsonb_array_elements(v_payload -> 'brands') with ordinality as entry(value, ordinality);
  if v_ids is distinct from array[v_rank_exact::text, v_alias_prefix::text, v_rank_prefix::text, v_alias_contains::text, v_rank_contains::text]
    or v_payload #> '{brands,0,matched_alias}' is distinct from 'null'::jsonb
    or v_payload #>> '{brands,1,matched_alias}' is distinct from '__brand_read_probe_rank AliasPrefix'
    or v_payload #> '{brands,2,matched_alias}' is distinct from 'null'::jsonb
  then raise exception 'brand_read.v1 rank/name order/canonical tie failed: %', v_payload; end if;
  v_checks := v_checks + 1;

  v_payload := public.get_brand_read_v1('__brand_read_probe_exact_alias');
  if jsonb_array_length(v_payload -> 'brands') <> 2
    or v_payload #>> '{brands,0,brand_id}' is distinct from v_alias_exact::text
    or v_payload #>> '{brands,0,matched_alias}' is distinct from '__brand_read_probe_exact_alias'
    or v_payload #>> '{brands,1,brand_id}' is distinct from v_alias_exact_prefix::text
  then raise exception 'brand_read.v1 exact alias must outrank prefix: %', v_payload; end if;
  v_checks := v_checks + 1;

  v_payload := public.get_brand_read_v1('__brand_read_probe_many');
  if jsonb_array_length(v_payload -> 'brands') <> 1
    or v_payload #>> '{brands,0,brand_id}' is distinct from v_deduplicated::text
    or v_payload #>> '{brands,0,matched_alias}' is distinct from '__brand_read_probe_many A'
  then raise exception 'brand_read.v1 aliases duplicated brand/non-deterministic alias: %', v_payload; end if;
  v_checks := v_checks + 1;

  v_payload := public.get_brand_read_v1('__brand_read_probe_%_');
  if jsonb_array_length(v_payload -> 'brands') <> 1
    or v_payload #>> '{brands,0,brand_id}' is distinct from v_literal::text
  then raise exception 'brand_read.v1 treated literal percent/underscore as wildcards: %', v_payload; end if;
  v_checks := v_checks + 1;

  insert into public.brands(canonical_name)
  select '__brand_read_probe_limit_' || lpad(n::text, 3, '0') from generate_series(1, 60) as n;
  insert into public.brand_aliases(brand_id, alias_name)
  select brand.id, alias_name
  from public.brands as brand
  cross join (values ('__brand_read_probe_limit_alias A'), ('__brand_read_probe_limit_alias B')) as aliases(alias_name)
  where brand.canonical_name = '__brand_read_probe_limit_001';
  v_payload := public.get_brand_read_v1('__brand_read_probe_limit_');
  if jsonb_array_length(v_payload -> 'brands') <> 20
  then raise exception 'brand_read.v1 default limit failed: %', v_payload; end if;
  v_checks := v_checks + 1;
  for v_case in select * from (values
    (1000, 50), (50, 50), (1, 1), (0, 1), (-100, 1), (null::integer, 20)
  ) as limits(requested, expected)
  loop
    v_payload := public.get_brand_read_v1('__brand_read_probe_limit_', v_case.requested);
    if jsonb_array_length(v_payload -> 'brands') <> v_case.expected
    then raise exception 'brand_read.v1 limit % failed: %', v_case.requested, v_payload; end if;
    v_checks := v_checks + 1;
  end loop;

  if not exists (
    select 1 from pg_catalog.pg_proc as proc
    inner join pg_catalog.pg_language as language on language.oid = proc.prolang
    where proc.oid = 'public.get_brand_read_v1(text,integer)'::regprocedure
      and language.lanname = 'sql' and proc.provolatile = 's' and proc.prosecdef
      and proc.proconfig @> array['search_path=""']
  ) then raise exception 'brand_read.v1 function security/volatility contract failed'; end if;
  v_checks := v_checks + 1;
  if exists (
    select 1 from pg_catalog.pg_proc as proc
    cross join lateral pg_catalog.aclexplode(coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))) as privilege
    where proc.oid = 'public.get_brand_read_v1(text,integer)'::regprocedure
      and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
  ) then raise exception 'brand_read.v1 retains PUBLIC execution'; end if;
  v_checks := v_checks + 1;

  foreach v_role in array array['anon', 'authenticated'] loop
    if not has_function_privilege(v_role, 'public.get_brand_read_v1(text,integer)', 'EXECUTE')
    then raise exception 'brand_read.v1 missing % execution grant', v_role; end if;
    execute format('set local role %I', v_role);
    v_payload := public.get_brand_read_v1('__brand_read_probe_Nongshim', 1);
    if v_payload #>> '{brands,0,brand_id}' is distinct from v_nongshim::text
    then raise exception 'brand_read.v1 % cannot execute public alias search: %', v_role, v_payload; end if;
    v_payload := public.get_brand_read_v1(null);
    if v_payload -> 'brands' is distinct from '[]'::jsonb
    then raise exception 'brand_read.v1 % can enumerate without query', v_role; end if;
    execute 'reset role';
    v_checks := v_checks + 1;
  end loop;

  raise notice 'BRAND_READ_V1_PASS: % checks', v_checks;
end;
$probe$;

select 'BRAND_READ_V1_PASS' as result;
rollback;
