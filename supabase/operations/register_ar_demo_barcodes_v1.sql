-- Operational data procedure, NOT a global data migration.
-- Two item-specific user confirmations are recorded below. Requires an operator
-- connection and separate user approval immediately before remote execution.
-- Do not change a target or broaden the scope without a new user confirmation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
lock table public.catalog_product_identifiers in share row exclusive mode;

do $registration$
declare
  v_target record;
  v_targets jsonb := '[
    {
      "barcode":"8801104671507",
      "catalog_id":"1516c3eb-3dfb-4e11-8040-d23fadcdaad0",
      "standard_id":"8510a217-fe6c-473b-8c14-2cba4a301e40",
      "name":"더단백 크런치바 초코",
      "amount":40,
      "provenance":{
        "source_type":"physical_package",
        "confirmed_on":"2026-10-23",
        "confirmed_by":"user",
        "comparison_fields":{
          "product_name":"더단백 크런치바 초코",
          "brand":"빙그레",
          "content_amount":40,
          "content_unit":"g",
          "package_count":1,
          "barcode":"8801104671507"
        }
      }
    },
    {
      "barcode":"8809375984692",
      "catalog_id":"18e83c5c-86a4-4e95-a131-411381789687",
      "standard_id":"f927e84d-9b57-4c6f-b1dc-80710c63f307",
      "name":"테아닌과 밀크씨슬 활력솔루션",
      "amount":60,
      "provenance":{
        "source_type":"physical_package",
        "evidence_observed_on":"2026-10-26",
        "confirmed_on":"2026-10-27",
        "confirmed_by":"user",
        "identity_confirmation":"User explicitly confirmed this physical package is PT catalog 18e83c5c-86a4-4e95-a131-411381789687 in the implementation conversation.",
        "comparison_fields":{
          "product_name":"테아닌과 밀크씨슬 활력솔루션",
          "brand":"Dr.Elizabeth''s",
          "tablet_amount_mg":1000,
          "tablet_count":60,
          "content_amount":60,
          "content_unit":"g",
          "package_count":1,
          "barcode":"8809375984692"
        }
      }
    }
  ]'::jsonb;
begin
  for v_target in select * from pg_catalog.jsonb_to_recordset(v_targets)
    as t(barcode text, catalog_id uuid, standard_id uuid, name text, amount numeric, provenance jsonb)
  loop
    -- Keep catalog state stable until the identifier transaction commits.
    perform catalog.id from public.catalog_products as catalog
    inner join public.standard_products as standard on standard.id = catalog.standard_product_id
    where catalog.id = v_target.catalog_id and standard.id = v_target.standard_id
      and standard.canonical_name = v_target.name
      and catalog.status = 'active' and standard.status = 'active'
      and catalog.content_amount = v_target.amount and catalog.content_unit = 'g' and catalog.package_count = 1
    for share of catalog, standard;
    if not found or pg_catalog.jsonb_array_length(
      public.get_product_read_v1(v_target.catalog_id, null, 1) -> 'products'
    ) <> 1 then
      raise exception 'STOP: approved catalog identity/specification is missing, changed, or not public: %', v_target.catalog_id;
    end if;

    -- Covers cross-scheme collisions, including pending/rejected on the SAME
    -- product. Never use ON CONFLICT DO UPDATE to promote or overwrite a row.
    if exists (
      select 1 from public.catalog_product_identifiers as identifier
      where identifier.identifier_value = v_target.barcode
        and (identifier.catalog_product_id <> v_target.catalog_id or identifier.verification_status <> 'verified')
    ) then
      raise exception 'STOP: barcode % already has a different target or pending/rejected review; no rows committed', v_target.barcode;
    end if;

    insert into public.catalog_product_identifiers(
      catalog_product_id, identifier_scheme, identifier_value, verification_status, provenance, reviewed_at
    )
    select v_target.catalog_id, 'ean', v_target.barcode, 'verified', v_target.provenance, pg_catalog.statement_timestamp()
    where not exists (
      select 1 from public.catalog_product_identifiers as identifier
      where identifier.identifier_scheme = 'ean' and identifier.identifier_value = v_target.barcode
    );
    -- No auth.users UUID was supplied for this human confirmation. reviewed_by
    -- stays NULL; the confirmation actor/date/fields live in private provenance.
  end loop;
end;
$registration$;

select identifier_value as barcode, catalog_product_id, verification_status
from public.catalog_product_identifiers
where identifier_scheme = 'ean' and identifier_value in ('8801104671507', '8809375984692')
order by identifier_value;
commit;
