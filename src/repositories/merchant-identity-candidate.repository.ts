import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const PendingMerchantIdentityCandidateSchema = z.object({
  candidate_id: z.string().uuid(),
  origin: z.enum(["receipt_ingestion", "merchant_only"]),
  merchant_name: z.string().min(1),
  branch_name: z.string().nullable(),
  business_registration_number: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  business_kind: z.string(),
  source_namespace: z.string().nullable(),
  source_code: z.string().nullable(),
  created_at: z.string(),
}).strict();

export type PendingMerchantIdentityCandidate = z.infer<typeof PendingMerchantIdentityCandidateSchema>;

export class MerchantIdentityCandidateRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listPending(): Promise<PendingMerchantIdentityCandidate[]> {
    const { data, error } = await this.client.rpc("admin_list_pending_merchant_identity_candidates_v1");
    if (error) throw new Error(error.message);
    return z.array(PendingMerchantIdentityCandidateSchema).parse(data ?? []);
  }

  async listMyPending(): Promise<PendingMerchantIdentityCandidate[]> {
    const { data, error } = await this.client.rpc("get_my_pending_merchant_identity_candidates_v1");
    if (error) throw new Error(error.message);
    return z.array(PendingMerchantIdentityCandidateSchema).parse(data ?? []);
  }
}