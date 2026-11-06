import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InformationSellerReviewRepository, type SellerReview } from "./information-seller-review.repository";
const owner = "00000000-0000-4000-8000-000000000011", other = "00000000-0000-4000-8000-000000000022";
const request: SellerReview = { request_id: "98000000-0000-4000-8000-000000000001", user_id: owner, source_record_id: "98000000-0000-4000-8000-000000000002", details: { display_name: "정확한 판매처", location_label: "지점", evidence_url: "https://example.test/store", evidence_note: "비공개 근거" }, input_digest: "a".repeat(64), state: "pending", store_id: null, review_note: null, created_at: "2026-11-06T00:00:00Z" };
function setup(admin = false) { const mock = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: owner, app_metadata: { role: admin ? "admin" : "user" } } }, error: null }) }, rpc: vi.fn().mockResolvedValue({ data: request, error: null }) }; return { mock, repo: new InformationSellerReviewRepository(mock as unknown as SupabaseClient) }; }
describe("private seller review", () => {
  it("requires explicit confirmation and sends stable request identity", async () => {
    const { mock, repo } = setup(); await expect(repo.submit(request.source_record_id, request.request_id, request.details, false)).rejects.toThrow("확인"); expect(mock.rpc).not.toHaveBeenCalled();
    expect(await repo.submit(request.source_record_id, request.request_id, request.details, true)).toEqual(request);
    expect(mock.rpc).toHaveBeenCalledWith("submit_pricetrace_seller_review_v1", { p_request_id: request.request_id, p_source_record_id: request.source_record_id, p_expected_user_id: owner, p_details: request.details });
  });
  it("does not let ordinary accounts approve sellers", async () => {
    const { mock, repo } = setup(); await expect(repo.review(request, true, "checked", true)).rejects.toThrow("관리자"); expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("binds admin review to evidence digest and exact decision", async () => {
    const { mock, repo } = setup(true); mock.rpc.mockResolvedValueOnce({ data: { ...request, state: "rejected", review_note: "근거 부족" }, error: null });
    const result = await repo.review(request, false, "근거 부족", true); expect(result.state).toBe("rejected");
    expect(mock.rpc).toHaveBeenCalledWith("review_pricetrace_seller_v1", { p_request_id: request.request_id, p_expected_user_id: owner, p_expected_digest: request.input_digest, p_approve: false, p_review_note: "근거 부족" });
  });
  it("blocks switched-account result display", async () => {
    const { mock, repo } = setup(); mock.auth.getUser.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null }).mockResolvedValueOnce({ data: { user: { id: other } }, error: null });
    await expect(repo.submit(request.source_record_id, request.request_id, request.details, true)).rejects.toThrow("계정이 변경");
  });
});
