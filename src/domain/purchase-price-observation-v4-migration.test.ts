import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260911140000_purchase_price_observation_v4.sql", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

const ingestionFunction = migration.slice(
  migration.indexOf("create or replace function public.ingest_verified_purchase_price_observation_v1"),
  migration.indexOf("comment on function public.ingest_verified_purchase_price_observation_v1"),
);
const productCandidateOrderHistoryMigration = readFileSync(
  new URL("../../supabase/migrations/20260911150000_product_candidate_order_history_allowlist.sql", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const productCandidateOrderHistoryVocabularyFollowUpMigration = readFileSync(
  new URL("../../supabase/migrations/20260911160000_product_candidate_order_history_ocr_fields.sql", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("purchase price observation v4 migration contract", () => {
  it("adds isolated source, line, and replay records", () => {
    expect(migration).toContain("create table public.purchase_price_sources");
    expect(migration).toContain("create table public.purchase_price_source_lines");
    expect(migration).toContain("create table public.purchase_price_observation_ingestion_contents");
    expect(migration).toContain("create table public.purchase_price_observation_ingestion_requests");
    expect(migration).toContain("purchase_price_sources_append_only");
    expect(migration).toContain("purchase_price_source_lines_append_only");
  });

  it("keeps platform and confirmed seller as separate facts", () => {
    expect(ingestionFunction).toContain("'platform',");
    expect(ingestionFunction).toContain("'seller',");
    expect(ingestionFunction).toContain("'order',");
    expect(ingestionFunction).toContain("'payment',");
    expect(ingestionFunction).toContain("v_platform_name := nullif");
    expect(ingestionFunction).toContain("v_seller_name := nullif");
    expect(ingestionFunction).toContain("'platform', v_platform");
    expect(ingestionFunction).toContain("'seller', v_effective_seller");
    expect(ingestionFunction).not.toContain("v_seller_name := v_platform_name");
    expect(ingestionFunction).not.toContain("merchant_name, v_platform_name");
    expect(ingestionFunction).not.toContain("v_seller_name := v_platform");
  });

  it("rejects injected identities and resolves Product Candidate keys server-side", () => {
    expect(ingestionFunction).toContain("external JSON must not contain UUID or PriceTrace identity fields");
    expect(ingestionFunction).toContain("client_key and product_client_key must identify the same Product Candidate");
    expect(ingestionFunction).toContain("product_client_key must be an opaque local reference");
    expect(ingestionFunction).toContain("product_candidate_authority_projections");
    expect(ingestionFunction).toContain("merchant_sku cannot reuse product_client_key");
    expect(ingestionFunction).toContain("v_purchase_kind = 'retail' and v_product_client_key is null");
    expect(ingestionFunction).not.toContain("p_purchase ->> 'catalog_product_id'");
    expect(ingestionFunction).not.toContain("p_purchase ->> 'store_id'");
  });

  it("keeps order-history candidate evidence sanitized and scoped to product facts", () => {
    expect(productCandidateOrderHistoryMigration).toContain("source_type' = 'order_history'");
    expect(productCandidateOrderHistoryMigration).toContain("order_history evidence must contain one observed product source fact");
    expect(productCandidateOrderHistoryMigration).toContain("'product_name', 'option_text', 'merchant_sku'");
    expect(productCandidateOrderHistoryMigration).toContain("jsonb_set(");
    expect(productCandidateOrderHistoryMigration).toContain("to_jsonb('ocr'::text)");
    expect(productCandidateOrderHistoryMigration).toContain("evidence = p_candidate -> 'evidence'");
    expect(productCandidateOrderHistoryMigration).toContain("client_key must be an opaque local reference, not a PriceTrace UUID");
    expect(productCandidateOrderHistoryMigration).toContain("submit_product_candidate_v1_legacy");
  });

  it("extends the applied order-history allowlist with the OCR vocabulary", () => {
    expect(productCandidateOrderHistoryVocabularyFollowUpMigration).toContain("20260911150000");
    for (const field of [
      "product_name",
      "brand",
      "manufacturer",
      "variant",
      "specification",
      "content_amount",
      "content_unit",
      "package_count",
      "option_text",
      "merchant_sku",
      "sub_brand",
    ]) {
      expect(productCandidateOrderHistoryVocabularyFollowUpMigration).toContain(`'${field}'`);
    }
    expect(productCandidateOrderHistoryVocabularyFollowUpMigration).not.toContain("'barcode'");
    expect(productCandidateOrderHistoryVocabularyFollowUpMigration).toContain("pg_get_functiondef");
    expect(productCandidateOrderHistoryVocabularyFollowUpMigration).toContain("regexp_replace");
  });

  it("adds explicit purchase semantics, settlement gating, and line-level sellers", () => {
    expect(migration).toContain("purchase_kind in ('retail', 'restaurant', 'other', 'unknown')");
    expect(ingestionFunction).toContain("purchase_kind and kind must describe the same purchase semantics");
    expect(ingestionFunction).toContain("v_purchase_kind not in ('retail', 'restaurant')");
    expect(ingestionFunction).toContain("v_transaction_state = 'refunded'");
    expect(ingestionFunction).toContain("v_transaction_state = 'cancelled'");
    expect(ingestionFunction).toContain("v_transaction_state = 'pending'");
    expect(ingestionFunction).toContain("v_transaction_state = 'unknown'");
    expect(migration).toContain("'seller'\n      )");
    expect(migration).toContain("line_seller_status");
    expect(ingestionFunction).toContain("A marketplace may put the merchant on each order line");
    expect(ingestionFunction).toContain("'purchaseKind', v_purchase_kind");
    expect(ingestionFunction).toContain("'transactionState', v_transaction_state");
  });

  it("preserves independent dates and nullable price facts", () => {
    expect(migration).toContain("ordered_on date");
    expect(migration).toContain("ordered_at_exact timestamptz");
    expect(migration).toContain("paid_on date");
    expect(migration).toContain("paid_at_exact timestamptz");
    expect(ingestionFunction).toContain("ordered_on and ordered_at refer to different calendar dates");
    expect(ingestionFunction).toContain("paid_on and paid_at refer to different calendar dates");
    expect(ingestionFunction).toContain("v_discount_price_int");
    expect(ingestionFunction).toContain("v_effective_observed_at_exact := v_ordered_at_exact");
    expect(ingestionFunction).toContain("v_effective_observed_at_exact := v_paid_at_exact");
  });

  it("blocks payment-only and ambiguous lines before identity creation", () => {
    expect(ingestionFunction).toContain("v_line_reason := 'product_price_unknown'");
    expect(ingestionFunction).toContain("v_line_reason := 'product_price_ambiguous'");
    expect(ingestionFunction).toContain("v_line_reason := 'seller_unknown'");
    expect(ingestionFunction).toContain("v_line_reason := 'order_and_payment_date_unknown'");
    expect(ingestionFunction).toContain("items must be an array or null");
    expect(ingestionFunction).toContain("insert into public.purchase_price_sources");
    expect(ingestionFunction).toContain("insert into public.purchase_price_source_lines");
    expect(ingestionFunction).toContain("'not_created'");
    expect(migration).toContain("never uses payment totals to create line observations");
  });

  it("reuses existing retail and restaurant authority without changing V3", () => {
    expect(ingestionFunction).toContain("insert into public.stores");
    expect(ingestionFunction).toContain("insert into public.products");
    expect(ingestionFunction).toContain("insert into public.store_products");
    expect(ingestionFunction).toContain("insert into public.price_observations");
    expect(ingestionFunction).toContain("public.restaurant_locations");
    expect(ingestionFunction).toContain("public.restaurant_menus");
    expect(ingestionFunction).toContain("insert into public.restaurant_menu_manual_observations");
    expect(ingestionFunction).toContain("restaurant.review_status = 'verified'");
    expect(ingestionFunction).toContain("menu.review_status = 'verified'");
    expect(ingestionFunction).not.toContain("insert into public.restaurants");
    expect(ingestionFunction).not.toContain("insert into public.restaurant_locations");
    expect(ingestionFunction).not.toContain("insert into public.restaurant_menus");
    expect(ingestionFunction).toContain("'standalone_purchase'");
    expect(ingestionFunction).not.toContain("alter function public.ingest_verified_standalone_price_observation_v1");
    expect(ingestionFunction).not.toContain("drop function public.ingest_verified_standalone_price_observation_v1");
  });
});
