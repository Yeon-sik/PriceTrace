import { z } from "zod";
import type { ProductObservationListing } from "./product-browser";
import type { Confidence, Receipt, RetailChannel } from "./types";

const confidenceSchema = z.enum(["high", "medium", "low", "user_verified"]);
const retailChannelSchema = z.enum(["px", "regular", "unknown"]);
const publicStoreLabelSchema = z.enum(["PX", "일반 매장", "판매처 미상"]);
const observedMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const hashSchema = z.string().regex(/^[0-9a-f]{16}$/);

export const PublicProductObservationSchema = z.object({
  id: hashSchema,
  storeLabel: publicStoreLabelSchema,
  retailChannel: retailChannelSchema,
  catalogNamespace: z.string().trim().min(1).nullable(),
  observedMonth: observedMonthSchema,
  productName: z.string().trim().min(1).max(300),
  sourceProductCode: z.string().trim().max(128),
  unitPriceKrw: z.number().int().nonnegative(),
  confidence: confidenceSchema,
}).strict();

export const PublicObservationBundleSchema = z.object({
  schemaVersion: z.literal(1),
  privacyPolicyVersion: z.literal(1),
  revision: hashSchema,
  observations: z.array(PublicProductObservationSchema),
}).strict().superRefine((bundle, context) => {
  const ids = new Set<string>();
  for (const [index, observation] of bundle.observations.entries()) {
    if (ids.has(observation.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "공개 관측 ID가 중복되었습니다.",
        path: ["observations", index, "id"],
      });
    }
    ids.add(observation.id);
  }

  const expectedRevision = stableHash(JSON.stringify(bundle.observations));
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

function stableHash(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x5bd1e995);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function publicStoreLabel(channel: RetailChannel) {
  if (channel === "px") return "PX" as const;
  if (channel === "regular") return "일반 매장" as const;
  return "판매처 미상" as const;
}

function receiptMonth(receipt: Receipt) {
  const month = receipt.purchasedAt.slice(0, 7);
  return observedMonthSchema.parse(month);
}

function compareObservations(left: PublicProductObservation, right: PublicProductObservation) {
  return left.storeLabel.localeCompare(right.storeLabel)
    || left.productName.localeCompare(right.productName, "ko-KR")
    || left.sourceProductCode.localeCompare(right.sourceProductCode)
    || left.observedMonth.localeCompare(right.observedMonth)
    || left.unitPriceKrw - right.unitPriceKrw
    || left.id.localeCompare(right.id);
}

export function buildPublicObservationBundle(receipts: Receipt[]): PublicObservationBundle {
  const deduplicated = new Map<string, PublicProductObservation>();

  for (const receipt of receipts) {
    const storeLabel = publicStoreLabel(receipt.retailChannel);
    const observedMonth = receiptMonth(receipt);
    for (const item of receipt.items) {
      const identity = JSON.stringify({
        storeLabel,
        retailChannel: receipt.retailChannel,
        catalogNamespace: receipt.catalogNamespace,
        observedMonth,
        productName: item.productName,
        sourceProductCode: item.sourceProductCode,
        unitPriceKrw: item.unitPriceKrw,
      });
      const id = stableHash(identity);
      const current = deduplicated.get(identity);
      if (current && confidencePriority[current.confidence] >= confidencePriority[item.confidence]) continue;
      deduplicated.set(identity, {
        id,
        storeLabel,
        retailChannel: receipt.retailChannel,
        catalogNamespace: receipt.catalogNamespace,
        observedMonth,
        productName: item.productName,
        sourceProductCode: item.sourceProductCode,
        unitPriceKrw: item.unitPriceKrw,
        confidence: item.confidence,
      });
    }
  }

  const observations = [...deduplicated.values()].sort(compareObservations);
  const ids = new Map<string, string>();
  for (const observation of observations) {
    const serialized = JSON.stringify(observation);
    const existing = ids.get(observation.id);
    if (existing && existing !== serialized) throw new Error(`공개 관측 ID 충돌: ${observation.id}`);
    ids.set(observation.id, serialized);
  }

  return PublicObservationBundleSchema.parse({
    schemaVersion: 1,
    privacyPolicyVersion: 1,
    revision: stableHash(JSON.stringify(observations)),
    observations,
  });
}

export function publicObservationListings(bundle: PublicObservationBundle): ProductObservationListing[] {
  return bundle.observations.map((observation) => {
    const receiptId = `public:${observation.id}`;
    return {
      id: receiptId,
      item: {
        id: `${receiptId}:item`,
        receiptId,
        sourceLineReferences: [],
        productName: observation.productName,
        sourceProductCode: observation.sourceProductCode,
        unitPriceKrw: observation.unitPriceKrw,
        quantityValue: 1,
        totalPriceKrw: observation.unitPriceKrw,
        confidence: observation.confidence,
      },
      storeLabel: observation.storeLabel,
      catalogNamespace: observation.catalogNamespace,
      observedAt: observation.observedMonth,
      martType: observation.retailChannel === "px" ? "px" : "regular",
      source: "public",
    };
  });
}
