import { z } from "zod";
import type { OfficialProductCandidate } from "./official-product";
import type { PublicOfficialChannelCatalog } from "./public-official-channel-catalog";

const reviewSchema = z.object({
  receiptId: z.string().trim().min(1),
  receiptItemId: z.string().trim().min(1),
  sourceLabel: z.string().trim().min(1),
  sourceProductCode: z.string().trim().min(1),
  sourceNameRaw: z.string().trim().min(1),
  reviewedDisplayName: z.string().trim().min(1),
  officialListing: z.object({
    channelId: z.literal("korean-military-px"),
    sourceProductCodeNamespace: z.string().trim().min(1),
    sourceProductCode: z.string().trim().min(1),
  }).strict(),
  reviewStatus: z.literal("display_alias_only"),
  reviewedAt: z.string().datetime({ offset: true }),
  sourceRefs: z.array(z.string().trim().min(1)).min(2),
}).strict();

export const PxProductNameReviewRegistrySchema = z.object({
  schemaVersion: z.literal("pricetrace-px-receipt-product-name-reviews.v1"),
  reviews: z.array(reviewSchema),
}).strict().superRefine((registry, context) => {
  const identities = new Set<string>();
  for (const [index, review] of registry.reviews.entries()) {
    const identity = `${review.receiptId}:${review.receiptItemId}`;
    if (identities.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviews", index, "receiptItemId"],
        message: "PX 영수증 표시명 검토 항목이 중복되었습니다.",
      });
    }
    identities.add(identity);
  }
});

export type PxProductNameReviewRegistry = z.infer<
  typeof PxProductNameReviewRegistrySchema
>;
export type PxProductNameReview = PxProductNameReviewRegistry["reviews"][number];

export function assertPxProductNameReviewsMatchOfficialCatalog(
  reviews: PxProductNameReview[],
  catalog: PublicOfficialChannelCatalog,
) {
  for (const review of reviews) {
    if (review.officialListing.channelId !== catalog.channel.id) {
      throw new Error(`PX 표시명 검토 채널이 현재 공식 카탈로그와 다릅니다: ${review.sourceProductCode}`);
    }
    const listing = catalog.listings.find((candidate) => (
      candidate.sourceProductCodeNamespace
        === review.officialListing.sourceProductCodeNamespace
      && candidate.sourceProductCode === review.officialListing.sourceProductCode
    ));
    if (!listing) {
      throw new Error(`PX 표시명 검토의 공식 상품을 찾을 수 없습니다: ${review.sourceProductCode}`);
    }
    if (listing.sourceNameRaw !== review.reviewedDisplayName) {
      throw new Error(`PX 검토 표시명이 공식 카탈로그 원문과 다릅니다: ${review.sourceProductCode}`);
    }
  }
}

export function findPxProductNameReview(
  candidate: OfficialProductCandidate,
  reviews: PxProductNameReview[],
) {
  return reviews.find((review) => (
    candidate.catalogNamespace === review.officialListing.channelId
    && candidate.receiptId === review.receiptId
    && candidate.receiptItemId === review.receiptItemId
    && candidate.storeLabel === review.sourceLabel
    && candidate.sourceProductCode === review.sourceProductCode
    && candidate.productName === review.sourceNameRaw
  ));
}
