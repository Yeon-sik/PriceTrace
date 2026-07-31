-- Remove legacy write entry points now that the strict RPC is deployed.
-- Existing functions remain readable in migration history, but application
-- roles cannot use them to bypass collision and idempotency checks.

revoke execute on function public.register_standard_product_with_coupang_price(
  uuid, text, text, text, text, numeric, text, integer, integer, text, text[],
  text, integer, numeric, text, integer, integer
) from anon, authenticated;

revoke execute on function public.register_standard_product_with_coupang_offer(
  uuid, text, text, text, text, numeric, text, integer, integer, text, text[],
  text, integer, integer, numeric, text, integer, integer
) from anon, authenticated;

revoke execute on function public.register_standard_product_with_brand_and_coupang_offer(
  uuid, text, text, text, text, text, text, text, text, numeric, text, integer,
  integer, text, text[], text, integer, integer, numeric, text, integer, integer
) from anon, authenticated;

alter table public.standard_product_coupang_prices
  add constraint standard_product_coupang_prices_new_rows_require_catalog
  check (catalog_product_id is not null)
  not valid;

create function public.validate_exact_coupang_price_variant()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.catalog_product_id is null
    or not exists (
      select 1
      from public.catalog_products as catalog
      where catalog.id = new.catalog_product_id
        and catalog.standard_product_id = new.standard_product_id
    )
  then
    raise exception 'A Coupang observation must identify a catalog variant in the same standard product.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_exact_coupang_price_variant
before insert or update of standard_product_id, catalog_product_id
on public.standard_product_coupang_prices
for each row execute function public.validate_exact_coupang_price_variant();

create function public.prevent_source_mapping_catalog_overwrite()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.catalog_product_id <> old.catalog_product_id
  then
    raise exception 'A source identity mapping cannot be overwritten. Delete and recreate it after explicit review.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger prevent_source_mapping_catalog_overwrite
before update of catalog_product_id
on public.source_product_mappings
for each row execute function public.prevent_source_mapping_catalog_overwrite();

comment on constraint standard_product_coupang_prices_new_rows_require_catalog
  on public.standard_product_coupang_prices is
  'Legacy family-only rows remain unvalidated; all new observations require an exact catalog variant.';
comment on function public.prevent_source_mapping_catalog_overwrite() is
  'Fails closed when an existing source identity is reassigned. Explicit review must delete and recreate the mapping.';

revoke all on function public.validate_exact_coupang_price_variant() from public;
revoke all on function public.prevent_source_mapping_catalog_overwrite() from public;
