import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260907100000_standalone_price_observation_v3.sql", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

const ingestionFunction = migration.slice(
  migration.indexOf("create or replace function public.ingest_verified_standalone_price_observation_v1"),
  migration.indexOf("comment on function public.ingest_verified_standalone_price_observation_v1"),
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
    expect(ingestionFunction).toContain("'transcription_status', '') <> 'user_verified'");
    expect(ingestionFunction).toContain("observed_on or observed_at is required");
    expect(ingestionFunction).toContain("external JSON must not contain UUID or PriceTrace identity fields");
    expect(ingestionFunction).toContain("quantity multiplied by unit_price must equal net_price");
    expect(ingestionFunction).toContain("gross_price minus discount must equal net_price");
    expect(migration).toContain("grant execute on function public.ingest_verified_standalone_price_observation_v1(text, jsonb)");
    expect(ingestionFunction).not.toContain("p_observation ->> 'receipt_id'");
    expect(ingestionFunction).not.toContain("p_observation ->> 'receipt_item_id'");
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
    expect(ingestionFunction).toContain("retail product candidate resolves to ambiguous canonical identities");
    expect(ingestionFunction).toContain("restaurant identity is ambiguous");
  });
});
