import { describe, expect, it } from "vitest";
import {
  filterAndSortOfficialChannelListings,
  partitionOfficialChannelListingsByStandardProduct,
  PublicOfficialChannelCatalogSchema,
  PublicOfficialChannelStandardLinkRegistrySchema,
  type PublicOfficialChannelCatalog,
} from "./public-official-channel-catalog";

function catalog(): PublicOfficialChannelCatalog {
  return {
    schemaVersion: "public-official-channel-catalog.v1",
    sourceSnapshot: {
      id: "1ce9706a-1ea4-45db-ac72-ed3414a955b0",
      contentHash: `sha256:${"a".repeat(64)}`,
      capturedAt: "2026-07-30T14:18:43.000Z",
    },
    channel: {
      id: "korean-military-px",
      name: "국군복지단 PX",
      kind: "retailer",
      operatorName: "국군복지단",
    },
    collection: {
      key: "welfare.mil.kr|mart-sale-products|all-products",
      name: "마트 판매상품",
      completeness: "full",
      listingCount: 2,
      pagesCollected: 46,
      paginationExhausted: true,
    },
    classification: {
      version: "px-official-category.v1",
      existingProductMatchCount: 1,
      curatedRuleCount: 1,
      unclassifiedCount: 0,
      categoryCounts: {
        "식품": 1,
        "생활용품": 0,
        "주방용품": 0,
        "신선식품": 0,
        "음료": 1,
        "간식": 0,
      },
    },
    notices: ["공식 사이트 등재는 특정 지점 판매 또는 재고 확인이 아닙니다."],
    listings: [
      {
        id: "korean-military-px:welfare.mil.kr:shop:p_code:2",
        sourceProductCode: "2",
        sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
        sourceNameRaw: "비싼 상품",
        vendorNameRaw: "업체 나",
        specificationTextRaw: "200g",
        category: "음료",
        categoryAssignment: {
          method: "curated_rule",
          basis: "test-beverage",
        },
        officialPrice: {
          amountKrw: 2_000,
          sourceText: "2,000원",
          observedAt: "2026-07-30T14:00:00.000Z",
        },
        publication: { status: "listed", locationScope: "channel_unspecified" },
        image: null,
        standardProductLink: { status: "unlinked", standardProductId: null },
        sourceRefs: ["source-2"],
      },
      {
        id: "korean-military-px:welfare.mil.kr:shop:p_code:1",
        sourceProductCode: "1",
        sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
        sourceNameRaw: "저렴한 상품",
        vendorNameRaw: "업체 가",
        specificationTextRaw: "100g",
        category: "식품",
        categoryAssignment: {
          method: "existing_product_match",
          basis: "저렴한 상품",
        },
        officialPrice: {
          amountKrw: 1_000,
          sourceText: "1,000원",
          observedAt: "2026-07-30T14:00:00.000Z",
        },
        publication: { status: "listed", locationScope: "channel_unspecified" },
        image: null,
        standardProductLink: { status: "unlinked", standardProductId: null },
        sourceRefs: ["source-1"],
      },
    ],
  };
}

describe("public official channel catalog", () => {
  it("accepts a channel collection without treating it as a standard product", () => {
    const parsed = PublicOfficialChannelCatalogSchema.parse(catalog());

    expect(parsed.channel.id).toBe("korean-military-px");
    expect(parsed.collection.key).toBe("welfare.mil.kr|mart-sale-products|all-products");
    expect(parsed.listings.every((listing) => listing.standardProductLink.status === "unlinked")).toBe(true);
  });

  it("rejects a mismatched full collection count", () => {
    const input = catalog();
    input.collection.listingCount = 3;

    expect(PublicOfficialChannelCatalogSchema.safeParse(input).success).toBe(false);
  });

  it("searches raw source fields and sorts official display prices", () => {
    const listings = catalog().listings;

    expect(filterAndSortOfficialChannelListings(listings, "업체 나", "price-asc").map((item) => item.sourceProductCode)).toEqual(["2"]);
    expect(filterAndSortOfficialChannelListings(listings, "", "price-asc").map((item) => item.sourceProductCode)).toEqual(["1", "2"]);
    expect(filterAndSortOfficialChannelListings(listings, "", "price-desc").map((item) => item.sourceProductCode)).toEqual(["2", "1"]);
  });

  it("filters official listings by the persisted category", () => {
    const listings = catalog().listings;

    expect(filterAndSortOfficialChannelListings(listings, "", "price-asc", "음료").map((item) => item.sourceProductCode)).toEqual(["2"]);
    expect(filterAndSortOfficialChannelListings(listings, "", "price-asc", "식품").map((item) => item.sourceProductCode)).toEqual(["1"]);
  });

  it("removes linked official listings from standalone cards and groups them under the standard product", () => {
    const listings = catalog().listings;
    listings[0].standardProductLink = {
      status: "linked",
      standardProductId: "11111111-1111-4111-8111-111111111111",
    };

    const partitioned = partitionOfficialChannelListingsByStandardProduct(listings);

    expect(partitioned.standaloneListings.map((listing) => listing.sourceProductCode)).toEqual(["1"]);
    expect(partitioned.linkedByStandardProduct.get("11111111-1111-4111-8111-111111111111")?.map(
      (listing) => listing.sourceProductCode,
    )).toEqual(["2"]);
  });

  it("rejects duplicate source identities in the manual standard link registry", () => {
    const duplicatedLink = {
      sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
      sourceProductCode: "2",
      standardProductId: "11111111-1111-4111-8111-111111111111",
      linkedAt: "2026-07-31T00:00:00.000Z",
      linkMethod: "manual" as const,
    };
    const result = PublicOfficialChannelStandardLinkRegistrySchema.safeParse({
      schemaVersion: "public-official-channel-standard-links.v1",
      channelId: "korean-military-px",
      links: [duplicatedLink, duplicatedLink],
    });

    expect(result.success).toBe(false);
  });
});
