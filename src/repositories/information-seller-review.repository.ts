import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type SellerReviewDetails = { display_name: string; location_label: string; evidence_url: string; evidence_note: string };
const detailsSchema = z.object({ display_name: z.string(), location_label: z.string(), evidence_url: z.string(), evidence_note: z.string() });
const reviewSchema = z.object({ request_id: z.string().uuid(), user_id: z.string().uuid(), source_record_id: z.string().uuid(),
  details: detailsSchema, input_digest: z.string().regex(/^[a-f0-9]{64}$/), state: z.enum(["pending", "approved", "rejected"]),
  store_id: z.string().uuid().nullable(), review_note: z.string().nullable(), created_at: z.string() });
export type SellerReview = z.infer<typeof reviewSchema>;
export class InformationSellerReviewRepository {
  constructor(private readonly client: SupabaseClient) {}
  private async account() {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new Error("판매처 검토 계정에 로그인하세요.");
    return { id: data.user.id, admin: data.user.app_metadata?.role === "admin" };
  }
  private async sameAccount(id: string) { if ((await this.account()).id !== id) throw new Error("계정이 변경되었습니다. 다시 검토하세요."); }
  async list() {
    const account = await this.account();
    const { data, error } = await this.client.from("pricetrace_seller_review_requests").select("request_id,user_id,source_record_id,details,input_digest,state,store_id,review_note,created_at").order("created_at", { ascending: false });
    if (error) throw new Error("판매처 신청을 불러오지 못했습니다.");
    await this.sameAccount(account.id);
    return { account, requests: z.array(reviewSchema).parse(data) };
  }
  async submit(recordId: string, requestId: string, details: SellerReviewDetails, approved: boolean) {
    if (!approved) throw new Error("판매처 식별 정보와 관리자에게 보낼 근거를 확인하세요.");
    const account = await this.account();
    const { data, error } = await this.client.rpc("submit_pricetrace_seller_review_v1", { p_request_id: requestId, p_source_record_id: recordId, p_expected_user_id: account.id, p_details: details });
    if (error) throw new Error("판매처 신청을 확인하지 못했습니다. 정확한 이름·지점·공개 확인 URL·근거를 확인하세요.");
    await this.sameAccount(account.id);
    const result = reviewSchema.parse(data);
    if (result.request_id !== requestId || result.user_id !== account.id || result.source_record_id !== recordId) throw new Error("다른 신청의 응답을 차단했습니다.");
    return result;
  }
  async review(request: SellerReview, approve: boolean, note: string, confirmed: boolean) {
    if (!confirmed || !note.trim()) throw new Error("검토 사유와 공개 승인 여부를 확인하세요.");
    const account = await this.account();
    if (!account.admin) throw new Error("판매처 승인은 관리자 계정만 가능합니다.");
    const { data, error } = await this.client.rpc("review_pricetrace_seller_v1", { p_request_id: request.request_id, p_expected_user_id: account.id, p_expected_digest: request.input_digest, p_approve: approve, p_review_note: note });
    if (error) throw new Error("판매처 검토 결과를 저장하지 못했습니다. 계정 권한 또는 변경된 신청을 확인하세요.");
    await this.sameAccount(account.id);
    const result = reviewSchema.parse(data);
    if (result.request_id !== request.request_id || result.input_digest !== request.input_digest) throw new Error("다른 신청의 응답을 차단했습니다.");
    return result;
  }
}
