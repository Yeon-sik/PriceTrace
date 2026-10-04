import { z } from "zod";

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
export const DiningMerchantCandidateSchema = z.object({
  candidate_id: uuid, origin: z.enum(["merchant_only", "receipt_ingestion"]),
  merchant_name: z.string().min(1), branch_name: z.string().nullable(),
  business_registration_number: z.string().nullable(), address: z.string().nullable(),
  phone: z.string().nullable(), business_kind: z.string(), source_namespace: z.string().nullable(),
  source_code: z.string().nullable(), created_at: z.string().datetime({ offset: true }),
});
export type DiningMerchantCandidate = z.infer<typeof DiningMerchantCandidateSchema>;
export const RestaurantMenuCandidateSchema = z.object({
  schemaVersion: z.literal("restaurant-menu-candidate.v1"),
  candidateId: uuid,
  reviewStatus: z.enum(["pending", "accepted", "rejected"]),
  resolutionStatus: z.enum(["exact", "unresolved"]),
  restaurantId: nullableUuid,
  restaurantLocationId: nullableUuid,
  restaurantMenuId: nullableUuid,
  catalogProductId: nullableUuid,
  proposedRestaurantId: nullableUuid,
  proposedRestaurantLocationId: nullableUuid,
  merchantCandidateId: nullableUuid,
  menuName: z.string().trim().min(1).max(200),
  metadata: z.object({
    serving_label: z.string().max(200).optional(),
    category_label: z.string().max(200).optional(),
    official_url: z.string().url().max(2048).optional(),
  }),
  reviewNote: z.string().max(500).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).superRefine((candidate, context) => {
  const exactIds = [candidate.restaurantId, candidate.restaurantLocationId,
    candidate.restaurantMenuId, candidate.catalogProductId];
  if (candidate.resolutionStatus === "exact"
    ? candidate.reviewStatus !== "accepted" || exactIds.some((id) => id === null)
    : exactIds.some((id) => id !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "제안 검토 상태와 exact identity가 모순됩니다." });
  }
  const selectorValid = candidate.merchantCandidateId !== null
    ? candidate.proposedRestaurantId === null && candidate.proposedRestaurantLocationId === null
    : candidate.proposedRestaurantId !== null && candidate.proposedRestaurantLocationId !== null;
  if (!selectorValid) context.addIssue({ code: z.ZodIssueCode.custom, message: "제안의 가게 selector가 올바르지 않습니다." });
});
export type RestaurantMenuCandidate = z.infer<typeof RestaurantMenuCandidateSchema>;

export const ResolveRestaurantMenuCandidateSchema = z.discriminatedUnion("decision", [
  z.object({ candidateId: uuid, decision: z.literal("accept"), restaurantId: uuid,
    restaurantLocationId: uuid, restaurantMenuId: uuid, catalogProductId: uuid,
    reviewNote: z.string().trim().max(500).optional() }).strict(),
  z.object({ candidateId: uuid, decision: z.literal("reject"),
    reviewNote: z.string().trim().max(500).optional() }).strict(),
]);
export type ResolveRestaurantMenuCandidate = z.infer<typeof ResolveRestaurantMenuCandidateSchema>;
