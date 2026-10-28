-- Public, read-only brand search contract for external consumers such as Fitness.
-- Empty queries never enumerate the catalog. Internal brand fields are excluded.
create function public.get_brand_read_v1(
  p_query text,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with search_input as (
    select
      nullif(btrim(public.normalize_brand_name(p_query)), '') as query,
      greatest(1, least(coalesce(p_limit, 20), 50)) as result_limit
  ),
  name_matches as (
    select
      brand.id as brand_id,
      brand.canonical_name,
      brand.updated_at,
      null::text as matched_alias,
      case
        when brand.normalized_name = input.query then 0
        when strpos(brand.normalized_name, input.query) = 1 then 2
        else 3
      end as match_priority
    from public.brands as brand
    cross join search_input as input
    where input.query is not null
      and brand.status = 'active'
      and strpos(brand.normalized_name, input.query) > 0

    union all

    select
      brand.id as brand_id,
      brand.canonical_name,
      brand.updated_at,
      alias.alias_name as matched_alias,
      case
        when alias.normalized_alias = input.query then 1
        when strpos(alias.normalized_alias, input.query) = 1 then 2
        else 3
      end as match_priority
    from public.brand_aliases as alias
    inner join public.brands as brand on brand.id = alias.brand_id
    cross join search_input as input
    where input.query is not null
      and brand.status = 'active'
      and strpos(alias.normalized_alias, input.query) > 0
  ),
  best_matches as (
    select distinct on (brand_id)
      brand_id,
      canonical_name,
      updated_at,
      matched_alias,
      match_priority
    from name_matches
    -- Prefer the canonical name on a rank tie; choose aliases deterministically.
    order by brand_id, match_priority, (matched_alias is not null), matched_alias
  ),
  limited_matches as (
    select *
    from best_matches
    order by match_priority, canonical_name, brand_id
    limit (select input.result_limit from search_input as input)
  )
  select jsonb_build_object(
    'contract_version', 'brand_read.v1',
    'brands', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'brand_id', brand_id,
          'canonical_name', canonical_name,
          'matched_alias', matched_alias,
          'updated_at', updated_at
        )
        order by match_priority, canonical_name, brand_id
      ),
      '[]'::jsonb
    )
  )
  from limited_matches;
$function$;

comment on function public.get_brand_read_v1(text, integer) is
  'brand_read.v1: public read-only search of active brands by normalized canonical names and aliases. NULL/blank queries return an empty brands array, never the full catalog. Limits clamp to 1..50 (default/NULL 20). Literal substring search ranks canonical exact, alias exact, prefix, then substring; ties sort by canonical_name. Each brand appears once; matched_alias identifies the winning alias or is NULL for a canonical match (also preferred on a rank tie). updated_at is brands.updated_at. Excludes internal fields, provenance, authors, and user-owned data.';

revoke all on function public.get_brand_read_v1(text, integer) from public;
grant execute on function public.get_brand_read_v1(text, integer) to anon;
grant execute on function public.get_brand_read_v1(text, integer) to authenticated;
