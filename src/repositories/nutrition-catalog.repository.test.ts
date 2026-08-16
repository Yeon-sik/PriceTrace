import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ProductNutritionProposalRequest } from "../domain/product-nutrition-link";
import { NutritionCatalogRepository } from "./nutrition-catalog.repository";

const catalogProductId = "22222222-2222-4222-8222-222222222222";
const nutritionFoodId = "fitness-food-100";
const productRevision = `sha256:${"a".repeat(64)}`;
const stateRevision = `sha256:${"b".repeat(64)}`;

function publicFoodRow() {
  return {
    contract_version: "nutrition-read.v1",
    nutrition_food_id: nutritionFoodId,
    name: "공개 영양 후보",
    kind: "external_menu",
    basis_amount: 100,
    basis_unit: "g",
    prep_state: "as_served",
    nutrition_values: {
      calories_kcal: 120,
      protein_grams: 5,
      carbs_grams: 20,
      fat_grams: 2,
      sodium_mg: 200,
      saturated_fat_grams: 1,
      sugars_grams: 3,
      fiber_grams: null,
      added_sugars_grams: null,
      trans_fat_grams: null,
      cholesterol_mg: null,
    },
    micronutrients: {},
    source_type: "manufacturer_label",
    source_reference: "https://example.com/nutrition",
    source_revision: "label-v2",
    revision: 2,
    catalog_product_id: null,
    catalog_product_revision: `sha256:${"c".repeat(64)}`,
    catalog_content_amount: 100,
    catalog_content_unit: "g",
    catalog_package_count: 1,
  };
}

function kaguriPublicFoodRow() {
  return {
    contract_version: "nutrition-read.v1",
    nutrition_food_id: "eddcbbb8-eaa6-4be0-9bae-cbc4dc37f41f",
    name: "카구리 큰사발면",
    kind: "external_menu",
    basis_amount: 103,
    basis_unit: "g",
    prep_state: "unspecified",
    nutrition_values: {
      fat_grams: 15,
      sodium_mg: 1550,
      carbs_grams: 73,
      fiber_grams: null,
      sugars_grams: 5,
      calories_kcal: 455,
      protein_grams: 7,
      cholesterol_mg: 0,
      trans_fat_grams: null,
      added_sugars_grams: null,
      saturated_fat_grams: 8,
    },
    micronutrients: {},
    source_type: "pricetrace_manual",
    source_reference: "catalogProductId:96eed0f6-1cfa-401a-850f-670d71c44d6f",
    source_revision: null,
    revision: 1,
    catalog_product_id: "96eed0f6-1cfa-401a-850f-670d71c44d6f",
    catalog_product_revision: "sha256:4a0e24d2150802a2a85d228f35104e56ec5ff75c3366f1e17414f63963a6864b",
    catalog_content_amount: 103,
    catalog_content_unit: "g",
    catalog_package_count: 1,
  };
}

function request(): ProductNutritionProposalRequest {
  return {
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
      standardProductId: "11111111-1111-4111-8111-111111111111",
      catalogProductId,
      standardName: "검색용 상품명",
      catalogProductName: "검색용 규격명",
    },
    candidateEvidence: {
      nutritionFoodName: "검색용 영양명",
      nutritionContract: "nutrition-read.v1",
      nutritionSourceType: "manufacturer_label",
      nutritionSourceReference: "https://example.com/nutrition",
      nutritionSourceRevision: "label-v2",
      nutritionRevision: 2,
    },
  };
}

describe("NutritionCatalogRepository", () => {
  it("reads public Nutrition candidates through nutrition-read.v1", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [publicFoodRow()], error: null });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    const foods = await repository.searchPublicFoods("공개 영양");

    expect(rpc).toHaveBeenCalledWith("get_nutrition_read_v1", {
      p_query: "공개 영양",
    });
    expect(foods[0]).toMatchObject({
      id: nutritionFoodId,
      name: "공개 영양 후보",
      sourceType: "manufacturer_label",
      sourceRevision: "label-v2",
      revision: 2,
      catalogProductRevision: `sha256:${"c".repeat(64)}`,
      catalogContentAmount: 100,
      catalogContentUnit: "g",
      catalogPackageCount: 1,
    });
  });

  it("reads only the public projection for an exact catalog product", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...publicFoodRow(), catalog_product_id: catalogProductId }],
      error: null,
    });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    const foods = await repository.readPublicFoods(catalogProductId);

    expect(rpc).toHaveBeenCalledWith("get_public_product_nutrition_v1", {
      p_namespace: "pricetrace",
      p_catalog_product_id: catalogProductId,
    });
    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({
      id: nutritionFoodId,
      approvedCatalogProductId: catalogProductId,
    });
  });

  it("accepts the live Kaguri public RPC object and preserves its basis and catalog metadata", async () => {
    const kaguriCatalogProductId = "96eed0f6-1cfa-401a-850f-670d71c44d6f";
    const rpc = vi.fn().mockResolvedValue({ data: kaguriPublicFoodRow(), error: null });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    const foods = await repository.readPublicFoods(kaguriCatalogProductId);

    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({
      id: "eddcbbb8-eaa6-4be0-9bae-cbc4dc37f41f",
      name: "카구리 큰사발면",
      basisAmount: 103,
      basisUnit: "g",
      caloriesKcal: 455,
      fiberGrams: null,
      transFatGrams: null,
      approvedCatalogProductId: kaguriCatalogProductId,
      catalogProductRevision: "sha256:4a0e24d2150802a2a85d228f35104e56ec5ff75c3366f1e17414f63963a6864b",
      catalogContentAmount: 103,
      catalogContentUnit: "g",
      catalogPackageCount: 1,
    });
  });

  it("rejects a public projection for a different exact catalog product", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        ...publicFoodRow(),
        catalog_product_id: "55555555-5555-4555-8555-555555555555",
      }],
      error: null,
    });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.readPublicFoods(catalogProductId)).rejects.toThrow(
      /요청하지 않은 정확 규격/,
    );
  });

  it("reads authoritative link state from the Nutrition RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        schemaVersion: "product-nutrition-link-state.v1",
        revision: stateRevision,
        namespace: "pricetrace",
        catalogProductId,
        approvedLinks: [],
        pendingProposals: [],
      },
      error: null,
    });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    const state = await repository.readLinkState(catalogProductId);

    expect(rpc).toHaveBeenCalledWith("get_product_nutrition_link_state_v1", {
      p_namespace: "pricetrace",
      p_catalog_product_id: catalogProductId,
    });
    expect(state.revision).toBe(stateRevision);
  });

  it("rejects link state for a different exact catalog product", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        schemaVersion: "product-nutrition-link-state.v1",
        revision: stateRevision,
        namespace: "pricetrace",
        catalogProductId: "55555555-5555-4555-8555-555555555555",
        approvedLinks: [],
        pendingProposals: [],
      },
      error: null,
    });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.readLinkState(catalogProductId)).rejects.toThrow(/요청하지 않은 정확 규격/);
  });

  it("submits a pending proposal with exact identity, provenance, and revision", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        schemaVersion: "product-nutrition-link-proposal.v1",
        id: "33333333-3333-4333-8333-333333333333",
        action: "link",
        identity: { namespace: "pricetrace", catalogProductId, nutritionFoodId },
        status: "pending",
        sourceRevision: productRevision,
        createdAt: "2026-08-09T03:00:00+00:00",
      },
      error: null,
    });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    const proposal = await repository.propose(request());

    expect(rpc).toHaveBeenCalledWith("propose_product_nutrition_link_v1", expect.objectContaining({
      p_action: "link",
      p_namespace: "pricetrace",
      p_catalog_product_id: catalogProductId,
      p_nutrition_food_id: nutritionFoodId,
      p_source_revision: productRevision,
      p_source: expect.objectContaining({
        system: "PriceTrace",
        contract: "product-read.v1",
        candidateEvidence: expect.objectContaining({
          nutritionContract: "nutrition-read.v1",
          nutritionSourceRevision: "label-v2",
          nutritionRevision: 2,
        }),
      }),
    }));
    expect(proposal.status).toBe("pending");
  });

  it("rejects a proposal response with a different composite identity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        schemaVersion: "product-nutrition-link-proposal.v1",
        id: "33333333-3333-4333-8333-333333333333",
        action: "link",
        identity: {
          namespace: "pricetrace",
          catalogProductId,
          nutritionFoodId: "different-food-id",
        },
        status: "pending",
        sourceRevision: productRevision,
        createdAt: "2026-08-09T03:00:00+00:00",
      },
      error: null,
    });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.propose(request())).rejects.toThrow(/identity 또는 revision/);
  });

  it("isolates Nutrition search failure instead of returning fabricated food rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "nutrition offline" } });
    const repository = new NutritionCatalogRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.searchPublicFoods("후보")).rejects.toThrow("nutrition offline");
  });
});
