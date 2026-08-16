import { describe, expect, it } from "vitest";
import { parseOptionalCoupangBundle, parseRequiredCoupangPrice, resolveCoupangPrice, type CoupangPriceObservation } from "./coupang-price";

const baseObservation: CoupangPriceObservation = {
  listedPriceKrw: 4_100,
  quantity: 1,
  maxBundleQuantity: 20,
  maxBundleListedPriceKrw: 21_250,
  contentAmount: 52,
  contentUnit: "g",
  productUrl: "https://www.coupang.com/vp/products/1",
  observedAt: "2026-07-29T00:00:00Z",
};

describe("Coupang price options", () => {
  it("chooses the cheapest normalized offer and calculates bundle savings", () => {
    const resolved = resolveCoupangPrice(baseObservation, 10);

    expect(resolved.requiredOffer).toMatchObject({
      pricePerItemKrw: 4_100,
      unitPriceKrw: 788,
      referenceLabel: "10g당",
    });
    expect(resolved.maxBundleOffer).toMatchObject({
      pricePerItemKrw: 1_063,
      unitPriceKrw: 204,
      referenceLabel: "10g당",
    });
    expect(resolved.cheapestOffer.kind).toBe("maxBundle");
    expect(resolved.bundleSavingsKrw).toBe(60_750);
    expect(resolved.bundleUnitSavingsKrw).toBe(584);
  });

  it("prefers the single offer when the bundle unit price is not lower", () => {
    const resolved = resolveCoupangPrice({
      ...baseObservation,
      maxBundleQuantity: 2,
      maxBundleListedPriceKrw: 8_200,
    }, 10);

    expect(resolved.cheapestOffer.kind).toBe("required");
    expect(resolved.bundleSavingsKrw).toBe(0);
  });

  it("normalizes a different Coupang weight against the requested reference unit", () => {
    const resolved = resolveCoupangPrice({
      ...baseObservation,
      listedPriceKrw: 3_600,
      maxBundleQuantity: null,
      maxBundleListedPriceKrw: null,
      contentAmount: 360,
    }, 100);

    expect(resolved.contentAmount).toBe(360);
    expect(resolved.requiredOffer).toMatchObject({
      unitPriceKrw: 1_000,
      referenceLabel: "100g당",
    });
  });

  it("uses exact totals to choose a bundle even when displayed unit prices round to a tie", () => {
    const resolved = resolveCoupangPrice({
      ...baseObservation,
      listedPriceKrw: 1_000,
      maxBundleQuantity: 3,
      maxBundleListedPriceKrw: 2_999,
      contentAmount: 100,
    }, 100);

    expect(resolved.requiredOffer.unitPriceKrw).toBe(1_000);
    expect(resolved.maxBundleOffer?.unitPriceKrw).toBe(1_000);
    expect(resolved.cheapestOffer.kind).toBe("maxBundle");
    expect(resolved.bundleSavingsKrw).toBe(1);
  });

  it("keeps existing observations without a bundle valid", () => {
    const resolved = resolveCoupangPrice({
      ...baseObservation,
      maxBundleQuantity: null,
      maxBundleListedPriceKrw: null,
    }, 10);

    expect(resolved.maxBundleOffer).toBeNull();
    expect(resolved.cheapestOffer).toBe(resolved.requiredOffer);
    expect(resolved.bundleSavingsKrw).toBeNull();
  });

  it("treats a multi-item minimum purchase as the required offer", () => {
    const resolved = resolveCoupangPrice({
      ...baseObservation,
      listedPriceKrw: 4_380,
      quantity: 3,
      maxBundleQuantity: 20,
      maxBundleListedPriceKrw: 21_250,
      contentAmount: 46,
    }, 10);

    expect(resolved.requiredOffer).toMatchObject({
      listedPriceKrw: 4_380,
      quantity: 3,
      pricePerItemKrw: 1_460,
      unitPriceKrw: 317,
    });
    expect(resolved.cheapestOffer.kind).toBe("maxBundle");
    expect(resolved.bundleSavingsKrw).toBe(7_950);
  });

  it("requires a positive integer price and defaults-compatible quantity", () => {
    expect(parseRequiredCoupangPrice("4100", "1")).toEqual({
      value: { listedPriceKrw: 4_100, quantity: 1 },
      error: null,
    });
    expect(parseRequiredCoupangPrice("4380", "3")).toEqual({
      value: { listedPriceKrw: 4_380, quantity: 3 },
      error: null,
    });
    expect(parseRequiredCoupangPrice("0", "1").error).toContain("0원보다 큰");
    expect(parseRequiredCoupangPrice("4100", "0").error).toContain("1개 이상");
  });

  it("requires the optional bundle quantity and total price together", () => {
    expect(parseOptionalCoupangBundle("", "")).toEqual({
      value: { maxBundleQuantity: null, maxBundleListedPriceKrw: null },
      error: null,
    });
    expect(parseOptionalCoupangBundle("20", "21250")).toEqual({
      value: { maxBundleQuantity: 20, maxBundleListedPriceKrw: 21_250 },
      error: null,
    });
    expect(parseOptionalCoupangBundle("20", "").error).toContain("함께");
    expect(parseOptionalCoupangBundle("1", "4100").error).toContain("2개 이상");
    expect(parseOptionalCoupangBundle("20", "0").error).toContain("0원보다 큰");
  });
});
