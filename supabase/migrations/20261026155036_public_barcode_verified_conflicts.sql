-- Identity ambiguity is independent of public eligibility. Never silently
-- select a visible variant when a verified archived/private variant conflicts.
create or replace function public.get_public_product_by_barcode_v1(p_barcode text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_barcode text := pg_catalog.regexp_replace(coalesce(p_barcode, ''), '[[:space:]-]', '', 'g');
  v_checksum integer := 0;
  v_position integer;
  v_verified_catalog_count integer := 0;
  v_matches jsonb := '[]'::jsonb;
  v_status text := 'invalid';
begin
  if v_barcode ~ '^[0-9]{13}$' then
    for v_position in 1..13 loop
      v_checksum := v_checksum + pg_catalog.substr(v_barcode, v_position, 1)::integer
        * case when v_position % 2 = 0 then 3 else 1 end;
    end loop;

    if v_checksum % 10 = 0 then
      with linked_catalog as (
        select distinct identifier.catalog_product_id
        from public.catalog_product_identifiers as identifier
        where identifier.identifier_value = v_barcode
          and identifier.identifier_scheme in ('ean', 'gtin')
          and identifier.verification_status = 'verified'
      ), public_products as (
        -- Preserve the existing public eligibility and price projection.
        select product.document
        from linked_catalog as linked
        cross join lateral pg_catalog.jsonb_array_elements(
          public.get_product_read_v1(linked.catalog_product_id, null, 1) -> 'products'
        ) as product(document)
      )
      select (select pg_catalog.count(*) from linked_catalog), coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'catalogProductId', product.document #>> '{catalogProduct,id}',
          'standardProductId', product.document #>> '{standardProduct,id}',
          'name', product.document #>> '{standardProduct,name}',
          'brand', brand.canonical_name,
          'contentAmount', product.document #> '{catalogProduct,contentAmount}',
          'contentUnit', product.document #>> '{catalogProduct,contentUnit}',
          'packageCount', product.document #> '{catalogProduct,packageCount}',
          -- Same rule as product-browser.selectors.ts: amount + unit, then x count.
          'specificationLabel',
            pg_catalog.trim_scale((product.document #>> '{catalogProduct,contentAmount}')::numeric)::text
            || case product.document #>> '{catalogProduct,contentUnit}'
                 when 'each' then '개' else product.document #>> '{catalogProduct,contentUnit}' end
            || case when (product.document #>> '{catalogProduct,packageCount}')::integer > 1
                 then ' x ' || (product.document #>> '{catalogProduct,packageCount}') else '' end,
          'categoryName', category.display_name,
          'latestPublicPrice', case
            when product.document #> '{observations,0}' is not null then
              pg_catalog.jsonb_build_object(
                'amountKrw', product.document #> '{observations,0,listedPriceKrw}',
                'kind', 'listed',
                'seller', product.document #>> '{observations,0,sellerLabel}',
                'observedAt', product.document #>> '{observations,0,observedAt}',
                'sourceLabel', product.document #>> '{observations,0,source}'
              )
            else null end
        ) order by product.document #>> '{catalogProduct,id}'
      ), '[]'::jsonb)
      into v_verified_catalog_count, v_matches
      from public_products as product
      inner join public.standard_products as standard
        on standard.id = (product.document #>> '{standardProduct,id}')::uuid
      left join public.brands as brand on brand.id = standard.brand_id and brand.status = 'active'
      left join public.catalog_categories as category
        on category.id = standard.category_id and category.purchase_type = 'retail_product';

      v_status := case
        when v_verified_catalog_count >= 2 then 'conflict'
        when v_verified_catalog_count = 1 and pg_catalog.jsonb_array_length(v_matches) = 1 then 'matched'
        else 'not_linked' end;

      -- Keep the original full-public conflict response compatible. When any
      -- conflicting identity is non-public, disclose no candidate objects.
      -- No new status/version is introduced; a lone hidden link is not_linked.
      if v_status = 'not_linked' or (
        v_status = 'conflict' and pg_catalog.jsonb_array_length(v_matches) <> v_verified_catalog_count
      ) then
        v_matches := '[]'::jsonb;
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'contractVersion', 'pricetrace-barcode-lookup.v1',
    'barcode', v_barcode,
    'status', v_status,
    'checkedAt', pg_catalog.statement_timestamp(),
    'matches', v_matches
  );
end;
$function$;

comment on function public.get_public_product_by_barcode_v1(text) is
  'pricetrace-barcode-lookup.v1: count distinct verified ean/gtin catalog IDs regardless of active/public state. Two or more means conflict; matches is empty if any conflicting variant is non-public. A single non-public link is not_linked, which does NOT mean the product is absent from PriceTrace. Only public eligible exact variants can be matched. No private product facts, receipts, owner prices, provenance, or authors are returned.';

revoke all on function public.get_public_product_by_barcode_v1(text) from public, anon, authenticated;
grant execute on function public.get_public_product_by_barcode_v1(text) to anon, authenticated;
