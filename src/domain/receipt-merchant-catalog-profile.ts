import { z } from "zod";
import { ReceiptJsonSchema, type ReceiptJson } from "./receipt";
import type { PublicReceiptSource } from "./public-receipt";

const profileSchema = z.object({
  id: z.string().trim().min(1),
  match: z.object({
    merchantId: z.string().trim().min(1),
    businessRegistrationNumber: z.string().trim().min(1),
    address: z.string().trim().min(1),
    phone: z.string().trim().min(1),
  }).strict(),
  classification: z.object({
    retailChannel: z.enum(["px", "regular"]),
    catalogNamespace: z.string().trim().min(1),
  }).strict(),
  reviewedAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1),
  sourceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const ReceiptMerchantCatalogProfileRegistrySchema = z.object({
  schemaVersion: z.literal("pricetrace-receipt-merchant-catalog-profiles.v1"),
  profiles: z.array(profileSchema),
}).strict().superRefine((registry, context) => {
  const ids = new Set<string>();
  const matchKeys = new Set<string>();
  for (const [index, profile] of registry.profiles.entries()) {
    if (ids.has(profile.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profiles", index, "id"],
        message: "판매처 카탈로그 프로필 ID가 중복되었습니다.",
      });
    }
    ids.add(profile.id);
    const matchKey = JSON.stringify(profile.match);
    if (matchKeys.has(matchKey)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profiles", index, "match"],
        message: "동일 판매처 식별자 프로필이 중복되었습니다.",
      });
    }
    matchKeys.add(matchKey);
  }
});

export type ReceiptMerchantCatalogProfileRegistry = z.infer<
  typeof ReceiptMerchantCatalogProfileRegistrySchema
>;

function profileMatchesReceipt(
  profile: ReceiptMerchantCatalogProfileRegistry["profiles"][number],
  receipt: ReceiptJson,
) {
  return receipt.merchant.merchant_id === profile.match.merchantId
    && receipt.merchant.business_registration_number
      === profile.match.businessRegistrationNumber
    && receipt.merchant.address === profile.match.address
    && receipt.merchant.phone === profile.match.phone;
}

export function applyReceiptMerchantCatalogProfiles(
  sources: PublicReceiptSource[],
  input: unknown,
) {
  const registry = ReceiptMerchantCatalogProfileRegistrySchema.parse(input);
  const applied: Array<{ receiptId: string; profileId: string }> = [];
  const profiledSources = sources.map(({ receiptId, source: inputSource }) => {
    const source = ReceiptJsonSchema.parse(inputSource);
    const matches = registry.profiles.filter((profile) => (
      profileMatchesReceipt(profile, source)
    ));
    if (matches.length > 1) {
      throw new Error(`영수증 ${receiptId}에 여러 판매처 카탈로그 프로필이 일치합니다.`);
    }
    const profile = matches[0];
    if (!profile) return { receiptId, source };
    const { retailChannel, catalogNamespace } = profile.classification;
    if (
      source.merchant.retail_channel !== "unknown"
      && source.merchant.retail_channel !== retailChannel
    ) {
      throw new Error(`영수증 ${receiptId}의 판매 채널이 검토 프로필과 충돌합니다.`);
    }
    if (
      source.merchant.catalog_namespace !== null
      && source.merchant.catalog_namespace !== catalogNamespace
    ) {
      throw new Error(`영수증 ${receiptId}의 카탈로그 namespace가 검토 프로필과 충돌합니다.`);
    }
    applied.push({ receiptId, profileId: profile.id });
    return {
      receiptId,
      source: ReceiptJsonSchema.parse({
        ...source,
        merchant: {
          ...source.merchant,
          retail_channel: retailChannel,
          catalog_namespace: catalogNamespace,
        },
      }),
    };
  });

  return { sources: profiledSources, applied };
}
