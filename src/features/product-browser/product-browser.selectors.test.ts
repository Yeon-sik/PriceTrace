import { describe, expect, it } from "vitest";
import { officialProductCandidateKey, type OfficialProductRecord } from "../../domain/official-product";
import { categoryForProduct, type ProductGroup, type ProductObservationListing } from "../../domain/product-browser";
import type { PublicOfficialChannelListing } from "../../domain/public-official-channel-catalog";
import { publicStandardMappingKey, type PublicCoupangPrice } from "../../domain/public-standard-catalog";
import type { ReceiptItem } from "../../domain/types";
import {
  officialListingsAreEligible,
  selectGridEntries,
  selectLinkedStandardSummaries,
  selectProductCatalogGroups,
  selectStoreOptions,
  selectVisibleLinkedStandardSummaries,
  selectVisibleStandardGroups,
} from "./product-browser.selectors";

const STANDARD_PRODUCT_ID = "11111111-1111-4111-8111-111111111111";

function productGroup({
  id,
  productName,
  sourceProductCode,
  storeLabel,
  priceKrw,
  observedAt,
  martType,
  catalogNamespace = null,
}: {
  id: string;
  productName: string;
  sourceProductCode: string;
  storeLabel: string;
  priceKrw: number;
  observedAt: string;
  martType: "regular" | "px";
  catalogNamespace?: string | null;
}): ProductGroup {
  const item: ReceiptItem = {
    id: `${id}:item`,
    receiptId: `${id}:receipt`,
    sourceLineReferences: [`${id}:line`],
    productName,
    sourceProductCode,
    unitPriceKrw: priceKrw,
    quantityValue: 1,
    totalPriceKrw: priceKrw,
    confidence: "high",
  };
  const latest: ProductObservationListing = {
    id: `${id}:listing`,
    item,
    storeLabel,
    sellerKey: `seller:${storeLabel}`,
    catalogNamespace,
    observedAt,
    martType,
    source: "receipt",
  };
  return {
    id,
    sourceProductCode,
    productName,
    storeLabel,
    sellerKey: latest.sellerKey!,
    catalogNamespace,
    martType,
    category: categoryForProduct(productName),
    latest,
    observations: [latest],
    latestPriceKrw: priceKrw,
    minimumPriceKrw: priceKrw,
  };
}

function officialListing({
  id = "official-1",
  standardProductId = STANDARD_PRODUCT_ID,
  name = "표준 쌀 공식 상품",
  vendorName = "공급사 가",
  priceKrw = 7_500,
  category = "식품" as const,
  imageUrl = "https://example.com/official.jpg",
}: {
  id?: string;
  standardProductId?: string;
  name?: string;
  vendorName?: string;
  priceKrw?: number;
  category?: PublicOfficialChannelListing["category"];
  imageUrl?: string | null;
} = {}): PublicOfficialChannelListing {
  return {
    id,
    sourceProductCode: id,
    sourceProductCodeNamespace: "official:test",
    sourceNameRaw: name,
    vendorNameRaw: vendorName,
    specificationTextRaw: "400g x 2",
    category,
    categoryAssignment: { method: "curated_rule", basis: "test" },
    officialPrice: {
      amountKrw: priceKrw,
      sourceText: `${priceKrw}원`,
      observedAt: "2026-07-31T00:00:00.000Z",
    },
    publication: { status: "listed", locationScope: "channel_unspecified" },
    image: imageUrl ? {
      url: imageUrl,
      contentHash: `sha256:${"a".repeat(64)}`,
      mediaType: "image/jpeg",
      byteLength: 100,
    } : null,
    standardProductLink: { status: "linked", standardProductId },
    sourceRefs: [`source:${id}`],
  };
}

function selectCatalog(groups: ProductGroup[], options: {
  officialProducts?: Record<string, OfficialProductRecord>;
  officialListings?: PublicOfficialChannelListing[];
  standardCategories?: Map<string, { id: string; slug: string; name: string }>;
} = {}) {
  const exactStandardMappings = new Map(
    groups
      .filter((group) => group.sourceProductCode.startsWith("MAPPED"))
      .map((group) => [
        publicStandardMappingKey(group.storeLabel, group.sourceProductCode),
        `catalog:${group.sourceProductCode}`,
      ]),
  );
  const catalogSpecs = new Map(
    groups
      .filter((group) => group.sourceProductCode.startsWith("MAPPED"))
      .map((group) => [
        `catalog:${group.sourceProductCode}`,
        {
          contentAmount: 400,
          contentUnit: "g" as const,
          packageCount: 2,
          referenceUnit: 100 as const,
          standardProductId: STANDARD_PRODUCT_ID,
        },
      ]),
  );
  const officialListings = options.officialListings ?? [officialListing()];
  return selectProductCatalogGroups({
    groups,
    officialProducts: options.officialProducts ?? {},
    standardMappings: new Map(),
    exactStandardMappings,
    catalogSpecs,
    standardNames: new Map([[STANDARD_PRODUCT_ID, "표준 쌀"]]),
    standardCategories: options.standardCategories ?? new Map([[
      STANDARD_PRODUCT_ID,
      {
        id: "22222222-2222-4222-8222-222222222222",
        slug: "flour-grains",
        name: "쌀·가루류",
      },
    ]]),
    standardBrands: new Map([[STANDARD_PRODUCT_ID, "테스트 브랜드"]]),
    standardImages: new Map([[STANDARD_PRODUCT_ID, "https://example.com/fallback.jpg"]]),
    coupangByStandard: new Map<string, PublicCoupangPrice>(),
    linkedByStandardProduct: new Map([[STANDARD_PRODUCT_ID, officialListings]]),
  });
}

describe("product browser selectors", () => {
  it("keeps unmapped products and builds the same normalized standard-product summary", () => {
    const mapped = productGroup({
      id: "mapped",
      productName: "테스트 쌀 400g",
      sourceProductCode: "MAPPED-1",
      storeLabel: "PX 가",
      priceKrw: 8_000,
      observedAt: "2026-07-31T00:00:00.000Z",
      martType: "px",
    });
    const unmapped = productGroup({
      id: "unmapped",
      productName: "일반 상품",
      sourceProductCode: "UNMAPPED-1",
      storeLabel: "일반 마트",
      priceKrw: 2_000,
      observedAt: "2026-07-30T00:00:00.000Z",
      martType: "regular",
    });
    const officialProduct: OfficialProductRecord = {
      officialName: "공식 일반 상품",
      officialUrl: "https://example.com/product",
      sourceName: "test",
      matchMethod: "manual",
      updatedAt: "2026-07-31T00:00:00.000Z",
    };

    const result = selectCatalog([mapped, unmapped], {
      officialProducts: {
        [officialProductCandidateKey(unmapped)]: officialProduct,
      },
    });

    expect(result.standardGroups[0].brand).toBe("테스트 브랜드");
    expect(result.productGroups).toHaveLength(1);
    expect(result.productGroups[0].officialProduct).toEqual(officialProduct);
    expect(result.standardGroups).toHaveLength(1);
    expect(result.standardGroups[0]).toMatchObject({
      id: `standard:${STANDARD_PRODUCT_ID}`,
      name: "표준 쌀",
      imageUrl: "https://example.com/official.jpg",
      category: "쌀·가루류",
      lowestUnitPriceKrw: 1_000,
      highestUnitPriceKrw: 1_000,
      unitPriceLabel: "100g당",
      lowestPriceKrw: 8_000,
      sellerCount: 1,
      observationCount: 1,
    });
    expect(result.standardGroups[0].items[0]).toMatchObject({
      catalogProductId: "catalog:MAPPED-1",
      packageLabel: "400g x 2",
      referenceUnit: 100,
    });
    expect(result.standardGroups[0].priceHistory).toEqual([{
      date: "2026-07-31T00:00:00.000Z",
      unitPriceKrw: 1_000,
      unitPriceLabel: "100g당",
      actualPriceKrw: 8_000,
      storeLabel: "PX 가",
    }]);
  });

  it("recalculates a standard summary after mart filtering and gates official-source search", () => {
    const px = productGroup({
      id: "px",
      productName: "테스트 쌀 400g",
      sourceProductCode: "MAPPED-PX",
      storeLabel: "PX 가",
      priceKrw: 8_000,
      observedAt: "2026-07-31T00:00:00.000Z",
      martType: "px",
    });
    const regular = productGroup({
      id: "regular",
      productName: "테스트 쌀 400g",
      sourceProductCode: "MAPPED-REGULAR",
      storeLabel: "일반 마트",
      priceKrw: 6_400,
      observedAt: "2026-07-30T00:00:00.000Z",
      martType: "regular",
    });
    const { standardGroups } = selectCatalog([px, regular]);

    const visible = selectVisibleStandardGroups({
      standardGroups,
      coupangByStandard: new Map(),
      query: "공급사 가",
      category: "전체",
      martType: "px",
      officialListingsEligible: true,
      selectedStore: "all",
      sort: "cheap",
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({
      lowestUnitPriceKrw: 1_000,
      highestUnitPriceKrw: 1_000,
      lowestPriceKrw: 8_000,
      sellerCount: 1,
      observationCount: 1,
    });
    expect(visible[0].items.map((item) => item.storeLabel)).toEqual(["PX 가"]);
    expect(visible[0].officialListings).toHaveLength(1);

    expect(selectVisibleStandardGroups({
      standardGroups,
      coupangByStandard: new Map(),
      query: "공급사 가",
      category: "전체",
      martType: "regular",
      officialListingsEligible: false,
      selectedStore: "all",
      sort: "cheap",
    })).toEqual([]);
  });

  it("preserves official summary fallback, eligibility, search, and store options", () => {
    const listing = officialListing({ name: "분류되지 않은 공식명", category: "음료" });
    const summaries = selectLinkedStandardSummaries({
      linkedByStandardProduct: new Map([[STANDARD_PRODUCT_ID, [listing]]]),
      standardNames: new Map(),
      standardCategories: new Map(),
      standardBrands: new Map(),
      standardImages: new Map(),
    });

    expect(summaries[0]).toMatchObject({
      name: "분류되지 않은 공식명",
      category: "음료",
      imageUrl: "https://example.com/official.jpg",
    });
    expect(officialListingsAreEligible("all", "all")).toBe(true);
    expect(officialListingsAreEligible("px", "all")).toBe(true);
    expect(officialListingsAreEligible("regular", "all")).toBe(false);
    expect(officialListingsAreEligible("px", "PX 가")).toBe(false);
    expect(selectVisibleLinkedStandardSummaries({
      summaries,
      eligible: true,
      query: "공급사 가",
      category: "전체",
    })).toHaveLength(1);
    expect(selectVisibleLinkedStandardSummaries({
      summaries,
      eligible: false,
      query: "",
      category: "전체",
    })).toEqual([]);

    const px = productGroup({
      id: "px-store",
      productName: "PX 상품",
      sourceProductCode: "PX-1",
      storeLabel: "PX 나",
      priceKrw: 1_000,
      observedAt: "2026-07-31T00:00:00.000Z",
      martType: "px",
    });
    const regular = productGroup({
      id: "regular-store",
      productName: "일반 상품",
      sourceProductCode: "REGULAR-1",
      storeLabel: "일반 마트",
      priceKrw: 1_000,
      observedAt: "2026-07-31T00:00:00.000Z",
      martType: "regular",
    });
    expect(selectStoreOptions({ productGroups: [regular, px], standardGroups: [], martType: "px" }))
      .toEqual(["PX 나"]);
  });

  it("deduplicates represented official standards and preserves view-specific entries and sorting", () => {
    const mapped = productGroup({
      id: "mapped",
      productName: "테스트 쌀 400g",
      sourceProductCode: "MAPPED-1",
      storeLabel: "PX 가",
      priceKrw: 8_000,
      observedAt: "2026-07-31T00:00:00.000Z",
      martType: "px",
    });
    const product = productGroup({
      id: "product",
      productName: "개별 상품",
      sourceProductCode: "PRODUCT-1",
      storeLabel: "일반 마트",
      priceKrw: 500,
      observedAt: "2026-07-31T00:00:00.000Z",
      martType: "regular",
    });
    const listing = officialListing();
    const { standardGroups } = selectCatalog([mapped], { officialListings: [listing] });
    const summaries = selectLinkedStandardSummaries({
      linkedByStandardProduct: new Map([[STANDARD_PRODUCT_ID, [listing]]]),
      standardNames: new Map([[STANDARD_PRODUCT_ID, "표준 쌀"]]),
      standardCategories: new Map([[
        STANDARD_PRODUCT_ID,
        {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "protein-drinks",
          name: "단백질음료",
        },
      ]]),
      standardBrands: new Map([[STANDARD_PRODUCT_ID, "테스트 브랜드"]]),
      standardImages: new Map(),
    });

    const allEntries = selectGridEntries({
      visibleStandardGroups: standardGroups,
      visibleProductGroups: [product],
      visibleLinkedStandardSummaries: summaries,
      catalogView: "all",
      sort: "cheap",
    });
    expect(allEntries.map((entry) => entry.kind)).toEqual(["product", "standard"]);

    const standardEntries = selectGridEntries({
      visibleStandardGroups: standardGroups,
      visibleProductGroups: [product],
      visibleLinkedStandardSummaries: summaries,
      catalogView: "standard",
      sort: "cheap",
    });
    expect(standardEntries.map((entry) => entry.kind)).toEqual(["standard"]);

    const officialEntries = selectGridEntries({
      visibleStandardGroups: standardGroups,
      visibleProductGroups: [product],
      visibleLinkedStandardSummaries: summaries,
      catalogView: "official",
      sort: "cheap",
    });
    expect(officialEntries.map((entry) => entry.kind)).toEqual(["official-standard"]);
    expect(summaries[0].category).toBe("단백질음료");
  });
});
