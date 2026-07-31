import { z } from "zod";
import {
  canonicalJson,
  normalizeProductNameForExactMatch,
  sha256CanonicalJson,
} from "./standard-product-registration";

const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nullableText = z.string().trim().min(1).nullable();
const dateTime = z.string().datetime({ offset: true });
const receiptSchema = z.object({
  receiptId: z.string().trim().min(1),
  receiptItemId: z.string().trim().min(1),
  receiptRevision: z.string().trim().min(1),
  sourceCatalogNamespace: nullableText,
  sourceLabel: z.string().trim().min(1),
  sourceProductCode: z.string().trim().min(1),
  sourceNameRaw: z.string().trim().min(1),
  observedAt: dateTime,
  unitPriceKrw: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
}).strict();
const officialListingSchema = z.object({
  channelId: z.string().trim().min(1),
  sourceProductCodeNamespace: z.string().trim().min(1),
  sourceProductCode: z.string().trim().min(1),
  snapshotId: z.string().uuid(),
  snapshotHash: fingerprintSchema,
  sourceNameRaw: z.string().trim().min(1),
  specificationTextRaw: nullableText,
  sourceRefs: z.array(z.string().trim().min(1)).min(1),
  image: z.object({
    url: z.string().url().startsWith("https://"),
    contentHash: fingerprintSchema,
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    byteLength: z.number().int().positive(),
  }).strict().nullable(),
}).strict();
const sameChannelNameRuleSchema = z.object({
  sameChannel: z.boolean(),
  normalization: z.literal("remove_unicode_whitespace_only"),
  normalizedReceiptName: z.string().min(1),
  normalizedOfficialName: z.string().min(1),
  exactNameMatch: z.boolean(),
  outcome: z.enum(["apply_official_identity", "discovery_only", "not_applicable"]),
  importedOfficialFields: z.array(z.enum([
    "brand", "contentAmount", "contentUnit", "packageCount", "gtin",
  ])),
}).strict();
const normalizedIdentitySchema = z.object({
  brand: nullableText,
  productFamilyName: nullableText,
  variantName: nullableText,
  contentAmount: z.number().positive().nullable(),
  contentUnit: z.enum(["g", "ml", "each"]).nullable(),
  packageCount: z.number().int().positive().nullable(),
  gtin: nullableText,
}).strict();
const decisionSchema = z.object({
  action: z.enum([
    "reuse_variant", "create_variant", "create_family_and_variant", "insufficient_evidence", "reject",
  ]),
  standardProductId: z.string().uuid().nullable(),
  catalogProductId: z.string().uuid().nullable(),
  proposedStandardName: nullableText,
  proposedVariantName: nullableText,
  confidence: z.enum(["high", "medium", "low"]),
  matchedFields: z.array(z.string().trim().min(1)),
  conflictingFields: z.array(z.string().trim().min(1)),
  missingFields: z.array(z.string().trim().min(1)),
}).strict();
const coupangOfferSchema = z.object({
  url: z.string().url(),
  totalPriceKrw: z.number().int().positive(),
  quantity: z.number().int().positive(),
  contentAmount: z.number().positive(),
  contentUnit: z.enum(["g", "ml", "each"]),
  observedAt: dateTime,
  maxBundleQuantity: z.number().int().positive().nullable(),
  maxBundleTotalPriceKrw: z.number().int().positive().nullable(),
}).strict();
const evidenceSchema = z.object({
  sourceType: z.enum([
    "receipt", "official_channel", "manufacturer", "brand", "retailer", "coupang", "database",
  ]),
  sourceId: z.string().trim().min(1),
  authority: z.enum(["primary", "secondary", "transactional"]),
  url: z.string().url().nullable(),
  capturedAt: dateTime,
  claims: z.array(z.string().trim().min(1)).min(1),
  sourceRefs: z.array(z.string().trim().min(1)).min(1),
}).strict();
const reviewSchema = z.object({
  verdict: z.enum(["approve", "needs_more_evidence", "reject"]),
  reviewerAgent: z.string().trim().min(1),
  counterCandidates: z.array(z.string().trim().min(1)),
  conflicts: z.array(z.string().trim().min(1)),
  evidenceQuality: z.enum(["sufficient", "partial", "insufficient"]),
  notes: z.array(z.string().trim().min(1)),
}).strict();
const effectSchema = z.enum([
  "reuse_standard_family", "create_standard_family", "reuse_catalog_variant", "create_catalog_variant",
  "link_official_listing", "verify_receipt_mapping", "register_coupang_offer", "update_representative_image",
]);
const representativeImageSchema = z.object({
  scope: z.literal("standard_product_family"),
  action: z.enum(["create", "reuse_exact"]),
  sourceType: z.literal("external_url"),
  imageUrl: z.string().url().startsWith("https://"),
  contentHash: fingerprintSchema,
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteLength: z.number().int().positive(),
  expectedCurrent: z.object({
    sourceType: z.literal("external_url"),
    imageUrl: z.string().url().startsWith("https://"),
  }).strict().nullable(),
}).strict();
const approvalSchema = z.object({
  status: z.enum(["not_requested", "requested", "approved", "expired"]),
  approvalRef: nullableText,
  userApprovalText: nullableText,
  approvedAt: dateTime.nullable(),
  targetFingerprint: fingerprintSchema,
}).strict();
const executionSchema = z.object({
  status: z.enum(["not_started", "applied", "failed", "unknown"]),
  idempotencyKey: z.string().trim().min(1),
  appliedAt: dateTime.nullable(),
  result: z.record(z.string()).nullable(),
}).strict();
const officialImageApprovalProposalSchema = z.object({
  schemaVersion: z.literal("pricetrace-link-proposal.v3"),
  caseId: z.string().trim().min(1),
  status: z.literal("approved"),
  inputFingerprint: fingerprintSchema,
  receipt: receiptSchema,
  officialListing: officialListingSchema,
  sameChannelNameRule: sameChannelNameRuleSchema,
  normalizedIdentity: normalizedIdentitySchema,
  decision: decisionSchema,
  coupangOffer: coupangOfferSchema.nullable(),
  representativeImage: representativeImageSchema.nullable(),
  evidence: z.array(evidenceSchema).min(1),
  review: reviewSchema,
  plannedEffects: z.array(effectSchema),
  approval: approvalSchema,
  execution: executionSchema,
}).strict();

export type OfficialImageApprovalProposal = z.infer<typeof officialImageApprovalProposalSchema>;

function approvalStatement(proposal: OfficialImageApprovalProposal) {
  return [
    `영수증 ${proposal.receipt.sourceLabel}/${proposal.receipt.sourceProductCode}`,
    `공식 ${proposal.officialListing.channelId}/${proposal.officialListing.sourceProductCodeNamespace}:${proposal.officialListing.sourceProductCode}`,
    `${proposal.normalizedIdentity.brand} ${proposal.normalizedIdentity.productFamilyName} / ${proposal.normalizedIdentity.variantName}`,
    proposal.plannedEffects.join(","),
  ].join(" · ") + ` 연결을 승인합니다. [${proposal.approval.targetFingerprint}]`;
}

export async function buildOfficialImageApprovalExecution(rawProposal: unknown) {
  const proposal = officialImageApprovalProposalSchema.parse(rawProposal);
  const officialImage = proposal.officialListing.image;
  const representativeImage = proposal.representativeImage;
  const standardProductId = proposal.decision.standardProductId;
  const catalogProductId = proposal.decision.catalogProductId;
  const normalizedReceiptName = normalizeProductNameForExactMatch(proposal.receipt.sourceNameRaw);
  const normalizedOfficialName = normalizeProductNameForExactMatch(proposal.officialListing.sourceNameRaw);
  const importedOfficialFields = proposal.sameChannelNameRule.importedOfficialFields;
  const officialSourceId = [
    proposal.officialListing.channelId,
    proposal.officialListing.sourceProductCodeNamespace,
    proposal.officialListing.sourceProductCode,
  ].join(":");
  const hasReceiptEvidence = proposal.evidence.some((item) => (
    item.sourceType === "receipt"
    && item.authority === "transactional"
    && item.sourceId === `${proposal.receipt.receiptId}:${proposal.receipt.receiptItemId}`
  ));
  const hasOfficialEvidence = proposal.evidence.some((item) => (
    item.sourceType === "official_channel"
    && item.authority === "primary"
    && item.sourceId === officialSourceId
    && item.sourceRefs.some((sourceRef) => proposal.officialListing.sourceRefs.includes(sourceRef))
  ));
  if (
    proposal.decision.action !== "reuse_variant"
    || !standardProductId
    || !catalogProductId
    || proposal.coupangOffer !== null
    || !officialImage
    || !representativeImage
    || proposal.normalizedIdentity.brand === null
    || proposal.normalizedIdentity.productFamilyName === null
    || proposal.normalizedIdentity.variantName === null
    || proposal.normalizedIdentity.contentAmount === null
    || proposal.normalizedIdentity.contentUnit === null
    || proposal.normalizedIdentity.packageCount === null
    || proposal.receipt.sourceCatalogNamespace !== proposal.officialListing.channelId
    || normalizedReceiptName.length === 0
    || normalizedReceiptName !== normalizedOfficialName
    || proposal.sameChannelNameRule.sameChannel !== true
    || proposal.sameChannelNameRule.normalization !== "remove_unicode_whitespace_only"
    || proposal.sameChannelNameRule.normalizedReceiptName !== normalizedReceiptName
    || proposal.sameChannelNameRule.normalizedOfficialName !== normalizedOfficialName
    || proposal.sameChannelNameRule.exactNameMatch !== true
    || proposal.sameChannelNameRule.outcome !== "apply_official_identity"
    || importedOfficialFields.join(",") !== "brand,contentAmount,contentUnit,packageCount"
    || new Set(importedOfficialFields).size !== importedOfficialFields.length
    || proposal.decision.confidence !== "high"
    || proposal.decision.matchedFields.length === 0
    || proposal.decision.conflictingFields.length > 0
    || proposal.decision.missingFields.length > 0
    || !hasReceiptEvidence
    || !hasOfficialEvidence
    || proposal.review.verdict !== "approve"
    || proposal.review.reviewerAgent !== "pricetrace_independent_reviewer"
    || proposal.review.evidenceQuality !== "sufficient"
    || proposal.review.conflicts.length > 0
    || proposal.plannedEffects.join(",")
      !== "reuse_standard_family,reuse_catalog_variant,update_representative_image"
    || proposal.approval.status !== "approved"
    || proposal.approval.approvalRef === null
    || proposal.approval.userApprovalText === null
    || proposal.approval.approvedAt === null
    || proposal.execution.status !== "not_started"
  ) {
    throw new Error("승인된 공식 이미지 제안이 이미지 전용 실행 계약을 충족하지 않습니다.");
  }
  const inputCanonicalJson = canonicalJson({
    receipt: proposal.receipt,
    officialListing: proposal.officialListing,
  });
  const inputFingerprint = await sha256CanonicalJson(inputCanonicalJson);
  const targetCanonicalJson = canonicalJson({
    caseId: proposal.caseId,
    inputFingerprint,
    sameChannelNameRule: proposal.sameChannelNameRule,
    normalizedIdentity: proposal.normalizedIdentity,
    decision: proposal.decision,
    coupangOffer: proposal.coupangOffer,
    representativeImage: proposal.representativeImage,
    plannedEffects: proposal.plannedEffects,
  });
  const targetFingerprint = await sha256CanonicalJson(targetCanonicalJson);
  const expectedStatement = approvalStatement(proposal);

  if (
    proposal.receipt.sourceCatalogNamespace !== proposal.officialListing.channelId
    || proposal.inputFingerprint !== inputFingerprint
    || proposal.approval.targetFingerprint !== targetFingerprint
    || representativeImage.imageUrl !== officialImage.url
    || representativeImage.contentHash !== officialImage.contentHash
    || representativeImage.mediaType !== officialImage.mediaType
    || representativeImage.byteLength !== officialImage.byteLength
    || (representativeImage.action === "create"
      ? representativeImage.expectedCurrent !== null
      : representativeImage.expectedCurrent?.sourceType !== "external_url"
        || representativeImage.expectedCurrent.imageUrl !== representativeImage.imageUrl)
    || proposal.approval.userApprovalText !== expectedStatement
  ) {
    throw new Error("승인된 공식 이미지 제안이 현재 실행 대상과 일치하지 않습니다.");
  }

  return {
    proposal,
    approvalStatement: expectedStatement,
    rpcArgs: {
      p_idempotency_key: `standard-product-official-image:${targetFingerprint.slice("sha256:".length)}`,
      p_proposal_canonical_json: canonicalJson(proposal),
      p_approval_statement: expectedStatement,
      p_standard_product_id: standardProductId,
      p_catalog_product_id: catalogProductId,
    },
  };
}
