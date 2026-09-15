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

  it("preserves public benefit source lines without publishing their price observations", () => {
    const source = createUniversalReceipt("식당", "2026-08-26", "PUBLIC-BENEFIT", 3_000, "MENU-1");
    source.merchant.business_kind = "food_service";
    source.line_items[0].food_service = { role: "main", applies_to_line_id: null, benefit_kind: null };
    source.line_items.push({
      ...source.line_items[0],
      id: "included-line",
      description: "포함 반찬",
      source_line_references: ["2"],
      unit_price_amount_minor: 0,
      gross_amount_minor: 0,
      net_amount_minor: 0,
      food_service: { role: "side", applies_to_line_id: null, benefit_kind: "included" },
    });
    const receiptFiles = buildPublicReceiptFiles([{ receiptId: "2026-08-26_001", source }]);
    const receiptIndex = buildPublicReceiptIndex(receiptFiles);
    const receipts = publicReceiptFilesToReceipts(receiptFiles);
    const observations = buildPublicObservationBundle(receipts, receiptIndex.revision);

    expect(receipts[0].items).toHaveLength(2);
    expect(receipts[0].items[1]).toMatchObject({ foodServiceBenefitKind: "included", totalPriceKrw: 0 });
    expect(observations.observations).toHaveLength(1);
    expect(observations.observations[0].productName).toBe("Test product");
    expect(() => assertPublicReceiptObservationLinks(receiptIndex, receiptFiles, observations)).not.toThrow();
  });

  it("remains deterministic and converts linked observations to product listings", () => {
    const first = createPublicData();
    const second = createPublicData();
    const receipts = publicReceiptFilesToReceipts(first.receiptFiles);

    expect(first).toEqual(second);
    expect(publicObservationListings(first.observations)[0]).toMatchObject({
      id: first.observations.observations[0].id,
      observedAt: "2026-07-22T00:00:00+09:00",
      storeLabel: "Linked Mart Gangnam",
      sellerKey: "label:linked mart gangnam",
      source: "public",
      item: {
        receiptId: first.receiptFiles[0].id,
        productName: "Test product",
        quantityValue: 1,
        unitPriceKrw: 3_000,
      },
    });
    expect(publicObservationListings(first.observations, receipts)[0].sellerKey).toBe("business:1234567890:linked mart gangnam");
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
