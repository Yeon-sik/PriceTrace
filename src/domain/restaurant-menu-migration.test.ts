import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260812110235_restaurant_menu_price_tracking.sql", import.meta.url),
  "utf8",
);
const directoryMigration = readFileSync(
  new URL("../../supabase/migrations/20260812170053_restaurant_directory_and_detail.sql", import.meta.url),
  "utf8",
);
const publicReadFunction = migration.slice(
  migration.indexOf("create function public.get_restaurant_menu_read_v1"),
  migration.indexOf("create function public.get_admin_restaurant_menu_receipt_candidates_v1"),
);

describe("restaurant-menu-read.v1 migration contract", () => {
  it("separates restaurant, source identity, menu, and menu prices", () => {
    expect(migration).toContain("create table public.restaurants");
    expect(migration).toContain("create table public.restaurant_locations");
    expect(migration).toContain("create table public.restaurant_menus");
    expect(migration).toContain("create table public.restaurant_menu_source_mappings");
    expect(migration).toContain("create table public.restaurant_menu_receipt_observations");
    expect(migration).toContain("catalog_product_id uuid not null unique");
    expect(migration).toContain("source_product_code_namespace");
    expect(migration).toContain("foreign key (restaurant_id, restaurant_menu_id)");
    expect(migration).toContain("alter column store_product_code drop not null");
    expect(migration).toContain("where store_product_code is not null");
    expect(migration).toContain("if v_store_product_code is not null");
  });

  it("publishes only the verified, versioned public projection", () => {
    expect(migration).toContain("create function public.get_restaurant_menu_read_v1");
    expect(migration).toContain("'schemaVersion', 'restaurant-menu-read.v1'");
    expect(migration).toContain("'namespace', 'pricetrace'");
    expect(publicReadFunction).toContain("restaurant.review_status = 'verified'");
    expect(publicReadFunction).toContain("menu.review_status = 'verified'");
    expect(publicReadFunction).toContain("observation.verification_status = 'verified'");
    expect(migration).toContain("grant execute on function public.get_restaurant_menu_read_v1(uuid, uuid, text, integer) to anon");
    expect(publicReadFunction).not.toContain("from public.receipts");
    expect(publicReadFunction).not.toContain("from public.receipt_items");
    expect(publicReadFunction).not.toContain("businessRegistrationNumber");
    expect(publicReadFunction).not.toContain("evidence_snapshot");
  });

  it("keeps receipt evidence and write authority behind an admin-only idempotent RPC", () => {
    expect(migration).toContain("create function public.admin_register_restaurant_menu_from_receipt_v1");
    expect(migration).toContain("p_price_observation_id uuid");
    expect(migration).toContain("from public.price_observations as observation");
    expect(migration).toContain("inner join public.receipt_items as item");
    expect(migration).toContain("inner join public.receipts as receipt");
    expect(migration).toContain("product.purchase_type = 'menu_item'");
    expect(migration).toContain("v_total_price_krw <> v_unit_price_krw * v_quantity");
    expect(migration).toContain("'app_metadata' ->> 'role'");
    expect(migration).toContain("restaurant_menu_registration_executions");
    expect(migration).toContain("are append-only");
    expect(migration).toContain("revoke all on public.restaurants");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("if v_restaurant_menu_id is null and v_source_mapping_menu_id is not null");
    expect(migration).toContain("v_restaurant_menu_id := v_source_mapping_menu_id");
  });

  it("does not weaken retail specification or Nutrition ownership boundaries", () => {
    expect(migration).toContain("purchase_type = 'menu_item'");
    expect(migration).toContain("specification_status = 'placeholder'");
    expect(migration).toContain("catalog.purchase_type = 'retail_product'");
    expect(migration).toContain("standard.purchase_type = 'retail_product'");
    expect(migration).not.toMatch(/create table public\..*nutrition/i);
    expect(migration).not.toMatch(/name.*auto.*match/i);
  });

  it("keeps list metadata and exact restaurant detail in separate public RPCs", () => {
    expect(directoryMigration).toContain("create or replace function public.get_restaurant_directory_v1");
    expect(directoryMigration).toContain("create or replace function public.get_restaurant_detail_v1");
    expect(directoryMigration).toContain("restaurant-directory.v1");
    expect(directoryMigration).toContain("restaurant-detail.v1");
    expect(directoryMigration).toContain("restaurant.review_status = 'verified'");
    expect(directoryMigration).toContain("menu.review_status = 'verified'");
    expect(directoryMigration).toContain("count(distinct menu.id)::integer as menu_count");
    expect(directoryMigration).toContain("observation.verification_status = 'verified'");
    expect(directoryMigration).toContain("revoke all on function public.get_restaurant_directory_v1");
    expect(directoryMigration).toContain("grant execute on function public.get_restaurant_directory_v1(text, integer)");
    expect(directoryMigration).toContain("grant execute on function public.get_restaurant_detail_v1(uuid)");
    expect(directoryMigration).not.toContain("evidence_snapshot");
  });
});
