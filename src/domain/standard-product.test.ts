import { describe, expect, it } from "vitest";
import { summarizeStandardProducts } from "./standard-product";

describe("standard product summaries", () => {
  it("ranks a standard product by its cheapest child listing's unit price", () => {
    const [rice] = summarizeStandardProducts([{ id: "rice", name: "햇반" }], {
      rice: [
        { id: "a", listingName: "햇반 130g 4입", sellerName: "A마트", observedAt: "2026-07-24", listedPriceKrw: 5_200, contentAmount: 130, contentUnit: "g", packageCount: 4 },
        { id: "b", listingName: "햇반 210g", sellerName: "B마트", observedAt: "2026-07-24", listedPriceKrw: 2_100, contentAmount: 210, contentUnit: "g", packageCount: 1 },
      ],
    });
    expect(rice).toMatchObject({ name: "햇반", lowestUnitPriceKrw: 1_000, unitLabel: "100g당", lowestVariant: { id: "a" } });
  });
});
