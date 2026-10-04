import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { RestaurantMenuProposalRepository } from "./restaurant-menu-proposal.repository";

const id = "11111111-1111-4111-8111-111111111111";
const payload = { schemaVersion: "restaurant-menu-candidate.v1", candidateId: id,
  reviewStatus: "pending", resolutionStatus: "unresolved", restaurantId: null,
  restaurantLocationId: null, restaurantMenuId: null, catalogProductId: null,
  proposedRestaurantId: id, proposedRestaurantLocationId: id, merchantCandidateId: null,
  menuName: "메뉴", metadata: {}, reviewNote: null,
  createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z" };
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, repository: new RestaurantMenuProposalRepository({ rpc } as unknown as SupabaseClient) };
}
describe("menu proposal review repository", () => {
  it("reuses the existing merchant queue and isolates the dining merchant-only domain", async () => {
    const row = { candidate_id: id, origin: "merchant_only", merchant_name: "가게", branch_name: null,
      business_registration_number: null, address: null, phone: null, business_kind: "food_service",
      source_namespace: null, source_code: null, created_at: "2026-10-04T00:00:00Z" };
    const { rpc, repository } = fixture([row, { ...row, origin: "receipt_ingestion" }, { ...row, business_kind: "retail" }]);
    expect(await repository.listMerchantCandidates()).toEqual([row]);
    expect(rpc).toHaveBeenCalledWith("admin_list_pending_merchant_identity_candidates_v1");
  });
  it("reuses the existing merchant resolution without creating a restaurant", async () => {
    const { rpc, repository } = fixture([{ candidate_id: id, review_status: "accepted", restaurant_id: id, restaurant_location_id: id }]);
    await repository.resolveMerchant(id, id, id, "accept");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("admin_resolve_merchant_identity_candidate_v1", {
      p_candidate_id: id, p_restaurant_id: id, p_restaurant_location_id: id, p_decision: "accept",
    });
  });
  it("reads only the checked administrator RPC", async () => {
    const { rpc, repository } = fixture([payload]);
    expect(await repository.listPending()).toEqual([payload]);
    expect(rpc).toHaveBeenCalledWith("admin_list_restaurant_menu_candidates_v1");
  });
  it("rejects invalid decisions before sending", async () => {
    const { rpc, repository } = fixture(payload);
    await expect(repository.resolve({ candidateId: id, decision: "accept" } as never)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("sends all four exact IDs and never registers canonical entities", async () => {
    const result = { ...payload, reviewStatus: "accepted", resolutionStatus: "exact",
      restaurantId: id, restaurantLocationId: id, restaurantMenuId: id, catalogProductId: id };
    const { rpc, repository } = fixture(result);
    await repository.resolve({ candidateId: id, decision: "accept", restaurantId: id,
      restaurantLocationId: id, restaurantMenuId: id, catalogProductId: id });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("admin_resolve_restaurant_menu_candidate_v1", {
      p_candidate_id: id, p_decision: "accept", p_restaurant_id: id,
      p_restaurant_location_id: id, p_restaurant_menu_id: id, p_catalog_product_id: id, p_review_note: null,
    });
  });
  it("fails closed if the response identity differs", async () => {
    const { repository } = fixture({ ...payload, candidateId: "22222222-2222-4222-8222-222222222222", reviewStatus: "rejected" });
    await expect(repository.resolve({ candidateId: id, decision: "reject" })).rejects.toThrow("다릅니다");
  });
  it("propagates permission errors", async () => {
    const { repository } = fixture(null, { message: "administrator required" });
    await expect(repository.listPending()).rejects.toThrow("administrator required");
  });
});
