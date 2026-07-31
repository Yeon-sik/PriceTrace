import { describe, expect, it } from "vitest";
import { categoryForProduct, compareCoupangPrice, distinctSellerCount, filterAndSortProductGroups, groupProductObservations, latestSellerRows, martTagFor, martTypeFor, mergeOfficialProductGroups, normalizeSellerLabel, type ProductObservationListing } from "./product-browser";
import type { ReceiptItem } from "./types";
import { createUniversalReceipt } from "./receipt.fixture";
import { mapReceipt } from "./receipt";

function listing(date: string, price: number, code = "A1", name = "product", catalogNamespace: string | null = null, storeLabel = "test store"): ProductObservationListing {
  const item: ReceiptItem = { id: `${date}:${code}:${price}`, receiptId: date, sourceLineReferences: [date], productName: name, sourceProductCode: code, unitPriceKrw: price, quantityValue: 1, totalPriceKrw: price, confidence: "high" };
  return { id: item.id, item, storeLabel, catalogNamespace, observedAt: date, martType: "regular" };
}

describe("product browser domain", () => {
  it.each([
    ["월드콘 쿠키앤크림", "간식"],
    ["더위사냥 커피", "간식"],
    ["라라스윗 저당 생우유 모나카", "간식"],
    ["상쾌한아침우유식빵", "식품"],
    ["크림우동", "식품"],
    ["순살바3종 1세트", "간식"],
    ["닭가슴살단백질바너츠", "간식"],
    ["즉석 해물 칼국수", "식품"],
    ["황금밥알새우&갈릭", "식품"],
    ["대전도시락김", "식품"],
    ["급냉삼겹살", "신선식품"],
    ["손질바지락", "신선식품"],
    ["닥터지 모이스처 인 바디 5.0 바", "생활용품"],
    ["삼각 로스트비프 40g", "식품"],
    ["요맘때 딸기 콘", "간식"],
    ["테이크핏 맥스 초코맛", "음료"],
    ["네파 페넥스남드로우", "생활용품"],
  ] as const)("classifies %s as %s without generic-word collisions", (name, category) => {
    expect(categoryForProduct(name)).toBe(category);
  });

  it("uses the explicit receipt retail channel", () => {
    const source = createUniversalReceipt(); source.merchant.retail_channel = "px";
    expect(martTypeFor(mapReceipt(source))).toBe("px");
  });

  it("uses the retail-channel tag instead of an individual branch name", () => {
    expect(martTagFor({ martType: "px", storeLabel: "와마트 일산점" })).toBe("PX");
    expect(martTagFor({ martType: "px", storeLabel: "국군 복지단 바다마을마트" })).toBe("PX");
    expect(martTagFor({ martType: "regular", storeLabel: "와마트 일산점" })).toBe("PX");
    expect(martTagFor({ martType: "regular", storeLabel: "국군복지단 바다마을마트" })).toBe("PX");
    expect(martTagFor({ martType: "regular", storeLabel: "홈플러스 일산점" })).toBe("홈플러스");
    expect(martTagFor({ martType: "regular", storeLabel: "이마트 에브리데이 풍산점" })).toBe("이마트 에브리데이");
  });

  it("compares the lowest seller with Coupang in either direction", () => {
    const seller = { martType: "regular" as const, storeLabel: "국군복지단 바다마을마트", unitPriceLabel: "10g당", unitPriceKrw: 250 };
    expect(compareCoupangPrice(seller, { referenceLabel: "10g당", unitPriceKrw: 300 })).toEqual({
      winner: "seller",
      sellerTag: "PX",
      differenceKrw: 50,
    });
    expect(compareCoupangPrice(seller, { referenceLabel: "10g당", unitPriceKrw: 200 })).toEqual({
      winner: "coupang",
      sellerTag: "PX",
      differenceKrw: 50,
    });
    expect(compareCoupangPrice(seller, { referenceLabel: "10g당", unitPriceKrw: 250 })).toEqual({
      winner: "tie",
      sellerTag: "PX",
      differenceKrw: 0,
    });
  });

  it("does not compare prices with different reference units", () => {
    const seller = { martType: "regular" as const, storeLabel: "홈플러스 일산점", unitPriceLabel: "100g당", unitPriceKrw: 500 };
    expect(compareCoupangPrice(seller, { referenceLabel: "10g당", unitPriceKrw: 50 })).toBeNull();
  });

  it("keeps same-name products with different product codes separate", () => {
    const groups = groupProductObservations([listing("2026-07-01", 1200, "A1"), listing("2026-07-02", 900, "B2")]);
    expect(groups).toHaveLength(2);
  });

  it("counts visually identical seller labels once across standard product variants", () => {
    const observations = [
      listing("2026-07-01", 1200, "A1", "product 100g", null, "Same Mart"),
      listing("2026-07-02", 2100, "B2", "product 200g", null, "  Same\u200B   Mart  "),
    ];

    expect(normalizeSellerLabel(observations[0].storeLabel)).toBe(normalizeSellerLabel(observations[1].storeLabel));
    expect(distinctSellerCount(observations)).toBe(1);
    expect(latestSellerRows(observations)).toEqual([{ storeLabel: "Same Mart", observedAt: "2026-07-02" }]);
  });

  it("falls back to the existing store-and-name grouping when product codes are absent", () => {
    const first = listing("2026-07-01", 1200, "");
    const second = listing("2026-07-02", 900, "");
    const groups = groupProductObservations([first, second]);
    expect(groups).toHaveLength(1);
    expect(groups[0].observations).toHaveLength(2);
  });

  it("merges same-code and same-name listings across a verified shared catalog", () => {
    const groups = groupProductObservations([
      listing("2026-07-01", 3440, "210157", "golden rice pork", "korean-military-px", "PX A"),
      listing("2026-07-02", 3440, "210157", "golden rice pork", "korean-military-px", "PX B"),
    ]);
    const merged = mergeOfficialProductGroups(groups);
    expect(merged).toHaveLength(1);
    expect(merged[0].sharedCatalogProduct).toBe(true);
    expect(merged[0].storeLabel).toBe("PX A, PX B");
  });

  it("does not merge the same code without a shared catalog namespace", () => {
    const groups = groupProductObservations([
      listing("2026-07-01", 3440, "210157", "golden rice pork", null, "Store A"),
      listing("2026-07-02", 3440, "210157", "golden rice pork", null, "Store B"),
    ]);
    expect(mergeOfficialProductGroups(groups)).toHaveLength(2);
  });

  it("keeps official variants merged by their official URL", () => {
    const official = { officialName: "official 500ml", officialUrl: "https://example.com/500", sourceName: "official", matchMethod: "manual" as const, updatedAt: "2026-07-23T00:00:00.000Z" };
    const groups = groupProductObservations([listing("2026-07-01", 1200, "A1", "product", null, "Store A"), listing("2026-07-02", 900, "B2", "product", null, "Store B")]).map((group) => ({ ...group, officialProduct: official }));
    expect(mergeOfficialProductGroups(groups)).toHaveLength(1);
  });

  it("sorts products by expensive price, cheap price, or distinct seller count", () => {
    const groups = groupProductObservations([
      listing("2026-07-01", 1000, "A", "alpha", null, "Store A"),
      listing("2026-07-01", 3000, "B", "beta", null, "Store B"),
      listing("2026-07-02", 3000, "B", "beta", null, "Store C"),
    ]);
    const options = { query: "", category: "전체" as const, martType: "all" as const, storeLabel: "all" };
    const betaWithTwoSellers = { ...groups[1], observations: [groups[1].observations[0], groups[2].observations[0]] };
    const comparableGroups = [groups[0], betaWithTwoSellers];
    expect(filterAndSortProductGroups(comparableGroups, { ...options, sort: "expensive" }).map((group) => group.productName)).toEqual(["beta", "alpha"]);
    expect(filterAndSortProductGroups(comparableGroups, { ...options, sort: "cheap" }).map((group) => group.productName)).toEqual(["alpha", "beta"]);
    expect(filterAndSortProductGroups(comparableGroups, { ...options, sort: "sellers" }).map((group) => group.productName)).toEqual(["beta", "alpha"]);
  });
});
