import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(path.join(process.cwd(), "supabase/migrations/20260827090000_verified_receipt_ingestion_v2.sql"), "utf8").replace(/\r\n/g, "\n");

describe("verified receipt ingestion v2 migration contract", () => {
  it("keeps the old restaurant RPC and adds a generic verified boundary", () => {
    expect(migration).toContain("create or replace function public.submit_verified_receipt_v2");
    expect(migration).toContain("grant execute on function public.submit_verified_receipt_v2(text, jsonb) to authenticated");
    expect(migration).toContain("submit_restaurant_receipt_v1");
    expect(migration).toContain("transcription_status = 'user_verified'");
    expect(migration).toContain("source_images");
    expect(migration).toContain("raw_text");
    expect(migration).toContain("payment reference");
    expect(migration).toContain("p_receipt -> 'document' ->> 'currency' is distinct from 'KRW'");
    expect(migration).toContain("v_source ->> 'transcription_status' is distinct from 'user_verified'");
    expect(migration).toContain("payment -> 'reference' is distinct from 'null'::jsonb");
    expect(migration).toContain("receipt.v2 contains unsupported identity or source fields");
    expect(migration).toContain("receipt.v2 line items contain unsupported identity fields");
    expect(migration).toContain("merchant profile contains unsupported identity fields");
    expect(migration).not.toContain("p_receipt -> 'document' ->> 'currency' <> 'KRW'");
  });

  it("preserves all receipt monetary semantics and reconciles refunds", () => {
    for (const lineType of ["product", "service", "discount", "fee", "tax", "tip", "refund", "rounding", "other"]) expect(migration).toContain(`'${lineType}'`);
    expect(migration).toContain("v_items_gross - v_total_discount + v_total_tax + v_total_fee + v_total_tip + v_total_rounding + v_refund");
    expect(migration).toContain("verified_receipt_source_lines");
    expect(migration).toContain("product/service net amount reconciliation failed");
    expect(migration).toContain("gross_amount_minor')::numeric");
    expect(migration).toContain("net_amount_minor')::numeric");
  });

  it("guards retries and refuses client-owned catalog identity", () => {
    expect(migration).toContain("primary key (user_id, idempotency_key)");
    expect(migration).toContain("create table public.verified_receipt_ingestion_contents");
    expect(migration).toContain("primary key (user_id, request_fingerprint)");
    expect(migration).toContain("insert into public.verified_receipt_ingestion_requests(");
    expect(migration).toContain("v_duplicate.receipt_id, v_duplicate.response");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("return v_duplicate.response || jsonb_build_object('replayed', false, 'deduplicated', true)");
    expect(migration).not.toContain("insert into public.catalog_products");
    expect(migration).toContain("source_product_mappings");
    expect(migration).toContain("restaurant_menu_source_mappings");
    expect(migration.indexOf("insert into public.products")).toBeGreaterThan(migration.indexOf("if v_quantity is not null and v_unit = 'each'"));
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
    expect(migration).toContain("restaurant registration requires an exact source location identity; no fake source identity will be created");
    expect(migration).toContain("v_existing.business_kind = 'food_service' and p_restaurant_location_id is null");
    expect(migration).toContain("p_merchant ->> 'business_kind' is null");
  });

  it("maps the receipt.v2 type key in the aggregate query", () => {
    expect(migration).toContain('as line(\n    "type" text, gross_amount_minor integer');
    expect(migration).toContain('line."type" in (\'product\', \'service\')');
    expect(migration).not.toContain("as line(\n    line_type text, gross_amount_minor integer");
  });
});
