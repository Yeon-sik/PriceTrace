import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProductReadProduct } from "./product-read";
import {
  buildOrderProductLinkRequestInput,
  orderCaptureCatalogCandidates,
} from "./order-product-link-request";

const product: ProductReadProduct = {
  revision: `sha256:${"a".repeat(64)}`,
  standardProduct: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "테스트 케이블",
    brand: "테스트 브랜드",
    updatedAt: "2026-08-20T03:00:00+09:00",
  },
  catalogProduct: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "테스트 케이블 150cm",
    specificationText: "화이트, 150cm",
    contentAmount: 1,
    contentUnit: "each",
    packageCount: 1,
    referenceUnit: 100,
    listingReferenceUrl: null,
    updatedAt: "2026-08-20T03:00:00+09:00",
  },
  sellerProducts: [
    { sellerLabel: "쿠팡", sourceProductCode: "CP-100" },
  ],
  observations: [],
};

describe("order product link request", () => {
  it("treats only an exact source label and source code as a verified mapping", () => {
    expect(orderCaptureCatalogCandidates({
      products: [product],
      sourceLabel: "쿠팡",
      sourceProductCode: "CP-100",
    })[0].exactSourceMapping).toBe(true);

    expect(orderCaptureCatalogCandidates({
      products: [product],
      sourceLabel: "쿠팡",
      sourceProductCode: null,
    })[0].exactSourceMapping).toBe(false);

    expect(orderCaptureCatalogCandidates({
      products: [product],
      sourceLabel: "coupang",
      sourceProductCode: "CP-100",
    })[0].exactSourceMapping).toBe(false);
  });

  it("uses a stable product-only fingerprint while generating a new retry id", async () => {
    const request = {
      requestKind: "link_existing" as const,
      platform: "coupang" as const,
      sourceLabel: "쿠팡",
      sellerLabel: null,
      sourceProductCode: "CP-100",
      productName: "테스트 케이블",
      optionText: "화이트, 150cm",
      suggestedStandardProductId: product.standardProduct.id,
      suggestedCatalogProductId: product.catalogProduct.id,
    };
    const first = await buildOrderProductLinkRequestInput(request);
    const second = await buildOrderProductLinkRequestInput(request);

    expect(first.requestFingerprint).toBe(second.requestFingerprint);
    expect(first.clientRequestId).not.toBe(second.clientRequestId);
    expect(JSON.stringify(first)).not.toContain("paidAmount");
    expect(JSON.stringify(first)).not.toContain("orderNumber");
  });
});

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260820025910_order_product_link_requests.sql"),
  "utf8",
);

describe("order product link request migration", () => {
  it("keeps screenshots, OCR, orders, prices, payment, and recipient data out of the shared inbox", () => {
    expect(migration).not.toMatch(/\b(raw_ocr|raw_text|image_url|capture_hash|order_number|paid_amount|unit_price|line_total|recipient|address|phone)\b/i);
  });

  it("uses least-privilege grants and owner-isolated RLS", () => {
    expect(migration).toContain("alter table public.order_product_link_requests enable row level security");
    expect(migration).toContain("revoke all on table public.order_product_link_requests from public, anon, authenticated");
    expect(migration).toContain("grant select, insert on table public.order_product_link_requests to authenticated");
    expect(migration).toContain("grant update (status) on table public.order_product_link_requests to authenticated");
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).toContain("auth.jwt() -> 'app_metadata' ->> 'role'");
  });

  it("allows approval only after the exact verified source mapping exists", () => {
    expect(migration).toContain("mapping.source_label = v_request.source_label");
    expect(migration).toContain("mapping.source_product_code = v_request.source_product_code");
    expect(migration).toContain("mapping.catalog_product_id = p_resolved_catalog_product_id");
    expect(migration).toContain("mapping.review_status = 'verified'");
    expect(migration).not.toMatch(/insert\s+into\s+public\.source_product_mappings/i);
  });
});
