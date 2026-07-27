import { z } from "zod";
import { normalizeSellerLabel, sellerIdentityKeyForReceipt, type ProductObservationListing } from "./product-browser";
import {
  assertPublicReceiptCollection,
  PublicReceiptIndexSchema,
  publicDataHash,
  publicReceiptFilesToReceipts,
  type PublicReceiptIndex,
} from "./public-receipt";
import type { Confidence, Receipt } from "./types";

const confidenceSchema = z.enum(["high", "medium", "low", "user_verified"]);
const retailChannelSchema = z.enum(["px", "regular", "unknown"]);
const hashSchema = z.string().regex(/^[0-9a-f]{16}$/);
const publicReceiptIdSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])_\d{3}$/);
const publicStoreIdSchema = z.string().regex(/^store_[0-9a-f]{16}$/);
const publicLineIdSchema = z.string().regex(/^line_[0-9a-f]{16}$/);
const observedAtSchema = z.string().refine(
  (value) => z.string().date().safeParse(value).success || z.string().datetime({ offset: true }).safeParse(value).success,
  "관측 시점은 ISO 8601 날짜 또는 offset이 포함된 시각이어야 합니다.",
);

export const PublicProductObservationSchema = z.object({
  id: hashSchema,
  receiptId: publicReceiptIdSchema,
  receiptItemId: publicLineIdSchema,
  storeId: publicStoreIdSchema,
  storeLabel: z.string().trim().min(1).max(300),
  retailChannel: retailChannelSchema,
  catalogNamespace: z.string().trim().min(1).nullable(),
  observedAt: observedAtSchema,
  productName: z.string().trim().min(1).max(300),
  sourceProductCode: z.string().trim().max(128),
  quantity: z.number().int().positive(),
  unitPriceKrw: z.number().int().nonnegative(),
  totalPriceKrw: z.number().int().nonnegative(),
  confidence: confidenceSchema,
}).strict().refine(
  (observation) => observation.unitPriceKrw * observation.quantity === observation.totalPriceKrw,
  { message: "공개 관측의 단가·수량·합계가 일치하지 않습니다." },
);

export const PublicObservationBundleSchema = z.object({
  schemaVersion: z.literal(3),
  privacyPolicyVersion: z.literal(2),
  receiptIndexRevision: hashSchema,
  revision: hashSchema,
  observations: z.array(PublicProductObservationSchema),
}).strict().superRefine((bundle, context) => {
  const ids = new Set<string>();
  const receiptItemIds = new Set<string>();
  for (const [index, observation] of bundle.observations.entries()) {
    if (ids.has(observation.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "공개 관측 ID가 중복되었습니다.",
        path: ["observations", index, "id"],
      });
    }
    ids.add(observation.id);

    const receiptItemIdentity = `${observation.receiptId}:${observation.receiptItemId}`;
    if (receiptItemIds.has(receiptItemIdentity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "공개 영수증 품목 연결이 중복되었습니다.",
        path: ["observations", index, "receiptItemId"],
      });
    }
    receiptItemIds.add(receiptItemIdentity);
  }

  const expectedRevision = publicDataHash(JSON.stringify(bundle.observations));
  if (bundle.revision !== expectedRevision) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "공개 관측 revision이 내용과 일치하지 않습니다.",
      path: ["revision"],
    });
  }
});

export type PublicProductObservation = z.infer<typeof PublicProductObservationSchema>;
export type PublicObservationBundle = z.infer<typeof PublicObservationBundleSchema>;

const confidencePriority: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
  user_verified: 3,
};

function compareObservations(left: PublicProductObservation, right: PublicProductObservation) {
  return left.storeLabel.localeCompare(right.storeLabel, "ko-KR")
    || left.productName.localeCompare(right.productName, "ko-KR")
    || left.sourceProductCode.localeCompare(right.sourceProductCode)
    || left.observedAt.localeCompare(right.observedAt)
    || left.receiptId.localeCompare(right.receiptId)
    || left.receiptItemId.localeCompare(right.receiptItemId);
}

export function buildPublicObservationBundle(receipts: Receipt[], receiptIndexRevision: string): PublicObservationBundle {
  const deduplicated = new Map<string, PublicProductObservation>();

  for (const receipt of receipts) {
    if (!receipt.storeId) throw new Error(`공개 영수증에 판매처 ID가 없습니다: ${receipt.id}`);
    for (const item of receipt.items) {
      const identity = JSON.stringify({
        receiptId: receipt.id,
        receiptItemId: item.id,
      });
      const id = publicDataHash(identity);
      const current = deduplicated.get(identity);
      if (current && confidencePriority[current.confidence] >= confidencePriority[item.confidence]) continue;
      deduplicated.set(identity, {
        id,
        receiptId: receipt.id,
        receiptItemId: item.id,
        storeId: receipt.storeId,
        storeLabel: receipt.storeLabel,
        retailChannel: receipt.retailChannel,
        catalogNamespace: receipt.catalogNamespace,
        observedAt: receipt.purchasedAt,
        productName: item.productName,
        sourceProductCode: item.sourceProductCode,
        quantity: item.quantityValue,
        unitPriceKrw: item.unitPriceKrw,
        totalPriceKrw: item.totalPriceKrw,
        confidence: item.confidence,
      });
    }
  }

  const observations = [...deduplicated.values()].sort(compareObservations);
  return PublicObservationBundleSchema.parse({
    schemaVersion: 3,
    privacyPolicyVersion: 2,
    receiptIndexRevision,
    revision: publicDataHash(JSON.stringify(observations)),
    observations,
  });
}

export function publicObservationListings(bundle: PublicObservationBundle, receipts: Receipt[] = []): ProductObservationListing[] {
  const sellerKeysByReceiptId = new Map(
    receipts.map((receipt) => [receipt.id, sellerIdentityKeyForReceipt(receipt)]),
  );
  return bundle.observations.map((observation) => ({
    id: observation.id,
    item: {
      id: observation.receiptItemId,
      receiptId: observation.receiptId,
      sourceLineReferences: [],
      productName: observation.productName,
      sourceProductCode: observation.sourceProductCode,
      unitPriceKrw: observation.unitPriceKrw,
      quantityValue: observation.quantity,
      totalPriceKrw: observation.totalPriceKrw,
      confidence: observation.confidence,
    },
    storeLabel: observation.storeLabel,
    sellerKey: sellerKeysByReceiptId.get(observation.receiptId) ?? `label:${normalizeSellerLabel(observation.storeLabel)}`,
    catalogNamespace: observation.catalogNamespace,
    observedAt: observation.observedAt,
    martType: observation.retailChannel === "px" ? "px" : "regular",
    source: "public",
  }));
}

export function assertPublicReceiptObservationLinks(
  receiptIndexInput: PublicReceiptIndex | unknown,
  receiptInputs: unknown[],
  observationInput: PublicObservationBundle | unknown,
) {
  const receiptIndex = PublicReceiptIndexSchema.parse(receiptIndexInput);
  const collection = assertPublicReceiptCollection(receiptIndex, receiptInputs);
  const observationBundle = PublicObservationBundleSchema.parse(observationInput);
  if (observationBundle.receiptIndexRevision !== receiptIndex.revision) {
    throw new Error("공개 상품 관측이 최신 공개 영수증 revision을 가리키지 않습니다.");
  }

  const expected = new Map<string, Omit<PublicProductObservation, "id">>();
  for (const receipt of publicReceiptFilesToReceipts(collection.receipts)) {
    for (const item of receipt.items) {
      expected.set(`${receipt.id}:${item.id}`, {
        receiptId: receipt.id,
        receiptItemId: item.id,
        storeId: receipt.storeId!,
        storeLabel: receipt.storeLabel,
        retailChannel: receipt.retailChannel,
        catalogNamespace: receipt.catalogNamespace,
        observedAt: receipt.purchasedAt,
        productName: item.productName,
        sourceProductCode: item.sourceProductCode,
        quantity: item.quantityValue,
        unitPriceKrw: item.unitPriceKrw,
        totalPriceKrw: item.totalPriceKrw,
        confidence: item.confidence,
      });
    }
  }

  if (observationBundle.observations.length !== expected.size) {
    throw new Error(`공개 영수증 품목 ${expected.size}건과 공개 상품 관측 ${observationBundle.observations.length}건이 일치하지 않습니다.`);
  }

  for (const observation of observationBundle.observations) {
    const key = `${observation.receiptId}:${observation.receiptItemId}`;
    const linked = expected.get(key);
    if (!linked) throw new Error(`공개 상품 관측의 영수증 연결을 찾을 수 없습니다: ${observation.id}`);
    const actual: Omit<PublicProductObservation, "id"> = {
      receiptId: observation.receiptId,
      receiptItemId: observation.receiptItemId,
      storeId: observation.storeId,
      storeLabel: observation.storeLabel,
      retailChannel: observation.retailChannel,
      catalogNamespace: observation.catalogNamespace,
      observedAt: observation.observedAt,
      productName: observation.productName,
      sourceProductCode: observation.sourceProductCode,
      quantity: observation.quantity,
      unitPriceKrw: observation.unitPriceKrw,
      totalPriceKrw: observation.totalPriceKrw,
      confidence: observation.confidence,
    };
    if (JSON.stringify(actual) !== JSON.stringify(linked)) {
      throw new Error(`공개 상품 관측이 연결된 영수증 품목과 일치하지 않습니다: ${observation.id}`);
    }
  }
}
