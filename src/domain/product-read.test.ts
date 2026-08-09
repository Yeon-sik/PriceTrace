import { describe, expect, it } from "vitest";
import { ProductReadV1Schema } from "./product-read";

const revision = `sha256:${"a".repeat(64)}`;

function fixture() {
  return {
    schemaVersion: "product-read.v1",
    namespace: "pricetrace",
    revision,
    products: [{
      revision,
      standardProduct: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "표준 상품",
        brand: "브랜드",
        updatedAt: "2026-08-09T01:00:00+00:00",
      },
      catalogProduct: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "표준 상품 100g",
        specificationText: "100g",
        contentAmount: 100,
        contentUnit: "g",
        packageCount: 1,
        referenceUnit: 100,
        listingReferenceUrl: "https://example.com/product",
        updatedAt: "2026-08-09T01:00:00+00:00",
      },
      sellerProducts: [{
        sellerLabel: "판매처 A",
        sourceProductCode: "A-100",
      }],
      observations: [{
        observationId: "33333333-3333-4333-8333-333333333333",
        sellerLabel: "판매처 A",
        listedPriceKrw: 1_000,
        shippingFeeKrw: 500,
        minimumOrderQuantity: 2,
        checkoutPriceKrw: 2_500,
        observedAt: "2026-08-09T01:30:00+00:00",
        productUrl: "https://example.com/offer",
        source: "verified-market-observation",
      }],
    }],
  };
}

describe("product-read.v1 contract", () => {
  it("keeps namespace, family, exact variant, seller, price, and observation time explicit", () => {
    const payload = ProductReadV1Schema.parse(fixture());

    expect(payload.namespace).toBe("pricetrace");
    expect(payload.products[0]).toMatchObject({
      standardProduct: { id: "11111111-1111-4111-8111-111111111111" },
      catalogProduct: { id: "22222222-2222-4222-8222-222222222222" },
      sellerProducts: [{ sellerLabel: "판매처 A", sourceProductCode: "A-100" }],
      observations: [{
        sellerLabel: "판매처 A",
        listedPriceKrw: 1_000,
        observedAt: "2026-08-09T01:30:00+00:00",
      }],
    });
  });

  it("rejects a derived checkout price that does not match the observation inputs", () => {
    const input = fixture();
    input.products[0].observations[0].checkoutPriceKrw = 2_499;

    expect(() => ProductReadV1Schema.parse(input)).toThrow(/관측 결제금액/);
  });

  it("rejects duplicate exact catalog variants even when their names differ", () => {
    const input = fixture();
    input.products.push({
      ...structuredClone(input.products[0]),
      standardProduct: {
        ...input.products[0].standardProduct,
        name: "이름이 바뀐 상품군",
      },
      catalogProduct: {
        ...input.products[0].catalogProduct,
        name: "이름이 바뀐 규격",
      },
    });

    expect(() => ProductReadV1Schema.parse(input)).toThrow(/정확한 판매 규격 ID가 중복/);
  });
});
