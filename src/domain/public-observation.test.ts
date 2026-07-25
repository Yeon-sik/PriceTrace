import { describe, expect, it } from "vitest";
import type { Receipt } from "./types";
import {
  buildPublicObservationBundle,
  PublicObservationBundleSchema,
  publicObservationListings,
} from "./public-observation";

const privateReceipt: Receipt = {
  id: "private:receipt-123",
  storeLabel: "민감한 실제 지점명",
  storeAddress: "공개하면 안 되는 주소",
  storePhone: "010-0000-0000",
  retailChannel: "px",
  catalogNamespace: "korean-military-px",
  purchasedAt: "2026-07-14",
  transactionNumber: "PRIVATE-TRANSACTION",
  currency: "KRW",
  totalPriceKrw: 21_000,
  items: [{
    id: "private:item-1",
    receiptId: "private:receipt-123",
    sourceLineReferences: ["37"],
    productName: "테스트 상품",
    sourceProductCode: "SKU-1",
    unitPriceKrw: 3_000,
    quantityValue: 7,
    totalPriceKrw: 21_000,
    confidence: "high",
  }],
};

describe("public observation projection", () => {
  it("keeps only the minimum public product observation fields", () => {
    const bundle = buildPublicObservationBundle([privateReceipt]);
    const serialized = JSON.stringify(bundle);

    expect(bundle.observations).toHaveLength(1);
    expect(bundle.observations[0]).toMatchObject({
      storeLabel: "PX",
      observedMonth: "2026-07",
      productName: "테스트 상품",
      sourceProductCode: "SKU-1",
      unitPriceKrw: 3_000,
    });
    expect(serialized).not.toContain(privateReceipt.storeLabel);
    expect(serialized).not.toContain(privateReceipt.storeAddress!);
    expect(serialized).not.toContain(privateReceipt.storePhone!);
    expect(serialized).not.toContain(privateReceipt.transactionNumber);
    expect(serialized).not.toContain("quantityValue");
    expect(serialized).not.toContain("totalPriceKrw");
    expect(serialized).not.toContain("sourceLineReferences");
    expect(serialized).not.toContain("2026-07-14");
  });

  it("deduplicates identical observations and remains deterministic", () => {
    const first = buildPublicObservationBundle([privateReceipt, privateReceipt]);
    const second = buildPublicObservationBundle([privateReceipt]);

    expect(first).toEqual(second);
    expect(first.observations).toHaveLength(1);
  });

  it("rejects unknown fields and converts public data to product listings", () => {
    const bundle = buildPublicObservationBundle([privateReceipt]);
    const invalid = structuredClone(bundle) as unknown as {
      observations: Array<Record<string, unknown>>;
    };
    invalid.observations[0].transactionNumber = "leak";

    expect(() => PublicObservationBundleSchema.parse(invalid)).toThrow();
    expect(publicObservationListings(bundle)[0]).toMatchObject({
      observedAt: "2026-07",
      storeLabel: "PX",
      source: "public",
      item: {
        productName: "테스트 상품",
        unitPriceKrw: 3_000,
      },
    });
  });
});
