import type {
  CatalogContentUnit,
  CatalogSpecificationStatus,
} from "./catalog-specification";
import { inferOfficialPackageCount } from "./catalog-specification";
import { z } from "zod";

export type StrictCatalogVariant = {
  id: string;
  standardProductId: string;
  canonicalName: string;
  specificationStatus: CatalogSpecificationStatus;
  contentAmount: number;
  contentUnit: CatalogContentUnit;
  packageCount: number;
  referenceUnit: number;
};

export type StrictRegistrationIdentityInput = {
  caseId: string;
  receipt: {
    receiptId: string;
    receiptItemId: string;
    receiptRevision: string;
    sourceCatalogNamespace: string;
    sourceLabel: string;
    sourceProductCode: string;
    sourceNameRaw: string;
    observedAt: string;
    unitPriceKrw: number;
    quantity: number;
  };
  officialListing: {
    channelId: string;
    sourceProductCodeNamespace: string;
    sourceProductCode: string;
    snapshotId: string;
    snapshotHash: string;
    sourceNameRaw: string;
    specificationTextRaw: string;
    sourceRefs: string[];
    image: {
      url: string;
      contentHash: string;
      mediaType: string;
      byteLength: number;
    };
  };
  assessment: {
    decision: {
      confidence: "high" | "medium" | "low";
      matchedFields: string[];
      conflictingFields: string[];
      missingFields: string[];
    };
    evidence: StrictLinkProposalEvidence[];
    review: StrictLinkProposalReview;
  };
  target: {
    standardProductId: string | null;
    catalogProductId: string | null;
    standardName: string;
    listingName: string;
    brandName: string;
    receiptBrandName: string | null;
    officialBrandName: string;
    officialBrandSourceLabel: string;
    productReferenceUrl: string;
    specificationStatus: CatalogSpecificationStatus;
    contentAmount: number;
    contentUnit: CatalogContentUnit;
    packageCount: number;
    referenceUnit: number;
    coupangProductUrl: string;
    coupangListedPriceKrw: number;
    coupangQuantity: number;
    coupangContentAmount: number;
    coupangContentUnit: CatalogContentUnit;
    coupangMaxBundleQuantity: number | null;
    coupangMaxBundleListedPriceKrw: number | null;
    representativeImageAction: "create" | "reuse_exact";
    representativeImageExpectedCurrent: {
      sourceType: "external_url";
      imageUrl: string;
    } | null;
  };
};

export type StrictLinkProposalEvidence = {
  sourceType:
    | "receipt"
    | "official_channel"
    | "manufacturer"
    | "brand"
    | "retailer"
    | "coupang"
    | "database";
  sourceId: string;
  authority: "primary" | "secondary" | "transactional";
  url: string | null;
  capturedAt: string;
  claims: string[];
  sourceRefs: string[];
};

export type StrictLinkProposalReview = {
  verdict: "approve" | "needs_more_evidence" | "reject";
  reviewerAgent: string;
  counterCandidates: string[];
  conflicts: string[];
  evidenceQuality: "sufficient" | "partial" | "insufficient";
  notes: string[];
};

export type StandardProductLinkEffect =
  | "reuse_standard_family"
  | "create_standard_family"
  | "reuse_catalog_variant"
  | "create_catalog_variant"
  | "link_official_listing"
  | "verify_receipt_mapping"
  | "register_coupang_offer"
  | "update_representative_image";

const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const evidenceSchema = z.object({
  sourceType: z.enum([
    "receipt",
    "official_channel",
    "manufacturer",
    "brand",
    "retailer",
    "coupang",
    "database",
  ]),
  sourceId: z.string().min(1),
  authority: z.enum(["primary", "secondary", "transactional"]),
  url: z.string().url().nullable(),
  capturedAt: z.string().min(1),
  claims: z.array(z.string().min(1)).min(1),
  sourceRefs: z.array(z.string().min(1)).min(1),
}).passthrough();
const reviewSchema = z.object({
  verdict: z.enum(["approve", "needs_more_evidence", "reject"]),
  reviewerAgent: z.string().min(1),
  counterCandidates: z.array(z.string()),
  conflicts: z.array(z.string()),
  evidenceQuality: z.enum(["sufficient", "partial", "insufficient"]),
  notes: z.array(z.string()),
}).passthrough();
const decisionSchema = z.object({
  action: z.enum([
    "reuse_variant",
    "create_variant",
    "create_family_and_variant",
    "insufficient_evidence",
    "reject",
  ]),
  standardProductId: z.string().nullable(),
  catalogProductId: z.string().nullable(),
  proposedStandardName: z.string().nullable(),
  proposedVariantName: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  matchedFields: z.array(z.string()),
  conflictingFields: z.array(z.string()),
  missingFields: z.array(z.string()),
}).passthrough();
const reviewedLinkProposalSchema = z.object({
  schemaVersion: z.literal("pricetrace-link-proposal.v3"),
  caseId: z.string().min(1),
  status: z.literal("approval_requested"),
  inputFingerprint: fingerprintSchema,
  receipt: z.object({
    receiptId: z.string().min(1),
    receiptItemId: z.string().min(1),
    receiptRevision: z.string().min(1),
    sourceCatalogNamespace: z.string().nullable(),
    sourceLabel: z.string().min(1),
    sourceProductCode: z.string().min(1),
    sourceNameRaw: z.string().min(1),
    observedAt: z.string().min(1),
    unitPriceKrw: z.number().int().nonnegative(),
    quantity: z.number().int().positive(),
  }).passthrough(),
  officialListing: z.object({
    channelId: z.string().min(1),
    sourceProductCodeNamespace: z.string().min(1),
    sourceProductCode: z.string().min(1),
    snapshotId: z.string().min(1),
    snapshotHash: fingerprintSchema,
    sourceNameRaw: z.string().min(1),
    specificationTextRaw: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).min(1),
    image: z.object({
      url: z.string().url().refine((url) => url.startsWith("https://")),
      contentHash: fingerprintSchema,
      mediaType: z.string().regex(/^image\/(?:jpeg|png|webp)$/),
      byteLength: z.number().int().positive(),
    }),
  }).passthrough(),
  sameChannelNameRule: z.object({
    sameChannel: z.boolean(),
    normalization: z.literal("remove_unicode_whitespace_only"),
    normalizedReceiptName: z.string().min(1),
    normalizedOfficialName: z.string().min(1),
    exactNameMatch: z.boolean(),
    outcome: z.enum(["apply_official_identity", "discovery_only", "not_applicable"]),
    importedOfficialFields: z.array(z.string()),
  }).passthrough(),
  normalizedIdentity: z.object({
    brand: z.string().nullable(),
    productFamilyName: z.string().nullable(),
    variantName: z.string().nullable(),
    contentAmount: z.number().positive().nullable(),
    contentUnit: z.enum(["g", "ml", "each"]).nullable(),
    packageCount: z.number().int().positive().nullable(),
    gtin: z.string().nullable(),
  }).passthrough(),
  decision: decisionSchema,
  coupangOffer: z.object({
    url: z.string().url(),
    totalPriceKrw: z.number().int().positive(),
    quantity: z.number().int().positive(),
    contentAmount: z.number().positive(),
    contentUnit: z.enum(["g", "ml", "each"]),
    observedAt: z.string().min(1),
    maxBundleQuantity: z.number().int().positive().nullable(),
    maxBundleTotalPriceKrw: z.number().int().positive().nullable(),
  }).passthrough(),
  representativeImage: z.object({
    scope: z.literal("standard_product_family"),
    action: z.enum(["create", "reuse_exact"]),
    sourceType: z.literal("external_url"),
    imageUrl: z.string().url().refine((url) => url.startsWith("https://")),
    contentHash: fingerprintSchema,
    mediaType: z.string().regex(/^image\/(?:jpeg|png|webp)$/),
    byteLength: z.number().int().positive(),
    expectedCurrent: z.object({
      sourceType: z.literal("external_url"),
      imageUrl: z.string().url().refine((url) => url.startsWith("https://")),
    }).nullable(),
  }),
  evidence: z.array(evidenceSchema).min(1),
  review: reviewSchema,
  plannedEffects: z.array(z.enum([
    "reuse_standard_family",
    "create_standard_family",
    "reuse_catalog_variant",
    "create_catalog_variant",
    "link_official_listing",
    "verify_receipt_mapping",
    "register_coupang_offer",
    "update_representative_image",
  ])).min(1),
  approval: z.object({
    status: z.literal("requested"),
    targetFingerprint: fingerprintSchema,
  }).passthrough(),
  execution: z.object({
    status: z.literal("not_started"),
    idempotencyKey: z.string().min(1),
    appliedAt: z.null(),
    result: z.null(),
  }).passthrough(),
}).passthrough();

export type ReviewedLinkProposal = z.infer<typeof reviewedLinkProposalSchema>;
type ReviewedLinkProposalTarget = Pick<
  ReviewedLinkProposal,
  | "caseId"
  | "inputFingerprint"
  | "sameChannelNameRule"
  | "normalizedIdentity"
  | "decision"
  | "coupangOffer"
  | "representativeImage"
  | "plannedEffects"
>;

export function normalizeProductNameForExactMatch(value: string) {
  return value.replace(/\p{White_Space}+/gu, "");
}

export function receiptAndOfficialNamesMatch(receiptName: string, officialName: string) {
  const normalizedReceipt = normalizeProductNameForExactMatch(receiptName);
  return normalizedReceipt.length > 0
    && normalizedReceipt === normalizeProductNameForExactMatch(officialName);
}

export function findUniqueOfficialExactNameMatch<T extends { sourceNameRaw: string }>(
  listings: T[],
  receiptName: string,
) {
  const expectedName = normalizeProductNameForExactMatch(receiptName);
  const matches = listings.filter(
    (listing) => normalizeProductNameForExactMatch(listing.sourceNameRaw) === expectedName,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function findExpectedCatalogProductId(
  variants: StrictCatalogVariant[],
  expected: Omit<StrictCatalogVariant, "id">,
) {
  const matches = variants.filter((variant) => (
    variant.standardProductId === expected.standardProductId
    && normalizeProductNameForExactMatch(variant.canonicalName)
      === normalizeProductNameForExactMatch(expected.canonicalName)
    && variant.specificationStatus === expected.specificationStatus
    && variant.contentAmount === expected.contentAmount
    && variant.contentUnit === expected.contentUnit
    && variant.packageCount === expected.packageCount
    && variant.referenceUnit === expected.referenceUnit
  ));
  if (matches.length > 1) {
    throw new Error("동일한 표준 판매 규격이 여러 건입니다. 중복을 먼저 정리하세요.");
  }
  return matches[0]?.id ?? null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export async function sha256CanonicalJson(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function reviewedLinkProposalTargetFingerprint(
  proposal: ReviewedLinkProposalTarget,
) {
  return sha256CanonicalJson(canonicalJson({
    caseId: proposal.caseId,
    inputFingerprint: proposal.inputFingerprint,
    sameChannelNameRule: proposal.sameChannelNameRule,
    normalizedIdentity: proposal.normalizedIdentity,
    decision: proposal.decision,
    coupangOffer: proposal.coupangOffer,
    representativeImage: proposal.representativeImage,
    plannedEffects: proposal.plannedEffects,
  }));
}

export async function parseReviewedLinkProposal(
  rawJson: string,
  expected: Pick<StrictRegistrationIdentityInput, "caseId" | "receipt" | "officialListing">,
): Promise<ReviewedLinkProposal> {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch {
    throw new Error("검토된 LinkProposal JSON 형식이 올바르지 않습니다.");
  }
  const parsed = reviewedLinkProposalSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("검토된 LinkProposal v3의 필수 필드가 완전하지 않습니다.");
  }
  const proposal = parsed.data;
  if (
    proposal.representativeImage.imageUrl !== proposal.officialListing.image.url
    || proposal.representativeImage.contentHash !== proposal.officialListing.image.contentHash
    || proposal.representativeImage.mediaType !== proposal.officialListing.image.mediaType
    || proposal.representativeImage.byteLength !== proposal.officialListing.image.byteLength
    || !proposal.plannedEffects.includes("update_representative_image")
    || (proposal.representativeImage.action === "create"
      ? proposal.representativeImage.expectedCurrent !== null
      : proposal.representativeImage.expectedCurrent?.sourceType !== "external_url"
        || proposal.representativeImage.expectedCurrent?.imageUrl !== proposal.representativeImage.imageUrl)
  ) {
    throw new Error("LinkProposal의 공식 이미지·대표 이미지 효과가 일치하지 않습니다.");
  }
  const expectedInputCanonicalJson = canonicalJson({
    receipt: expected.receipt,
    officialListing: expected.officialListing,
  });
  const proposalInputCanonicalJson = canonicalJson({
    receipt: proposal.receipt,
    officialListing: proposal.officialListing,
  });
  const proposalInputFingerprint = await sha256CanonicalJson(proposalInputCanonicalJson);
  if (
    proposal.caseId !== expected.caseId
    || proposalInputCanonicalJson !== expectedInputCanonicalJson
    || proposal.inputFingerprint !== proposalInputFingerprint
  ) {
    throw new Error("LinkProposal의 동결 입력이 현재 영수증·공식 상품 기록과 일치하지 않습니다.");
  }

  const reviewedTargetFingerprint = await reviewedLinkProposalTargetFingerprint(proposal);
  if (proposal.approval.targetFingerprint !== reviewedTargetFingerprint) {
    throw new Error("LinkProposal의 검토 대상 지문이 유효하지 않습니다.");
  }
  return proposal;
}

export function assertReviewedProposalMatchesExecutionTarget(
  proposal: ReviewedLinkProposal,
  targetCanonicalJson: string,
) {
  const target = JSON.parse(targetCanonicalJson) as {
    sameChannelNameRule: unknown;
    normalizedIdentity: Record<string, unknown>;
    decision: unknown;
    coupangOffer: unknown;
    representativeImage: unknown;
    plannedEffects: unknown;
  };
  const targetIdentity = {
    brand: target.normalizedIdentity.brand,
    productFamilyName: target.normalizedIdentity.productFamilyName,
    variantName: target.normalizedIdentity.variantName,
    contentAmount: target.normalizedIdentity.contentAmount,
    contentUnit: target.normalizedIdentity.contentUnit,
    packageCount: target.normalizedIdentity.packageCount,
    gtin: target.normalizedIdentity.gtin,
  };
  const targetCoupangOffer = target.coupangOffer as {
    productUrl: string;
    listedPriceKrw: number;
    quantity: number;
    contentAmount: number;
    contentUnit: CatalogContentUnit;
    maxBundleQuantity: number | null;
    maxBundleListedPriceKrw: number | null;
  };
  const proposalCoupangOffer = {
    productUrl: proposal.coupangOffer.url,
    listedPriceKrw: proposal.coupangOffer.totalPriceKrw,
    quantity: proposal.coupangOffer.quantity,
    contentAmount: proposal.coupangOffer.contentAmount,
    contentUnit: proposal.coupangOffer.contentUnit,
    maxBundleQuantity: proposal.coupangOffer.maxBundleQuantity,
    maxBundleListedPriceKrw: proposal.coupangOffer.maxBundleTotalPriceKrw,
  };
  if (
    canonicalJson(proposal.sameChannelNameRule) !== canonicalJson(target.sameChannelNameRule)
    || canonicalJson(proposal.normalizedIdentity) !== canonicalJson(targetIdentity)
    || canonicalJson(proposal.decision) !== canonicalJson(target.decision)
    || canonicalJson(proposalCoupangOffer) !== canonicalJson(targetCoupangOffer)
    || canonicalJson(proposal.representativeImage) !== canonicalJson(target.representativeImage)
    || canonicalJson(proposal.plannedEffects) !== canonicalJson(target.plannedEffects)
  ) {
    throw new Error("독립 검토 대상과 현재 적용 대상·효과가 일치하지 않습니다.");
  }
}

export function parseOfficialSpecification(value: string): {
  contentAmount: number;
  contentUnit: CatalogContentUnit;
} | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(g|ml|each|개)$/iu);
  if (!match) return null;
  const contentAmount = Number(match[1]);
  if (!Number.isFinite(contentAmount) || contentAmount <= 0) return null;
  const rawUnit = match[2].toLocaleLowerCase("en-US");
  const contentUnit: CatalogContentUnit = rawUnit === "개" || rawUnit === "each"
    ? "each"
    : rawUnit as CatalogContentUnit;
  return { contentAmount, contentUnit };
}

function hasExplicitPackageCount(value: string) {
  return /(?:[xX×*]\s*\d+|\d+\s*(?:개입|입|팩))/u.test(value);
}

function assertCompleteAssessment(input: StrictRegistrationIdentityInput) {
  const { decision, evidence, review } = input.assessment;
  if (
    review.verdict !== "approve"
    || review.reviewerAgent !== "pricetrace_independent_reviewer"
    || review.evidenceQuality !== "sufficient"
    || review.conflicts.length > 0
    || decision.conflictingFields.length > 0
    || decision.missingFields.length > 0
    || decision.confidence !== "high"
    || decision.matchedFields.length === 0
  ) {
    throw new Error("독립 검토가 승인되지 않았거나 충돌·필수 누락이 남아 있습니다.");
  }

  const receiptSourceId = `${input.receipt.receiptId}:${input.receipt.receiptItemId}`;
  const officialSourceId = [
    input.officialListing.channelId,
    input.officialListing.sourceProductCodeNamespace,
    input.officialListing.sourceProductCode,
  ].join(":");
  const hasRequiredEvidence = (
    evidence.some((item) => (
      item.sourceType === "receipt"
      && item.authority === "transactional"
      && item.sourceId === receiptSourceId
      && item.claims.length > 0
      && item.sourceRefs.length > 0
    ))
    && evidence.some((item) => (
      item.sourceType === "official_channel"
      && item.authority === "primary"
      && item.sourceId === officialSourceId
      && item.claims.length > 0
      && item.sourceRefs.length > 0
      && input.officialListing.sourceRefs.some((sourceRef) => item.sourceRefs.includes(sourceRef))
    ))
    && evidence.some((item) => (
      item.sourceType === "coupang"
      && item.url === input.target.coupangProductUrl
      && item.claims.length > 0
      && item.sourceRefs.length > 0
    ))
  );
  if (!hasRequiredEvidence) {
    throw new Error("영수증·공식 상품·쿠팡 정확 옵션 근거가 모두 필요합니다.");
  }
}

export async function buildStrictRegistrationIdentity(input: StrictRegistrationIdentityInput) {
  if (input.receipt.sourceCatalogNamespace !== input.officialListing.channelId) {
    throw new Error("영수증 판매처와 공식 상품의 카탈로그 채널이 일치하지 않습니다.");
  }
  const normalizedReceiptName = normalizeProductNameForExactMatch(input.receipt.sourceNameRaw);
  const normalizedOfficialName = normalizeProductNameForExactMatch(input.officialListing.sourceNameRaw);
  if (!normalizedReceiptName || normalizedReceiptName !== normalizedOfficialName) {
    throw new Error("영수증명과 공식 상품명이 공백 제거 후 일치하지 않습니다.");
  }
  if (
    !input.officialListing.image.url.startsWith("https://")
    || !/^sha256:[a-f0-9]{64}$/.test(input.officialListing.image.contentHash)
    || !/^image\/(?:jpeg|png|webp)$/.test(input.officialListing.image.mediaType)
    || !Number.isInteger(input.officialListing.image.byteLength)
    || input.officialListing.image.byteLength <= 0
  ) {
    throw new Error("공식 상품의 검증된 HTTPS 대표 이미지 근거가 필요합니다.");
  }
  if (
    input.target.representativeImageAction === "create"
      ? input.target.representativeImageExpectedCurrent !== null
      : input.target.representativeImageExpectedCurrent?.sourceType !== "external_url"
        || input.target.representativeImageExpectedCurrent?.imageUrl !== input.officialListing.image.url
  ) {
    throw new Error("대표 이미지 생성·정확 재사용 상태가 현재 표준 상품과 일치하지 않습니다.");
  }
  assertCompleteAssessment(input);
  if (input.target.specificationStatus !== "verified") {
    throw new Error("공식 근거와 일치하는 검증된 규격만 연결할 수 있습니다.");
  }
  const parsedOfficialSpecification = parseOfficialSpecification(
    input.officialListing.specificationTextRaw,
  );
  if (!parsedOfficialSpecification) {
    throw new Error("공식 규격 원문을 내용량과 단위로 엄격하게 해석할 수 없습니다.");
  }
  const officialPackageCount = inferOfficialPackageCount(input.officialListing.sourceNameRaw);
  if (
    parsedOfficialSpecification.contentAmount !== input.target.contentAmount
    || parsedOfficialSpecification.contentUnit !== input.target.contentUnit
    || officialPackageCount !== input.target.packageCount
  ) {
    throw new Error("공식 규격 원문과 적용할 내용량·단위·개수가 일치하지 않습니다.");
  }
  if (
    input.target.coupangContentAmount !== input.target.contentAmount
    || input.target.coupangContentUnit !== input.target.contentUnit
  ) {
    throw new Error("쿠팡 정확 옵션의 개당 규격이 적용할 판매 규격과 일치하지 않습니다.");
  }
  const receipt = {
    ...input.receipt,
    receiptId: input.receipt.receiptId.trim(),
    receiptItemId: input.receipt.receiptItemId.trim(),
    receiptRevision: input.receipt.receiptRevision.trim(),
    sourceLabel: input.receipt.sourceLabel.trim(),
    sourceProductCode: input.receipt.sourceProductCode.trim(),
  };
  const officialListing = {
    ...input.officialListing,
    sourceRefs: [...input.officialListing.sourceRefs],
    image: { ...input.officialListing.image },
  };
  const inputCanonicalJson = canonicalJson({ receipt, officialListing });
  const inputFingerprint = await sha256CanonicalJson(inputCanonicalJson);
  const sameChannelNameRule = {
    sameChannel: true,
    normalization: "remove_unicode_whitespace_only",
    normalizedReceiptName,
    normalizedOfficialName,
    exactNameMatch: true,
    outcome: "apply_official_identity",
    importedOfficialFields: ["brand", "contentAmount", "contentUnit", "packageCount"],
  };
  const officialSpecificationCheck = {
    specificationTextRaw: input.officialListing.specificationTextRaw,
    parsedContentAmount: parsedOfficialSpecification.contentAmount,
    parsedContentUnit: parsedOfficialSpecification.contentUnit,
    parsedPackageCount: officialPackageCount,
    packageCountBasis: hasExplicitPackageCount(input.officialListing.sourceNameRaw)
      ? "explicit"
      : "default_one_absent_count",
    matchesTarget: true,
  };
  const normalizedIdentity = {
    brand: input.target.brandName,
    productFamilyName: input.target.standardName,
    variantName: input.target.listingName,
    specificationStatus: input.target.specificationStatus,
    contentAmount: input.target.contentAmount,
    contentUnit: input.target.contentUnit,
    packageCount: input.target.packageCount,
    referenceUnit: input.target.referenceUnit,
    gtin: null,
  };
  const brandEvidence = {
    canonicalName: input.target.brandName,
    receiptObservedName: input.target.receiptBrandName,
    officialObservedName: input.target.officialBrandName,
    officialSourceLabel: input.target.officialBrandSourceLabel,
    productReferenceUrl: input.target.productReferenceUrl,
  };
  const decisionAction = input.target.catalogProductId
    ? "reuse_variant"
    : input.target.standardProductId
      ? "create_variant"
      : "create_family_and_variant";
  const decision = {
    action: decisionAction,
    standardProductId: input.target.standardProductId,
    catalogProductId: input.target.catalogProductId,
    proposedStandardName: input.target.standardProductId ? null : input.target.standardName,
    proposedVariantName: input.target.catalogProductId ? null : input.target.listingName,
    confidence: input.assessment.decision.confidence,
    matchedFields: [...input.assessment.decision.matchedFields],
    conflictingFields: [...input.assessment.decision.conflictingFields],
    missingFields: [...input.assessment.decision.missingFields],
  };
  const coupangOffer = {
    productUrl: input.target.coupangProductUrl,
    listedPriceKrw: input.target.coupangListedPriceKrw,
    quantity: input.target.coupangQuantity,
    contentAmount: input.target.coupangContentAmount,
    contentUnit: input.target.coupangContentUnit,
    maxBundleQuantity: input.target.coupangMaxBundleQuantity,
    maxBundleListedPriceKrw: input.target.coupangMaxBundleListedPriceKrw,
  };
  const representativeImage = {
    scope: "standard_product_family",
    action: input.target.representativeImageAction,
    sourceType: "external_url",
    imageUrl: input.officialListing.image.url,
    contentHash: input.officialListing.image.contentHash,
    mediaType: input.officialListing.image.mediaType,
    byteLength: input.officialListing.image.byteLength,
    expectedCurrent: input.target.representativeImageExpectedCurrent,
  };
  const plannedEffects: StandardProductLinkEffect[] = [
    input.target.standardProductId ? "reuse_standard_family" : "create_standard_family",
    input.target.catalogProductId ? "reuse_catalog_variant" : "create_catalog_variant",
    "link_official_listing",
    "verify_receipt_mapping",
    "register_coupang_offer",
    "update_representative_image",
  ];
  const target = {
    caseId: input.caseId.trim(),
    inputFingerprint,
    approvalPolicy: {
      mode: "authenticated_admin_explicit_second_step",
      requiredStatementPrefix: "APPROVE_STANDARD_PRODUCT_LINK",
      statementTemplateVersion: "link-approval-ko-v1",
      oneTimeTargetFingerprint: true,
    },
    sameChannelNameRule,
    officialSpecificationCheck,
    normalizedIdentity,
    brandEvidence,
    decision,
    coupangOffer,
    representativeImage,
    evidence: input.assessment.evidence.map((item) => ({
      ...item,
      claims: [...item.claims],
      sourceRefs: [...item.sourceRefs],
    })),
    review: {
      ...input.assessment.review,
      counterCandidates: [...input.assessment.review.counterCandidates],
      conflicts: [...input.assessment.review.conflicts],
      notes: [...input.assessment.review.notes],
    },
    plannedEffects,
  };
  const targetCanonicalJson = canonicalJson(target);
  const targetFingerprint = await sha256CanonicalJson(targetCanonicalJson);
  const approvalStatement = [
    `영수증 ${receipt.sourceLabel}/${receipt.sourceProductCode}`,
    `공식 ${officialListing.channelId}/${officialListing.sourceProductCodeNamespace}:${officialListing.sourceProductCode}`,
    `${input.target.brandName} ${input.target.standardName} / ${input.target.listingName}`,
    plannedEffects.join(","),
  ].join(" · ") + ` 연결을 승인합니다. [${targetFingerprint}]`;
  return {
    caseId: input.caseId.trim(),
    inputFingerprint,
    targetFingerprint,
    inputCanonicalJson,
    targetCanonicalJson,
    idempotencyKey: `standard-product-link:${targetFingerprint.slice("sha256:".length)}`,
    approvalStatement,
  };
}
