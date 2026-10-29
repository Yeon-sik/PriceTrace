import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260813120000_admin_unverified_manual_registration.sql", import.meta.url),
  "utf8",
);
const productFunction = migration.slice(
  migration.indexOf("create or replace function public.admin_register_unverified_product_sale_v1"),
  migration.indexOf("comment on function public.admin_register_unverified_product_sale_v1"),
);
const restaurantFunction = migration.slice(
  migration.indexOf("create or replace function public.admin_register_unverified_restaurant_menu_v1"),
  migration.indexOf("comment on function public.admin_register_unverified_restaurant_menu_v1"),
);

describe("admin unverified registration migration contract", () => {
  it("creates separate manual observation and append-only audit tables", () => {
    expect(migration).toContain("create table public.restaurant_menu_manual_observations");
    expect(migration).toContain("create table public.admin_unverified_product_sale_registrations");
    expect(migration).toContain("create table public.restaurant_menu_manual_registration_executions");
    expect(migration).toContain("restaurant_menu_manual_observations_append_only");
    expect(migration).toContain("restaurant_menu_manual_registration_executions_append_only");
    expect(migration).toContain("source_snapshot jsonb not null");
    expect(migration).toContain("verification_status text not null default 'unverified'");
  });

  it("requires admin metadata and writes an unverified result", () => {
    expect(productFunction).toContain("'app_metadata' ->> 'role'");
    expect(productFunction).toContain("'unverified'");
    expect(productFunction).not.toContain("receipt");
    expect(restaurantFunction).toContain("'app_metadata' ->> 'role'");
    expect(restaurantFunction).toContain("btrim(p_source_namespace) <> 'admin-manual'");
    expect(restaurantFunction).toContain("'unverified'");
    expect(restaurantFunction).not.toContain("receipt");
  });

  it("keeps direct authenticated reads and public product projection inside verified data", () => {
    expect(migration).toContain("verification_status = 'verified'");
    expect(migration).toContain("verified catalog products readable by signed in users");
    expect(migration).toContain("verified standard products readable by signed in users");
    expect(migration).toContain("catalog.verification_status = 'verified'");
    expect(migration).toContain("standard.verification_status = 'verified'");
    expect(migration).toContain("mapping.verification_status = 'verified'");
    expect(migration).toContain("restaurants_unverified_review_check");
    expect(migration).toContain("restaurant_menus_unverified_review_check");
  });
});
