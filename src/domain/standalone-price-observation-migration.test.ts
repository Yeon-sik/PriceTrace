import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const legacyMigration = readFileSync(
  new URL("../../supabase/migrations/20260907100000_standalone_price_observation_v3.sql", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const alignmentMigration = readFileSync(
  new URL("../../supabase/migrations/20260911120000_align_yeonsik_ocr_v3_identity_precision.sql", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const migration = `${legacyMigration}\n${alignmentMigration}`;

const ingestionFunction = alignmentMigration.slice(
  alignmentMigration.indexOf("create or replace function public.ingest_verified_standalone_price_observation_v1"),
  alignmentMigration.indexOf("comment on function public.ingest_verified_standalone_price_observation_v1"),
);

describe("standalone price observation v3 migration contract", () => {
  it("makes receipt identity optional without changing the legacy default", () => {
    expect(migration).toContain("alter column receipt_item_id drop not null");
    expect(migration).toContain("observation_kind text not null default 'receipt_purchase'");
    expect(migration).toContain("observation_kind = 'receipt_purchase'");
    expect(migration).toContain("receipt_item_id is null");
    expect(migration).toContain("create table public.standalone_price_observation_ingestion_requests");
  });

  it("enforces the verified wire contract and server-owned identity", () => {
    expect(ingestionFunction).toContain("'retail_purchase', 'restaurant_purchase'");
    expect(ingestionFunction).toContain("'source_evidence', 'manual_canonical_review'");
    expect(ingestionFunction).toContain("<> 'user_verified'");
    expect(ingestionFunction).toContain("observed_on or observed_at is required");
    expect(ingestionFunction).toContain("external JSON must not contain UUID or PriceTrace identity fields");
    expect(ingestionFunction).toContain("quantity multiplied by unit_price must equal net_price when all are known");
    expect(ingestionFunction).toContain("gross_price minus discount must equal net_price when all are known");
    expect(migration).toContain("grant execute on function public.ingest_verified_standalone_price_observation_v1(text, jsonb)");
    expect(ingestionFunction).not.toContain("p_observation ->> 'receipt_id'");
    expect(ingestionFunction).not.toContain("p_observation ->> 'receipt_item_id'");
  });

  it("requires a PriceTrace Product Candidate projection and keeps SKU separate", () => {
    expect(alignmentMigration).toContain("add column client_key text");
    expect(alignmentMigration).toContain("add column sub_brand text");
    expect(alignmentMigration).toContain("create table public.product_candidate_authority_projections");
    expect(alignmentMigration).toContain("alter function public.submit_product_candidate_v1(text, jsonb)");
    expect(alignmentMigration).toContain("rename to submit_product_candidate_v1_legacy");
    expect(ingestionFunction).toContain("product_client_key");
    expect(ingestionFunction).toContain("merchant_sku");
    expect(ingestionFunction).toContain("retail product candidate authority projection is required before a price observation");
    expect(ingestionFunction).not.toContain("source_product_mappings");
  });

  it("preserves nullable price facts and date precision", () => {
    expect(alignmentMigration).toContain("alter column unit_price_krw drop not null");
    expect(alignmentMigration).toContain("alter column quantity drop not null");
    expect(alignmentMigration).toContain("at least one observed price fact is required");
    expect(ingestionFunction).toContain("v_observed_at_exact := null");
    expect(ingestionFunction).toContain("substring(v_observed_at_text from 1 for 10)::date");
    expect(ingestionFunction).toContain("v_discount_price is not null");
  });

  it("resolves retail and restaurant identities through existing ownership tables", () => {
    expect(ingestionFunction).toContain("insert into public.stores");
    expect(ingestionFunction).toContain("insert into public.products");
    expect(ingestionFunction).toContain("insert into public.store_products");
    expect(ingestionFunction).toContain("insert into public.price_observations");
    expect(ingestionFunction).toContain("insert into public.restaurants");
    expect(ingestionFunction).toContain("insert into public.restaurant_locations");
    expect(ingestionFunction).toContain("insert into public.restaurant_menus");
    expect(ingestionFunction).toContain("insert into public.restaurant_menu_manual_observations");
    expect(ingestionFunction).toContain("retail product identity is ambiguous");
    expect(ingestionFunction).toContain("restaurant identity is ambiguous");
  });
});
