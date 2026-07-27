import { describe, expect, it } from "vitest";
import { summarizeSellerPrices, type SellerPricePoint } from "./seller-price-insights";

function point(sellerLabel: string, observedAt: string, priceKrw: number, confidence: SellerPricePoint["confidence"] = "high"): SellerPricePoint {
  return { sellerLabel, observedAt, priceKrw, confidence, source: "receipt" };
}

describe("seller price insights", () => {
  it("ranks sellers by each seller's latest observation rather than an old historical minimum", () => {
    const summaries = summarizeSellerPrices([
      point("판매처 A", "2026-06-01", 500),
      point("판매처 A", "2026-07-01", 2_000),
      point("판매처 B", "2026-07-02", 1_000),
    ]);

    expect(summaries.map((summary) => summary.sellerLabel)).toEqual(["판매처 B", "판매처 A"]);
    expect(summaries[1]).toMatchObject({ latestPriceKrw: 2_000, minimumPriceKrw: 500 });
  });

  it("calculates the previous change only within the same seller", () => {
    const summaries = summarizeSellerPrices([
      point("판매처 A", "2026-07-01", 1_000),
      point("판매처 B", "2026-07-02", 5_000),
      point("판매처 A", "2026-07-03", 1_200),
    ]);

    const sellerA = summaries.find((summary) => summary.sellerLabel === "판매처 A");
    expect(sellerA).toMatchObject({ previousPriceKrw: 1_000, changeKrw: 200, changePercent: 20 });
  });

  it("uses the lowest recorded price as one snapshot when date precision is identical", () => {
    const summaries = summarizeSellerPrices([
      point("PX", "2026-07", 1_100),
      point("PX", "2026-07", 900),
      point("PX", "2026-06", 1_000),
    ]);

    expect(summaries[0]).toMatchObject({
      latestPriceKrw: 900,
      previousPriceKrw: 1_000,
      changeKrw: -100,
      observationCount: 3,
      snapshotCount: 2,
    });
  });

  it("reports confidence coverage without treating unknown stored observations as low confidence", () => {
    const summaries = summarizeSellerPrices([
      point("A", "2026-07-01", 1_000, "high"),
      point("A", "2026-07-02", 1_100, "low"),
      point("B", "2026-07-01", 900, null),
    ]);

    expect(summaries.find((summary) => summary.sellerLabel === "A")?.highConfidenceRatio).toBe(0.5);
    expect(summaries.find((summary) => summary.sellerLabel === "B")?.highConfidenceRatio).toBeNull();
  });
});
