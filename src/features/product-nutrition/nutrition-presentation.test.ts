import { describe, expect, it } from "vitest";
import { nutritionValueAtAmount } from "../../domain/nutrition-normalization";
import { nutritionFoodFromReadRow } from "../../domain/product-nutrition-link";
import { nutritionMacroSummary, nutritionRows } from "./nutrition-presentation";

const food = nutritionFoodFromReadRow({
  contract_version: "nutrition-read.v1",
  nutrition_food_id: "nutrition-presentation-fixture",
  name: "영양 표시 예시",
  kind: "external_menu",
  basis_amount: 100,
  basis_unit: "g",
  prep_state: "as_served",
  nutrition_values: {
    calories_kcal: 300,
    protein_grams: 5,
    carbs_grams: 43,
    fat_grams: 28,
    sodium_mg: 200,
    saturated_fat_grams: 9,
    sugars_grams: 8,
    fiber_grams: 2,
    added_sugars_grams: 3,
    trans_fat_grams: 0.4,
    cholesterol_mg: 15,
  },
  micronutrients: {},
  source_type: "manufacturer_label",
  source_reference: null,
  source_revision: null,
  revision: 1,
  catalog_product_id: null,
});

describe("nutrition presentation", () => {
  it("presents 43g total carbohydrate with its included 8g sugar", () => {
    expect(nutritionRows(food)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "carbsGrams", label: "탄수화물 (총)", value: 43, depth: 0 }),
      expect.objectContaining({ field: "sugarsGrams", value: 8, depth: 1, parentField: "carbsGrams" }),
    ]));
    expect(nutritionMacroSummary(food)).toBe("탄수화물 (총) 43g (당류 8g) · 지방 (총) 28g (포화 9g · 트랜스 0.4g)");
  });

  it("presents 28g total fat with its included saturated and trans fat", () => {
    expect(nutritionRows(food)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "fatGrams", label: "지방 (총)", value: 28, depth: 0 }),
      expect.objectContaining({ field: "saturatedFatGrams", value: 9, depth: 1, parentField: "fatGrams" }),
      expect.objectContaining({ field: "transFatGrams", value: 0.4, depth: 1, parentField: "fatGrams" }),
    ]));
  });

  it("places known added sugar immediately under sugar, one level deeper", () => {
    const rows = nutritionRows(food);
    const sugarIndex = rows.findIndex((row) => row.field === "sugarsGrams");
    expect(rows[sugarIndex + 1]).toMatchObject({
      field: "addedSugarsGrams", label: "첨가당", value: 3, depth: 2,
      parentField: "sugarsGrams", parentLabel: "당류",
    });
  });

  it("keeps null children unknown and omits optional rows and summary children", () => {
    const unknownChildren = {
      ...food, sugarsGrams: null, saturatedFatGrams: null, transFatGrams: null,
      addedSugarsGrams: null, fiberGrams: null,
    };
    const rows = nutritionRows(unknownChildren);
    expect(rows.find((row) => row.field === "sugarsGrams")?.value).toBeNull();
    expect(rows.find((row) => row.field === "saturatedFatGrams")?.value).toBeNull();
    expect(rows.find((row) => row.field === "transFatGrams")?.value).toBeNull();
    expect(rows.some((row) => row.field === "addedSugarsGrams" || row.field === "fiberGrams")).toBe(false);
    expect(nutritionMacroSummary(unknownChildren)).toBe("탄수화물 (총) 43g · 지방 (총) 28g");
  });

  it("shows known zero children and does not infer unknown totals from children", () => {
    const unknownTotals = { ...food, carbsGrams: null, fatGrams: null, transFatGrams: 0, addedSugarsGrams: 0 };
    expect(nutritionMacroSummary(unknownTotals)).toBe("탄수화물 (총) 미입력 (당류 8g) · 지방 (총) 미입력 (포화 9g · 트랜스 0g)");
    expect(nutritionRows(unknownTotals).find((row) => row.field === "addedSugarsGrams")?.value).toBe(0);
  });
});

describe("independent nutrition amount scaling", () => {
  it("scales each received nutrient independently without adding children to totals", () => {
    const recordedFood = { ...food, basisAmount: 200 };
    const scaledValues = Object.fromEntries(nutritionRows(recordedFood).map((row) => [
      row.field, nutritionValueAtAmount(recordedFood, row.value, "g"),
    ]));
    expect(scaledValues).toEqual({
      caloriesKcal: 150,
      sodiumMg: 100,
      carbsGrams: 21.5,
      sugarsGrams: 4,
      addedSugarsGrams: 1.5,
      fiberGrams: 1,
      fatGrams: expect.closeTo(14, 12),
      saturatedFatGrams: 4.5,
      transFatGrams: 0.2,
      cholesterolMg: 7.5,
      proteinGrams: 2.5,
    });
  });

  it("preserves null and unavailable unit conversion for each parent and child", () => {
    expect(nutritionValueAtAmount(food, null, "g")).toBeNull();
    for (const row of nutritionRows(food)) {
      expect(nutritionValueAtAmount(food, row.value, "ml")).toBeNull();
      expect(nutritionValueAtAmount(food, row.value, "serving")).toBeNull();
    }
  });

  it("keeps ml scaling and the recorded serving amount behavior", () => {
    const mlFood = { ...food, basisAmount: 200, basisUnit: "ml" };
    const servingFood = { ...food, basisAmount: 2, basisUnit: "serving" };
    expect(nutritionValueAtAmount(mlFood, mlFood.carbsGrams, "ml")).toBe(21.5);
    expect(nutritionValueAtAmount(servingFood, servingFood.fatGrams, "serving")).toBe(14);
    expect(nutritionValueAtAmount(servingFood, servingFood.transFatGrams, "serving")).toBe(0.2);
  });
});
