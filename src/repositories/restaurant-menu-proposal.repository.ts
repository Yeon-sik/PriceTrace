import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  RestaurantMenuCandidateSchema, ResolveRestaurantMenuCandidateSchema,
  type RestaurantMenuCandidate, type ResolveRestaurantMenuCandidate,
  DiningMerchantCandidateSchema, type DiningMerchantCandidate,
} from "../domain/restaurant-menu-proposal";

/** Candidate review only. Canonical creation stays in RestaurantMenuRepository's existing RPCs. */
export class RestaurantMenuProposalRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listMerchantCandidates(): Promise<DiningMerchantCandidate[]> {
    const { data, error } = await this.client.rpc("admin_list_pending_merchant_identity_candidates_v1");
    if (error) throw new Error(error.message || "가게 등록 제안을 불러오지 못했습니다.");
    return DiningMerchantCandidateSchema.array().parse(data)
      .filter((row) => row.origin === "merchant_only" && row.business_kind === "food_service");
  }

  async resolveMerchant(candidateId: string, restaurantId: string | null, locationId: string | null,
    decision: "accept" | "reject"): Promise<void> {
    z.string().uuid().parse(candidateId);
    if (decision === "accept") { z.string().uuid().parse(restaurantId); z.string().uuid().parse(locationId); }
    else if (restaurantId !== null || locationId !== null) throw new Error("거절에 identity를 지정할 수 없습니다.");
    const { data, error } = await this.client.rpc("admin_resolve_merchant_identity_candidate_v1", {
      p_candidate_id: candidateId, p_restaurant_id: restaurantId,
      p_restaurant_location_id: locationId, p_decision: decision,
    });
    if (error) throw new Error(error.message || "가게 제안을 검토하지 못했습니다.");
    const row = z.object({ candidate_id: z.string().uuid(), review_status: z.enum(["accepted", "rejected"]),
      restaurant_id: z.string().uuid().nullable(), restaurant_location_id: z.string().uuid().nullable() })
      .parse(Array.isArray(data) && data.length === 1 ? data[0] : data);
    if (row.candidate_id !== candidateId || row.review_status !== (decision === "accept" ? "accepted" : "rejected")
      || row.restaurant_id !== restaurantId || row.restaurant_location_id !== locationId) {
      throw new Error("가게 검토 응답의 exact identity가 다릅니다.");
    }
  }

  async listPending(): Promise<RestaurantMenuCandidate[]> {
    const { data, error } = await this.client.rpc("admin_list_restaurant_menu_candidates_v1");
    if (error) throw new Error(error.message || "메뉴 등록 제안을 불러오지 못했습니다.");
    return RestaurantMenuCandidateSchema.array().parse(data);
  }

  async resolve(input: ResolveRestaurantMenuCandidate): Promise<RestaurantMenuCandidate> {
    const request = ResolveRestaurantMenuCandidateSchema.parse(input);
    const { data, error } = await this.client.rpc("admin_resolve_restaurant_menu_candidate_v1", {
      p_candidate_id: request.candidateId, p_decision: request.decision,
      p_restaurant_id: request.decision === "accept" ? request.restaurantId : null,
      p_restaurant_location_id: request.decision === "accept" ? request.restaurantLocationId : null,
      p_restaurant_menu_id: request.decision === "accept" ? request.restaurantMenuId : null,
      p_catalog_product_id: request.decision === "accept" ? request.catalogProductId : null,
      p_review_note: request.reviewNote?.trim() || null,
    });
    if (error) throw new Error(error.message || "메뉴 등록 제안을 검토하지 못했습니다.");
    const result = RestaurantMenuCandidateSchema.parse(data);
    if (result.candidateId !== request.candidateId
      || result.reviewStatus !== (request.decision === "accept" ? "accepted" : "rejected")
      || (request.decision === "accept" && (result.restaurantId !== request.restaurantId
        || result.restaurantLocationId !== request.restaurantLocationId
        || result.restaurantMenuId !== request.restaurantMenuId
        || result.catalogProductId !== request.catalogProductId))) {
      throw new Error("메뉴 제안 검토 응답이 선택한 exact identity와 다릅니다.");
    }
    return result;
  }
}
