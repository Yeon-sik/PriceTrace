import { z } from "zod";
import { MerchantProfileV1MerchantSchema } from "./merchant-profile";
import { ReceiptJsonSchema, type ReceiptJson } from "./receipt";

export const VerifiedReceiptIngestionRequestSchema = z.object({
  schema_version: z.literal("verified-receipt-ingestion.v2"),
  idempotency_key: z.string().trim().min(1).max(200),
  receipt: ReceiptJsonSchema,
}).superRefine(({ receipt }, context) => {
  if (receipt.document.source.transcription_status !== "user_verified") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt", "document", "source", "transcription_status"], message: "사용자 검증이 완료된 receipt.v2만 등록할 수 있습니다." });
  }
  if (receipt.document.source.source_images.length > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt", "document", "source", "source_images"], message: "원본 이미지는 PriceTrace ingestion payload에 포함할 수 없습니다." });
  }
  if (receipt.document.source.raw_text !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt", "document", "source", "raw_text"], message: "raw OCR text는 PriceTrace에 저장하거나 전송할 수 없습니다." });
  }
  if (receipt.payments.some((payment) => payment.reference !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt", "payments"], message: "결제 reference는 PriceTrace ingestion payload에 포함할 수 없습니다." });
  }
  if (receipt.line_items.some((line) => line.identifiers.some((identifier) => identifier.scheme !== "merchant_sku"))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["receipt", "line_items"], message: "merchant_sku 이외의 상품 식별자는 catalog identity로 사용하지 않습니다." });
  }
});

export const MerchantOnlyCandidateRequestSchema = z.object({
  schema_version: z.literal("merchant-only-candidate.v1"),
  idempotency_key: z.string().trim().min(1).max(200),
  user_verified: z.literal(true),
  merchant: MerchantProfileV1MerchantSchema,
});

export type VerifiedReceiptIngestionRequest = z.infer<typeof VerifiedReceiptIngestionRequestSchema>;
export type MerchantOnlyCandidateRequest = z.infer<typeof MerchantOnlyCandidateRequestSchema>;
export type VerifiedReceiptInput = ReceiptJson;

export function verifiedReceiptIngestionFingerprint(receipt: ReceiptJson) {
  return JSON.stringify(receipt);
}
