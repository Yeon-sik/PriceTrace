import { describe, expect, it } from "vitest";
import { createUniversalReceipt } from "./receipt.fixture";
import {
  assertPublicReceiptObservationLinks,
  buildPublicObservationBundle,
  PublicObservationBundleSchema,
  publicObservationListings,
} from "./public-observation";
import {
  buildPublicReceiptFiles,
  buildPublicReceiptIndex,
  publicReceiptFilesToReceipts,
} from "./public-receipt";

function createPublicData() {
  const source = createUniversalReceipt("Linked Mart", "2026-07-22", "PRIVATE-TX", 3_000, "SKU-1");
  source.merchant.branch_name = "Gangnam";
  source.merchant.business_registration_number = "123-45-67890";
  source.merchant.address = "Gangnam-gu, Seoul";
  source.merchant.phone = "02-0000-0000";
  const receiptFiles = buildPublicReceiptFiles([{ receiptId: "2026-07-22_001", source }]);
  const receiptIndex = buildPublicReceiptIndex(receiptFiles);
  const observations = buildPublicObservationBundle(
    publicReceiptFilesToReceipts(receiptFiles),
    receiptIndex.revision,
  );
  return { receiptFiles, receiptIndex, observations };
}

describe("public receipt observation links", () => {
  it("keeps exact public store, date, quantity, and receipt-item links", () => {
    const { receiptFiles, receiptIndex, observations } = createPublicData();
    const receipt = receiptFiles[0];
    const line = receipt.lineItems[0];

    expect(observations.observations).toHaveLength(1);
    expect(observations.observations[0]).toMatchObject({
      receiptId: receipt.id,
      receiptItemId: line.id,
      storeId: receipt.merchant.id,
      storeLabel: "Linked Mart Gangnam",
      observedAt: "2026-07-22T00:00:00+09:00",
      productName: "Test product",
      sourceProductCode: "SKU-1",
      quantity: 1,
      unitPriceKrw: 3_000,
      totalPriceKrw: 3_000,
    });
    expect(observations.receiptIndexRevision).toBe(receiptIndex.revision);
    expect(() => assertPublicReceiptObservationLinks(receiptIndex, receiptFiles, observations)).not.toThrow();
  });

  it("remains deterministic and converts linked observations to product listings", () => {
    const first = createPublicData();
    const second = createPublicData();

    expect(first).toEqual(second);
    expect(publicObservationListings(first.observations)[0]).toMatchObject({
      id: first.observations.observations[0].id,
      observedAt: "2026-07-22T00:00:00+09:00",
      storeLabel: "Linked Mart Gangnam",
      source: "public",
      item: {
        receiptId: first.receiptFiles[0].id,
        productName: "Test product",
        quantityValue: 1,
        unitPriceKrw: 3_000,
      },
    });
  });

  it("rejects observations that point at a stale receipt-file index", () => {
    const { receiptFiles, receiptIndex, observations } = createPublicData();
    const invalid = {
      ...observations,
      receiptIndexRevision: "0".repeat(16),
    };

    expect(() => PublicObservationBundleSchema.parse(invalid)).not.toThrow();
    expect(() => assertPublicReceiptObservationLinks(receiptIndex, receiptFiles, invalid)).toThrow();
  });
});
