import type { NutritionFood } from "./product-nutrition-link";

export const NUTRITION_DISPLAY_UNITS = ["g", "ml", "serving"] as const;
export type NutritionDisplayUnit = (typeof NUTRITION_DISPLAY_UNITS)[number];
export const NUTRITION_DISPLAY_AMOUNT = 100;

/**
 * Normalize only when the recorded basis and requested unit are the same.
 * nutrition-read.v1 has no density or serving-size metadata for cross-unit
 * conversion, so those values must remain unavailable rather than guessed.
 */
export function nutritionValueAtAmount(
  food: Pick<NutritionFood, "basisAmount" | "basisUnit">,
  value: number | null,
  targetUnit: NutritionDisplayUnit,
  targetAmount = NUTRITION_DISPLAY_AMOUNT,
) {
  if (value === null || food.basisAmount <= 0) return null;
  if (food.basisUnit.trim().toLowerCase() !== targetUnit) return null;
  return (value / food.basisAmount) * targetAmount;
}
