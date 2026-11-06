-- Reuse only an unambiguous owner-confirmed identity with matching OCR variant and seller/channel facts.
create or replace function public.get_my_catalog_purchase_context_v1(
  p_catalog_product_ids uuid[], p_query text default null
)
returns table (
  purchase_source_line_id uuid,
  catalog_product_id uuid,
  product_client_key text,
  product_name text,
  option_text text,
  quantity integer,
  platform_name text,
  seller_name text,
  ordered_on date,
  paid_on date,
  unit_price_krw integer,
  item_net_price_krw integer,
  order_total_krw integer,
  order_line_count integer,
  owner_connected boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_catalog as (
    select catalog.id
    from public.catalog_products catalog
    join public.standard_products standard on standard.id = catalog.standard_product_id
    where catalog.purchase_type = 'retail_product' and catalog.specification_status = 'verified'
      and catalog.status = 'active' and standard.status = 'active'
      and catalog.verification_status = 'verified' and standard.verification_status = 'verified'
  ), purchase_facts as (
    select line.*, source.platform_name, source.ordered_on, source.paid_on,
      source.payment_total_price_krw, source.created_at as source_created_at,
      link.catalog_product_id as manual_catalog_id, approved.id as approved_catalog_id,
      (count(*) over (partition by source.id))::integer as source_line_count,
      case when projection.resolution_status = 'private_unverified_candidate_created'
          and candidate.review_status <> 'rejected'
          and candidate.candidate_type = 'retail_product'
          and (candidate.content_amount is not null or candidate.identifiers <> '[]'::jsonb
            or pg_catalog.concat_ws(' ', candidate.product_name, candidate.specification, line.option_text)
                ~* '[0-9]+[[:space:]]*(정|캡슐|ml|g|개|매)([^[:alnum:]]|$)')
        then pg_catalog.jsonb_build_array(
          source.platform_name, source.platform_code, source.seller_name,
          source.seller_source_namespace, source.seller_source_code,
          line.line_seller_name, line.line_seller_branch_name, line.line_seller_source_namespace,
          line.line_seller_source_code, line.merchant_sku, line.product_name, line.option_text,
          candidate.product_name, candidate.brand, candidate.sub_brand, candidate.manufacturer,
          candidate.specification, candidate.content_amount, candidate.content_unit,
          candidate.package_count, candidate.variant, candidate.identifiers
        ) end as identity_facts
    from public.purchase_price_source_lines line
    join public.purchase_price_sources source
      on source.id = line.purchase_source_id and source.user_id = line.user_id
    left join public.owner_catalog_purchase_links link
      on link.user_id = line.user_id and link.purchase_source_line_id = line.id
    left join public.product_candidate_authority_projections projection
      on projection.user_id = line.user_id and projection.client_key = line.product_client_key
    left join public.product_identity_candidates candidate
      on candidate.user_id = projection.user_id and candidate.id = projection.candidate_id
    left join eligible_catalog approved on approved.id = projection.catalog_product_id
      and projection.resolution_status = 'catalog_product_reused'
    where line.user_id = (select auth.uid()) and source.purchase_kind = 'retail'
      and source.transaction_state = 'settled'
      and pg_catalog.cardinality(p_catalog_product_ids) between 1 and 50
  ), confirmed as (
    select identity_facts, (array_agg(distinct manual_catalog_id))[1] as catalog_id
    from purchase_facts
    where identity_facts is not null and manual_catalog_id is not null
    group by identity_facts
    having count(distinct manual_catalog_id) = 1
  ), context as (
    select
      line.id as line_id,
      coalesce(line.catalog_product_id, line.manual_catalog_id, line.approved_catalog_id, reused.id) as catalog_id,
      line.product_client_key, line.product_name, line.option_text, line.quantity, line.platform_name,
      line.line_seller_name as seller_name, line.ordered_on, line.paid_on,
      case when line.price_status = 'itemized' then line.unit_price_krw end as unit_price,
      case when line.price_status = 'itemized' then line.net_price_krw end as net_price,
      line.payment_total_price_krw as order_total,
      line.source_line_count as order_line_count,
      line.catalog_product_id is null and line.manual_catalog_id is not null as owner_connected,
      line.source_created_at as created_at,
      nullif(pg_catalog.btrim(p_query), '') as query
    from purchase_facts line
    left join confirmed on confirmed.identity_facts = line.identity_facts
    left join eligible_catalog reused on reused.id = confirmed.catalog_id
  ), matching as (
    select context.*, row_number() over (
      partition by catalog_id
      order by coalesce(paid_on, ordered_on) desc nulls last, created_at desc, line_id
    ) as position
    from context
    where (query is null and catalog_id = any(p_catalog_product_ids))
       or (query is not null and pg_catalog.length(query) <= 200 and catalog_id is null
         and pg_catalog.cardinality(p_catalog_product_ids) = 1
         and pg_catalog.strpos(pg_catalog.lower(product_name), pg_catalog.lower(query)) > 0)
  )
  select line_id, catalog_id, product_client_key, product_name, option_text, quantity, platform_name,
    seller_name, ordered_on, paid_on, unit_price, net_price, order_total, order_line_count, owner_connected
  from matching
  where position <= 20
  order by coalesce(paid_on, ordered_on) desc nulls last, created_at desc, line_id;
$$;

create or replace function public.search_public_manufacturer_products_v1(p_query text, p_limit integer default 20)
returns table (
  catalog_product_id uuid,
  product_name text,
  brand_name text,
  specification text,
  manufacturer_sku text,
  manufacturer_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select catalog.id, catalog.canonical_name, standard.brand, catalog.specification,
    publication.manufacturer_sku, publication.reviewed_facts ->> 'manufacturer_url'
  from public.manufacturer_product_publications as publication
  join public.catalog_products as catalog on catalog.id = publication.catalog_product_id
  join public.standard_products as standard on standard.id = catalog.standard_product_id
  where catalog.status = 'active' and standard.status = 'active'
    and catalog.verification_status = 'verified' and standard.verification_status = 'verified'
    and catalog.specification_status = 'verified'
    and (nullif(pg_catalog.btrim(p_query), '') is null or (
      pg_catalog.length(pg_catalog.btrim(p_query)) <= 200 and pg_catalog.strpos(
      pg_catalog.lower(pg_catalog.concat_ws(' ', catalog.canonical_name, standard.brand, catalog.specification, publication.manufacturer_sku)),
      pg_catalog.lower(pg_catalog.btrim(p_query))
    ) > 0))
  order by case when nullif(pg_catalog.btrim(p_query), '') is null then publication.approved_at end desc nulls last,
    catalog.canonical_name, catalog.id
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
