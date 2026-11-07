import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { InformationInboxEntry } from "./information-inbox.repository";

export type InformationPriceMapping = { catalog_product_id: string; store_id: string; price_field: string; date_field: string };
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const impactSchema = z.object({ product_name: z.string(), specification: z.string().nullable(), store_name: z.string(), location_label: z.string().nullable(),
  catalog_product_id: z.string().uuid(), store_id: z.string().uuid(), observed_on: z.string(), unit_price_krw: z.number().int().nonnegative(),
  visibility: z.literal("public"), additional_observations: z.number().int().min(0).max(1), observation_count_before: z.number().int().nonnegative(),
  minimum_before: z.number().nullable(), minimum_after: z.number() });
export const InformationPricePreviewSchema = z.object({ status: z.enum(["blocked", "ready", "applied"]), reason: z.string().optional(),
  account_id: z.string().uuid(), record_id: z.string().uuid(), source_fingerprint: hash, mapping_digest: hash.optional(), impact: impactSchema.optional(),
  observation_id: z.string().uuid().optional(), applied_at: z.string().optional(), applied_action: z.string().optional(), replayed: z.boolean().optional() }).superRefine((value, ctx) => {
  if (value.status !== "blocked" && (!value.mapping_digest || !value.impact)) ctx.addIssue({ code: "custom", message: "Missing impact preview" });
  if (value.status === "applied" && !value.observation_id) ctx.addIssue({ code: "custom", message: "Missing application receipt" });
});
export type InformationPricePreview = z.infer<typeof InformationPricePreviewSchema>;
const storesSchema = z.array(z.object({ store_id: z.string().uuid(), display_name: z.string(), location_label: z.string().nullable() }));

export class InformationPriceProjectionRepository {
  constructor(private readonly client: SupabaseClient) {}
  async account() {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new Error("가격 반영 계정에 로그인하세요.");
    return { id: data.user.id, email: data.user.email ?? "이메일 없음" };
  }
  private async sameAccount(id: string) { if ((await this.account()).id !== id) throw new Error("계정이 변경되었습니다. 다시 미리보기를 확인하세요."); }
  async prepare(entry: InformationInboxEntry) {
    const account = await this.account();
    const [stores, receipt] = await Promise.all([
      this.client.rpc("get_price_observation_sources_v1"),
      this.client.from("pricetrace_information_projection_receipts").select("result,mapping").eq("user_id", account.id).eq("record_id", entry.record_id).maybeSingle(),
    ]);
    if (stores.error || receipt.error) throw new Error("가격 반영 기능을 불러오지 못했습니다. 연결 또는 서버 업데이트를 확인하세요.");
    await this.sameAccount(account.id);
    const result = receipt.data ? this.checked(receipt.data.result, entry, account.id) : null;
    if (result && result.status !== "applied") throw new Error("저장된 반영 영수증을 확인하지 못했습니다.");
    return { account, stores: storesSchema.parse(stores.data), receipt: result };
  }
  async preview(entry: InformationInboxEntry, mapping: InformationPriceMapping) {
    const account = await this.account();
    const { data, error } = await this.client.rpc("preview_pricetrace_information_price_v1", { p_record_id: entry.record_id, p_expected_user_id: account.id, p_source_fingerprint: entry.content_fingerprint, p_mapping: mapping });
    if (error) throw new Error(error.code === "23505" ? "이미 반영한 내용과 다르거나 미리보기가 변경되었습니다. 기록을 다시 확인하세요." : "반영 미리보기를 확인하지 못했습니다. 계정과 원문을 다시 확인하세요.");
    await this.sameAccount(account.id);
    return this.checked(data, entry, account.id);
  }
  async apply(entry: InformationInboxEntry, mapping: InformationPriceMapping, preview: InformationPricePreview, approved: boolean) {
    if (!approved || preview.status !== "ready" || !preview.mapping_digest) throw new Error("미리보기의 계정과 공개 범위를 확인하고 승인하세요.");
    await this.sameAccount(preview.account_id);
    const { data, error } = await this.client.rpc("apply_pricetrace_information_price_v1", { p_record_id: entry.record_id, p_expected_user_id: preview.account_id,
      p_source_fingerprint: entry.content_fingerprint, p_mapping: mapping, p_mapping_digest: preview.mapping_digest, p_publication_approved: approved });
    if (error) throw new Error(error.code === "23505" ? "미리보기 이후 내용이 달라졌습니다. 다시 확인하고 승인하세요." : "반영을 확인하지 못했습니다. 원문은 유지됩니다. 목록을 새로고침하면 기존 반영 결과를 확인할 수 있습니다.");
    await this.sameAccount(preview.account_id);
    const result = this.checked(data, entry, preview.account_id);
    if (result.status !== "applied") throw new Error("반영 영수증을 확인하지 못했습니다.");
    return result;
  }
  private checked(data: unknown, entry: InformationInboxEntry, account: string) {
    const result = InformationPricePreviewSchema.parse(data);
    if (result.account_id !== account || result.record_id !== entry.record_id || result.source_fingerprint !== entry.content_fingerprint) throw new Error("다른 계정 또는 원문의 응답을 차단했습니다.");
    return result;
  }
}
