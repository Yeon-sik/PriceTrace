import { z } from "zod";

const httpUrlSchema = z.string().url().refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "HTTP(S) URL이어야 합니다.",
);

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const standardProductLinkSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unlinked"), standardProductId: z.null() }).strict(),
  z.object({ status: z.literal("pending"), standardProductId: z.null() }).strict(),
  z.object({ status: z.literal("linked"), standardProductId: z.string().uuid() }).strict(),
  z.object({ status: z.literal("rejected"), standardProductId: z.null() }).strict(),
]);

export const PublicOfficialChannelListingSchema = z.object({
  id: z.string().min(1),
  sourceProductCode: z.string().min(1),
  sourceProductCodeNamespace: z.string().min(1),
  sourceNameRaw: z.string().min(1),
  vendorNameRaw: z.string().min(1).nullable(),
  specificationTextRaw: z.string().min(1).nullable(),
  officialPrice: z.object({
    amountKrw: z.number().int().nonnegative(),
    sourceText: z.string().min(1),
    observedAt: z.string().datetime({ offset: true }),
  }).strict(),
  publication: z.object({
    status: z.literal("listed"),
    locationScope: z.literal("channel_unspecified"),
  }).strict(),
  image: z.object({
    url: httpUrlSchema,
    contentHash: hashSchema,
    mediaType: z.string().regex(/^image\//),
    byteLength: z.number().int().positive(),
  }).strict().nullable(),
  standardProductLink: standardProductLinkSchema,
  sourceRefs: z.array(z.string().min(1)).min(1),
}).strict();

export const PublicOfficialChannelCatalogSchema = z.object({
  schemaVersion: z.literal("public-official-channel-catalog.v1"),
  sourceSnapshot: z.object({
    id: z.string().uuid(),
    contentHash: hashSchema,
    capturedAt: z.string().datetime({ offset: true }),
  }).strict(),
  channel: z.object({
    id: z.literal("korean-military-px"),
    name: z.literal("국군복지단 PX"),
    kind: z.literal("retailer"),
    operatorName: z.literal("국군복지단"),
  }).strict(),
  collection: z.object({
    key: z.literal("welfare.mil.kr|mart-sale-products|all-products"),
    name: z.literal("마트 판매상품"),
    completeness: z.enum(["full", "partial", "unknown"]),
    listingCount: z.number().int().nonnegative(),
    pagesCollected: z.number().int().positive().nullable(),
    paginationExhausted: z.boolean(),
  }).strict(),
  notices: z.array(z.string().min(1)).min(1),
  listings: z.array(PublicOfficialChannelListingSchema),
}).strict().superRefine((catalog, context) => {
  if (catalog.collection.listingCount !== catalog.listings.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["collection", "listingCount"],
      message: "listingCount는 listings 길이와 같아야 합니다.",
    });
  }

  const ids = new Set<string>();
  const sourceProductCodes = new Set<string>();
  for (const [index, listing] of catalog.listings.entries()) {
    if (ids.has(listing.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["listings", index, "id"],
        message: "listing id가 중복되었습니다.",
      });
    }
    ids.add(listing.id);

    const sourceIdentity = `${listing.sourceProductCodeNamespace}:${listing.sourceProductCode}`;
    if (sourceProductCodes.has(sourceIdentity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["listings", index, "sourceProductCode"],
        message: "채널 내 source product identity가 중복되었습니다.",
      });
    }
    sourceProductCodes.add(sourceIdentity);
  }

  if (
    catalog.collection.completeness === "full"
    && !catalog.collection.paginationExhausted
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["collection", "paginationExhausted"],
      message: "full collection은 paginationExhausted가 true여야 합니다.",
    });
  }
});

export type PublicOfficialChannelCatalog = z.infer<typeof PublicOfficialChannelCatalogSchema>;
export type PublicOfficialChannelListing = z.infer<typeof PublicOfficialChannelListingSchema>;
export type OfficialChannelListingSort = "price-asc" | "price-desc" | "name";

export function filterAndSortOfficialChannelListings(
  listings: PublicOfficialChannelListing[],
  query: string,
  sort: OfficialChannelListingSort,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const filtered = normalizedQuery
    ? listings.filter((listing) => [
      listing.sourceNameRaw,
      listing.vendorNameRaw,
      listing.specificationTextRaw,
      listing.sourceProductCode,
    ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR").includes(normalizedQuery))
    : [...listings];

  return filtered.sort((left, right) => {
    if (sort === "price-desc") {
      return right.officialPrice.amountKrw - left.officialPrice.amountKrw
        || left.sourceNameRaw.localeCompare(right.sourceNameRaw, "ko");
    }
    if (sort === "name") return left.sourceNameRaw.localeCompare(right.sourceNameRaw, "ko");
    return left.officialPrice.amountKrw - right.officialPrice.amountKrw
      || left.sourceNameRaw.localeCompare(right.sourceNameRaw, "ko");
  });
}
