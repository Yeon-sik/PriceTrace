import { z } from "zod";
import { auditReceipt, mapReceipt, ReceiptJsonSchema, type ReceiptJson } from "./receipt";
import type { Receipt } from "./types";

const minorAmountSchema = z.number().int();
const nullableNonNegativeMinorAmountSchema = minorAmountSchema.nonnegative().nullable();
const confidenceSchema = z.enum(["high", "medium", "low", "user_verified"]);
const lineTypeSchema = z.enum(["product", "service", "discount", "fee", "tax", "tip", "refund", "rounding", "other"]);
const businessKindSchema = z.enum(["retail", "food_service", "transport", "accommodation", "healthcare", "professional_service", "utility", "government", "financial", "marketplace", "other", "unknown"]);
const retailChannelSchema = z.enum(["px", "regular", "unknown"]);
const publicReceiptIdSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])_\d{3}$/);
const publicReceiptFileNameSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])_\d{3}\.json$/);
const publicStoreIdSchema = z.string().regex(/^store_[0-9a-f]{16}$/);
const publicLineIdSchema = z.string().regex(/^line_[0-9a-f]{16}$/);
const revisionSchema = z.string().regex(/^[0-9a-f]{16}$/);

const publicReceiptLineItemSchema = z.object({
  id: publicLineIdSchema,
  type: lineTypeSchema,
  description: z.string().min(1).nullable(),
  sourceLineReferences: z.array(z.string().min(1)),
  identifiers: z.array(z.object({
    scheme: z.string().min(1),
    value: z.string().min(1),
  }).strict()),
  quantity: z.object({
    value: z.number().positive(),
    unit: z.string().min(1),
  }).strict().nullable(),
  unitPriceAmountMinor: nullableNonNegativeMinorAmountSchema,
  grossAmountMinor: nullableNonNegativeMinorAmountSchema,
  discountAmountMinor: nullableNonNegativeMinorAmountSchema,
  taxAmountMinor: nullableNonNegativeMinorAmountSchema,
  netAmountMinor: minorAmountSchema.nullable(),
  confidence: confidenceSchema,
  taxRatePercent: z.number().min(0).nullable(),
  foodService: z.object({
    role: z.enum(["main", "option", "side"]),
    appliesToLineId: publicLineIdSchema.nullable(),
  }).strict().nullable().optional(),
}).strict();

const publicReceiptPayloadSchema = z.object({
  id: publicReceiptIdSchema,
  fileName: publicReceiptFileNameSchema,
  merchant: z.object({
    id: publicStoreIdSchema,
    name: z.string().min(1),
    branchName: z.string().min(1).nullable(),
    businessKind: businessKindSchema,
    retailChannel: retailChannelSchema,
    catalogNamespace: z.string().trim().min(1).nullable(),
    merchantId: z.string().min(1).nullable(),
    businessRegistrationNumber: z.string().min(1).nullable(),
    address: z.string().min(1).nullable(),
    phone: z.string().min(1).nullable(),
  }).strict(),
  document: z.object({
    type: z.enum(["receipt", "invoice", "order_confirmation", "credit_note", "statement", "voucher", "other"]),
    status: z.enum(["draft", "final", "voided", "refunded", "unknown"]),
    issuedOn: z.string().date().nullable(),
    issuedAt: z.string().datetime({ offset: true }).nullable(),
    currency: z.literal("KRW"),
    fulfillment: z.object({
      type: z.enum(["delivery", "takeout", "dine_in", "unknown"]),
      evidence: z.enum(["printed", "user_confirmed", "unknown"]),
    }).strict(),
    captureMethod: z.enum(["pos_export", "e_receipt", "ocr", "manual_transcription", "manual_entry", "unknown"]),
    transcriptionStatus: z.enum(["unprocessed", "parsed", "verified", "user_verified", "unknown"]),
    notes: z.array(z.string()),
  }).strict().refine((document) => document.issuedOn !== null || document.issuedAt !== null, {
    message: "공개 영수증에는 발행일 또는 발행 시각이 필요합니다.",
  }),
  lineItems: z.array(publicReceiptLineItemSchema),
  totals: z.object({
    itemsGrossAmountMinor: nullableNonNegativeMinorAmountSchema,
    discountAmountMinor: nullableNonNegativeMinorAmountSchema,
    taxAmountMinor: nullableNonNegativeMinorAmountSchema,
    feeAmountMinor: minorAmountSchema.nullable(),
    tipAmountMinor: minorAmountSchema.nullable(),
    roundingAmountMinor: minorAmountSchema.nullable(),
    grandTotalAmountMinor: minorAmountSchema,
  }).strict(),
}).strict();

export const PublicReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  privacyPolicyVersion: z.literal(2),
  revision: revisionSchema,
  ...publicReceiptPayloadSchema.shape,
}).strict().superRefine((receipt, context) => {
  if (receipt.fileName !== `${receipt.id}.json`) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 영수증 파일명은 영수증 ID와 일치해야 합니다.", path: ["fileName"] });
  }
  const issuedDate = receipt.document.issuedOn ?? receipt.document.issuedAt?.slice(0, 10);
  if (issuedDate !== receipt.id.slice(0, 10)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 영수증 ID의 날짜와 발행일이 일치하지 않습니다.", path: ["id"] });
  }
  validatePublicReceiptContent(receipt, context);
  if (receipt.revision !== publicReceiptRevision(receipt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 영수증 revision이 내용과 일치하지 않습니다.", path: ["revision"] });
  }
});

export const PublicReceiptIndexSchema = z.object({
  schemaVersion: z.literal(1),
  privacyPolicyVersion: z.literal(2),
  revision: revisionSchema,
  receipts: z.array(z.object({
    id: publicReceiptIdSchema,
    fileName: publicReceiptFileNameSchema,
    revision: revisionSchema,
  }).strict()),
}).strict().superRefine((index, context) => {
  const ids = new Set<string>();
  for (const [entryIndex, entry] of index.receipts.entries()) {
    if (ids.has(entry.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 영수증 인덱스 ID가 중복되었습니다.", path: ["receipts", entryIndex, "id"] });
    }
    ids.add(entry.id);
    if (entry.fileName !== `${entry.id}.json`) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 영수증 인덱스 파일명이 ID와 일치하지 않습니다.", path: ["receipts", entryIndex, "fileName"] });
    }
  }
  if (index.revision !== publicReceiptIndexRevision(index.receipts)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 영수증 인덱스 revision이 내용과 일치하지 않습니다.", path: ["revision"] });
  }
});

export type PublicReceipt = z.infer<typeof PublicReceiptSchema>;
export type PublicReceiptIndex = z.infer<typeof PublicReceiptIndexSchema>;
export type PublicReceiptSource = {
  receiptId: string;
  source: ReceiptJson;
};

export const FORBIDDEN_PUBLIC_RECEIPT_KEYS = new Set([
  "documentId",
  "originalDocumentId",
  "sourceImages",
  "rawText",
  "payments",
  "paymentReference",
  "transactionNumber",
  "approvalNumber",
  "customer",
  "customerId",
]);

export function publicDataHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x5bd1e995);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function publicReceiptRevision(receipt: Omit<PublicReceipt, "revision"> | PublicReceipt) {
  const content = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "revision"),
  );
  return publicDataHash(JSON.stringify(content));
}

function publicReceiptIndexRevision(receipts: PublicReceiptIndex["receipts"]) {
  return publicDataHash(JSON.stringify(receipts));
}

function merchantIdentity(merchant: Omit<PublicReceipt["merchant"], "id">) {
  return JSON.stringify({
    name: merchant.name,
    branchName: merchant.branchName,
    businessRegistrationNumber: merchant.businessRegistrationNumber,
    address: merchant.address,
    phone: merchant.phone,
    merchantId: merchant.merchantId,
  });
}

function publicStoreId(merchant: PublicReceipt["merchant"] | Omit<PublicReceipt["merchant"], "id">) {
  return `store_${publicDataHash(merchantIdentity(merchant))}`;
}

function publicLineId(receiptId: string, sourceLineId: string) {
  return `line_${publicDataHash(JSON.stringify({ receiptId, sourceLineId }))}`;
}

function validatePublicReceiptContent(receipt: Omit<PublicReceipt, "schemaVersion" | "privacyPolicyVersion" | "revision"> | PublicReceipt, context: z.RefinementCtx) {
  const expectedStoreId = publicStoreId(receipt.merchant);
  if (receipt.merchant.id !== expectedStoreId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 판매처 ID가 판매처 정보와 일치하지 않습니다.", path: ["merchant", "id"] });
  }
  const lineIds = new Set<string>();
  for (const [lineIndex, line] of receipt.lineItems.entries()) {
    if (lineIds.has(line.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 영수증 품목 ID가 중복되었습니다.", path: ["lineItems", lineIndex, "id"] });
    }
    lineIds.add(line.id);
    const foodService = line.foodService;
    if (foodService?.appliesToLineId !== null && foodService?.appliesToLineId !== undefined) {
      const parent = receipt.lineItems.find((candidate) => candidate.id === foodService.appliesToLineId);
      if (foodService.role !== "option" || !parent || parent.foodService?.role !== "main") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 옵션 연결은 같은 영수증의 main 메뉴를 가리켜야 합니다.", path: ["lineItems", lineIndex, "foodService"] });
      }
    }
  }
  const hasCompleteLineBreakdown = receipt.lineItems.every((line) => line.grossAmountMinor !== null && line.discountAmountMinor !== null && line.taxAmountMinor !== null);
  const totals = receipt.totals;
  const hasCompleteTotals = [totals.itemsGrossAmountMinor, totals.discountAmountMinor, totals.taxAmountMinor, totals.feeAmountMinor, totals.tipAmountMinor, totals.roundingAmountMinor].every((amount) => amount !== null);
  if (!hasCompleteLineBreakdown || !hasCompleteTotals) return;

  const gross = receipt.lineItems.filter((line) => line.type === "product" || line.type === "service").reduce((sum, line) => sum + line.grossAmountMinor!, 0);
  const discount = receipt.lineItems.reduce((sum, line) => sum + line.discountAmountMinor!, 0);
  const tax = receipt.lineItems.reduce((sum, line) => sum + line.taxAmountMinor!, 0);
  const refunds = receipt.lineItems.filter((line) => line.type === "refund").reduce((sum, line) => sum + (line.netAmountMinor ?? 0), 0);
  const expectedGrandTotal = totals.itemsGrossAmountMinor! - totals.discountAmountMinor! + totals.taxAmountMinor! + totals.feeAmountMinor! + totals.tipAmountMinor! + totals.roundingAmountMinor! + refunds;
  if (gross !== totals.itemsGrossAmountMinor || discount !== totals.discountAmountMinor || tax !== totals.taxAmountMinor || expectedGrandTotal !== totals.grandTotalAmountMinor) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "공개 영수증 품목 집계와 합계가 일치하지 않습니다.", path: ["totals"] });
  }
}

function toPublicReceipt({ receiptId, source: input }: PublicReceiptSource): PublicReceipt {
  const source = ReceiptJsonSchema.parse(input);
  const parsedReceiptId = publicReceiptIdSchema.parse(receiptId);
  const mappedReceipt = mapReceipt(source);
  const issuedDate = source.document.issued_on ?? source.document.issued_at?.slice(0, 10);
  if (issuedDate !== parsedReceiptId.slice(0, 10)) throw new Error(`공개 영수증 ID 날짜가 발행일과 다릅니다: ${parsedReceiptId}`);
  const merchantWithoutId = {
    name: source.merchant.name!,
    branchName: source.merchant.branch_name,
    businessKind: source.merchant.business_kind,
    retailChannel: source.merchant.retail_channel,
    catalogNamespace: source.merchant.catalog_namespace,
    merchantId: source.merchant.merchant_id,
    businessRegistrationNumber: source.merchant.business_registration_number,
    address: source.merchant.address,
    phone: source.merchant.phone,
  };
  const content = {
    schemaVersion: 1 as const,
    privacyPolicyVersion: 2 as const,
    id: parsedReceiptId,
    fileName: `${parsedReceiptId}.json`,
    merchant: { id: publicStoreId(merchantWithoutId), ...merchantWithoutId },
    document: {
      type: source.document.type,
      status: source.document.status,
      issuedOn: source.document.issued_on,
      issuedAt: source.document.issued_at,
      currency: "KRW" as const,
      fulfillment: source.document.fulfillment,
      captureMethod: source.document.source.capture_method,
      transcriptionStatus: source.document.source.transcription_status,
      notes: source.document.source.notes,
    },
    lineItems: source.line_items.map((line) => ({
      id: publicLineId(parsedReceiptId, line.id),
      type: line.type,
      description: line.description,
      sourceLineReferences: line.source_line_references,
      identifiers: line.identifiers,
      quantity: line.quantity,
      unitPriceAmountMinor: line.unit_price_amount_minor,
      grossAmountMinor: line.gross_amount_minor,
      discountAmountMinor: line.discount_amount_minor,
      taxAmountMinor: line.tax_amount_minor,
      netAmountMinor: line.net_amount_minor,
      confidence: line.confidence,
      taxRatePercent: line.tax_rate_percent,
      foodService: line.food_service === null ? null : {
        role: line.food_service.role,
        appliesToLineId: line.food_service.applies_to_line_id === null ? null : publicLineId(parsedReceiptId, line.food_service.applies_to_line_id),
      },
    })),
    totals: {
      itemsGrossAmountMinor: source.totals.items_gross_amount_minor,
      discountAmountMinor: source.totals.discount_amount_minor,
      taxAmountMinor: source.totals.tax_amount_minor,
      feeAmountMinor: source.totals.fee_amount_minor,
      tipAmountMinor: source.totals.tip_amount_minor,
      roundingAmountMinor: source.totals.rounding_amount_minor,
      grandTotalAmountMinor: mappedReceipt.totalPriceKrw,
    },
  };
  return PublicReceiptSchema.parse({ ...content, revision: publicReceiptRevision(content) });
}

export function buildPublicReceiptFiles(sources: PublicReceiptSource[]): PublicReceipt[] {
  const ids = new Set<string>();
  const receipts = sources.map(toPublicReceipt).sort((left, right) => left.id.localeCompare(right.id));
  for (const receipt of receipts) {
    if (ids.has(receipt.id)) throw new Error(`공개 영수증 ID가 중복되었습니다: ${receipt.id}`);
    ids.add(receipt.id);
  }
  return receipts;
}

export function buildPublicReceiptIndex(receipts: PublicReceipt[]): PublicReceiptIndex {
  const entries = receipts
    .map((receipt) => ({ id: receipt.id, fileName: receipt.fileName, revision: receipt.revision }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return PublicReceiptIndexSchema.parse({
    schemaVersion: 1,
    privacyPolicyVersion: 2,
    revision: publicReceiptIndexRevision(entries),
    receipts: entries,
  });
}

export function assertPublicReceiptCollection(indexInput: unknown, receiptInputs: unknown[]): { index: PublicReceiptIndex; receipts: PublicReceipt[] } {
  const index = PublicReceiptIndexSchema.parse(indexInput);
  const receipts = receiptInputs.map((input) => PublicReceiptSchema.parse(input));
  if (index.receipts.length !== receipts.length) throw new Error(`공개 영수증 인덱스 ${index.receipts.length}건과 파일 ${receipts.length}건이 일치하지 않습니다.`);
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  for (const entry of index.receipts) {
    const receipt = byId.get(entry.id);
    if (!receipt || receipt.fileName !== entry.fileName || receipt.revision !== entry.revision) {
      throw new Error(`공개 영수증 인덱스와 파일이 일치하지 않습니다: ${entry.id}`);
    }
  }
  return { index, receipts };
}

function sourceProductCode(line: PublicReceipt["lineItems"][number]) {
  return line.identifiers.find((identifier) => identifier.scheme === "merchant_sku")?.value ?? "";
}

export function publicReceiptFilesToReceipts(inputs: unknown[]): Receipt[] {
  return inputs.map((input) => PublicReceiptSchema.parse(input)).map((publicReceipt) => {
    const purchasedAt = publicReceipt.document.issuedAt ?? publicReceipt.document.issuedOn!;
    const receipt: Receipt = {
      id: publicReceipt.id,
      publicReceiptFileName: publicReceipt.fileName,
      storeId: publicReceipt.merchant.id,
      storeName: publicReceipt.merchant.name,
      storeBranchName: publicReceipt.merchant.branchName,
      storeLabel: publicReceipt.merchant.branchName ? `${publicReceipt.merchant.name} ${publicReceipt.merchant.branchName}` : publicReceipt.merchant.name,
      storeBusinessKind: publicReceipt.merchant.businessKind,
      storeMerchantId: publicReceipt.merchant.merchantId,
      storeBusinessRegistrationNumber: publicReceipt.merchant.businessRegistrationNumber,
      storeAddress: publicReceipt.merchant.address,
      storePhone: publicReceipt.merchant.phone,
      retailChannel: publicReceipt.merchant.retailChannel,
      fulfillmentType: publicReceipt.document.fulfillment.type,
      fulfillmentEvidence: publicReceipt.document.fulfillment.evidence,
      catalogNamespace: publicReceipt.merchant.catalogNamespace,
      purchasedAt,
      transactionNumber: "",
      currency: "KRW",
      totalPriceKrw: publicReceipt.totals.grandTotalAmountMinor,
      source: "public",
      items: publicReceipt.lineItems.flatMap((line) => {
        if (line.type !== "product" || line.description === null || line.quantity?.unit !== "each" || !Number.isInteger(line.quantity.value) || line.quantity.value <= 0 || line.netAmountMinor === null || line.netAmountMinor < 0 || line.netAmountMinor % line.quantity.value !== 0) return [];
        return [{
          id: line.id,
          receiptId: publicReceipt.id,
          sourceLineReferences: line.sourceLineReferences,
          productName: line.description,
          sourceProductCode: sourceProductCode(line),
          unitPriceKrw: line.netAmountMinor / line.quantity.value,
          quantityValue: line.quantity.value,
          totalPriceKrw: line.netAmountMinor,
          confidence: line.confidence,
        }];
      }),
    };
    auditReceipt(receipt);
    return receipt;
  });
}

export function assertNoForbiddenPublicReceiptKeys(value: unknown, path = "publicReceipt"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenPublicReceiptKeys(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_RECEIPT_KEYS.has(key)) throw new Error(`공개 영수증 금지 필드 감지: ${path}.${key}`);
    assertNoForbiddenPublicReceiptKeys(entry, `${path}.${key}`);
  }
}

function collectStringValues(value: unknown, result: string[] = []): string[] {
  if (typeof value === "string") { result.push(value); return result; }
  if (Array.isArray(value)) { value.forEach((entry) => collectStringValues(entry, result)); return result; }
  if (typeof value === "object" && value !== null) Object.values(value).forEach((entry) => collectStringValues(entry, result));
  return result;
}

export function assertNoForbiddenSourceValues(receiptInputs: unknown[], sources: PublicReceiptSource[]) {
  const receipts = receiptInputs.map((input) => PublicReceiptSchema.parse(input));
  const publicValues = collectStringValues(receipts);
  const forbiddenValues = sources.flatMap(({ source }) => [source.document.id, source.document.source.original_document_id, ...source.document.source.source_images, source.document.source.raw_text, ...source.payments.map((payment) => payment.reference)]).filter((value): value is string => typeof value === "string" && value.length >= 4);
  for (const forbidden of forbiddenValues) {
    if (publicValues.some((value) => value.includes(forbidden))) throw new Error("공개 영수증에서 거래·결제·OCR·원본 이미지 관련 금지 값이 감지되었습니다.");
  }
  const unsafeNote = receipts.flatMap((receipt) => receipt.document.notes).find((note) => /[A-Za-z]:[\\/]/.test(note) || /(?:^|[\\/])[^\\/]+\.(?:jpe?g|png|webp|heic|pdf)\b/i.test(note));
  if (unsafeNote) throw new Error("공개 영수증 메모에서 로컬 경로 또는 원본 파일명이 감지되었습니다.");
}
