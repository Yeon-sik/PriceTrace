import { describe, expect, it } from "vitest";
import { createUniversalReceipt } from "./receipt.fixture";
import {
  assertNoForbiddenPublicReceiptKeys,
  assertNoForbiddenSourceValues,
  assertPublicReceiptCollection,
  buildPublicReceiptFiles,
  buildPublicReceiptIndex,
  PublicReceiptSchema,
  publicDataHash,
  publicReceiptFilesToReceipts,
} from "./public-receipt";
import { applyReceiptMerchantCatalogProfiles } from "./receipt-merchant-catalog-profile";

function createPrivateSource() {
  const source = createUniversalReceipt("Transparent Mart", "2026-07-22", "PRIVATE-TRANSACTION", 12_000, "SKU-1");
  source.document.id = "PRIVATE-DOCUMENT-ID";
  source.document.source.source_images = ["C:/private/receipt-original.jpg"];
  source.document.source.notes = ["Public-safe note"];
  source.document.source.raw_text = "receipt OCR raw text";
  source.merchant.branch_name = "Main";
  source.merchant.business_kind = "retail";
  source.merchant.merchant_id = "PUBLIC-MERCHANT-ID";
  source.merchant.business_registration_number = "123-45-67890";
  source.merchant.address = "1 Transparent-ro";
  source.merchant.phone = "02-1234-5678";
  source.payments = [{
    method: "card",
    amount_minor: 12_000,
    status: "paid",
    reference: "PRIVATE-APPROVAL-1234",
  }];
  return source;
}

describe("public receipt files", () => {
  it("applies a reviewed merchant catalog profile without mutating the raw receipt", () => {
    const source = createPrivateSource();
    expect(source.merchant.retail_channel).toBe("unknown");
    expect(source.merchant.catalog_namespace).toBeNull();

    const result = applyReceiptMerchantCatalogProfiles([{
      receiptId: "2026-07-22_001",
      source,
    }], {
      schemaVersion: "pricetrace-receipt-merchant-catalog-profiles.v1",
      profiles: [{
        id: "reviewed-store",
        match: {
          merchantId: "PUBLIC-MERCHANT-ID",
          businessRegistrationNumber: "123-45-67890",
          address: "1 Transparent-ro",
          phone: "02-1234-5678",
        },
        classification: {
          retailChannel: "px",
          catalogNamespace: "reviewed-px-catalog",
        },
        reviewedAt: "2026-08-09T00:00:00+09:00",
        reason: "테스트 검토 근거",
        sourceRefs: ["fixture:reviewed-store"],
      }],
    });

    expect(result.applied).toEqual([{
      receiptId: "2026-07-22_001",
      profileId: "reviewed-store",
    }]);
    expect(result.sources[0].source.merchant).toMatchObject({
      retail_channel: "px",
      catalog_namespace: "reviewed-px-catalog",
    });
    expect(source.merchant).toMatchObject({
      retail_channel: "unknown",
      catalog_namespace: null,
    });
  });

  it("rejects a reviewed merchant profile that conflicts with source classification", () => {
    const source = createPrivateSource();
    source.merchant.retail_channel = "regular";

    expect(() => applyReceiptMerchantCatalogProfiles([{
      receiptId: "2026-07-22_001",
      source,
    }], {
      schemaVersion: "pricetrace-receipt-merchant-catalog-profiles.v1",
      profiles: [{
        id: "reviewed-store",
        match: {
          merchantId: "PUBLIC-MERCHANT-ID",
          businessRegistrationNumber: "123-45-67890",
          address: "1 Transparent-ro",
          phone: "02-1234-5678",
        },
        classification: {
          retailChannel: "px",
          catalogNamespace: "reviewed-px-catalog",
        },
        reviewedAt: "2026-08-09T00:00:00+09:00",
        reason: "테스트 검토 근거",
        sourceRefs: ["fixture:reviewed-store"],
      }],
    })).toThrow(/충돌/);
  });

  it("creates one transparent JSON file per receipt with a traceable date and sequence key", () => {
    const source = createPrivateSource();
    source.document.fulfillment = { type: "takeout", evidence: "user_confirmed" };
    const files = buildPublicReceiptFiles([{ receiptId: "2026-07-22_001", source }]);
    const receipt = files[0];
    const index = buildPublicReceiptIndex(files);
    const serialized = JSON.stringify(receipt);

    expect(receipt).toMatchObject({
      id: "2026-07-22_001",
      fileName: "2026-07-22_001.json",
      merchant: {
        name: "Transparent Mart",
        branchName: "Main",
        merchantId: "PUBLIC-MERCHANT-ID",
        businessRegistrationNumber: "123-45-67890",
        address: "1 Transparent-ro",
        phone: "02-1234-5678",
      },
      document: { issuedOn: "2026-07-22", currency: "KRW", fulfillment: { type: "takeout", evidence: "user_confirmed" } },
      totals: { grandTotalAmountMinor: 12_000 },
    });
    expect(receipt.lineItems[0]).toMatchObject({
      description: "Test product",
      sourceLineReferences: ["1"],
      netAmountMinor: 12_000,
    });
    expect(index.receipts).toEqual([{ id: receipt.id, fileName: receipt.fileName, revision: receipt.revision }]);
    expect(serialized).not.toContain("PRIVATE-DOCUMENT-ID");
    expect(serialized).not.toContain("PRIVATE-TRANSACTION");
    expect(serialized).not.toContain("receipt-original.jpg");
    expect(serialized).not.toContain("receipt OCR raw text");
    expect(serialized).toContain("Public-safe note");
    expect(serialized).not.toContain("PRIVATE-APPROVAL-1234");
    expect(serialized).not.toContain('"payments"');
    expect(() => assertPublicReceiptCollection(index, files)).not.toThrow();
    assertNoForbiddenPublicReceiptKeys(files);
    expect(() => assertNoForbiddenSourceValues(files, [{ receiptId: receipt.id, source }])).not.toThrow();
  });

  it("maps verified public receipt files to the UI without a transaction number", () => {
    const source = createPrivateSource();
    source.document.fulfillment = { type: "dine_in", evidence: "printed" };
    const files = buildPublicReceiptFiles([{ receiptId: "2026-07-22_002", source }]);
    const receipt = publicReceiptFilesToReceipts(files)[0];

    expect(receipt).toMatchObject({
      id: "2026-07-22_002",
      publicReceiptFileName: "2026-07-22_002.json",
      storeLabel: "Transparent Mart Main",
      storeBusinessRegistrationNumber: "123-45-67890",
      storeAddress: "1 Transparent-ro",
      storePhone: "02-1234-5678",
      purchasedAt: "2026-07-22T00:00:00+09:00",
      transactionNumber: "",
      source: "public",
      fulfillmentType: "dine_in",
      fulfillmentEvidence: "printed",
      totalPriceKrw: 12_000,
    });
    expect(receipt.items[0]).toMatchObject({
      receiptId: receipt.id,
      sourceProductCode: "SKU-1",
      quantityValue: 1,
      unitPriceKrw: 12_000,
    });
  });

  it("projects a restaurant option parent with public line IDs while keeping sides separate", () => {
    const source = createPrivateSource();
    source.merchant.business_kind = "food_service";
    source.line_items[0].food_service = { role: "main", applies_to_line_id: null };
    source.line_items.push({
      id: "line-option", type: "product", description: "면추가", source_line_references: ["2"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 0, gross_amount_minor: 0, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 0, confidence: "high", tax_rate_percent: null, food_service: { role: "option", applies_to_line_id: "line-1" },
    });
    source.line_items.push({
      id: "line-side", type: "product", description: "교자", source_line_references: ["3"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 0, gross_amount_minor: 0, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 0, confidence: "high", tax_rate_percent: null, food_service: { role: "side", applies_to_line_id: null },
    });

    const receipt = buildPublicReceiptFiles([{ receiptId: "2026-07-22_005", source }])[0];
    expect(receipt.lineItems).toMatchObject([
      { description: "Test product", foodService: { role: "main", appliesToLineId: null } },
      { description: "면추가", foodService: { role: "option", appliesToLineId: receipt.lineItems[0].id } },
      { description: "교자", foodService: { role: "side", appliesToLineId: null } },
    ]);
    expect(() => PublicReceiptSchema.parse(receipt)).not.toThrow();
  });

  it("rejects invalid key formats, stale index entries, and forbidden content", () => {
    const source = createPrivateSource();
    expect(() => buildPublicReceiptFiles([{ receiptId: "receipt_2026-07-22_001", source }])).toThrow();
    expect(() => buildPublicReceiptFiles([{ receiptId: "2026-07-21_001", source }])).toThrow(/ID/);

    const files = buildPublicReceiptFiles([{ receiptId: "2026-07-22_003", source }]);
    const invalid = structuredClone(files[0]) as Record<string, unknown>;
    (invalid.document as Record<string, unknown>).transactionNumber = "leak";
    expect(() => PublicReceiptSchema.parse(invalid)).toThrow();
    expect(() => assertNoForbiddenPublicReceiptKeys({ payments: [] })).toThrow();

    const invalidTotals = structuredClone(files[0]);
    invalidTotals.totals.grandTotalAmountMinor += 1;
    invalidTotals.revision = publicDataHash(JSON.stringify(Object.fromEntries(Object.entries(invalidTotals).filter(([key]) => key !== "revision"))));
    expect(() => PublicReceiptSchema.parse(invalidTotals)).toThrow();

    const invalidIndex = structuredClone(buildPublicReceiptIndex(files));
    invalidIndex.receipts[0].fileName = "2026-07-22_999.json";
    expect(() => assertPublicReceiptCollection(invalidIndex, files)).toThrow();

    const unsafeSource = createPrivateSource();
    unsafeSource.document.source.notes = ["Reference PRIVATE-APPROVAL-1234"];
    const unsafeFiles = buildPublicReceiptFiles([{ receiptId: "2026-07-22_004", source: unsafeSource }]);
    expect(() => assertNoForbiddenSourceValues(unsafeFiles, [{ receiptId: "2026-07-22_004", source: unsafeSource }])).toThrow();
  });
});
