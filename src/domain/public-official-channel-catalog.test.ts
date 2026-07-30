import { describe, expect, it } from "vitest";
import {
  filterAndSortOfficialChannelListings,
  PublicOfficialChannelCatalogSchema,
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
    notices: ["공식 사이트 등재는 특정 지점 판매 또는 재고 확인이 아닙니다."],
    listings: [
      {
        id: "korean-military-px:welfare.mil.kr:shop:p_code:2",
        sourceProductCode: "2",
        sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
        sourceNameRaw: "비싼 상품",
        vendorNameRaw: "업체 나",
        specificationTextRaw: "200g",
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
});
