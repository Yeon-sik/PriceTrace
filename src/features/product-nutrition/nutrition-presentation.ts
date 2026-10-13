import type { NutritionFood } from "../../domain/product-nutrition-link";

type NutrientField = {
  [Field in keyof NutritionFood]: NutritionFood[Field] extends number | null ? Field : never;
}[keyof NutritionFood];

type NutritionRowMetadata = {
  field: NutrientField;
  label: string;
  unit: "g" | "mg" | "kcal";
  depth: 0 | 1 | 2;
  parentField?: NutrientField;
  parentLabel?: string;
  summaryLabel?: string;
  knownOnly?: boolean;
};

export type NutritionPresentationRow = NutritionRowMetadata & { value: number | null };

// Presentation only: child values are already included in their received totals.
const NUTRITION_ROWS: readonly NutritionRowMetadata[] = [
  { field: "caloriesKcal", label: "열량", unit: "kcal", depth: 0 },
  { field: "sodiumMg", label: "나트륨", unit: "mg", depth: 0 },
  { field: "carbsGrams", label: "탄수화물 (총)", unit: "g", depth: 0 },
  { field: "sugarsGrams", label: "당류", unit: "g", depth: 1, parentField: "carbsGrams", parentLabel: "탄수화물", summaryLabel: "당류" },
  { field: "addedSugarsGrams", label: "첨가당", unit: "g", depth: 2, parentField: "sugarsGrams", parentLabel: "당류", knownOnly: true },
  { field: "fiberGrams", label: "식이섬유", unit: "g", depth: 1, parentField: "carbsGrams", parentLabel: "탄수화물", knownOnly: true },
  { field: "fatGrams", label: "지방 (총)", unit: "g", depth: 0 },
  { field: "saturatedFatGrams", label: "포화지방", unit: "g", depth: 1, parentField: "fatGrams", parentLabel: "지방", summaryLabel: "포화" },
  { field: "transFatGrams", label: "트랜스지방", unit: "g", depth: 1, parentField: "fatGrams", parentLabel: "지방", summaryLabel: "트랜스" },
  { field: "cholesterolMg", label: "콜레스테롤", unit: "mg", depth: 0 },
  { field: "proteinGrams", label: "단백질", unit: "g", depth: 0 },
];

export function nutritionRows(food: NutritionFood): NutritionPresentationRow[] {
  return NUTRITION_ROWS
    .filter((row) => !row.knownOnly || food[row.field] !== null)
    .map((row) => ({ ...row, value: food[row.field] }));
}

export function formatNutrient(value: number | null, unit: string) {
  return value === null ? "미입력" : `${value.toLocaleString("ko-KR")}${unit}`;
}

export function nutritionMacroSummary(food: NutritionFood) {
  const rows = nutritionRows(food);
  return rows
    .filter((row) => row.field === "carbsGrams" || row.field === "fatGrams")
    .map((total) => {
      const children = rows
        .filter((row) => row.parentField === total.field && row.summaryLabel && row.value !== null)
        .map((row) => `${row.summaryLabel} ${formatNutrient(row.value, row.unit)}`);
      const totalText = `${total.label} ${formatNutrient(total.value, total.unit)}`;
      return children.length > 0 ? `${totalText} (${children.join(" · ")})` : totalText;
    })
    .join(" · ");
}
