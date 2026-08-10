import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ProductNutritionLinkStateSchema,
  ProductNutritionProposalRequestSchema,
  ProductNutritionProposalSchema,
  nutritionFoodFromReadRow,
  productNutritionLinkIdentityKey,
  type NutritionFood,
  type ProductNutritionLinkState,
  type ProductNutritionProposal,
  type ProductNutritionProposalRequest,
} from "../domain/product-nutrition-link";
import { PRODUCT_READ_NAMESPACE } from "../domain/product-read";

function remoteErrorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

function unwrapRpcObject(data: unknown) {
  return Array.isArray(data) && data.length === 1 ? data[0] : data;
}

export class NutritionCatalogRepository {
  constructor(private readonly client: SupabaseClient) {}

  async readPublicFoods(catalogProductId: string): Promise<NutritionFood[]> {
    const { data, error } = await this.client.rpc("get_public_product_nutrition_v1", {
      p_namespace: PRODUCT_READ_NAMESPACE,
      p_catalog_product_id: catalogProductId,
    });
    if (error) {
      throw new Error(remoteErrorMessage(error, "공개 영양정보를 불러오지 못했습니다."));
    }
    if (!Array.isArray(data)) {
      throw new Error("공개 영양 RPC가 배열 계약을 반환하지 않았습니다.");
    }
    return data.map((row) => {
      const food = nutritionFoodFromReadRow(row);
      if (food.approvedCatalogProductId !== catalogProductId) {
        throw new Error("공개 영양 RPC가 요청하지 않은 정확 규격을 반환했습니다.");
      }
      return food;
    });
  }

  async searchPublicFoods(query: string, limit = 8): Promise<NutritionFood[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const { data, error } = await this.client.rpc("get_nutrition_read_v1", {
      p_query: normalizedQuery,
    });

    if (error) {
      throw new Error(remoteErrorMessage(error, "Fitness 공개 영양을 검색하지 못했습니다."));
    }
    if (!Array.isArray(data)) {
      throw new Error("nutrition-read.v1 RPC가 배열 계약을 반환하지 않았습니다.");
    }
    const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 20));
    return data.slice(0, safeLimit).map(nutritionFoodFromReadRow);
  }

  async readLinkState(catalogProductId: string): Promise<ProductNutritionLinkState> {
    const { data, error } = await this.client.rpc("get_product_nutrition_link_state_v1", {
      p_namespace: PRODUCT_READ_NAMESPACE,
      p_catalog_product_id: catalogProductId,
    });
    if (error) {
      throw new Error(remoteErrorMessage(error, "Nutrition 링크 상태를 불러오지 못했습니다."));
    }
    const state = ProductNutritionLinkStateSchema.parse(unwrapRpcObject(data));
    if (state.catalogProductId !== catalogProductId) {
      throw new Error("Nutrition 링크 RPC가 요청하지 않은 정확 규격을 반환했습니다.");
    }
    return state;
  }

  async propose(requestInput: ProductNutritionProposalRequest): Promise<ProductNutritionProposal> {
    const request = ProductNutritionProposalRequestSchema.parse(requestInput);
    const { data, error } = await this.client.rpc("propose_product_nutrition_link_v1", {
      p_action: request.action,
      p_namespace: request.identity.namespace,
      p_catalog_product_id: request.identity.catalogProductId,
      p_nutrition_food_id: request.identity.nutritionFoodId,
      p_source_revision: request.source.productRevision,
      p_source: {
        ...request.source,
        candidateEvidence: request.candidateEvidence,
      },
    });
    if (error) {
      throw new Error(remoteErrorMessage(error, "Nutrition 연결 제안을 저장하지 못했습니다."));
    }
    const proposal = ProductNutritionProposalSchema.parse(unwrapRpcObject(data));
    if (
      proposal.action !== request.action
      || productNutritionLinkIdentityKey(proposal.identity)
        !== productNutritionLinkIdentityKey(request.identity)
      || proposal.sourceRevision !== request.source.productRevision
    ) {
      throw new Error("Nutrition 제안 RPC가 요청 identity 또는 revision과 다른 결과를 반환했습니다.");
    }
    return proposal;
  }
}
