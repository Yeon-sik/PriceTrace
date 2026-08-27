import { z } from "zod";
import { MerchantBusinessKindSchema } from "../receipt-contract/receipt";

/**
 * Source facts for a merchant-only draft. This contract has no PriceTrace UUID,
 * SKU, brand, or catalog field: those identities are server-owned and resolved
 * only after a user confirms the supplied facts.
 */
export const MerchantProfileV1MerchantSchema = z.object({
  merchant_name: z.string().trim().min(1).max(500),
  branch_name: z.string().trim().min(1).max(500).nullable().default(null),
  business_kind: MerchantBusinessKindSchema,
  business_registration_number: z.string().trim().min(1).max(100).nullable().default(null),
  address: z.string().trim().min(1).max(1000).nullable().default(null),
  phone: z.string().trim().min(1).max(100).nullable().default(null),
  source_namespace: z.string().trim().min(1).max(200).nullable().default(null),
  source_location_code: z.string().trim().min(1).max(200).nullable().default(null),
}).strict().superRefine((merchant, context) => {
  if ((merchant.source_namespace === null) !== (merchant.source_location_code === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["source_namespace"], message: "source namespace와 source location code는 함께 있어야 합니다." });
  }
});

export const MerchantProfileV1Schema = z.object({
  schema_version: z.literal("merchant-profile.v1"),
  merchant: MerchantProfileV1MerchantSchema,
}).strict();

export type MerchantProfileV1 = z.infer<typeof MerchantProfileV1Schema>;
