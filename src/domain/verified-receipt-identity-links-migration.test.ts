import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260901090000_verified_receipt_identity_links.sql"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("verified receipt identity link migration contract", () => {
  it("stores a server-owned ordinal and every identity layer on source lines", () => {
    for (const column of ["line_ordinal", "product_id", "store_product_id", "catalog_product_id", "restaurant_menu_id"]) {
      expect(migration).toContain(`add column ${column}`);
    }
    expect(migration).toContain("verified_receipt_source_lines_ordinal_key");
    expect(migration).toContain("One-based source line order assigned by the PriceTrace server");
    expect(migration).toContain("'lineOrdinal', v_ordinal");
    expect(migration).toContain("'productId'");
    expect(migration).toContain("'storeProductId'");
    expect(migration).toContain("'catalogProductId'");
    expect(migration).toContain("'restaurantMenuId'");
  });

  it("keeps the old validated and idempotent RPC behind the same public name", () => {
    expect(migration).toContain("alter function public.submit_verified_receipt_v2(text, jsonb)");
    expect(migration).toContain("rename to submit_verified_receipt_v2_legacy");
    expect(migration).toContain("v_base_response := public.submit_verified_receipt_v2_legacy(p_idempotency_key, p_receipt)");
    expect(migration).toContain("private_enrich_verified_receipt_ingestion_v2");
    expect(migration).toContain("grant execute on function public.submit_verified_receipt_v2(text, jsonb)");
    expect(migration).not.toContain("p_receipt ->> 'productId'");
    expect(migration).not.toContain("p_receipt ->> 'storeProductId'");
    expect(migration).not.toContain("p_receipt ->> 'catalogProductId'");
    expect(migration).not.toContain("p_receipt ->> 'restaurantMenuId'");
  });

  it("creates a private product and seller-product reference even without a catalog match", () => {
    const helper = migration.slice(
      migration.indexOf("create or replace function public.private_enrich_verified_receipt_ingestion_v2"),
      migration.indexOf("alter function public.submit_verified_receipt_v2(text, jsonb)"),
    );
    expect(helper).toContain("if v_line_type in ('product', 'service') and v_description is not null then");
    expect(helper).toContain("insert into public.products");
    expect(helper).toContain("insert into public.store_products");
    expect(helper).toContain("store_product.store_product_code is null");
    expect(helper).toContain("pg_advisory_xact_lock");
  });

  it("exposes only authenticated, scoped private reads without raw OCR or payment storage", () => {
    expect(migration).toContain("create or replace function public.get_authenticated_identity_detail_v1");
    expect(migration).toContain("exactly one PriceTrace identity selector is required");
    expect(migration).toContain("grant execute on function public.get_authenticated_identity_detail_v1(uuid, uuid, uuid, uuid)");
    expect(migration).not.toContain("source_images");
    expect(migration).not.toContain("raw_text");
    expect(migration).not.toContain("payments");
    expect(migration).toContain("where receipt.user_id = v_user_id");
    expect(migration).toContain("where source_line.user_id = v_user_id");
  });
});
