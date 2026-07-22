import { ReceiptJsonSchema } from "./receipt";

export function createUniversalReceipt(store = "Test Store", date = "2026-07-22", transactionId = "TX-1", amountMinor = 1_000, sourceProductCode = "P1") {
  return ReceiptJsonSchema.parse({
    schema_version: "receipt.v2",
    document: { id: `receipt:${store}:${transactionId}`, type: "receipt", status: "final", issued_on: date, issued_at: `${date}T00:00:00+09:00`, currency: "KRW", source: { capture_method: "manual_entry", original_document_id: transactionId, source_images: [], transcription_status: "user_verified", notes: [] } },
    merchant: { name: store, branch_name: null, retail_channel: "unknown", catalog_namespace: null, merchant_id: null, business_registration_number: null, address: null, phone: null },
    line_items: [{ id: "line-1", type: "product", description: "Test product", source_line_references: ["1"], identifiers: [{ scheme: "merchant_sku", value: sourceProductCode }], quantity: { value: 1, unit: "each" }, unit_price_amount_minor: amountMinor, gross_amount_minor: amountMinor, discount_amount_minor: 0, tax_amount_minor: 0, net_amount_minor: amountMinor, confidence: "high", tax_rate_percent: null }],
    totals: { items_gross_amount_minor: amountMinor, discount_amount_minor: 0, tax_amount_minor: 0, fee_amount_minor: 0, tip_amount_minor: 0, rounding_amount_minor: 0, grand_total_amount_minor: amountMinor },
    payments: [{ method: "unknown", amount_minor: amountMinor, status: "paid", reference: null }],
  });
}
