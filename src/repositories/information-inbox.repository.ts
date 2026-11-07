import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { parseInformationRecordText, type InformationInboxState } from "../domain/information-record";

const RowSchema = z.object({
  user_id: z.string().uuid(), record_id: z.string().uuid(), payload_text: z.string(),
  content_fingerprint: z.string().regex(/^[0-9a-f]{64}$/), state: z.enum(["pending", "reviewed", "archived"]),
  received_at: z.string(),
});
const ReceiptSchema = z.object({ record_id: z.string().uuid(), duplicate: z.boolean(), content_fingerprint: z.string().regex(/^[0-9a-f]{64}$/) });
export type InformationInboxEntry = z.infer<typeof RowSchema> & { record: ReturnType<typeof parseInformationRecordText> };

export class InformationInboxRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async owner() {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new Error("내 정보 보관함을 사용하려면 로그인하세요.");
    return data.user.id;
  }

  private async assertOwner(owner: string) {
    if (await this.owner() !== owner) throw new Error("계정이 변경되었습니다. 목록을 다시 불러오세요.");
  }

  async list(offset = 0): Promise<InformationInboxEntry[]> {
    const owner = await this.owner();
    const { data, error } = await this.client.from("pricetrace_information_inbox")
      .select("user_id,record_id,payload_text,content_fingerprint,state,received_at").eq("user_id", owner)
      .order("received_at", { ascending: false }).order("record_id").range(offset, offset + 49);
    if (error) throw new Error("보관함을 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.");
    await this.assertOwner(owner);
    return z.array(RowSchema).parse(data).map(row => {
      if (row.user_id !== owner) throw new Error("다른 계정의 응답을 차단했습니다.");
      const record = parseInformationRecordText(row.payload_text, "pricetrace");
      if (record.record_id !== row.record_id) throw new Error("기록 식별자가 일치하지 않습니다.");
      return { ...row, record };
    });
  }

  async importText(text: string) {
    const record = parseInformationRecordText(text, "pricetrace");
    const owner = await this.owner();
    // Send the original text. JSON.parse/stringify would round large custom JSON numbers.
    const { data, error } = await this.client.rpc("ingest_pricetrace_information_record_v1", { p_payload_text: text, p_expected_user_id: owner });
    if (error) throw new Error(error.code === "23505"
      ? "같은 ID에 다른 내용이 저장되어 있습니다. 기존 기록을 덮어쓸 수 없습니다. 새 ID로 수정 기록을 만드세요."
      : "정보를 저장하지 못했습니다. 연결과 파일 내용을 확인한 뒤 다시 시도하세요.");
    await this.assertOwner(owner);
    const result = ReceiptSchema.parse(data);
    if (result.record_id !== record.record_id) throw new Error("저장 응답의 기록 ID가 일치하지 않습니다.");
    return result;
  }

  async setState(recordId: string, state: InformationInboxState) {
    const owner = await this.owner();
    const { data, error } = await this.client.from("pricetrace_information_inbox").update({ state })
      .eq("user_id", owner).eq("record_id", recordId).select("record_id").single();
    if (error || data?.record_id !== recordId) throw new Error("검토 상태를 변경하지 못했습니다. 다시 시도하세요.");
    await this.assertOwner(owner);
  }
}
