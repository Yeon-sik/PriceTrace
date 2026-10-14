import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260812131955_price_observation_submit_v1.sql", import.meta.url),
  "utf8",
);

describe("price-observation-submit.v1 migration contract", () => {
  it("keeps public observations separate from user-owned receipt observations", () => {
    expect(migration).toContain("create table public.public_price_observations");
    expect(migration).toContain("create table public.price_observation_sources");
    expect(migration).toContain("create table public.price_observation_submission_requests");
    expect(migration).toContain("unique (store_id, observed_on, catalog_product_id, unit_price_krw)");
    expect(migration).not.toContain("receipt_item_id");
    expect(migration).not.toContain("receipt_id");
  });

  it("exposes only versioned functions and keeps direct table writes closed", () => {
    expect(migration).toContain("create or replace function public.submit_price_observation_v1");
    expect(migration).toContain("create or replace function public.get_price_observation_sources_v1");
    expect(migration).toContain("create or replace function public.get_price_observations_v1");
    expect(migration).toContain("revoke all on table public.public_price_observations from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.submit_price_observation_v1");
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("catalog.purchase_type = 'retail_product'");
  });
});
