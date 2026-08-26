import { describe, expect, it } from "vitest";
import { auditReceipt, mapReceipt, ReceiptJsonSchema } from "./receipt";
import { MerchantOnlyCandidateRequestSchema, VerifiedReceiptIngestionRequestSchema, verifiedReceiptIngestionFingerprint } from "./verified-receipt-ingestion";

function receipt(overrides: Record<string, unknown> = {}) {
  const base = {
    schema_version: "receipt.v2",
    document: {
      id: null, type: "receipt", status: "final", issued_on: "2026-08-27", issued_at: null, currency: "KRW",
      fulfillment: { type: "unknown", evidence: "unknown" },
      source: { capture_method: "ocr", original_document_id: null, source_images: [], transcription_status: "user_verified", notes: [], raw_text: null },
    },
    merchant: { name: "검증 상점", branch_name: "본점", business_kind: "retail", retail_channel: "regular", catalog_namespace: null, merchant_id: null, business_registration_number: null, address: null, phone: null },
    line_items: [{ id: "line-001", type: "product", description: "상품", source_line_references: ["1"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 1000, gross_amount_minor: 1000, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 1000, confidence: "user_verified", tax_rate_percent: null, food_service: null }],
    totals: { items_gross_amount_minor: 1000, discount_amount_minor: 0, tax_amount_minor: 0, fee_amount_minor: 0, tip_amount_minor: 0, rounding_amount_minor: 0, grand_total_amount_minor: 1000 },
    payments: [],
  };
  return { ...base, ...overrides };
}

function request(input: Record<string, unknown>) {
  return VerifiedReceiptIngestionRequestSchema.parse({ schema_version: "verified-receipt-ingestion.v2", idempotency_key: "test-key", receipt: input });
}

describe("verified receipt ingestion contract", () => {
  it.each([
    ["일반 소매 영수증", receipt()],
    ["음식점 영수증", receipt({ merchant: { name: "식당", branch_name: "강남점", business_kind: "food_service", retail_channel: "unknown", catalog_namespace: null, merchant_id: null, business_registration_number: null, address: null, phone: null } })],
    ["할인 포함 음식점 영수증", receipt({ merchant: { name: "식당", branch_name: null, business_kind: "food_service", retail_channel: "unknown", catalog_namespace: null, merchant_id: null, business_registration_number: null, address: null, phone: null }, line_items: [{ id: "line-001", type: "product", description: "메뉴", source_line_references: ["1"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 10000, gross_amount_minor: 10000, discount_amount_minor: 1000, tax_amount_minor: 0, net_amount_minor: 9000, confidence: "user_verified", tax_rate_percent: null, food_service: { role: "main", applies_to_line_id: null } }, { id: "line-002", type: "discount", description: "쿠폰", source_line_references: ["2"], identifiers: [], quantity: null, unit_price_amount_minor: null, gross_amount_minor: 0, discount_amount_minor: 1000, tax_amount_minor: 0, net_amount_minor: -1000, confidence: "user_verified", tax_rate_percent: null, food_service: null }], totals: { items_gross_amount_minor: 10000, discount_amount_minor: 2000, tax_amount_minor: 0, fee_amount_minor: 0, tip_amount_minor: 0, rounding_amount_minor: 0, grand_total_amount_minor: 8000 } })],
    ["세금 fee 포함 영수증", receipt({ line_items: [{ id: "line-001", type: "product", description: "상품", source_line_references: ["1"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 1000, gross_amount_minor: 1000, discount_amount_minor: 0, tax_amount_minor: 100, net_amount_minor: 1100, confidence: "user_verified", tax_rate_percent: 10, food_service: null }, { id: "line-002", type: "fee", description: "서비스 수수료", source_line_references: ["2"], identifiers: [], quantity: null, unit_price_amount_minor: null, gross_amount_minor: 0, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 50, confidence: "user_verified", tax_rate_percent: null, food_service: null }], totals: { items_gross_amount_minor: 1000, discount_amount_minor: 0, tax_amount_minor: 100, fee_amount_minor: 50, tip_amount_minor: 0, rounding_amount_minor: 0, grand_total_amount_minor: 1150 } })],
  ])("accepts %s", (_, value) => {
    expect(() => request(value)).not.toThrow();
  });

  it("accepts a SKU-less product without inventing an identifier", () => {
    const parsed = request(receipt());
    expect(parsed.receipt.line_items[0].identifiers).toEqual([]);
  });

  it("keeps same-name restaurant branches as distinct source facts", () => {
    const first = request(receipt({ merchant: { ...receipt().merchant, name: "같은 상호", branch_name: "강남점", business_kind: "food_service" } }));
    const second = request(receipt({ merchant: { ...receipt().merchant, name: "같은 상호", branch_name: "홍대점", business_kind: "food_service" } }));
    expect(first.receipt.merchant.branch_name).not.toBe(second.receipt.merchant.branch_name);
    expect(verifiedReceiptIngestionFingerprint(first.receipt)).not.toBe(verifiedReceiptIngestionFingerprint(second.receipt));
  });

  it("leaves an unknown menu without a client catalog identity", () => {
    const parsed = request(receipt({ merchant: { ...receipt().merchant, business_kind: "food_service" }, line_items: [{ ...receipt().line_items[0], description: "등록되지 않은 메뉴", food_service: { role: "main", applies_to_line_id: null } }] }));
    expect(parsed.receipt.line_items[0].identifiers).toEqual([]);
    expect(parsed.receipt.line_items[0]).not.toHaveProperty("catalog_product_id");
  });

  it("reconciles a refund without folding it into a product line", () => {
    const source = receipt({
      line_items: [
        { id: "line-001", type: "product", description: "상품", source_line_references: ["1"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 1000, gross_amount_minor: 1000, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 1000, confidence: "user_verified", tax_rate_percent: null, food_service: null },
        { id: "line-002", type: "refund", description: "반품", source_line_references: ["2"], identifiers: [], quantity: null, unit_price_amount_minor: null, gross_amount_minor: 0, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: -200, confidence: "user_verified", tax_rate_percent: null, food_service: null },
      ],
      totals: { items_gross_amount_minor: 1000, discount_amount_minor: 0, tax_amount_minor: 0, fee_amount_minor: 0, tip_amount_minor: 0, rounding_amount_minor: 0, grand_total_amount_minor: 800 },
    });
    const parsed = ReceiptJsonSchema.parse(source);
    expect(() => auditReceipt(mapReceipt(parsed), parsed)).not.toThrow();
  });

  it("rejects an unverified or privacy-bearing payload", () => {
    expect(() => request(receipt({ document: { ...receipt().document, source: { ...receipt().document.source, transcription_status: "parsed" } } }))).toThrow();
    expect(() => request(receipt({ document: { ...receipt().document, source: { ...receipt().document.source, raw_text: "민감 OCR" } } }))).toThrow();
    expect(() => request(receipt({ payments: [{ method: "card", amount_minor: 1000, status: "paid", reference: "approval" }] }))).toThrow();
  });

  it("preserves exact menu option relationships without resolving names in the client", () => {
    const value = receipt({ merchant: { name: "식당", branch_name: "2호점", business_kind: "food_service", retail_channel: "unknown", catalog_namespace: null, merchant_id: null, business_registration_number: null, address: null, phone: null }, line_items: [{ id: "line-001", type: "product", description: "정확한 메뉴", source_line_references: ["1"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 5000, gross_amount_minor: 5000, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 5000, confidence: "user_verified", tax_rate_percent: null, food_service: { role: "main", applies_to_line_id: null } }, { id: "line-002", type: "product", description: "옵션", source_line_references: ["2"], identifiers: [], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: 1000, gross_amount_minor: 1000, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: 1000, confidence: "user_verified", tax_rate_percent: null, food_service: { role: "option", applies_to_line_id: "line-001" } }], totals: { items_gross_amount_minor: 6000, discount_amount_minor: 0, tax_amount_minor: 0, fee_amount_minor: 0, tip_amount_minor: 0, rounding_amount_minor: 0, grand_total_amount_minor: 6000 } });
    expect(() => ReceiptJsonSchema.parse(value)).not.toThrow();
    expect((request(value).receipt.line_items[1].food_service)?.applies_to_line_id).toBe("line-001");
    expect(() => request({ ...value, catalog_product_id: "11111111-1111-4111-8111-111111111111" })).not.toThrow();
    expect(request({ ...value, catalog_product_id: "11111111-1111-4111-8111-111111111111" }).receipt).not.toHaveProperty("catalog_product_id");
  });

  it("accepts merchant-only candidates only after explicit user verification", () => {
    expect(() => MerchantOnlyCandidateRequestSchema.parse({ schema_version: "merchant-only-candidate.v1", idempotency_key: "merchant-1", user_verified: true, merchant: { merchant_name: "가게", branch_name: "본점", business_registration_number: null, address: null, phone: null, business_kind: "food_service", source_namespace: null, source_location_code: null } })).not.toThrow();
    expect(() => MerchantOnlyCandidateRequestSchema.parse({ schema_version: "merchant-only-candidate.v1", idempotency_key: "merchant-1", user_verified: false, merchant: { merchant_name: "가게", branch_name: null, business_registration_number: null, address: null, phone: null, business_kind: "food_service", source_namespace: null, source_location_code: null } })).toThrow();
  });
});
