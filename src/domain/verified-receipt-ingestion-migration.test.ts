import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.join(process.cwd(), "supabase/migrations/20260827090000_verified_receipt_ingestion_v2.sql"), "utf8");

describe("verified receipt ingestion v2 migration contract", () => {
  it("keeps the old restaurant RPC and adds a generic verified boundary", () => {
    expect(migration).toContain("create or replace function public.submit_verified_receipt_v2");
    expect(migration).toContain("grant execute on function public.submit_verified_receipt_v2(text, jsonb) to authenticated");
    expect(migration).toContain("submit_restaurant_receipt_v1");
    expect(migration).toContain("transcription_status = 'user_verified'");
    expect(migration).toContain("source_images");
    expect(migration).toContain("raw_text");
    expect(migration).toContain("payment reference");
  });

  it("preserves all receipt monetary semantics and reconciles refunds", () => {
    for (const lineType of ["product", "service", "discount", "fee", "tax", "tip", "refund", "rounding", "other"]) expect(migration).toContain(`'${lineType}'`);
    expect(migration).toContain("v_items_gross - v_total_discount + v_total_tax + v_total_fee + v_total_tip + v_total_rounding + v_refund");
    expect(migration).toContain("verified_receipt_source_lines");
  });

  it("guards retries and refuses client-owned catalog identity", () => {
    expect(migration).toContain("primary key (user_id, idempotency_key)");
    expect(migration).toContain("unique (user_id, request_fingerprint)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("return v_duplicate.response || jsonb_build_object('replayed', false, 'deduplicated', true)");
    expect(migration).not.toContain("insert into public.catalog_products");
    expect(migration).toContain("source_product_mappings");
    expect(migration).toContain("restaurant_menu_source_mappings");
  });

  it("keeps branch and menu resolution exact and preserves option parents", () => {
    expect(migration).toContain("location.location_label = v_branch_name");
    expect(migration).toContain("menu.canonical_name = v_description");
    expect(migration).toContain("v_menu_match_count = 1");
    expect(migration).toContain("receipt_item_menu_option_sources");
    expect(migration).toContain("auto_link_restaurant_menu_options_for_receipt");
    expect(migration).toContain("unresolved_catalog");
  });

  it("provides an explicit verified merchant-only candidate workflow", () => {
    expect(migration).toContain("submit_merchant_identity_candidate_v1");
    expect(migration).toContain("admin_resolve_merchant_identity_candidate_v1");
    expect(migration).toContain("admin_register_restaurant_from_merchant_candidate_v1");
    expect(migration).toContain("merchant facts require explicit user verification");
    expect(migration).toContain("never auto-creates a canonical restaurant");
    expect(migration).toContain("merchant identity candidate was already resolved");
  });
});
