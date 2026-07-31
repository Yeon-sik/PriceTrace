import { z } from "zod";
import {
  OFFICIAL_PRODUCT_CATEGORIES,
  type OfficialProductCategory,
} from "./official-product-category";
import type { ProductCategory } from "./product-browser";

const httpUrlSchema = z.string().url().refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "HTTP(S) URL이어야 합니다.",
);

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const officialProductCategorySchema = z.enum(OFFICIAL_PRODUCT_CATEGORIES);

const standardProductLinkSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unlinked"), standardProductId: z.null() }).strict(),
  z.object({ status: z.literal("pending"), standardProductId: z.null() }).strict(),
  z.object({ status: z.literal("linked"), standardProductId: z.string().uuid() }).strict(),
  z.object({ status: z.literal("rejected"), standardProductId: z.null() }).strict(),
]);

export const PublicOfficialChannelStandardLinkRegistrySchema = z.object({
  schemaVersion: z.literal("public-official-channel-standard-links.v1"),
  channelId: z.string().min(1),
  links: z.array(z.object({
    sourceProductCodeNamespace: z.string().min(1),
    sourceProductCode: z.string().min(1),
    standardProductId: z.string().uuid(),
    linkedAt: z.string().datetime({ offset: true }),
    linkMethod: z.literal("manual"),
  }).strict()),
}).strict().superRefine((registry, context) => {
  const identities = new Set<string>();
  for (const [index, link] of registry.links.entries()) {
    const identity = officialChannelSourceIdentity(link);
    if (identities.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["links", index, "sourceProductCode"],
        message: "하나의 공식 판매상품이 여러 표준 상품에 연결되었습니다.",
      });
    }
    identities.add(identity);
  }
});

export const PublicOfficialChannelListingSchema = z.object({
  id: z.string().min(1),
  sourceProductCode: z.string().min(1),
  sourceProductCodeNamespace: z.string().min(1),
  sourceNameRaw: z.string().min(1),
  vendorNameRaw: z.string().min(1).nullable(),
  specificationTextRaw: z.string().min(1).nullable(),
  category: officialProductCategorySchema,
  categoryAssignment: z.discriminatedUnion("method", [
    z.object({
      method: z.literal("existing_product_match"),
      basis: z.string().min(1),
    }).strict(),
    z.object({
      method: z.literal("curated_rule"),
      basis: z.string().min(1),
    }).strict(),
  ]),
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
  classification: z.object({
    version: z.literal("px-official-category.v1"),
    existingProductMatchCount: z.number().int().nonnegative(),
    curatedRuleCount: z.number().int().nonnegative(),
    unclassifiedCount: z.literal(0),
    categoryCounts: z.object({
      "식품": z.number().int().nonnegative(),
      "생활용품": z.number().int().nonnegative(),
      "주방용품": z.number().int().nonnegative(),
      "신선식품": z.number().int().nonnegative(),
      "음료": z.number().int().nonnegative(),
      "간식": z.number().int().nonnegative(),
    }).strict(),
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

  const actualCategoryCounts = Object.fromEntries(
    OFFICIAL_PRODUCT_CATEGORIES.map((category) => [
      category,
      catalog.listings.filter((listing) => listing.category === category).length,
    ]),
  ) as Record<OfficialProductCategory, number>;
  for (const category of OFFICIAL_PRODUCT_CATEGORIES) {
    if (catalog.classification.categoryCounts[category] !== actualCategoryCounts[category]) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["classification", "categoryCounts", category],
        message: `${category} count가 실제 listings 분류 수와 다릅니다.`,
      });
    }
  }

  const existingProductMatchCount = catalog.listings.filter(
    (listing) => listing.categoryAssignment.method === "existing_product_match",
  ).length;
  const curatedRuleCount = catalog.listings.length - existingProductMatchCount;
  if (catalog.classification.existingProductMatchCount !== existingProductMatchCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["classification", "existingProductMatchCount"],
      message: "existing product match count가 실제 listings와 다릅니다.",
    });
  }
  if (catalog.classification.curatedRuleCount !== curatedRuleCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["classification", "curatedRuleCount"],
      message: "curated rule count가 실제 listings와 다릅니다.",
    });
  }
});

export type PublicOfficialChannelCatalog = z.infer<typeof PublicOfficialChannelCatalogSchema>;
export type PublicOfficialChannelListing = z.infer<typeof PublicOfficialChannelListingSchema>;
export type PublicOfficialChannelStandardLinkRegistry = z.infer<typeof PublicOfficialChannelStandardLinkRegistrySchema>;
export type OfficialChannelListingSort = "price-asc" | "price-desc" | "name";

export function officialChannelSourceIdentity(source: {
  sourceProductCodeNamespace: string;
  sourceProductCode: string;
}) {
  return `${source.sourceProductCodeNamespace}:${source.sourceProductCode}`;
}

export function partitionOfficialChannelListingsByStandardProduct(
  listings: PublicOfficialChannelListing[],
) {
  const linkedByStandardProduct = new Map<string, PublicOfficialChannelListing[]>();
  const standaloneListings: PublicOfficialChannelListing[] = [];

  for (const listing of listings) {
    if (listing.standardProductLink.status !== "linked") {
      standaloneListings.push(listing);
      continue;
    }
    const standardProductId = listing.standardProductLink.standardProductId;
    linkedByStandardProduct.set(standardProductId, [
      ...(linkedByStandardProduct.get(standardProductId) ?? []),
      listing,
    ]);
  }

  return { linkedByStandardProduct, standaloneListings };
}

export function filterAndSortOfficialChannelListings(
  listings: PublicOfficialChannelListing[],
  query: string,
  sort: OfficialChannelListingSort,
  category: ProductCategory = "전체",
) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const categoryFiltered = category === "전체"
    ? [...listings]
    : listings.filter((listing) => listing.category === category);
  const filtered = normalizedQuery
    ? categoryFiltered.filter((listing) => [
      listing.sourceNameRaw,
      listing.vendorNameRaw,
      listing.specificationTextRaw,
      listing.sourceProductCode,
    ].filter(Boolean).join(" ").toLocaleLowerCase("ko-KR").includes(normalizedQuery))
    : categoryFiltered;

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
