import { z } from "zod";
import type { Receipt } from "./types";

const minorAmount = z.number().int();
const nonNegativeMinorAmount = minorAmount.nonnegative();
const identifierSchema = z.object({ scheme: z.string().min(1), value: z.string().min(1) });
const lineTypeSchema = z.enum(["product", "service", "discount", "fee", "tax", "tip", "refund", "rounding", "other"]);

/**
 * Canonical, store-agnostic receipt contract. Money is always expressed in
 * currency minor units: 1200 KRW is `1200`, regardless of presentation text.
 */
export const ReceiptJsonSchema = z.object({
  schema_version: z.literal("receipt.v2"),
  document: z.object({
    id: z.string().min(1).nullable(),
    type: z.enum(["receipt", "invoice", "order_confirmation", "credit_note"]),
    status: z.enum(["draft", "final", "voided", "refunded", "unknown"]),
    issued_on: z.string().date(),
    issued_at: z.string().datetime({ offset: true }).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    source: z.object({
      capture_method: z.enum(["pos_export", "e_receipt", "ocr", "manual_transcription", "manual_entry", "unknown"]),
      original_document_id: z.string().min(1).nullable(),
      source_images: z.array(z.string().min(1)),
      transcription_status: z.enum(["unprocessed", "parsed", "verified", "user_verified", "unknown"]),
      notes: z.array(z.string()),
    }),
  }),
  merchant: z.object({
    name: z.string().min(1),
    branch_name: z.string().min(1).nullable(),
    retail_channel: z.enum(["px", "regular", "unknown"]).default("unknown"),
    /** Shared product-code catalog, only when the merchant explicitly confirms it. */
    catalog_namespace: z.string().trim().min(1).nullable(),
    merchant_id: z.string().min(1).nullable(),
    business_registration_number: z.string().min(1).nullable(),
    address: z.string().min(1).nullable(),
    phone: z.string().min(1).nullable(),
  }),
  line_items: z.array(z.object({
    id: z.string().min(1),
    type: lineTypeSchema,
    description: z.string().min(1).nullable(),
    source_line_references: z.array(z.string().min(1)),
    identifiers: z.array(identifierSchema),
    quantity: z.object({ value: z.number().positive(), unit: z.string().min(1) }).nullable(),
    unit_price_amount_minor: nonNegativeMinorAmount.nullable(),
    gross_amount_minor: nonNegativeMinorAmount,
    discount_amount_minor: nonNegativeMinorAmount,
    tax_amount_minor: nonNegativeMinorAmount,
    net_amount_minor: minorAmount,
    confidence: z.enum(["high", "medium", "low", "user_verified"]),
    tax_rate_percent: z.number().min(0).nullable(),
  })).min(1),
  totals: z.object({
    items_gross_amount_minor: nonNegativeMinorAmount,
    discount_amount_minor: nonNegativeMinorAmount,
    tax_amount_minor: nonNegativeMinorAmount,
    fee_amount_minor: minorAmount,
    tip_amount_minor: minorAmount,
    rounding_amount_minor: minorAmount,
    grand_total_amount_minor: minorAmount,
  }),
  payments: z.array(z.object({
    method: z.enum(["cash", "card", "bank_transfer", "mobile_payment", "gift_card", "points", "mixed", "unknown"]),
    amount_minor: minorAmount,
    status: z.enum(["authorized", "paid", "refunded", "voided", "unknown"]),
    reference: z.string().min(1).nullable(),
  })),
});
export type ReceiptJson = z.infer<typeof ReceiptJsonSchema>;

export const receiptItemId = (receiptId: string, lineId: string) => `${receiptId}:${lineId}`;

function sourceProductCode(line: ReceiptJson["line_items"][number]) {
  return line.identifiers.find((identifier) => identifier.scheme === "merchant_sku")?.value ?? line.id;
}

export function mapReceipt(input: unknown): Receipt {
  const data = ReceiptJsonSchema.parse(input);
  if (data.document.currency !== "KRW") throw new Error("현재 정산 화면은 KRW 영수증만 지원합니다.");
  const receiptId = data.document.id ?? `${data.merchant.name}:${data.document.issued_at ?? data.document.issued_on}:${data.document.source.original_document_id ?? "unknown"}`;
  const items = data.line_items.flatMap((line) => {
    if (line.type !== "product" || line.description === null || line.quantity?.unit !== "each" || !Number.isInteger(line.quantity.value) || line.quantity.value <= 0 || line.net_amount_minor < 0 || line.net_amount_minor % line.quantity.value !== 0) return [];
    return [{ id: receiptItemId(receiptId, line.id), receiptId, sourceLineReferences: line.source_line_references, productName: line.description, sourceProductCode: sourceProductCode(line), unitPriceKrw: line.net_amount_minor / line.quantity.value, quantityValue: line.quantity.value, totalPriceKrw: line.net_amount_minor, confidence: line.confidence }];
  });
  const receipt = { id: receiptId, storeLabel: data.merchant.branch_name ? `${data.merchant.name} ${data.merchant.branch_name}` : data.merchant.name, retailChannel: data.merchant.retail_channel, catalogNamespace: data.merchant.catalog_namespace, purchasedAt: data.document.issued_at ?? data.document.issued_on, transactionNumber: data.document.source.original_document_id ?? "", currency: "KRW" as const, totalPriceKrw: data.totals.grand_total_amount_minor, items };
  auditReceipt(receipt, data);
  return receipt;
}

export function auditReceipt(receipt: Receipt, source?: ReceiptJson) {
  if (source) {
    const gross = source.line_items.filter((line) => line.type === "product" || line.type === "service").reduce((sum, line) => sum + line.gross_amount_minor, 0);
    const discount = source.line_items.reduce((sum, line) => sum + line.discount_amount_minor, 0);
    const tax = source.line_items.reduce((sum, line) => sum + line.tax_amount_minor, 0);
    if (gross !== source.totals.items_gross_amount_minor || discount !== source.totals.discount_amount_minor || tax !== source.totals.tax_amount_minor) throw new Error("영수증 품목 집계가 totals와 일치하지 않습니다.");
    const expected = source.totals.items_gross_amount_minor - source.totals.discount_amount_minor + source.totals.tax_amount_minor + source.totals.fee_amount_minor + source.totals.tip_amount_minor + source.totals.rounding_amount_minor;
    if (expected !== source.totals.grand_total_amount_minor) throw new Error("영수증 총액 무결성 검증에 실패했습니다.");
  }
  if (receipt.items.some((item) => item.unitPriceKrw * item.quantityValue !== item.totalPriceKrw)) throw new Error("배분 가능한 품목의 단가와 수량이 일치하지 않습니다.");
  const references = receipt.items.flatMap((item) => item.sourceLineReferences);
  if (new Set(references).size !== references.length) throw new Error("원본 품목 참조가 중복되었습니다.");
  return { itemCount: receipt.items.length, quantity: receipt.items.reduce((sum, item) => sum + item.quantityValue, 0), totalKrw: receipt.totalPriceKrw, sourceLineReferenceCount: references.length };
}
