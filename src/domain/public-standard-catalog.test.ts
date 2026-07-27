import { describe, expect, it } from "vitest";
import { buildPublicStandardCatalogIndex, PublicStandardCatalogRowsSchema } from "./public-standard-catalog";

const catalogProductId = "11111111-1111-4111-8111-111111111111";
const standardProductId = "22222222-2222-4222-8222-222222222222";

function row(overrides: Record<string, unknown> = {}) {
  return {
    source_product_code: "210157",
    catalog_product_id: catalogProductId,
    standard_product_id: standardProductId,
    standard_name: "CJ 햇반",
    content_amount: 210,
    content_unit: "g",
    package_count: 1,
    reference_unit: 100,
    coupang_listed_price_krw: null,
    coupang_quantity: null,
    coupang_content_amount: null,
    coupang_content_unit: null,
    coupang_product_url: null,
    coupang_observed_at: null,
    ...overrides,
  };
}

describe("public standard catalog", () => {
  it("validates and indexes a public standard product without exposing seller identity", () => {
    const parsed = PublicStandardCatalogRowsSchema.parse([row()]);
    const index = buildPublicStandardCatalogIndex(parsed);

    expect(index.standardMappings.get("210157")).toBe(catalogProductId);
    expect(index.standardNames.get(standardProductId)).toBe("CJ 햇반");
    expect(index.catalogSpecs.get(catalogProductId)).toMatchObject({ contentAmount: 210, contentUnit: "g", referenceUnit: 100 });
  });

  it("rejects a partially populated Coupang observation", () => {
    const parsed = PublicStandardCatalogRowsSchema.safeParse([row({ coupang_listed_price_krw: 12_900 })]);
    expect(parsed.success).toBe(false);
  });

  it("rejects a Coupang content amount without its unit", () => {
    const parsed = PublicStandardCatalogRowsSchema.safeParse([row({
      coupang_listed_price_krw: 12_900,
      coupang_quantity: 12,
      coupang_content_amount: 210,
      coupang_product_url: "https://www.coupang.com/vp/products/1",
      coupang_observed_at: "2026-07-01T00:00:00Z",
    })]);
    expect(parsed.success).toBe(false);
  });

  it("keeps the latest complete Coupang observation for a standard product", () => {
    const parsed = PublicStandardCatalogRowsSchema.parse([
      row({
        coupang_listed_price_krw: 12_900,
        coupang_quantity: 12,
        coupang_content_amount: 210,
        coupang_content_unit: "g",
        coupang_product_url: "https://www.coupang.com/vp/products/1",
        coupang_observed_at: "2026-07-01T00:00:00Z",
      }),
      row({
        source_product_code: "210158",
        catalog_product_id: "33333333-3333-4333-8333-333333333333",
        coupang_listed_price_krw: 11_900,
        coupang_quantity: 12,
        coupang_content_amount: 210,
        coupang_content_unit: "g",
        coupang_product_url: "https://www.coupang.com/vp/products/2",
        coupang_observed_at: "2026-07-20T00:00:00Z",
      }),
    ]);

    expect(buildPublicStandardCatalogIndex(parsed).coupangByStandard.get(standardProductId)).toMatchObject({
      listedPriceKrw: 11_900,
      quantity: 12,
      contentAmount: 210,
      contentUnit: "g",
    });
  });
});
