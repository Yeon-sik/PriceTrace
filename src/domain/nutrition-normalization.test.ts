import { describe, expect, it } from "vitest";
import { nutritionValueAtAmount } from "./nutrition-normalization";

describe("nutrition basis normalization", () => {
  it("normalizes a recorded gram basis to 100g and does not invent ml or serving values", () => {
    const food = { basisAmount: 103, basisUnit: "g" };

    expect(nutritionValueAtAmount(food, 455, "g")).toBeCloseTo((455 / 103) * 100);
    expect(nutritionValueAtAmount(food, 455, "ml")).toBeNull();
    expect(nutritionValueAtAmount(food, 455, "serving")).toBeNull();
  });

  it("normalizes a serving basis to 1 serving", () => {
    const food = { basisAmount: 2, basisUnit: "serving" };

    expect(nutritionValueAtAmount(food, 650, "serving")).toBe(325);
    expect(nutritionValueAtAmount(food, null, "serving")).toBeNull();
  });
});
