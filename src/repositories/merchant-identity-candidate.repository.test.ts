import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MerchantIdentityCandidateRepository } from "./merchant-identity-candidate.repository";

describe("MerchantIdentityCandidateRepository", () => {
  it("reads admin-visible pending source facts", async () => {
    const row = {
      candidate_id: "cb512559-1c03-41f0-9764-dd97db78caa1",
      origin: "receipt_ingestion",
      merchant_name: "검증된 원본 식당명",
      branch_name: null,
      business_registration_number: null,
      address: "서울시 예시로 1",
      phone: null,
      business_kind: "food_service",
      source_namespace: null,
      source_code: null,
      created_at: "2026-09-24T00:00:00Z",
    };
    const rpc = vi.fn().mockResolvedValue({ data: [row], error: null });
    const repository = new MerchantIdentityCandidateRepository({ rpc } as unknown as SupabaseClient);
    await expect(repository.listPending()).resolves.toEqual([row]);
    expect(rpc).toHaveBeenCalledWith("admin_list_pending_merchant_identity_candidates_v1");
  });

  it("reads only the authenticated owner's pending candidates through the owner RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repository = new MerchantIdentityCandidateRepository({ rpc } as unknown as SupabaseClient);
    await expect(repository.listMyPending()).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith("get_my_pending_merchant_identity_candidates_v1");
  });
  it("surfaces an authorization error instead of treating it as an empty queue", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Administrator authentication is required." } });
    const repository = new MerchantIdentityCandidateRepository({ rpc } as unknown as SupabaseClient);
    await expect(repository.listPending()).rejects.toThrow("Administrator authentication is required.");
  });
});