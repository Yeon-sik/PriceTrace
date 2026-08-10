import { describe, expect, it } from "vitest";
import {
  ProductNutritionLinkStateSchema,
  ProductNutritionProposalSchema,
  approvedNutritionFoodsFromLinkStates,
  buildProductNutritionProposalRequest,
  productNutritionLinkIdentityKey,
  type NutritionFood,
} from "./product-nutrition-link";
import { ProductReadProductSchema } from "./product-read";

const productRevision = `sha256:${"a".repeat(64)}`;
const stateRevision = `sha256:${"b".repeat(64)}`;
const catalogProductId = "22222222-2222-4222-8222-222222222222";
const nutritionFoodId = "fitness-food-100";

const product = ProductReadProductSchema.parse({
  revision: productRevision,
  standardProduct: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "표준 상품",
    brand: null,
    updatedAt: "2026-08-09T01:00:00+00:00",
  },
  catalogProduct: {
    id: catalogProductId,
    name: "표준 상품 100g",
    specificationText: "100g",
    contentAmount: 100,
    contentUnit: "g",
    packageCount: 1,
    referenceUnit: 100,
    listingReferenceUrl: null,
    updatedAt: "2026-08-09T01:00:00+00:00",
  },
  sellerProducts: [],
  observations: [],
});

const nutritionFood: NutritionFood = {
  id: nutritionFoodId,
  name: "후보 영양 식품",
  kind: "external_menu",
  basisAmount: 100,
  basisUnit: "g",
  prepState: "as_served",
  caloriesKcal: 120,
  proteinGrams: 5,
  carbsGrams: 20,
  fatGrams: 2,
  sodiumMg: 200,
  saturatedFatGrams: 1,
  sugarsGrams: 3,
  fiberGrams: 2,
  addedSugarsGrams: null,
  transFatGrams: 0,
  cholesterolMg: 15,
  micronutrients: {},
  sourceType: "manufacturer_label",
  sourceReference: "https://example.com/nutrition",
  sourceRevision: "label-v2",
  revision: 2,
  approvedCatalogProductId: null,
};

function nutritionFoodRow(revision = nutritionFood.revision) {
  return {
    contract_version: "nutrition-read.v1" as const,
    nutrition_food_id: nutritionFood.id,
    name: nutritionFood.name,
    kind: nutritionFood.kind,
    basis_amount: nutritionFood.basisAmount,
    basis_unit: nutritionFood.basisUnit,
    prep_state: nutritionFood.prepState,
    nutrition_values: {
      calories_kcal: nutritionFood.caloriesKcal,
      protein_grams: nutritionFood.proteinGrams,
      carbs_grams: nutritionFood.carbsGrams,
      fat_grams: nutritionFood.fatGrams,
      sodium_mg: nutritionFood.sodiumMg,
      saturated_fat_grams: nutritionFood.saturatedFatGrams,
      sugars_grams: nutritionFood.sugarsGrams,
      fiber_grams: nutritionFood.fiberGrams,
      added_sugars_grams: nutritionFood.addedSugarsGrams,
      trans_fat_grams: nutritionFood.transFatGrams,
      cholesterol_mg: nutritionFood.cholesterolMg,
    },
    micronutrients: nutritionFood.micronutrients,
    source_type: nutritionFood.sourceType,
    source_reference: nutritionFood.sourceReference,
    source_revision: nutritionFood.sourceRevision,
    revision,
    catalog_product_id: null,
  };
}

describe("product nutrition link contract", () => {
  it("uses only namespace, exact catalog ID, and nutrition food ID as identity", () => {
    const request = buildProductNutritionProposalRequest({
      action: "link",
      product,
      nutritionFood,
    });
    const renamedRequest = buildProductNutritionProposalRequest({
      action: "link",
      product: {
        ...product,
        standardProduct: { ...product.standardProduct, name: "바뀐 상품명" },
        catalogProduct: { ...product.catalogProduct, name: "바뀐 규격명" },
      },
      nutritionFood: { ...nutritionFood, name: "바뀐 영양명" },
    });

    expect(productNutritionLinkIdentityKey(request.identity)).toBe(
      productNutritionLinkIdentityKey(renamedRequest.identity),
    );
    expect(request.source.standardName).not.toBe(renamedRequest.source.standardName);
    expect(request.candidateEvidence.nutritionFoodName).not.toBe(
      renamedRequest.candidateEvidence.nutritionFoodName,
    );
  });

  it("keeps PriceTrace revision and Nutrition provenance in the review proposal", () => {
    const request = buildProductNutritionProposalRequest({
      action: "link",
      product,
      nutritionFood,
    });

    expect(request).toMatchObject({
      action: "link",
      identity: {
        namespace: "pricetrace",
        catalogProductId,
        nutritionFoodId,
      },
      source: {
        system: "PriceTrace",
        contract: "product-read.v1",
        productRevision,
      },
      candidateEvidence: {
        nutritionContract: "nutrition-read.v1",
        nutritionSourceType: "manufacturer_label",
        nutritionSourceRevision: "label-v2",
        nutritionRevision: 2,
      },
    });
  });

  it("preserves an approved link identity when the public nutrition row no longer exists", () => {
    const state = ProductNutritionLinkStateSchema.parse({
      schemaVersion: "product-nutrition-link-state.v1",
      revision: stateRevision,
      namespace: "pricetrace",
      catalogProductId,
      approvedLinks: [{
        id: "33333333-3333-4333-8333-333333333333",
        identity: { namespace: "pricetrace", catalogProductId, nutritionFoodId },
        status: "approved",
        sourceRevision: productRevision,
        approvalRevision: 3,
        approvedAt: "2026-08-09T03:00:00+00:00",
        candidateEvidence: {
          nutritionFoodName: "삭제 전 식품명",
          nutritionContract: "nutrition-read.v1",
          nutritionSourceType: "manufacturer_label",
          nutritionSourceReference: null,
          nutritionSourceRevision: "v1",
          nutritionRevision: 2,
        },
        nutritionFood: null,
      }],
      pendingProposals: [],
    });

    expect(state.approvedLinks[0].nutritionFood).toBeNull();
    expect(state.approvedLinks[0].identity.nutritionFoodId).toBe(nutritionFoodId);
  });

  it("combines approved nutrition across exact variants without duplicate tables", () => {
    const secondCatalogProductId = "55555555-5555-4555-8555-555555555555";
    const states = [
      ProductNutritionLinkStateSchema.parse({
        schemaVersion: "product-nutrition-link-state.v1",
        revision: stateRevision,
        namespace: "pricetrace",
        catalogProductId,
        approvedLinks: [{
          id: "33333333-3333-4333-8333-333333333333",
          identity: { namespace: "pricetrace", catalogProductId, nutritionFoodId },
          status: "approved",
          sourceRevision: productRevision,
          approvalRevision: 3,
          approvedAt: "2026-08-09T03:00:00+00:00",
          candidateEvidence: {
            nutritionFoodName: nutritionFood.name,
            nutritionContract: "nutrition-read.v1",
            nutritionSourceType: nutritionFood.sourceType,
            nutritionSourceReference: nutritionFood.sourceReference,
            nutritionSourceRevision: nutritionFood.sourceRevision,
            nutritionRevision: 2,
          },
          nutritionFood: nutritionFoodRow(2),
        }],
        pendingProposals: [],
      }),
      ProductNutritionLinkStateSchema.parse({
        schemaVersion: "product-nutrition-link-state.v1",
        revision: stateRevision,
        namespace: "pricetrace",
        catalogProductId: secondCatalogProductId,
        approvedLinks: [{
          id: "66666666-6666-4666-8666-666666666666",
          identity: { namespace: "pricetrace", catalogProductId: secondCatalogProductId, nutritionFoodId },
          status: "approved",
          sourceRevision: productRevision,
          approvalRevision: 4,
          approvedAt: "2026-08-09T04:00:00+00:00",
          candidateEvidence: {
            nutritionFoodName: nutritionFood.name,
            nutritionContract: "nutrition-read.v1",
            nutritionSourceType: nutritionFood.sourceType,
            nutritionSourceReference: nutritionFood.sourceReference,
            nutritionSourceRevision: nutritionFood.sourceRevision,
            nutritionRevision: 3,
          },
          nutritionFood: nutritionFoodRow(3),
        }],
        pendingProposals: [],
      }),
    ];

    expect(approvedNutritionFoodsFromLinkStates(states)).toMatchObject([{
      id: nutritionFoodId,
      revision: 3,
      fiberGrams: 2,
      transFatGrams: 0,
      cholesterolMg: 15,
    }]);
  });

  it("rejects a public nutrition row that does not belong to the approved identity", () => {
    expect(() => ProductNutritionLinkStateSchema.parse({
      schemaVersion: "product-nutrition-link-state.v1",
      revision: stateRevision,
      namespace: "pricetrace",
      catalogProductId,
      approvedLinks: [{
        id: "33333333-3333-4333-8333-333333333333",
        identity: { namespace: "pricetrace", catalogProductId, nutritionFoodId },
        status: "approved",
        sourceRevision: productRevision,
        approvalRevision: 3,
        approvedAt: "2026-08-09T03:00:00+00:00",
        candidateEvidence: {
          nutritionFoodName: nutritionFood.name,
          nutritionContract: "nutrition-read.v1",
          nutritionSourceType: nutritionFood.sourceType,
          nutritionSourceReference: nutritionFood.sourceReference,
          nutritionSourceRevision: nutritionFood.sourceRevision,
          nutritionRevision: nutritionFood.revision,
        },
        nutritionFood: { ...nutritionFoodRow(), nutrition_food_id: "different-food-id" },
      }],
      pendingProposals: [],
    })).toThrow(/링크 identity와 일치하지 않습니다/);
  });

  it("does not accept a client response that skips approval", () => {
    expect(() => ProductNutritionProposalSchema.parse({
      schemaVersion: "product-nutrition-link-proposal.v1",
      id: "44444444-4444-4444-8444-444444444444",
      action: "link",
      identity: { namespace: "pricetrace", catalogProductId, nutritionFoodId },
      status: "approved",
      sourceRevision: productRevision,
      createdAt: "2026-08-09T03:00:00+00:00",
    })).toThrow();
  });
});
