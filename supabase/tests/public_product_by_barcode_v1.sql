-- Local-only, synthetic fixtures. All writes and test helpers roll back.
begin;
create temporary table barcode_probe_results(label text primary key);
grant select, insert on barcode_probe_results to anon, authenticated;
do $$ begin
  execute format('grant usage on schema %I to anon, authenticated', pg_my_temp_schema()::regnamespace::text);
end $$;
create function pg_temp.barcode_check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'Barcode contract failed: %', p_label; end if;
  insert into pg_temp.barcode_probe_results values (p_label);
end;
$$;
create function pg_temp.probe_ean(p_prefix text) returns text language sql as $$
  select p_prefix || ((10 - sum(substr(p_prefix, n, 1)::integer * case when n % 2 = 0 then 3 else 1 end) % 10) % 10)::text
  from generate_series(1, 12) as n;
$$;

insert into public.brands(id, canonical_name) values
  ('97000000-0000-4000-8000-000000000001', '__barcode_probe_brand');
insert into public.standard_products(id, purchase_type, canonical_name, brand_id, category_id) values
  ('97000000-0000-4000-8000-000000000002', 'retail_product', '__barcode_probe_family',
   '97000000-0000-4000-8000-000000000001',
   (select id from public.catalog_categories where purchase_type = 'retail_product' and slug = 'chocolate-dessert'));
insert into public.catalog_products(id, standard_product_id, purchase_type, canonical_name,
  specification_status, content_amount, content_unit, package_count, reference_unit, listing_reference_url)
select ('97000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '97000000-0000-4000-8000-000000000002', 'retail_product', '__barcode_probe_variant_' || n,
  'verified', 40.000, 'g', 1, 100, 'https://example.com/barcode-probe'
from generate_series(10, 11) as n;

-- A private marker must never appear in the public response.
insert into public.catalog_product_identifiers(catalog_product_id, identifier_scheme, identifier_value, verification_status, provenance)
values ('97000000-0000-4000-8000-000000000010', 'ean', pg_temp.probe_ean('200000000001'), 'verified', '{"privateMarker":"DO_NOT_PROJECT"}'),
       ('97000000-0000-4000-8000-000000000010', 'ean', pg_temp.probe_ean('200000000002'), 'pending', '{}'),
       ('97000000-0000-4000-8000-000000000010', 'gtin', pg_temp.probe_ean('200000000003'), 'rejected', '{}'),
       ('97000000-0000-4000-8000-000000000010', 'ean', pg_temp.probe_ean('200000000004'), 'verified', '{}'),
       ('97000000-0000-4000-8000-000000000011', 'gtin', pg_temp.probe_ean('200000000004'), 'verified', '{}'),
       ('97000000-0000-4000-8000-000000000010', 'ean', pg_temp.probe_ean('200000000005'), 'verified', '{}'),
       ('97000000-0000-4000-8000-000000000010', 'gtin', pg_temp.probe_ean('200000000005'), 'verified', '{}');

select pg_temp.barcode_check(has_function_privilege('anon', 'public.get_public_product_by_barcode_v1(text)', 'execute'), 'anon execute grant');
select pg_temp.barcode_check(has_function_privilege('authenticated', 'public.get_public_product_by_barcode_v1(text)', 'execute'), 'authenticated execute grant');
select pg_temp.barcode_check(not has_table_privilege('anon', 'public.catalog_product_identifiers', 'select'), 'anon table select revoked');
select pg_temp.barcode_check((select relrowsecurity from pg_class where oid = 'public.catalog_product_identifiers'::regclass), 'identifier RLS preserved');
select pg_temp.barcode_check((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'public.get_public_product_by_barcode_v1(text)'::regprocedure), 'definer with empty search path');
select pg_temp.barcode_check(not exists (
  select 1 from pg_proc as p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
  where p.oid = 'public.get_public_product_by_barcode_v1(text)'::regprocedure and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
), 'PUBLIC execute revoked');

set local role anon;
do $$
declare payload jsonb; item jsonb; value text;
begin
  payload := public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001'));
  item := payload -> 'matches' -> 0;
  perform pg_temp.barcode_check(payload ->> 'status' = 'matched' and jsonb_array_length(payload -> 'matches') = 1, 'matched one exact variant');
  perform pg_temp.barcode_check(payload ->> 'contractVersion' = 'pricetrace-barcode-lookup.v1'
    and (payload ->> 'checkedAt')::timestamptz is not null
    and (select count(*) from jsonb_object_keys(payload)) = 5, 'fixed envelope and ISO timestamp');
  perform pg_temp.barcode_check(item ->> 'catalogProductId' = '97000000-0000-4000-8000-000000000010'
    and item ->> 'standardProductId' = '97000000-0000-4000-8000-000000000002'
    and item ->> 'name' = '__barcode_probe_family'
    and item ->> 'brand' = '__barcode_probe_brand'
    and item -> 'contentAmount' = '40'::jsonb and item ->> 'contentUnit' = 'g'
    and item -> 'packageCount' = '1'::jsonb and item ->> 'specificationLabel' = '40g'
    and item ->> 'categoryName' = '초콜릿·디저트', 'fixed public product fields');
  perform pg_temp.barcode_check((select count(*) from jsonb_object_keys(item)) = 10
    and payload::text not like '%DO_NOT_PROJECT%' and payload::text not like '%provenance%'
    and payload::text not like '%reviewed_by%' and item -> 'latestPublicPrice' = 'null'::jsonb, 'allowlist only and null price');
  payload := public.get_public_product_by_barcode_v1(E' \t2000-0000 0001-5\n');
  perform pg_temp.barcode_check(payload ->> 'status' = 'matched' and payload ->> 'barcode' = pg_temp.probe_ean('200000000001'), 'spaces hyphens tabs newline normalization');
  payload := public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000099'));
  perform pg_temp.barcode_check(payload ->> 'status' = 'not_linked' and payload -> 'matches' = '[]'::jsonb, 'valid unlinked EAN');
  foreach value in array array[null::text, '', '12345678', '123456789012', '12345678901234', '2000000000016', '200000000001X', '２００００００００００１５'] loop
    payload := public.get_public_product_by_barcode_v1(value);
    perform pg_temp.barcode_check(payload ->> 'status' = 'invalid' and payload -> 'matches' = '[]'::jsonb, 'invalid ' || coalesce(value, 'NULL'));
  end loop;
  payload := public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000002'));
  perform pg_temp.barcode_check(payload ->> 'status' = 'not_linked', 'pending identifier excluded');
  payload := public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000003'));
  perform pg_temp.barcode_check(payload ->> 'status' = 'not_linked', 'rejected identifier excluded');
  payload := public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000004'));
  perform pg_temp.barcode_check(payload ->> 'status' = 'conflict' and jsonb_array_length(payload -> 'matches') = 2
    and payload #>> '{matches,0,catalogProductId}' < payload #>> '{matches,1,catalogProductId}', 'conflict retains both with deterministic order');
  payload := public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000005'));
  perform pg_temp.barcode_check(payload ->> 'status' = 'matched' and jsonb_array_length(payload -> 'matches') = 1, 'ean gtin duplicate same product');
  begin
    perform 1 from public.catalog_product_identifiers;
    raise exception 'anon table SELECT unexpectedly succeeded';
  exception when insufficient_privilege then
    perform pg_temp.barcode_check(true, 'anon actual table SELECT denied');
  end;
end;
$$;
reset role;

-- Reuse only the verified, already-public exact-variant market listing path.
insert into public.market_price_observations(catalog_product_id, seller_name, product_url, listed_price_krw,
  shipping_fee_krw, minimum_order_quantity, observed_at, verification_status)
values ('97000000-0000-4000-8000-000000000010', '__barcode_seller', 'https://example.com/offer', 1000, 500, 2, '2026-10-20T00:00:00Z', 'verified'),
       ('97000000-0000-4000-8000-000000000010', '__barcode_seller_2', 'https://example.com/offer', 1200, 0, 1, '2026-10-21T00:00:00Z', 'verified'),
       ('97000000-0000-4000-8000-000000000010', '__barcode_seller', 'https://example.com/offer', 1, 0, 1, '2026-10-22T00:00:00Z', 'pending'),
       ('97000000-0000-4000-8000-000000000010', '__barcode_seller', 'https://example.com/offer', 2, 0, 1, '2026-10-23T00:00:00Z', 'rejected');
set local role anon;
do $$ declare price jsonb; begin
  price := public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001')) #> '{matches,0,latestPublicPrice}';
  perform pg_temp.barcode_check(price - 'observedAt' =
    '{"amountKrw":1200,"kind":"listed","seller":"__barcode_seller_2","sourceLabel":"verified-market-observation"}'::jsonb
    and (price ->> 'observedAt')::timestamptz = '2026-10-21T00:00:00Z'::timestamptz,
    'latest public listed price with seller date source: ' || price::text);
end $$;
reset role;

update public.catalog_products set status = 'archived' where id = '97000000-0000-4000-8000-000000000010';
set local role anon;
select pg_temp.barcode_check(public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001')) ->> 'status' = 'not_linked', 'archived catalog excluded');
select pg_temp.barcode_check(public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000004')) ->> 'status' = 'matched', 'archived conflict candidate excluded');
reset role;
update public.catalog_products set status = 'active' where id = '97000000-0000-4000-8000-000000000010';
update public.standard_products set status = 'archived' where id = '97000000-0000-4000-8000-000000000002';
set local role anon;
select pg_temp.barcode_check(public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001')) ->> 'status' = 'not_linked', 'archived standard excluded');
reset role;
update public.standard_products set status = 'active', verification_status = 'unverified' where id = '97000000-0000-4000-8000-000000000002';
set local role anon;
select pg_temp.barcode_check(public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001')) ->> 'status' = 'not_linked', 'private unverified standard excluded');
reset role;
update public.standard_products set verification_status = 'verified', brand_id = null where id = '97000000-0000-4000-8000-000000000002';
update public.catalog_products set verification_status = 'unverified' where id = '97000000-0000-4000-8000-000000000010';
set local role anon;
select pg_temp.barcode_check(public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001')) ->> 'status' = 'not_linked', 'private unverified catalog excluded');
reset role;
update public.catalog_products set verification_status = 'verified', specification_status = 'placeholder', content_amount = 1, content_unit = 'each', package_count = 1 where id = '97000000-0000-4000-8000-000000000010';
set local role anon;
select pg_temp.barcode_check(public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001')) ->> 'status' = 'not_linked', 'unverified specification excluded');
reset role;
update public.catalog_products set specification_status = 'verified', content_amount = 40, content_unit = 'each', package_count = 2 where id = '97000000-0000-4000-8000-000000000010';
set local role authenticated;
select pg_temp.barcode_check(public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001')) #> '{matches,0,brand}' = 'null'::jsonb, 'authenticated call and null brand');
select pg_temp.barcode_check(public.get_public_product_by_barcode_v1(pg_temp.probe_ean('200000000001')) #>> '{matches,0,specificationLabel}' = '40개 x 2', 'package label uses existing each and count rule');
reset role;

select 'public_barcode_lookup_pass' as result, count(*) as checks from barcode_probe_results;
rollback;
