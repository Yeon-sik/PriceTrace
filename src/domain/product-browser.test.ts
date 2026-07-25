import { describe, expect, it } from "vitest";
import { filterAndSortProductGroups, groupProductObservations, martTypeFor, mergeOfficialProductGroups, type ProductObservationListing } from "./product-browser";
import type { ReceiptItem } from "./types";
import { createUniversalReceipt } from "./receipt.fixture";
import { mapReceipt } from "./receipt";

function listing(date: string, price: number, code = "A1", name = "product", catalogNamespace: string | null = null, storeLabel = "test store"): ProductObservationListing {
  const item: ReceiptItem = { id: `${date}:${code}:${price}`, receiptId: date, sourceLineReferences: [date], productName: name, sourceProductCode: code, unitPriceKrw: price, quantityValue: 1, totalPriceKrw: price, confidence: "high" };
  return { id: item.id, item, storeLabel, catalogNamespace, observedAt: date, martType: "regular" };
}

describe("product browser domain", () => {
  it("uses the explicit receipt retail channel", () => {
    const source = createUniversalReceipt(); source.merchant.retail_channel = "px";
    expect(martTypeFor(mapReceipt(source))).toBe("px");
  });

  it("keeps same-name products with different product codes separate", () => {
    const groups = groupProductObservations([listing("2026-07-01", 1200, "A1"), listing("2026-07-02", 900, "B2")]);
    expect(groups).toHaveLength(2);
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
