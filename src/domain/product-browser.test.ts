import { describe, expect, it } from "vitest";
import { categoryForProduct, filterAndSortProductGroups, groupProductObservations, type ProductObservationListing } from "./product-browser";
import type { ReceiptItem } from "./types";

function listing(date: string, price: number, code = "A1", name = "새우깡"): ProductObservationListing {
  const item: ReceiptItem = { id: `${date}:${code}:${price}`, receiptId: date, sourceLineReferences: ["1"], productName: name, sourceProductCode: code, unitPriceKrw: price, quantityValue: 1, totalPriceKrw: price, confidence: "high" };
  return { id: item.id, item, storeLabel: "테스트마트", observedAt: date, martType: "regular" };
}

describe("product browser domain", () => {
  it("groups dated observations into one seller product", () => {
    const groups = groupProductObservations([listing("2026-07-01", 1200), listing("2026-07-02", 900)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].observations).toHaveLength(2);
    expect(groups[0].latestPriceKrw).toBe(900);
    expect(groups[0].minimumPriceKrw).toBe(900);
  });

  it("uses conservative categories and leaves uncertain products unclassified", () => {
    expect(categoryForProduct("샴푸 리필")).toBe("생활용품");
    expect(categoryForProduct("알 수 없는 규격 상품")).toBe("미분류");
  });

  it("filters and sorts grouped products", () => {
    const groups = groupProductObservations([listing("2026-07-01", 1200), listing("2026-07-02", 900, "B2", "커피우유")]);
    const result = filterAndSortProductGroups(groups, { query: "커피", category: "전체", martType: "all", storeLabel: "all", sort: "lowest" });
    expect(result.map((group) => group.sourceProductCode)).toEqual(["B2"]);
  });
});
