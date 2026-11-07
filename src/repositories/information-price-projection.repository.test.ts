import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InformationInboxEntry } from "./information-inbox.repository";
import { InformationPriceProjectionRepository, type InformationPricePreview } from "./information-price-projection.repository";
const owner = "00000000-0000-4000-8000-000000000011", other = "00000000-0000-4000-8000-000000000022";
const recordId = "99000000-0000-4000-8000-000000000010", product = "99000000-0000-4000-8000-000000000002", store = "99000000-0000-4000-8000-000000000003";
const entry = { record_id: recordId, content_fingerprint: "a".repeat(64), payload_text: "EXACT ORIGINAL" } as InformationInboxEntry;
const mapping = { catalog_product_id: product, store_id: store, price_field: "price", date_field: "day" };
const preview: InformationPricePreview = { status: "ready", account_id: owner, record_id: recordId, source_fingerprint: entry.content_fingerprint, mapping_digest: "b".repeat(64),
  impact: { product_name: "Exact product", specification: "40 g", store_name: "Exact store", location_label: "Branch", catalog_product_id: product, store_id: store, observed_on: "2026-11-06", unit_price_krw: 1200, visibility: "public", additional_observations: 1, observation_count_before: 0, minimum_before: null, minimum_after: 1200 } };
function mock() { const value = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: owner } }, error: null }) }, rpc: vi.fn().mockResolvedValue({ data: preview, error: null }) }; return { value, repo: new InformationPriceProjectionRepository(value as unknown as SupabaseClient) }; }
describe("explicit public price projection", () => {
  it("sends immutable source fingerprint and typed mapping without source text", async () => {
    const { value, repo } = mock(); expect(await repo.preview(entry, mapping)).toEqual(preview);
    expect(value.rpc).toHaveBeenCalledExactlyOnceWith("preview_pricetrace_information_price_v1", { p_record_id: recordId, p_expected_user_id: owner, p_source_fingerprint: entry.content_fingerprint, p_mapping: mapping });
  });
  it("requires approval and a ready preview before any mutation", async () => {
    const { value, repo } = mock();
    await expect(repo.apply(entry, mapping, preview, false)).rejects.toThrow("승인");
    await expect(repo.apply(entry, mapping, { ...preview, status: "blocked" }, true)).rejects.toThrow("승인"); expect(value.rpc).not.toHaveBeenCalled();
  });
  it("sends digest, exact account and approval then requires native receipt", async () => {
    const { value, repo } = mock(); const receipt = { ...preview, status: "applied", observation_id: product, replayed: false };
    value.rpc.mockResolvedValueOnce({ data: receipt, error: null }); expect(await repo.apply(entry, mapping, preview, true)).toEqual(receipt);
    expect(value.rpc).toHaveBeenCalledWith("apply_pricetrace_information_price_v1", { p_record_id: recordId, p_expected_user_id: owner, p_source_fingerprint: entry.content_fingerprint, p_mapping: mapping, p_mapping_digest: preview.mapping_digest, p_publication_approved: true });
    await expect(repo.apply(entry, mapping, preview, true)).rejects.toThrow("영수증");
  });
  it.each(["account_id", "record_id", "source_fingerprint"])("rejects a mismatched %s response", async key => {
    const { value, repo } = mock(); value.rpc.mockResolvedValueOnce({ data: { ...preview, [key]: key === "source_fingerprint" ? "f".repeat(64) : other }, error: null }); await expect(repo.preview(entry, mapping)).rejects.toThrow("차단");
  });
  it("blocks account switches before mutation and after read", async () => {
    const { value, repo } = mock(); value.auth.getUser.mockResolvedValueOnce({ data: { user: { id: other } }, error: null });
    await expect(repo.apply(entry, mapping, preview, true)).rejects.toThrow("계정이 변경"); expect(value.rpc).not.toHaveBeenCalled();
    value.auth.getUser.mockResolvedValueOnce({ data: { user: { id: owner } }, error: null }).mockResolvedValueOnce({ data: { user: { id: other } }, error: null }); await expect(repo.preview(entry, mapping)).rejects.toThrow("계정이 변경");
  });
  it("does not report backend failures as applied", async () => {
    const { value, repo } = mock(); value.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505" } }); await expect(repo.apply(entry, mapping, preview, true)).rejects.toThrow("다시 확인");
  });
});
