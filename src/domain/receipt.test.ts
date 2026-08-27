import { describe, expect, it } from "vitest";
import raw from "../../data/demo/receipt.sample.json";
import receiptTemplate from "../../docs/templates/RECEIPT_V2_TEMPLATE.json";
import { auditReceipt, mapReceipt, nullableSourceProductCode, purchaseTypeForReceipt, ReceiptJsonSchema, receiptItemId } from "./receipt";
import { createUniversalReceipt } from "./receipt.fixture";

describe("receipt mapper", () => {
  it("maps and audits the complete v2 sample", () => {
    const receipt = mapReceipt(raw);
    expect(receipt.items).toHaveLength(95);
    expect(auditReceipt(receipt)).toMatchObject({ quantity: 247, totalKrw: 737790, sourceLineReferenceCount: 125 });
  });
  it("keeps the image-analysis template as a schema-valid complete example", () => {
    const template = ReceiptJsonSchema.parse(receiptTemplate);
    expect(template.document.id).toBeNull();
    expect(template.document.currency).toBe("KRW");
    expect(template.merchant.name).toBe("예시마트");
    expect(template.line_items).toHaveLength(3);
    expect(template.line_items.every((line) => line.quantity === null || (line.quantity.unit === "each" && Number.isInteger(line.quantity.value)))).toBe(true);
    expect(template.document.fulfillment).toEqual({ type: "unknown", evidence: "unknown" });
  });
  it("preserves only explicit restaurant fulfilment facts", () => {
    const receipt = createUniversalReceipt();
    receipt.document.fulfillment = { type: "delivery", evidence: "printed" };
    expect(mapReceipt(receipt)).toMatchObject({ fulfillmentType: "delivery", fulfillmentEvidence: "printed" });
    expect(ReceiptJsonSchema.parse({ ...receipt, document: { ...receipt.document, fulfillment: undefined } }).document.fulfillment).toEqual({ type: "unknown", evidence: "unknown" });
  });
  it("creates a stable line ID", () => expect(receiptItemId("r", "line-001")).toBe("r:line-001"));
  it("accepts a nullable source document ID without treating an OCR local ID as receipt.v2 identity", () => {
    const source = createUniversalReceipt();
    source.document.id = null;
    const parsed = ReceiptJsonSchema.parse({ ...source, document: { ...source.document, localDocumentId: "device-only-001" } });
    expect(parsed.document.id).toBeNull();
    expect(parsed.document).not.toHaveProperty("localDocumentId");
    expect(mapReceipt(parsed).id).not.toBe("device-only-001");
  });
  it("classifies food-service receipt products as menu items", () => {
    expect(purchaseTypeForReceipt({ storeBusinessKind: "food_service" })).toBe("menu_item");
    expect(purchaseTypeForReceipt({ storeBusinessKind: "retail" })).toBe("retail_product");
    expect(purchaseTypeForReceipt({})).toBe("retail_product");
  });
  it("preserves a restaurant option's exact parent while keeping a side independent", () => {
    const source = createUniversalReceipt("라면집", "2026-08-26", "FOOD-1", 11_000);
    source.merchant.business_kind = "food_service";
    source.line_items = [
      { id: "line-001", type: "product", description: "라면", source_line_references: ["1"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 7_000, gross_amount_minor: 7_000, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 7_000, confidence: "high", tax_rate_percent: null, food_service: { role: "main", applies_to_line_id: null } },
      { id: "line-002", type: "product", description: "면추가", source_line_references: ["2"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 1_000, gross_amount_minor: 1_000, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 1_000, confidence: "high", tax_rate_percent: null, food_service: { role: "option", applies_to_line_id: "line-001" } },
      { id: "line-003", type: "product", description: "교자", source_line_references: ["3"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 3_000, gross_amount_minor: 3_000, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 3_000, confidence: "high", tax_rate_percent: null, food_service: { role: "side", applies_to_line_id: null } },
    ];
    source.totals.items_gross_amount_minor = 11_000;
    source.totals.grand_total_amount_minor = 11_000;

    const receipt = mapReceipt(source);
    expect(receipt.items).toMatchObject([
      { productName: "라면", foodServiceRole: "main", optionParentReceiptItemId: null },
      { productName: "면추가", foodServiceRole: "option", optionParentReceiptItemId: `${receipt.id}:line-001` },
      { productName: "교자", foodServiceRole: "side", optionParentReceiptItemId: null },
    ]);
  });
  it("rejects a food-service option that points to a side or a non-food-service receipt", () => {
    const source = createUniversalReceipt();
    source.line_items[0].food_service = { role: "option", applies_to_line_id: "line-2" };
    source.line_items.push({ id: "line-2", type: "product", description: "Side", source_line_references: ["2"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 0, gross_amount_minor: 0, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 0, confidence: "high", tax_rate_percent: null, food_service: { role: "side", applies_to_line_id: null } });
    expect(() => ReceiptJsonSchema.parse(source)).toThrow(/food_service|main/);
  });
  it("preserves a missing merchant SKU as null instead of inventing an identity", () => {
    expect(nullableSourceProductCode("")).toBeNull();
    expect(nullableSourceProductCode("   ")).toBeNull();
    expect(nullableSourceProductCode("MENU-001")).toBe("MENU-001");
  });
  it("rejects an inconsistent grand total", () => {
    const bad = structuredClone(createUniversalReceipt());
    bad.totals.grand_total_amount_minor = 1_001;
    expect(() => mapReceipt(bad)).toThrow("총액");
  });
  it("keeps non-product and weighted lines as source evidence, not allocatable items", () => {
    const receipt = createUniversalReceipt();
    receipt.line_items.push({ id: "delivery", type: "fee", description: "Delivery", source_line_references: [], identifiers: [], quantity: null, unit_price_amount_minor: null, gross_amount_minor: 0, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 3_000, confidence: "high", tax_rate_percent: null, food_service: null });
    receipt.totals.fee_amount_minor = 3_000;
    receipt.totals.grand_total_amount_minor = 4_000;
    expect(mapReceipt(receipt).items).toHaveLength(1);
  });
  it("uses the net unit price for a discounted product line", () => {
    const receipt = createUniversalReceipt();
    receipt.line_items[0].discount_amount_minor = 100;
    receipt.line_items[0].net_amount_minor = 900;
    receipt.totals.discount_amount_minor = 100;
    receipt.totals.grand_total_amount_minor = 900;
    expect(mapReceipt(receipt).items[0].unitPriceKrw).toBe(900);
  });
  it("accepts an incomplete non-retail source document without inventing facts", () => {
    const source = ReceiptJsonSchema.parse({
      schema_version: "receipt.v2",
      document: { id: null, type: "invoice", status: "unknown", issued_on: null, issued_at: null, currency: null, source: { capture_method: "ocr", original_document_id: null, source_images: ["invoice.jpg"], transcription_status: "parsed", notes: [], raw_text: null } },
      merchant: { name: null, branch_name: null, business_kind: "professional_service", retail_channel: "unknown", catalog_namespace: null, merchant_id: null, business_registration_number: null, address: null, phone: null },
      line_items: [],
      totals: { items_gross_amount_minor: null, discount_amount_minor: null, tax_amount_minor: null, fee_amount_minor: null, tip_amount_minor: null, rounding_amount_minor: null, grand_total_amount_minor: null },
      payments: [],
    });
    expect(source.document.currency).toBeNull();
    expect(() => mapReceipt(source)).toThrow("KRW");
  });
});
