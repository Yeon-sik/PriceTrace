import { describe, expect, it } from "vitest";
import { groupProductObservations, type ProductObservationListing } from "../../domain/product-browser";
import { chronologicalObservations, observationDate, observationOverview, selectInstrumentGroups } from "./observation-selector";

function observation(id: string, date: string, code = "A", seller = "seller-1"): ProductObservationListing {
  return {
    id, observedAt: date, storeLabel: "동일한 판매처 이름", sellerKey: seller, catalogNamespace: seller, martType: "regular",
    item: { id, receiptId: id, sourceLineReferences: [id], productName: "동일한 상품 이름", sourceProductCode: code, unitPriceKrw: 1080, quantityValue: 1, totalPriceKrw: 1080, confidence: "high" },
  };
}

describe("observation instrument presentation", () => {
  it("orders actual records by date and stable identity without mutating them or inventing price changes", () => {
    const groups = groupProductObservations([observation("b", "2026-06-12"), observation("a", "2026-05-08"), observation("c", "2026-06-12")]);
    const original = [...groups[0].observations];
    const ordered = chronologicalObservations(groups[0]);
    expect(ordered.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(ordered.map((row) => row.item.unitPriceKrw)).toEqual([1080, 1080, 1080]);
    expect(groups[0].observations).toEqual(original);
    expect(ordered[0]).toBe(original.find((row) => row.id === "a"));
  });

  it("keeps same-name products and sellers separate using existing identity", () => {
    const groups = groupProductObservations([observation("a", "2026-05-01", "A", "seller-1"), observation("b", "2026-06-01", "B", "seller-1"), observation("c", "2026-04-01", "C", "seller-2")]);
    expect(selectInstrumentGroups(groups)).toHaveLength(3);
    expect(observationOverview(groups)).toMatchObject({ observations: 3, sellers: 2, latestDate: "2026-06-01" });
    expect(observationOverview(groups).recent.map((group) => group.latest.id)).toEqual(["b", "a", "c"]);
  });

  it("uses deterministic tie ordering and bounds only the featured subjects", () => {
    const groups = groupProductObservations(Array.from({ length: 8 }, (_, i) => observation(String(i), "2026-06-01", String(i))));
    expect(selectInstrumentGroups(groups)).toHaveLength(5);
    expect(selectInstrumentGroups([...groups].reverse()).map((group) => group.id)).toEqual(selectInstrumentGroups(groups).map((group) => group.id));
    expect(observationOverview(groups).observations).toBe(8);
  });

  it("retains date-only facts and provides an explicit empty state", () => {
    expect(observationDate("2026-06-01")).toBe("2026.06.01");
    expect(observationDate("2026-06-01T18:20:00+09:00")).toBe("2026.06.01");
    expect(selectInstrumentGroups([])).toEqual([]);
    expect(observationOverview([])).toEqual({ observations: 0, sellers: 0, latestDate: "", recent: [] });
  });
});
