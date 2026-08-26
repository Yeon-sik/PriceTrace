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
const fulfillmentMigration = readFileSync(
  new URL("../../supabase/migrations/20260825154433_restaurant_fulfillment_modes.sql", import.meta.url),
  "utf8",
);
const profileEditorMigration = readFileSync(
  new URL("../../supabase/migrations/20260825163530_admin_restaurant_profile_editing.sql", import.meta.url),
  "utf8",
);
const optionSourceMigration = readFileSync(
  new URL("../../supabase/migrations/20260826113000_receipt_menu_option_sources.sql", import.meta.url),
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

  it("projects only admin-confirmed restaurant fulfilment modes without receipt identities", () => {
    expect(fulfillmentMigration).toContain("create table public.restaurant_fulfillment_evidence");
    expect(fulfillmentMigration).toContain("alter table public.restaurant_fulfillment_evidence enable row level security");
    expect(fulfillmentMigration).toContain("admin_confirm_restaurant_fulfillment_manual_v1");
    expect(fulfillmentMigration).toContain("admin_confirm_restaurant_fulfillment_from_receipt_v1");
    expect(fulfillmentMigration).toContain("restaurant_id = p_restaurant_id");
    expect(fulfillmentMigration).toContain("receipt_observation_id = p_receipt_observation_id");
    expect(fulfillmentMigration).toContain("'{restaurant,fulfillmentModes}'");
    expect(fulfillmentMigration).toContain("'type', chosen.fulfillment_type");
    expect(fulfillmentMigration).toContain("'evidence', chosen.evidence_type");
    expect(fulfillmentMigration).not.toContain("'receiptObservationId'");
  });

  it("keeps profile contact edits at an exact location behind administrator RPCs and an append-only audit", () => {
    expect(profileEditorMigration).toContain("add column business_registration_number");
    expect(profileEditorMigration).toContain("create table public.restaurant_profile_update_audits");
    expect(profileEditorMigration).toContain("restaurant_profile_update_audits enable row level security");
    expect(profileEditorMigration).toContain("Restaurant profile update audits are append-only");
    expect(profileEditorMigration).toContain("admin_list_restaurant_profile_editors_v1");
    expect(profileEditorMigration).toContain("admin_update_restaurant_profile_editor_v1");
    expect(profileEditorMigration).toContain("'app_metadata' ->> 'role'");
    expect(profileEditorMigration).toContain("location.id = p_restaurant_location_id");
    expect(profileEditorMigration).toContain("사업자등록번호는 숫자 10자리여야 합니다.");
    expect(profileEditorMigration).toContain("수정 근거 URL은 HTTP(S) 주소여야 합니다.");
    expect(profileEditorMigration).toContain("revoke all on function public.admin_update_restaurant_profile_editor_v1");
  });

  it("keeps receipt-v2 option parents as user-owned evidence until exact menu registration", () => {
    expect(optionSourceMigration).toContain("create table public.receipt_item_menu_option_sources");
    expect(optionSourceMigration).toContain("option_receipt_item_id text primary key");
    expect(optionSourceMigration).toContain("parent_receipt_item_id text not null");
    expect(optionSourceMigration).toContain("receipt option sources own rows");
    expect(optionSourceMigration).toContain("receipt-v2-explicit-option-parent");
    expect(optionSourceMigration).toContain("'side'");
    expect(optionSourceMigration).toContain("if v_parent_menu_id is null then");
  });
});
