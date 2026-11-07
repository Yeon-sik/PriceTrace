import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { InformationInboxRepository } from "./information-inbox.repository";

const cases = JSON.parse(readFileSync(new URL("../../contracts/information-record.v1.cases.json", import.meta.url), "utf8"));
const fixture = cases.accepted.find((entry: { record: { owner_app: string } }) => entry.record.owner_app === "pricetrace").record;
const owner = "00000000-0000-4000-8000-000000000011";
const text = JSON.stringify(fixture).replace('"nested":[', '"large":90071992547409931234567890,"nested":[');

function client() {
  return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: owner } }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ data: { record_id: fixture.record_id, duplicate: false, content_fingerprint: "a".repeat(64) }, error: null }) };
}

describe("private information inbox repository", () => {
  it("sends exact imported text and never writes native domain tables", async () => {
    const mock = client();
    await new InformationInboxRepository(mock as unknown as SupabaseClient).importText(text);
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("ingest_pricetrace_information_record_v1", { p_payload_text: text, p_expected_user_id: owner });
  });
  it("rejects foreign records before sending any request", async () => {
    const mock = client();
    await expect(new InformationInboxRepository(mock as unknown as SupabaseClient).importText(JSON.stringify(cases.accepted[0].record))).rejects.toThrow();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("requires auth and reports changed-content conflicts", async () => {
    const mock = client(); mock.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const repository = new InformationInboxRepository(mock as unknown as SupabaseClient);
    await expect(repository.importText(text)).rejects.toThrow("로그인");
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    await expect(repository.importText(text)).rejects.toThrow("같은 ID");
  });
  it("does not reveal a completed write after account changes", async () => {
    const mock = client();
    mock.auth.getUser.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: "00000000-0000-4000-8000-000000000022" } }, error: null });
    await expect(new InformationInboxRepository(mock as unknown as SupabaseClient).importText(text)).rejects.toThrow("계정이 변경");
  });
});
