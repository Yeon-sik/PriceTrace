-- Public, read-only product contract for external consumers such as Fitness.
--
-- The contract deliberately excludes user-owned receipts and price_observations.
-- Only active verified catalog variants, verified seller mappings, and verified
-- market observations are projected. Product-nutrition links remain owned by
-- the separate Nutrition database.

drop function if exists public.get_product_read_v1(uuid, text, integer);

create function public.get_product_read_v1(
  p_catalog_product_id uuid default null,
  p_query text default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with eligible_products as (
    select
      catalog.id as catalog_product_id,
      catalog.canonical_name as catalog_name,
      catalog.specification as specification_text,
      catalog.content_amount,
      catalog.content_unit,
      catalog.package_count,
      catalog.reference_unit,
      catalog.listing_reference_url,
      catalog.updated_at as catalog_updated_at,
      standard.id as standard_product_id,
      standard.canonical_name as standard_name,
      standard.brand,
      standard.updated_at as standard_updated_at
    from public.catalog_products as catalog
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where catalog.status = 'active'
      and standard.status = 'active'
      and catalog.specification_status = 'verified'
      and catalog.content_amount is not null
      and catalog.content_amount > 0
      and catalog.content_unit in ('g', 'ml', 'each')
      and catalog.package_count > 0
      and (
        p_catalog_product_id is null
        or catalog.id = p_catalog_product_id
      )
      and (
        nullif(btrim(p_query), '') is null
        or standard.canonical_name ilike '%' || btrim(p_query) || '%'
        or catalog.canonical_name ilike '%' || btrim(p_query) || '%'
        or coalesce(standard.brand, '') ilike '%' || btrim(p_query) || '%'
      )
    order by standard.canonical_name, catalog.canonical_name, catalog.id
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ),
  seller_products as (
    select
      mapping.catalog_product_id,
      jsonb_agg(
        jsonb_build_object(
          'sellerLabel', mapping.source_label,
          'sourceProductCode', mapping.source_product_code
        )
        order by mapping.source_label, mapping.source_product_code
      ) as documents
    from public.source_product_mappings as mapping
    inner join eligible_products as product
      on product.catalog_product_id = mapping.catalog_product_id
    where mapping.review_status = 'verified'
    group by mapping.catalog_product_id
  ),
  latest_verified_market_observations as (
    select distinct on (
      observation.catalog_product_id,
      lower(btrim(observation.seller_name))
    )
      observation.id,
      observation.catalog_product_id,
      observation.seller_name,
      observation.product_url,
      observation.listed_price_krw,
      observation.shipping_fee_krw,
      observation.minimum_order_quantity,
      observation.observed_at,
      observation.created_at
    from public.market_price_observations as observation
    inner join eligible_products as product
      on product.catalog_product_id = observation.catalog_product_id
    where observation.verification_status = 'verified'
    order by
      observation.catalog_product_id,
      lower(btrim(observation.seller_name)),
      observation.observed_at desc,
      observation.created_at desc,
      observation.id desc
  ),
  market_observations as (
    select
      observation.catalog_product_id,
      jsonb_agg(
        jsonb_build_object(
          'observationId', observation.id,
          'sellerLabel', observation.seller_name,
          'listedPriceKrw', observation.listed_price_krw,
          'shippingFeeKrw', observation.shipping_fee_krw,
          'minimumOrderQuantity', observation.minimum_order_quantity,
          'checkoutPriceKrw',
            observation.listed_price_krw::bigint
              * observation.minimum_order_quantity::bigint
              + observation.shipping_fee_krw::bigint,
          'observedAt', observation.observed_at,
          'productUrl', observation.product_url,
          'source', 'verified-market-observation'
        )
        order by
          observation.observed_at desc,
          observation.seller_name,
          observation.id
      ) as documents
    from latest_verified_market_observations as observation
    group by observation.catalog_product_id
  ),
  base_product_documents as (
    select
      product.standard_product_id,
      product.catalog_product_id,
      jsonb_build_object(
        'standardProduct', jsonb_build_object(
          'id', product.standard_product_id,
          'name', product.standard_name,
          'brand', product.brand,
          'updatedAt', product.standard_updated_at
        ),
        'catalogProduct', jsonb_build_object(
          'id', product.catalog_product_id,
          'name', product.catalog_name,
          'specificationText', product.specification_text,
          'contentAmount', product.content_amount,
          'contentUnit', product.content_unit,
          'packageCount', product.package_count,
          'referenceUnit', product.reference_unit,
          'listingReferenceUrl', product.listing_reference_url,
          'updatedAt', product.catalog_updated_at
        ),
        'sellerProducts', coalesce(seller.documents, '[]'::jsonb),
        'observations', coalesce(observation.documents, '[]'::jsonb)
      ) as document
    from eligible_products as product
    left join seller_products as seller
      on seller.catalog_product_id = product.catalog_product_id
    left join market_observations as observation
      on observation.catalog_product_id = product.catalog_product_id
  ),
  product_documents as (
    select
      base.standard_product_id,
      base.catalog_product_id,
      jsonb_set(
        base.document,
        '{revision}',
        to_jsonb(
          'sha256:' || encode(
            extensions.digest(
              pg_catalog.convert_to(base.document::text, 'UTF8'),
              'sha256'
            ),
            'hex'
          )
        ),
        true
      ) as document
    from base_product_documents as base
  ),
  product_array as (
    select coalesce(
      jsonb_agg(
        product.document
        order by product.standard_product_id, product.catalog_product_id
      ),
      '[]'::jsonb
    ) as documents
    from product_documents as product
  )
  select jsonb_build_object(
    'schemaVersion', 'product-read.v1',
    'namespace', 'pricetrace',
    'revision',
      'sha256:' || encode(
        extensions.digest(
          pg_catalog.convert_to(product_array.documents::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
    'products', product_array.documents
  )
  from product_array;
$function$;

comment on function public.get_product_read_v1(uuid, text, integer) is
  'product-read.v1: active verified product families and exact variants with verified seller mappings and latest verified market observations. Excludes user-owned receipt data.';

revoke all on function public.get_product_read_v1(uuid, text, integer) from public;
grant execute on function public.get_product_read_v1(uuid, text, integer) to anon;
grant execute on function public.get_product_read_v1(uuid, text, integer) to authenticated;
