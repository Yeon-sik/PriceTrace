import { z } from "zod";
import {
  PRODUCT_READ_NAMESPACE,
  PRODUCT_READ_SCHEMA_VERSION,
  ProductReadProductSchema,
  Sha256RevisionSchema,
  type ProductReadProduct,
} from "./product-read";

export const PRODUCT_NUTRITION_LINK_STATE_SCHEMA_VERSION = "product-nutrition-link-state.v1" as const;
export const PRODUCT_NUTRITION_PROPOSAL_SCHEMA_VERSION = "product-nutrition-link-proposal.v1" as const;
export const NUTRITION_READ_SCHEMA_VERSION = "nutrition-read.v1" as const;

const offsetDateTimeSchema = z.string().datetime({ offset: true });
const nullableNonnegativeNumberSchema = z.coerce.number().nonnegative().nullable();

export const NutritionReadV1RowSchema = z.object({
  contract_version: z.literal(NUTRITION_READ_SCHEMA_VERSION),
  nutrition_food_id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(300),
  kind: z.enum(["ingredient", "external_menu", "recipe"]),
  basis_amount: z.coerce.number().positive(),
  basis_unit: z.string().trim().min(1).max(50),
  prep_state: z.enum(["unspecified", "raw", "cooked", "as_served", "dried", "frozen"]),
  nutrition_values: z.object({
    calories_kcal: nullableNonnegativeNumberSchema,
    protein_grams: nullableNonnegativeNumberSchema,
    carbs_grams: nullableNonnegativeNumberSchema,
    fat_grams: nullableNonnegativeNumberSchema,
    sodium_mg: nullableNonnegativeNumberSchema,
    saturated_fat_grams: nullableNonnegativeNumberSchema,
    sugars_grams: nullableNonnegativeNumberSchema,
    fiber_grams: nullableNonnegativeNumberSchema,
    added_sugars_grams: nullableNonnegativeNumberSchema,
    trans_fat_grams: nullableNonnegativeNumberSchema,
    cholesterol_mg: nullableNonnegativeNumberSchema,
  }).strict(),
  micronutrients: z.record(z.string(), z.object({
    amount: z.coerce.number().nonnegative(),
    unit: z.string().trim().min(1).max(50),
  }).strict()),
  source_type: z.string().trim().min(1).max(100),
  source_reference: z.string().trim().min(1).max(1000).nullable(),
  source_revision: z.string().trim().min(1).max(200).nullable(),
  revision: z.coerce.number().int().positive(),
  catalog_product_id: z.string().uuid().nullable(),
}).strict();

export type NutritionReadV1Row = z.infer<typeof NutritionReadV1RowSchema>;

export type NutritionFood = {
  id: string;
  name: string;
  kind: NutritionReadV1Row["kind"];
  basisAmount: number;
  basisUnit: string;
  prepState: NutritionReadV1Row["prep_state"];
  caloriesKcal: number | null;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  sodiumMg: number | null;
  saturatedFatGrams: number | null;
  sugarsGrams: number | null;
  fiberGrams: number | null;
  addedSugarsGrams: number | null;
  transFatGrams: number | null;
  cholesterolMg: number | null;
  micronutrients: Record<string, { amount: number; unit: string }>;
  sourceType: string;
  sourceReference: string | null;
  sourceRevision: string | null;
  revision: number;
  approvedCatalogProductId: string | null;
};

export function nutritionFoodFromReadRow(rowInput: unknown): NutritionFood {
  const row = NutritionReadV1RowSchema.parse(rowInput);
  return {
    id: row.nutrition_food_id,
    name: row.name,
    kind: row.kind,
    basisAmount: row.basis_amount,
    basisUnit: row.basis_unit,
    prepState: row.prep_state,
    caloriesKcal: row.nutrition_values.calories_kcal,
    proteinGrams: row.nutrition_values.protein_grams,
    carbsGrams: row.nutrition_values.carbs_grams,
    fatGrams: row.nutrition_values.fat_grams,
    sodiumMg: row.nutrition_values.sodium_mg,
    saturatedFatGrams: row.nutrition_values.saturated_fat_grams,
    sugarsGrams: row.nutrition_values.sugars_grams,
    fiberGrams: row.nutrition_values.fiber_grams,
    addedSugarsGrams: row.nutrition_values.added_sugars_grams,
    transFatGrams: row.nutrition_values.trans_fat_grams,
    cholesterolMg: row.nutrition_values.cholesterol_mg,
    micronutrients: row.micronutrients,
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    sourceRevision: row.source_revision,
    revision: row.revision,
    approvedCatalogProductId: row.catalog_product_id,
  };
}

export const ProductNutritionLinkIdentitySchema = z.object({
  namespace: z.literal(PRODUCT_READ_NAMESPACE),
  catalogProductId: z.string().uuid(),
  nutritionFoodId: z.string().trim().min(1).max(200),
}).strict();

export type ProductNutritionLinkIdentity = z.infer<typeof ProductNutritionLinkIdentitySchema>;

export function productNutritionLinkIdentityKey(identityInput: ProductNutritionLinkIdentity) {
  const identity = ProductNutritionLinkIdentitySchema.parse(identityInput);
  return JSON.stringify([
    identity.namespace,
    identity.catalogProductId,
    identity.nutritionFoodId,
  ]);
}

export const ProductNutritionSourceSchema = z.object({
  system: z.literal("PriceTrace"),
  contract: z.literal(PRODUCT_READ_SCHEMA_VERSION),
  productRevision: Sha256RevisionSchema,
  standardProductId: z.string().uuid(),
  catalogProductId: z.string().uuid(),
  standardName: z.string().trim().min(1).max(300),
  catalogProductName: z.string().trim().min(1).max(300),
}).strict();

export const NutritionCandidateEvidenceSchema = z.object({
  nutritionFoodName: z.string().trim().min(1).max(300),
  nutritionContract: z.literal(NUTRITION_READ_SCHEMA_VERSION),
  nutritionSourceType: z.string().trim().min(1).max(100),
  nutritionSourceReference: z.string().trim().min(1).max(1000).nullable(),
  nutritionSourceRevision: z.string().trim().min(1).max(200).nullable(),
  nutritionRevision: z.number().int().positive(),
}).strict();

export const ProductNutritionProposalRequestSchema = z.object({
  action: z.enum(["link", "unlink"]),
  identity: ProductNutritionLinkIdentitySchema,
  source: ProductNutritionSourceSchema,
  candidateEvidence: NutritionCandidateEvidenceSchema,
}).strict().superRefine((request, context) => {
  if (request.identity.catalogProductId !== request.source.catalogProductId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "링크 identity와 PriceTrace 출처의 정확 규격 ID가 일치해야 합니다.",
      path: ["source", "catalogProductId"],
    });
  }
});

export type ProductNutritionProposalRequest = z.infer<typeof ProductNutritionProposalRequestSchema>;

export const ProductNutritionLinkSchema = z.object({
  id: z.string().uuid(),
  identity: ProductNutritionLinkIdentitySchema,
  status: z.literal("approved"),
  sourceRevision: Sha256RevisionSchema,
  approvalRevision: z.number().int().positive(),
  approvedAt: offsetDateTimeSchema,
  candidateEvidence: NutritionCandidateEvidenceSchema,
  nutritionFood: NutritionReadV1RowSchema.nullable(),
}).strict().superRefine((link, context) => {
  if (
    link.nutritionFood
    && link.nutritionFood.nutrition_food_id !== link.identity.nutritionFoodId
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "승인 링크의 공개 영양 행이 링크 identity와 일치하지 않습니다.",
      path: ["nutritionFood", "nutrition_food_id"],
    });
  }
});

export const ProductNutritionProposalSchema = z.object({
  schemaVersion: z.literal(PRODUCT_NUTRITION_PROPOSAL_SCHEMA_VERSION),
  id: z.string().uuid(),
  action: z.enum(["link", "unlink"]),
  identity: ProductNutritionLinkIdentitySchema,
  status: z.literal("pending"),
  sourceRevision: Sha256RevisionSchema,
  createdAt: offsetDateTimeSchema,
}).strict();

export const ProductNutritionLinkStateSchema = z.object({
  schemaVersion: z.literal(PRODUCT_NUTRITION_LINK_STATE_SCHEMA_VERSION),
  revision: Sha256RevisionSchema,
  namespace: z.literal(PRODUCT_READ_NAMESPACE),
  catalogProductId: z.string().uuid(),
  approvedLinks: z.array(ProductNutritionLinkSchema),
  pendingProposals: z.array(ProductNutritionProposalSchema),
}).strict().superRefine((state, context) => {
  const identities = new Set<string>();
  for (const [index, link] of state.approvedLinks.entries()) {
    if (link.identity.catalogProductId !== state.catalogProductId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "승인 링크가 조회한 정확 규격에 속하지 않습니다.",
        path: ["approvedLinks", index, "identity", "catalogProductId"],
      });
    }
    const key = productNutritionLinkIdentityKey(link.identity);
    if (identities.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "승인 링크 identity가 중복되었습니다.",
        path: ["approvedLinks", index, "identity"],
      });
    }
    identities.add(key);
  }

  for (const [index, proposal] of state.pendingProposals.entries()) {
    if (proposal.identity.catalogProductId !== state.catalogProductId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "대기 제안이 조회한 정확 규격에 속하지 않습니다.",
        path: ["pendingProposals", index, "identity", "catalogProductId"],
      });
    }
  }
});

export type ProductNutritionLink = z.infer<typeof ProductNutritionLinkSchema>;
export type ProductNutritionProposal = z.infer<typeof ProductNutritionProposalSchema>;
export type ProductNutritionLinkState = z.infer<typeof ProductNutritionLinkStateSchema>;

export function approvedNutritionFoodsFromLinkStates(
  states: readonly ProductNutritionLinkState[],
) {
  const foodsById = new Map<string, NutritionFood>();

  for (const state of states) {
    for (const link of state.approvedLinks) {
      if (!link.nutritionFood) continue;
      const food = nutritionFoodFromReadRow(link.nutritionFood);
      const current = foodsById.get(food.id);
      if (!current || food.revision > current.revision) foodsById.set(food.id, food);
    }
  }

  return [...foodsById.values()].sort((left, right) => (
    left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id)
  ));
}

export function buildProductNutritionProposalRequest({
  action,
  product: productInput,
  nutritionFood,
}: {
  action: "link" | "unlink";
  product: ProductReadProduct;
  nutritionFood: NutritionFood;
}): ProductNutritionProposalRequest {
  return buildProductNutritionProposalRequestFromEvidence({
    action,
    product: productInput,
    nutritionFoodId: nutritionFood.id,
    candidateEvidence: {
      nutritionFoodName: nutritionFood.name,
      nutritionContract: NUTRITION_READ_SCHEMA_VERSION,
      nutritionSourceType: nutritionFood.sourceType,
      nutritionSourceReference: nutritionFood.sourceReference,
      nutritionSourceRevision: nutritionFood.sourceRevision,
      nutritionRevision: nutritionFood.revision,
    },
  });
}

export function buildProductNutritionProposalRequestFromEvidence({
  action,
  product: productInput,
  nutritionFoodId,
  candidateEvidence,
}: {
  action: "link" | "unlink";
  product: ProductReadProduct;
  nutritionFoodId: string;
  candidateEvidence: z.infer<typeof NutritionCandidateEvidenceSchema>;
}): ProductNutritionProposalRequest {
  const product = ProductReadProductSchema.parse(productInput);
  return ProductNutritionProposalRequestSchema.parse({
    action,
    identity: {
      namespace: PRODUCT_READ_NAMESPACE,
      catalogProductId: product.catalogProduct.id,
      nutritionFoodId,
    },
    source: {
      system: "PriceTrace",
      contract: PRODUCT_READ_SCHEMA_VERSION,
      productRevision: product.revision,
      standardProductId: product.standardProduct.id,
      catalogProductId: product.catalogProduct.id,
      standardName: product.standardProduct.name,
      catalogProductName: product.catalogProduct.name,
    },
    candidateEvidence,
  });
}
