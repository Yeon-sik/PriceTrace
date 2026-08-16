import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260809120000_product_read_v1.sql", import.meta.url),
  "utf8",
);

describe("product-read.v1 migration contract", () => {
  it("publishes the versioned RPC to browser-safe roles", () => {
    expect(migration).toContain("create function public.get_product_read_v1");
    expect(migration).toContain("'schemaVersion', 'product-read.v1'");
    expect(migration).toContain("'namespace', 'pricetrace'");
    expect(migration).toContain("extensions.digest(");
    expect(migration).toContain("grant execute on function public.get_product_read_v1(uuid, text, integer) to anon");
    expect(migration).toContain("grant execute on function public.get_product_read_v1(uuid, text, integer) to authenticated");
  });

  it("uses only verified public catalog boundaries and never opens private receipt rows", () => {
    expect(migration).toContain("mapping.review_status = 'verified'");
    expect(migration).toContain("observation.verification_status = 'verified'");
    expect(migration).not.toContain("public.price_observations");
    expect(migration).not.toContain("public.receipts");
    expect(migration).not.toContain("service_role");
  });

  it("does not create a PriceTrace-side nutrition link table", () => {
    expect(migration).not.toMatch(/create table[\s\S]*nutrition/i);
    expect(migration).not.toMatch(/localstorage/i);
  });
});
