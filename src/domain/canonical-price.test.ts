import { describe, expect, it } from "vitest";
import { lowestVerifiedMarketPrice, normalizeMarketPrice, summarizeCanonicalPrices } from "./canonical-price";

describe("canonical price summaries", () => {
  it("groups observations by source and keeps each source's latest price", () => {
    expect(summarizeCanonicalPrices([
      { locationLabel: "A마트", unitPriceKrw: 1200, observedAt: "2026-07-02", measurementUnit: "each" },
      { locationLabel: "A마트", unitPriceKrw: 1000, observedAt: "2026-07-01", measurementUnit: "each" },
      { locationLabel: "B마트", unitPriceKrw: 900, observedAt: "2026-07-02", measurementUnit: "each" },
    ])).toMatchObject([{ locationLabel: "B마트", latestKrw: 900 }, { locationLabel: "A마트", latestKrw: 1200, minimumKrw: 1000 }]);
  });
});

describe("market price normalization", () => {
  const specification = { contentAmount: 400, contentUnit: "g" as const, packageCount: 2 };

  it("derives the effective and 100g price from source fields", () => {
    expect(normalizeMarketPrice({ sellerName: "A", listedPriceKrw: 7_000, shippingFeeKrw: 1_000, minimumOrderQuantity: 1, observedAt: "2026-07-23T00:00:00.000Z", verificationStatus: "verified" }, specification)).toMatchObject({ effectivePriceKrw: 8_000, pricePerReferenceUnitKrw: 1_000, referenceLabel: "100g당" });
  });

  it("uses the selected 10g or 1kg reference unit", () => {
    const observation = { sellerName: "A", listedPriceKrw: 8_000, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: "2026-07-23T00:00:00.000Z", verificationStatus: "verified" as const };
    expect(normalizeMarketPrice(observation, { ...specification, referenceUnit: 10 })).toMatchObject({ pricePerReferenceUnitKrw: 100, referenceLabel: "10g당" });
    expect(normalizeMarketPrice(observation, { ...specification, referenceUnit: 1000 })).toMatchObject({ pricePerReferenceUnitKrw: 10_000, referenceLabel: "1kg당" });
  });

  it("excludes pending and rejected offers from the tracked-seller minimum", () => {
    const lowest = lowestVerifiedMarketPrice([
      { sellerName: "pending", listedPriceKrw: 100, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: "2026-07-23T00:00:00.000Z", verificationStatus: "pending" as const },
      { sellerName: "unverified", listedPriceKrw: 50, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: "2026-07-24T00:00:00.000Z", verificationStatus: "unverified" as const },
      { sellerName: "verified", listedPriceKrw: 7_000, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: "2026-07-22T00:00:00.000Z", verificationStatus: "verified" as const },
    ], specification);
    expect(lowest?.sellerName).toBe("verified");
  });
});
