import { describe, expect, it } from "vitest";
import { summarizeCanonicalPrices } from "./canonical-price";

describe("canonical price summaries", () => {
  it("groups observations by source and keeps each source's latest price", () => {
    expect(summarizeCanonicalPrices([
      { locationLabel: "A마트", unitPriceKrw: 1200, observedAt: "2026-07-02", measurementUnit: "each" },
      { locationLabel: "A마트", unitPriceKrw: 1000, observedAt: "2026-07-01", measurementUnit: "each" },
      { locationLabel: "B마트", unitPriceKrw: 900, observedAt: "2026-07-02", measurementUnit: "each" },
    ])).toMatchObject([{ locationLabel: "B마트", latestKrw: 900 }, { locationLabel: "A마트", latestKrw: 1200, minimumKrw: 1000 }]);
  });
});
