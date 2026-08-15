-- Keep the restaurant list and restaurant detail boundaries separate.
-- The directory is small metadata; the detail contract carries exact menus
-- and verified observations only after a restaurant identity is selected.

create or replace function public.get_restaurant_directory_v1(
  p_query text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with eligible_restaurants as (
    select
      restaurant.id as restaurant_id,
      restaurant.canonical_name as restaurant_name,
      restaurant.legal_name,
      restaurant.cuisine_type,
      restaurant.official_site_url,
      restaurant.updated_at as restaurant_updated_at,
      restaurant.brand_id
    from public.restaurants as restaurant
    where restaurant.status = 'active'
      and restaurant.review_status = 'verified'
      and (
        nullif(btrim(p_query), '') is null
        or restaurant.canonical_name ilike '%' || btrim(p_query) || '%'
        or coalesce(restaurant.legal_name, '') ilike '%' || btrim(p_query) || '%'
        or coalesce(restaurant.cuisine_type, '') ilike '%' || btrim(p_query) || '%'
        or exists (
          select 1
          from public.restaurant_locations as search_location
          where search_location.restaurant_id = restaurant.id
            and search_location.review_status = 'verified'
            and (
              coalesce(search_location.location_label, '') ilike '%' || btrim(p_query) || '%'
              or search_location.source_namespace ilike '%' || btrim(p_query) || '%'
            )
        )
        or exists (
          select 1
          from public.restaurant_menus as search_menu
          where search_menu.restaurant_id = restaurant.id
            and search_menu.status = 'active'
            and search_menu.review_status = 'verified'
            and (
              search_menu.canonical_name ilike '%' || btrim(p_query) || '%'
              or coalesce(search_menu.category_label, '') ilike '%' || btrim(p_query) || '%'
            )
        )
      )
    order by restaurant.canonical_name, restaurant.id
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  ),
  location_documents as (
    select
      location.restaurant_id,
      jsonb_agg(
        jsonb_build_object(
          'id', location.id,
          'sourceLabel', location.source_namespace,
          'sourceRestaurantCode', location.source_location_code,
          'locationLabel', location.location_label,
          'sourceUrl', location.official_url
        )
        order by location.location_label nulls last, location.id
      ) as documents
    from public.restaurant_locations as location
    inner join eligible_restaurants as eligible
      on eligible.restaurant_id = location.restaurant_id
    where location.review_status = 'verified'
    group by location.restaurant_id
  ),
  menu_stats as (
    select
      menu.restaurant_id,
      count(distinct menu.id)::integer as menu_count,
      max(observation.observed_on) as latest_observed_on
    from public.restaurant_menus as menu
    inner join eligible_restaurants as eligible
      on eligible.restaurant_id = menu.restaurant_id
    inner join public.catalog_products as catalog
      on catalog.id = menu.catalog_product_id
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    left join public.restaurant_menu_receipt_observations as observation
      on observation.restaurant_id = menu.restaurant_id
      and observation.restaurant_menu_id = menu.id
      and observation.verification_status = 'verified'
    where menu.status = 'active'
      and menu.review_status = 'verified'
      and catalog.status = 'active'
      and catalog.purchase_type = 'menu_item'
      and standard.status = 'active'
      and standard.purchase_type = 'menu_item'
    group by menu.restaurant_id
  ),
  base_documents as (
    select
      eligible.restaurant_id,
      jsonb_build_object(
        'restaurant', jsonb_build_object(
          'id', eligible.restaurant_id,
          'brandId', eligible.brand_id,
          'brand', eligible.restaurant_name,
          'legalName', eligible.legal_name,
          'cuisineType', eligible.cuisine_type,
          'officialSiteUrl', eligible.official_site_url,
          'updatedAt', eligible.restaurant_updated_at
        ),
        'locations', coalesce(location.documents, '[]'::jsonb),
        'menuCount', coalesce(stats.menu_count, 0),
        'latestObservedAt', case
          when stats.latest_observed_on is null then null
          else (stats.latest_observed_on::text || 'T00:00:00+00:00')
        end
      ) as document
    from eligible_restaurants as eligible
    left join location_documents as location
      on location.restaurant_id = eligible.restaurant_id
    left join menu_stats as stats
      on stats.restaurant_id = eligible.restaurant_id
  ),
  directory_documents as (
    select
      base.restaurant_id,
      jsonb_set(
        base.document,
        '{revision}',
        to_jsonb(
          'sha256:' || encode(
            extensions.digest(pg_catalog.convert_to(base.document::text, 'UTF8'), 'sha256'),
            'hex'
          )
        ),
        true
      ) as document
    from base_documents as base
  ),
  directory_array as (
    select coalesce(
      jsonb_agg(directory.document order by directory.restaurant_id),
      '[]'::jsonb
    ) as documents
    from directory_documents as directory
  )
  select jsonb_build_object(
    'schemaVersion', 'restaurant-directory.v1',
    'namespace', 'pricetrace',
    'revision', 'sha256:' || encode(
      extensions.digest(
        pg_catalog.convert_to(directory_array.documents::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'restaurants', directory_array.documents
  )
  from directory_array;
$function$;

comment on function public.get_restaurant_directory_v1(text, integer) is
  'restaurant-directory.v1: verified restaurant identities and summary metadata. Exact menu observations are loaded by restaurant identity.';

revoke all on function public.get_restaurant_directory_v1(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_directory_v1(text, integer)
  to anon, authenticated;

create or replace function public.get_restaurant_detail_v1(
  p_restaurant_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with restaurant_row as (
    select
      restaurant.id as restaurant_id,
      restaurant.canonical_name as restaurant_name,
      restaurant.legal_name,
      restaurant.cuisine_type,
      restaurant.official_site_url,
      restaurant.updated_at as restaurant_updated_at,
      restaurant.brand_id
    from public.restaurants as restaurant
    where restaurant.id = p_restaurant_id
      and restaurant.status = 'active'
      and restaurant.review_status = 'verified'
  ),
  location_documents as (
    select
      location.restaurant_id,
      jsonb_agg(
        jsonb_build_object(
          'id', location.id,
          'sourceLabel', location.source_namespace,
          'sourceRestaurantCode', location.source_location_code,
          'locationLabel', location.location_label,
          'sourceUrl', location.official_url
        )
        order by location.location_label nulls last, location.id
      ) as documents
    from public.restaurant_locations as location
    inner join restaurant_row as restaurant
      on restaurant.restaurant_id = location.restaurant_id
    where location.review_status = 'verified'
    group by location.restaurant_id
  ),
  eligible_menus as (
    select
      menu.restaurant_id,
      menu.id as restaurant_menu_id,
      menu.catalog_product_id,
      catalog.standard_product_id,
      menu.canonical_name as menu_name,
      menu.category_label,
      menu.serving_label,
      menu.official_url as menu_official_url,
      menu.updated_at as menu_updated_at
    from public.restaurant_menus as menu
    inner join restaurant_row as restaurant
      on restaurant.restaurant_id = menu.restaurant_id
    inner join public.catalog_products as catalog
      on catalog.id = menu.catalog_product_id
    inner join public.standard_products as standard
      on standard.id = catalog.standard_product_id
    where menu.status = 'active'
      and menu.review_status = 'verified'
      and catalog.status = 'active'
      and catalog.purchase_type = 'menu_item'
      and standard.status = 'active'
      and standard.purchase_type = 'menu_item'
  ),
  observation_documents as (
    select
      observation.restaurant_menu_id,
      jsonb_agg(
        jsonb_build_object(
          'id', observation.id,
          'restaurantSourceId', location.id,
          'locationLabel', location.location_label,
          'unitPriceKrw', observation.unit_price_krw,
          'quantity', observation.quantity,
          'totalPriceKrw', observation.total_price_krw,
          'observedAt', (observation.observed_on::text || 'T00:00:00+00:00'),
          'sourceType', 'database_receipt',
          'receiptReference', null,
          'sourceUrl', null,
          'verifiedAt', observation.verified_at
        )
        order by observation.observed_on desc, observation.created_at desc, observation.id desc
      ) as documents
    from public.restaurant_menu_receipt_observations as observation
    inner join eligible_menus as menu
      on menu.restaurant_menu_id = observation.restaurant_menu_id
      and menu.restaurant_id = observation.restaurant_id
    inner join public.restaurant_locations as location
      on location.id = observation.restaurant_location_id
      and location.restaurant_id = observation.restaurant_id
      and location.review_status = 'verified'
    where observation.verification_status = 'verified'
    group by observation.restaurant_menu_id
  ),
  base_menu_documents as (
    select
      menu.restaurant_menu_id,
      jsonb_build_object(
        'id', menu.restaurant_menu_id,
        'catalogProductId', menu.catalog_product_id,
        'standardProductId', menu.standard_product_id,
        'name', menu.menu_name,
        'categoryLabel', menu.category_label,
        'servingLabel', menu.serving_label,
        'officialUrl', menu.menu_official_url,
        'updatedAt', menu.menu_updated_at,
        'observations', coalesce(observation.documents, '[]'::jsonb)
      ) as document
    from eligible_menus as menu
    left join observation_documents as observation
      on observation.restaurant_menu_id = menu.restaurant_menu_id
  ),
  menu_documents as (
    select
      base.restaurant_menu_id,
      jsonb_set(
        base.document,
        '{revision}',
        to_jsonb(
          'sha256:' || encode(
            extensions.digest(pg_catalog.convert_to(base.document::text, 'UTF8'), 'sha256'),
            'hex'
          )
        ),
        true
      ) as document
    from base_menu_documents as base
  ),
  menus_document as (
    select coalesce(
      jsonb_agg(menu.document order by menu.restaurant_menu_id),
      '[]'::jsonb
    ) as documents
    from menu_documents as menu
  ),
  base_restaurant_document as (
    select
      restaurant.restaurant_id,
      jsonb_build_object(
        'restaurant', jsonb_build_object(
          'id', restaurant.restaurant_id,
          'brandId', restaurant.brand_id,
          'brand', restaurant.restaurant_name,
          'legalName', restaurant.legal_name,
          'cuisineType', restaurant.cuisine_type,
          'officialSiteUrl', restaurant.official_site_url,
          'updatedAt', restaurant.restaurant_updated_at
        ),
        'locations', coalesce(location.documents, '[]'::jsonb),
        'menus', menus.documents
      ) as document
    from restaurant_row as restaurant
    cross join menus_document as menus
    left join location_documents as location
      on location.restaurant_id = restaurant.restaurant_id
  ),
  detail_document as (
    select jsonb_set(
      base.document,
      '{revision}',
      to_jsonb(
        'sha256:' || encode(
          extensions.digest(pg_catalog.convert_to(base.document::text, 'UTF8'), 'sha256'),
          'hex'
        )
      ),
      true
    ) as document
    from base_restaurant_document as base
  )
  select jsonb_build_object(
    'schemaVersion', 'restaurant-detail.v1',
    'namespace', 'pricetrace',
    'revision', 'sha256:' || encode(
      extensions.digest(
        pg_catalog.convert_to(detail.document::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'restaurant', detail.document -> 'restaurant',
    'locations', detail.document -> 'locations',
    'menus', detail.document -> 'menus'
  )
  from detail_document as detail;
$function$;

comment on function public.get_restaurant_detail_v1(uuid) is
  'restaurant-detail.v1: one verified restaurant identity with verified locations, exact menu catalog IDs, and server-verified observations.';

revoke all on function public.get_restaurant_detail_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_detail_v1(uuid)
  to anon, authenticated;
