import type {
  CatalogContentUnit,
  CatalogSpecificationStatus,
} from "./catalog-specification";
import { inferOfficialPackageCount } from "./catalog-specification";
import {
  parseOfficialApparelSize,
  type ApparelSize,
} from "./apparel-size";
import { z } from "zod";

export type StrictCatalogVariant = {
  id: string;
  standardProductId: string;
  canonicalName: string;
  specification: string;
  attributes: Record<string, unknown>;
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
    officialPrice?: {
      amountKrw: number;
      sourceText: string;
      observedAt: string;
    } | null;
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
  verifiedNameEquivalence?: VerifiedNameEquivalence | null;
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

export type RegistrationAssessmentMode = "independent" | "admin_direct";

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

export type LinkOnlyRegistrationIdentityInput = Omit<
  StrictRegistrationIdentityInput,
  "target"
> & {
  userSelectedOfficialVariant?: UserSelectedOfficialVariant | null;
  target: Omit<
    StrictRegistrationIdentityInput["target"],
    | "coupangProductUrl"
    | "coupangListedPriceKrw"
    | "coupangQuantity"
    | "coupangContentAmount"
    | "coupangContentUnit"
    | "coupangMaxBundleQuantity"
    | "coupangMaxBundleListedPriceKrw"
  > & {
    apparelSize: ApparelSize | null;
    kitComponents?: CompositeKitComponent[] | null;
    wiperBladeFitment?: WiperBladeFitment | null;
  };
};

export type WiperBladeFitment = {
  lengthMm: number;
};

export type CompositeKitComponent = {
  componentType: "razor_handle" | "razor_blade";
  quantity: number;
  unit: "each";
};

export type UserSelectedOfficialVariant = {
  scope: "frozen_receipt_official_pair_only";
  selectedReceiptSourceId: string;
  selectedOfficialSourceId: string;
  selectedSpecificationTextRaw: string;
  selectionSourceRef: string;
  selectionContentHash: string;
  selectedAt: string;
};

type VerifiedNameEquivalenceBase = {
  scope: "frozen_receipt_official_pair_only";
  supportingEvidenceSourceIds: string[];
  supportingSourceRefs: string[];
  reviewerAgent: "pricetrace_independent_reviewer";
  reviewedAt: string;
  conclusion: "same_exact_sellable_variant";
};

export type VerifiedNameEquivalence = VerifiedNameEquivalenceBase & (
  | {
    method: "single_unicode_code_point_substitution_v1";
    zeroBasedCodePointIndex: number;
    receiptCodePoint: string;
    officialCodePoint: string;
  }
  | {
    method: "single_unicode_code_point_insertion_deletion_v1";
    editDirection: "insert_official_code_point_into_receipt" | "delete_receipt_code_point";
    zeroBasedEditIndex: number;
    editedCodePoint: string;
    receiptCodePointLength: number;
    officialCodePointLength: number;
    discoverySimilarityBasisPoints: number;
    uniqueOfficialCandidate: true;
  }
  | {
    method: "official_name_contains_receipt_name_v1";
    zeroBasedOfficialCodePointIndex: number;
    receiptCodePointLength: number;
    officialCodePointLength: number;
    officialPrefix: string;
    officialSuffix: string;
    officialDisplayedPriceKrw: number;
    officialPriceObservedAt: string;
    uniqueOfficialCandidate: true;
  }
  | {
    method: "explicit_user_selected_frozen_pair_v1";
    selectedReceiptSourceId: string;
    selectedOfficialSourceId: string;
    selectedNormalizedReceiptName: string;
    selectedNormalizedOfficialName: string;
    userSelectionSourceRef: string;
    userSelectionContentHash: string;
  }
);

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
const verifiedNameEquivalenceBaseSchema = z.object({
  scope: z.literal("frozen_receipt_official_pair_only"),
  supportingEvidenceSourceIds: z.array(z.string().min(1)).min(2),
  supportingSourceRefs: z.array(z.string().min(1)).min(2),
  reviewerAgent: z.literal("pricetrace_independent_reviewer"),
  reviewedAt: z.string().datetime({ offset: true }),
  conclusion: z.literal("same_exact_sellable_variant"),
});
const verifiedNameEquivalenceSchema = z.discriminatedUnion("method", [
  verifiedNameEquivalenceBaseSchema.extend({
    method: z.literal("single_unicode_code_point_substitution_v1"),
    zeroBasedCodePointIndex: z.number().int().nonnegative(),
    receiptCodePoint: z.string().min(1),
    officialCodePoint: z.string().min(1),
  }).strict(),
  verifiedNameEquivalenceBaseSchema.extend({
    method: z.literal("single_unicode_code_point_insertion_deletion_v1"),
    editDirection: z.enum([
      "insert_official_code_point_into_receipt",
      "delete_receipt_code_point",
    ]),
    zeroBasedEditIndex: z.number().int().nonnegative(),
    editedCodePoint: z.string().min(1),
    receiptCodePointLength: z.number().int().positive(),
    officialCodePointLength: z.number().int().positive(),
    discoverySimilarityBasisPoints: z.number().int().min(9000).max(10000),
    uniqueOfficialCandidate: z.literal(true),
  }).strict(),
  verifiedNameEquivalenceBaseSchema.extend({
    method: z.literal("official_name_contains_receipt_name_v1"),
    zeroBasedOfficialCodePointIndex: z.number().int().nonnegative(),
    receiptCodePointLength: z.number().int().positive(),
    officialCodePointLength: z.number().int().positive(),
    officialPrefix: z.string(),
    officialSuffix: z.string(),
    officialDisplayedPriceKrw: z.number().int().nonnegative(),
    officialPriceObservedAt: z.string().datetime({ offset: true }),
    uniqueOfficialCandidate: z.literal(true),
  }).strict(),
  verifiedNameEquivalenceBaseSchema.extend({
    method: z.literal("explicit_user_selected_frozen_pair_v1"),
    selectedReceiptSourceId: z.string().min(1),
    selectedOfficialSourceId: z.string().min(1),
    selectedNormalizedReceiptName: z.string().min(1),
    selectedNormalizedOfficialName: z.string().min(1),
    userSelectionSourceRef: z.string().min(1),
    userSelectionContentHash: fingerprintSchema,
  }).strict(),
]);
const sameChannelNameRuleSchema = z.object({
  sameChannel: z.boolean(),
  normalization: z.literal("remove_unicode_whitespace_only"),
  normalizedReceiptName: z.string().min(1),
  normalizedOfficialName: z.string().min(1),
  exactNameMatch: z.boolean(),
  outcome: z.enum([
    "apply_official_identity",
    "apply_verified_name_equivalence",
    "discovery_only",
    "not_applicable",
  ]),
  importedOfficialFields: z.array(z.string()),
  verifiedEquivalence: verifiedNameEquivalenceSchema.optional(),
}).strict();
const representativeImageSchema = z.object({
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
}).passthrough();
const effectSchema = z.enum([
  "reuse_standard_family",
  "create_standard_family",
  "reuse_catalog_variant",
  "create_catalog_variant",
  "link_official_listing",
  "verify_receipt_mapping",
  "register_coupang_offer",
  "update_representative_image",
]);
const apparelSizeSchema = z.object({
  alpha: z.enum(["S", "M", "L", "XL", "XXL", "XXXL"]),
  kr: z.union([
    z.literal(90),
    z.literal(95),
    z.literal(100),
    z.literal(105),
    z.literal(110),
    z.literal(115),
  ]),
  label: z.enum(["S(90)", "M(95)", "L(100)", "XL(105)", "XXL(110)", "XXXL(115)"]),
}).strict().superRefine((size, context) => {
  if (`${size.alpha}(${size.kr})` !== size.label) {
    context.addIssue({
      code: "custom",
      message: "의류 영문 사이즈와 한국 호칭이 일치하지 않습니다.",
      path: ["label"],
    });
  }
});
const contentSpecificationCheckSchema = z.object({
  kind: z.literal("content").optional(),
  specificationTextRaw: z.string().min(1),
  parsedContentAmount: z.number().positive(),
  parsedContentUnit: z.enum(["g", "ml", "each"]),
  parsedPackageCount: z.number().int().positive(),
  packageCountBasis: z.enum(["explicit", "default_one_absent_count"]),
  matchesTarget: z.literal(true),
}).passthrough();
const structuredContentSpecificationCheckSchema = z.object({
  kind: z.literal("structured_content"),
  specificationTextRaw: z.string().min(1),
  parseRule: z.enum([
    "count_only_v1",
    "per_item_times_count_v1",
    "per_item_times_count_with_total_v1",
    "total_amount_per_count_v1",
    "numeric_spec_unit_from_official_name_v1",
  ]),
  parsedContentAmount: z.number().positive(),
  parsedContentUnit: z.enum(["g", "ml", "each"]),
  parsedPackageCount: z.number().int().positive(),
  packageCountBasis: z.enum([
    "explicit_specification",
    "default_one_absent_count",
  ]),
  parsedTotalContentAmount: z.number().positive().optional(),
  matchedOfficialNameFragment: z.string().min(1).optional(),
  matchesTarget: z.literal(true),
}).passthrough();
const apparelSpecificationCheckSchema = z.object({
  kind: z.literal("apparel_size"),
  specificationTextRaw: z.string().min(1),
  parsedApparelSize: apparelSizeSchema,
  matchesTarget: z.literal(true),
}).passthrough();
const compositeKitComponentSchema = z.object({
  componentType: z.enum(["razor_handle", "razor_blade"]),
  quantity: z.number().int().positive(),
  unit: z.literal("each"),
}).strict();
const compositeKitSpecificationCheckSchema = z.object({
  kind: z.literal("composite_kit"),
  specificationTextRaw: z.string().min(1),
  parseRule: z.literal("razor_handle_blade_kit_v1"),
  parsedSellableContentAmount: z.literal(1),
  parsedSellableContentUnit: z.literal("each"),
  parsedSellablePackageCount: z.literal(1),
  kitComponents: z.array(compositeKitComponentSchema).length(2),
  matchesTarget: z.literal(true),
}).strict();
const wiperBladeFitmentSchema = z.object({
  lengthMm: z.number().int().min(250).max(800),
}).strict();
const wiperBladeSpecificationCheckSchema = z.object({
  kind: z.literal("wiper_blade_fitment"),
  specificationTextRaw: z.string().min(1),
  parsedWiperBladeFitment: wiperBladeFitmentSchema,
  matchesTarget: z.literal(true),
}).strict();
const userSelectedOfficialVariantSchema = z.object({
  scope: z.literal("frozen_receipt_official_pair_only"),
  selectedReceiptSourceId: z.string().min(1),
  selectedOfficialSourceId: z.string().min(1),
  selectedSpecificationTextRaw: z.string().min(1),
  selectionSourceRef: z.string().min(1),
  selectionContentHash: fingerprintSchema,
  selectedAt: z.string().datetime({ offset: true }),
}).strict();
const strictExecutionTargetSchema = z.object({
  executionMode: z.enum(["strict_v6", "link_only_v1"]).optional(),
  caseId: z.string().min(1),
  inputFingerprint: fingerprintSchema,
  approvalPolicy: z.object({
    mode: z.enum([
      "authenticated_admin_explicit_second_step",
      "authenticated_admin_direct_registration",
    ]),
    requiredStatementPrefix: z.literal("APPROVE_STANDARD_PRODUCT_LINK"),
    statementTemplateVersion: z.literal("link-approval-ko-v1"),
    oneTimeTargetFingerprint: z.literal(true),
  }).passthrough(),
  sameChannelNameRule: sameChannelNameRuleSchema,
  userSelectedOfficialVariant: userSelectedOfficialVariantSchema.optional(),
  officialSpecificationCheck: z.union([
    contentSpecificationCheckSchema,
    structuredContentSpecificationCheckSchema,
    apparelSpecificationCheckSchema,
    compositeKitSpecificationCheckSchema,
    wiperBladeSpecificationCheckSchema,
  ]),
  normalizedIdentity: z.object({
    brand: z.string().min(1),
    productFamilyName: z.string().min(1),
    variantName: z.string().min(1),
    specificationStatus: z.literal("verified"),
    contentAmount: z.number().positive(),
    contentUnit: z.enum(["g", "ml", "each"]),
    packageCount: z.number().int().positive(),
    referenceUnit: z.union([z.literal(10), z.literal(100), z.literal(1000)]),
    gtin: z.null(),
    apparelSize: apparelSizeSchema.nullable().optional(),
    kitComponents: z.array(compositeKitComponentSchema).length(2).nullable().optional(),
    wiperBladeFitment: wiperBladeFitmentSchema.nullable().optional(),
  }).passthrough(),
  brandEvidence: z.object({
    canonicalName: z.string().min(1),
    receiptObservedName: z.string().min(1).nullable(),
    officialObservedName: z.string().min(1),
    officialSourceLabel: z.string().min(1),
    productReferenceUrl: z.string().url(),
  }).passthrough(),
  decision: decisionSchema,
  coupangOffer: z.object({
    productUrl: z.string().url(),
    listedPriceKrw: z.number().int().positive(),
    quantity: z.number().int().positive(),
    contentAmount: z.number().positive(),
    contentUnit: z.enum(["g", "ml", "each"]),
    maxBundleQuantity: z.number().int().positive().nullable(),
    maxBundleListedPriceKrw: z.number().int().positive().nullable(),
  }).passthrough().nullable(),
  representativeImage: representativeImageSchema,
  evidence: z.array(evidenceSchema).min(1),
  review: reviewSchema,
  plannedEffects: z.array(effectSchema).min(1),
}).passthrough().superRefine((target, context) => {
  const executionMode = target.executionMode ?? "strict_v6";
  const hasCoupangEffect = target.plannedEffects.includes("register_coupang_offer");
  const expectedApprovalPolicy = target.review.reviewerAgent === "admin_direct"
    ? "authenticated_admin_direct_registration"
    : target.review.reviewerAgent === "pricetrace_independent_reviewer"
      ? "authenticated_admin_explicit_second_step"
      : null;
  if (expectedApprovalPolicy && target.approvalPolicy.mode !== expectedApprovalPolicy) {
    context.addIssue({
      code: "custom",
      message: "The approval policy must match the registration reviewer.",
      path: ["approvalPolicy", "mode"],
    });
  }
  if (executionMode === "strict_v6" && (!target.coupangOffer || !hasCoupangEffect)) {
    context.addIssue({
      code: "custom",
      message: "strict_v6 실행에는 쿠팡 정확 옵션과 등록 효과가 필요합니다.",
      path: ["coupangOffer"],
    });
  }
  if (executionMode === "link_only_v1" && (target.coupangOffer || hasCoupangEffect)) {
    context.addIssue({
      code: "custom",
      message: "link_only_v1 실행에는 쿠팡 제안과 등록 효과가 없어야 합니다.",
      path: ["coupangOffer"],
    });
  }
  const apparelSize = target.normalizedIdentity.apparelSize ?? null;
  if (target.officialSpecificationCheck.kind === "apparel_size") {
    if (
      !apparelSize
      || canonicalJson(target.officialSpecificationCheck.parsedApparelSize)
        !== canonicalJson(apparelSize)
      || target.normalizedIdentity.contentAmount !== 1
      || target.normalizedIdentity.contentUnit !== "each"
      || target.normalizedIdentity.packageCount !== 1
      || target.normalizedIdentity.referenceUnit !== 100
    ) {
      context.addIssue({
        code: "custom",
        message: "의류 사이즈 규격은 typed apparelSize와 1 each 판매단위로 저장해야 합니다.",
        path: ["normalizedIdentity", "apparelSize"],
      });
    }
  } else if (apparelSize) {
    context.addIssue({
      code: "custom",
      message: "내용량 규격에는 의류 사이즈를 함께 저장할 수 없습니다.",
      path: ["normalizedIdentity", "apparelSize"],
    });
  }
  const kitComponents = target.normalizedIdentity.kitComponents ?? null;
  if (target.officialSpecificationCheck.kind === "composite_kit") {
    if (
      !kitComponents
      || canonicalJson(target.officialSpecificationCheck.kitComponents)
        !== canonicalJson(kitComponents)
      || target.normalizedIdentity.contentAmount !== 1
      || target.normalizedIdentity.contentUnit !== "each"
      || target.normalizedIdentity.packageCount !== 1
      || target.normalizedIdentity.referenceUnit !== 100
    ) {
      context.addIssue({
        code: "custom",
        message: "복합 키트 규격은 구성품과 1 each 판매 단위를 함께 보존해야 합니다.",
        path: ["normalizedIdentity", "kitComponents"],
      });
    }
  } else if (kitComponents) {
    context.addIssue({
      code: "custom",
      message: "복합 키트가 아닌 규격에는 구성품을 저장할 수 없습니다.",
      path: ["normalizedIdentity", "kitComponents"],
    });
  }
  const wiperBladeFitment = target.normalizedIdentity.wiperBladeFitment ?? null;
  if (target.officialSpecificationCheck.kind === "wiper_blade_fitment") {
    if (
      !wiperBladeFitment
      || canonicalJson(target.officialSpecificationCheck.parsedWiperBladeFitment)
        !== canonicalJson(wiperBladeFitment)
      || target.normalizedIdentity.contentAmount !== 1
      || target.normalizedIdentity.contentUnit !== "each"
      || target.normalizedIdentity.packageCount !== 1
      || target.normalizedIdentity.referenceUnit !== 100
    ) {
      context.addIssue({
        code: "custom",
        message: "와이퍼 길이 규격은 typed fitment와 1 each 판매 단위를 함께 보존해야 합니다.",
        path: ["normalizedIdentity", "wiperBladeFitment"],
      });
    }
  } else if (wiperBladeFitment) {
    context.addIssue({
      code: "custom",
      message: "와이퍼 길이 규격이 아닌 대상에는 해당 fitment를 저장할 수 없습니다.",
      path: ["normalizedIdentity", "wiperBladeFitment"],
    });
  }
  const nameProof = target.sameChannelNameRule.verifiedEquivalence;
  if (nameProof?.method === "explicit_user_selected_frozen_pair_v1") {
    const selection = target.userSelectedOfficialVariant;
    if (
      !selection
      || selection.selectedReceiptSourceId !== nameProof.selectedReceiptSourceId
      || selection.selectedOfficialSourceId !== nameProof.selectedOfficialSourceId
      || selection.selectionSourceRef !== nameProof.userSelectionSourceRef
      || selection.selectionContentHash !== nameProof.userSelectionContentHash
    ) {
      context.addIssue({
        code: "custom",
        message: "사용자 선택 이름 예외는 같은 동결 선택 증명과 target fingerprint에 포함되어야 합니다.",
        path: ["userSelectedOfficialVariant"],
      });
    }
  }
});
const reviewedLinkProposalSchema = z.object({
  schemaVersion: z.literal("pricetrace-link-proposal.v3"),
  caseId: z.string().min(1),
  status: z.enum(["approval_requested", "approved"]),
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
    officialPrice: z.object({
      amountKrw: z.number().int().nonnegative(),
      sourceText: z.string().min(1),
      observedAt: z.string().datetime({ offset: true }),
    }).nullable().optional(),
    image: z.object({
      url: z.string().url().refine((url) => url.startsWith("https://")),
      contentHash: fingerprintSchema,
      mediaType: z.string().regex(/^image\/(?:jpeg|png|webp)$/),
      byteLength: z.number().int().positive(),
    }),
  }).passthrough(),
  sameChannelNameRule: sameChannelNameRuleSchema,
  normalizedIdentity: z.object({
    brand: z.string().nullable(),
    productFamilyName: z.string().nullable(),
    variantName: z.string().nullable(),
    contentAmount: z.number().positive().nullable(),
    contentUnit: z.enum(["g", "ml", "each"]).nullable(),
    packageCount: z.number().int().positive().nullable(),
    gtin: z.string().nullable(),
    apparelSize: apparelSizeSchema.nullable().optional(),
    kitComponents: z.array(compositeKitComponentSchema).length(2).nullable().optional(),
    wiperBladeFitment: wiperBladeFitmentSchema.nullable().optional(),
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
  }).passthrough().nullable(),
  representativeImage: representativeImageSchema,
  executionTarget: strictExecutionTargetSchema,
  evidence: z.array(evidenceSchema).min(1),
  review: reviewSchema,
  plannedEffects: z.array(effectSchema).min(1),
  approval: z.object({
    status: z.enum(["requested", "approved"]),
    approvalRef: z.string().min(1).nullable().optional(),
    userApprovalText: z.string().min(1).nullable().optional(),
    approvedAt: z.string().min(1).nullable().optional(),
    targetFingerprint: fingerprintSchema,
  }).passthrough(),
  execution: z.object({
    status: z.literal("not_started"),
    idempotencyKey: z.string().min(1),
    appliedAt: z.null(),
    result: z.null(),
  }).passthrough(),
}).passthrough().superRefine((proposal, context) => {
  const approved = proposal.status === "approved";
  if (
    approved !== (proposal.approval.status === "approved")
    || (approved && (
      !proposal.approval.approvalRef
      || !proposal.approval.userApprovalText
      || !proposal.approval.approvedAt
    ))
  ) {
    context.addIssue({
      code: "custom",
      message: "LinkProposal의 승인 상태와 승인 메타데이터가 일치하지 않습니다.",
      path: ["approval"],
    });
  }
});

export type ReviewedLinkProposal = z.infer<typeof reviewedLinkProposalSchema>;
type ReviewedLinkProposalTarget = Pick<
  ReviewedLinkProposal,
  "executionTarget"
>;

export function normalizeProductNameForExactMatch(value: string) {
  return value.replace(/\p{White_Space}+/gu, "");
}

export function normalizeStandardProductNameForUniqueness(value: string) {
  return normalizeProductNameForExactMatch(value).toLocaleLowerCase("ko-KR");
}

export function findWhitespaceEquivalentStandardProduct<
  T extends { canonical_name: string },
>(standards: T[], proposedName: string) {
  const normalizedProposedName = normalizeStandardProductNameForUniqueness(proposedName);
  if (!normalizedProposedName) return undefined;
  return standards.find(
    (standard) => normalizeStandardProductNameForUniqueness(standard.canonical_name)
      === normalizedProposedName,
  );
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

/**
 * Discovery selector for receipt labels truncated inside a longer official
 * channel name. The name-only candidate set must already be unique before
 * price is checked, so price never disambiguates identity. The selected pair
 * still requires an item-specific containment proof and review.
 */
export function findUniqueOfficialContainedNameMatch<T extends {
  sourceNameRaw: string;
  officialPrice: { amountKrw: number } | null;
}>(
  listings: T[],
  receiptName: string,
  receiptUnitPriceKrw: number,
) {
  const expectedName = normalizeProductNameForExactMatch(receiptName);
  const expectedLength = Array.from(expectedName).length;
  if (expectedLength < 6) return null;
  const nameMatches = listings.filter((listing) => {
    const candidateName = normalizeProductNameForExactMatch(listing.sourceNameRaw);
    const candidateLength = Array.from(candidateName).length;
    return candidateName !== expectedName
      && candidateName.includes(expectedName)
      && expectedLength / candidateLength >= 0.6
      && candidateName.indexOf(expectedName) === candidateName.lastIndexOf(expectedName);
  });
  if (nameMatches.length !== 1) return null;
  return nameMatches[0].officialPrice?.amountKrw === receiptUnitPriceKrw
    ? nameMatches[0]
    : null;
}

function assertVerifiedNameEquivalence(
  proof: VerifiedNameEquivalence,
  normalizedReceiptName: string,
  normalizedOfficialName: string,
  evidence: StrictLinkProposalEvidence[],
  review: StrictLinkProposalReview,
  receiptSourceId: string,
  receiptUnitPriceKrw: number,
  officialPrice: {
    amountKrw: number;
    sourceText: string;
    observedAt: string;
  } | null | undefined,
  officialSourceId: string,
) {
  verifiedNameEquivalenceSchema.parse(proof);
  const receiptCodePoints = Array.from(normalizedReceiptName);
  const officialCodePoints = Array.from(normalizedOfficialName);
  if (proof.method === "single_unicode_code_point_substitution_v1") {
    const differingIndexes = receiptCodePoints.flatMap((value, index) => (
      value === officialCodePoints[index] ? [] : [index]
    ));
    const differenceIndex = differingIndexes[0];
    if (
      receiptCodePoints.length !== officialCodePoints.length
      || differingIndexes.length !== 1
      || proof.zeroBasedCodePointIndex !== differenceIndex
      || proof.receiptCodePoint !== receiptCodePoints[differenceIndex]
      || proof.officialCodePoint !== officialCodePoints[differenceIndex]
    ) {
      throw new Error("검증된 이름 동등성은 동결 원문의 단일 Unicode 문자 치환과 정확히 일치해야 합니다.");
    }
  } else if (proof.method === "single_unicode_code_point_insertion_deletion_v1") {
    const derivedEdit = deriveSingleCodePointInsertionDeletion(
      receiptCodePoints,
      officialCodePoints,
    );
    const similarityBasisPoints = discoverySimilarityBasisPoints(
      normalizedReceiptName,
      normalizedOfficialName,
    );
    if (
      !derivedEdit
      || proof.editDirection !== derivedEdit.editDirection
      || proof.zeroBasedEditIndex !== derivedEdit.zeroBasedEditIndex
      || proof.editedCodePoint !== derivedEdit.editedCodePoint
      || proof.receiptCodePointLength !== receiptCodePoints.length
      || proof.officialCodePointLength !== officialCodePoints.length
      || proof.discoverySimilarityBasisPoints !== similarityBasisPoints
      || similarityBasisPoints < 9000
      || proof.uniqueOfficialCandidate !== true
    ) {
      throw new Error("검증된 이름 동등성은 90% 이상인 동결 원문의 단일 Unicode 문자 삽입·누락과 정확히 일치해야 합니다.");
    }
  } else if (proof.method === "official_name_contains_receipt_name_v1") {
    const occurrenceIndexes = officialCodePoints.flatMap((_, index) => (
      receiptCodePoints.every((value, offset) => officialCodePoints[index + offset] === value)
        ? [index]
        : []
    ));
    const occurrenceIndex = occurrenceIndexes[0];
    const officialPrefix = officialCodePoints.slice(0, occurrenceIndex).join("");
    const officialSuffix = officialCodePoints
      .slice(occurrenceIndex + receiptCodePoints.length)
      .join("");
    if (
      receiptCodePoints.length < 6
      || officialCodePoints.length <= receiptCodePoints.length
      || receiptCodePoints.length / officialCodePoints.length < 0.6
      || occurrenceIndexes.length !== 1
      || proof.zeroBasedOfficialCodePointIndex !== occurrenceIndex
      || proof.receiptCodePointLength !== receiptCodePoints.length
      || proof.officialCodePointLength !== officialCodePoints.length
      || proof.officialPrefix !== officialPrefix
      || proof.officialSuffix !== officialSuffix
      || proof.officialDisplayedPriceKrw !== receiptUnitPriceKrw
      || officialPrice?.amountKrw !== proof.officialDisplayedPriceKrw
      || officialPrice?.observedAt !== proof.officialPriceObservedAt
    ) {
      throw new Error("검증된 잘림 이름은 고유한 공식명 포함 위치·길이·앞뒤 원문과 동일한 공식 표시가격을 정확히 증명해야 합니다.");
    }
  } else if (
    proof.selectedReceiptSourceId !== receiptSourceId
    || proof.selectedOfficialSourceId !== officialSourceId
    || proof.selectedNormalizedReceiptName !== normalizedReceiptName
    || proof.selectedNormalizedOfficialName !== normalizedOfficialName
  ) {
    throw new Error("사용자가 선택한 이름 예외는 동결 영수증 행과 공식 상품 identity에 정확히 묶여야 합니다.");
  }
  if (
    proof.reviewerAgent !== "pricetrace_independent_reviewer"
    || review.reviewerAgent !== proof.reviewerAgent
    || review.verdict !== "approve"
    || review.evidenceQuality !== "sufficient"
    || review.conflicts.length > 0
  ) {
    throw new Error("검증된 이름 동등성에는 충돌 없는 독립 승인 검토가 필요합니다.");
  }
  if (
    new Set(proof.supportingEvidenceSourceIds).size !== proof.supportingEvidenceSourceIds.length
    || new Set(proof.supportingSourceRefs).size !== proof.supportingSourceRefs.length
  ) {
    throw new Error("검증된 이름 동등성 근거에는 중복되지 않은 source ID와 source ref가 필요합니다.");
  }
  const supportingSourceIds = new Set(proof.supportingEvidenceSourceIds);
  const supportingEvidence = evidence.filter((item) => supportingSourceIds.has(item.sourceId));
  if (supportingEvidence.length !== supportingSourceIds.size) {
    throw new Error("검증된 이름 동등성의 source ID가 동결된 근거 목록과 일치하지 않습니다.");
  }
  const hasOfficialEvidence = supportingEvidence.some((item) => (
    item.sourceType === "official_channel"
    && item.authority === "primary"
    && item.sourceId === officialSourceId
  ));
  const hasIndependentPrimaryEvidence = supportingEvidence.some((item) => (
    (item.sourceType === "manufacturer" || item.sourceType === "brand")
    && item.authority === "primary"
  ));
  const hasReceiptEvidence = supportingEvidence.some((item) => (
    item.sourceType === "receipt"
    && item.authority === "transactional"
    && item.sourceId === receiptSourceId
  ));
  const supportingRefs = new Set(supportingEvidence.flatMap((item) => item.sourceRefs));
  if (
    !hasOfficialEvidence
    || (proof.method !== "official_name_contains_receipt_name_v1"
      ? !hasIndependentPrimaryEvidence
      : !hasReceiptEvidence)
    || (proof.method === "explicit_user_selected_frozen_pair_v1" && !hasReceiptEvidence)
    || proof.supportingSourceRefs.some((sourceRef) => !supportingRefs.has(sourceRef))
  ) {
    throw new Error(
      proof.method !== "official_name_contains_receipt_name_v1"
        ? "검증된 이름 동등성에는 공식 채널과 제조사·브랜드의 독립 1차 근거가 모두 필요합니다."
        : "검증된 잘림 이름에는 같은 영수증 행과 공식 채널의 원문·가격 근거가 모두 필요합니다.",
    );
  }
}

function assertReviewedSameChannelNameRule(proposal: ReviewedLinkProposal) {
  const rule = proposal.sameChannelNameRule;
  const normalizedReceiptName = normalizeProductNameForExactMatch(proposal.receipt.sourceNameRaw);
  const normalizedOfficialName = normalizeProductNameForExactMatch(
    proposal.officialListing.sourceNameRaw,
  );
  const sameChannel = proposal.receipt.sourceCatalogNamespace !== null
    && proposal.receipt.sourceCatalogNamespace === proposal.officialListing.channelId;
  const exactNameMatch = normalizedReceiptName === normalizedOfficialName;
  if (
    !normalizedReceiptName
    || rule.normalizedReceiptName !== normalizedReceiptName
    || rule.normalizedOfficialName !== normalizedOfficialName
    || rule.sameChannel !== sameChannel
    || rule.exactNameMatch !== exactNameMatch
    || rule.normalization !== "remove_unicode_whitespace_only"
  ) {
    throw new Error("LinkProposal의 같은 채널 이름 판정이 동결 원문과 일치하지 않습니다.");
  }
  if (!sameChannel) {
    throw new Error("승인 가능한 LinkProposal은 영수증과 공식 상품의 카탈로그 채널이 같아야 합니다.");
  }
  if (exactNameMatch) {
    if (rule.outcome !== "apply_official_identity" || rule.verifiedEquivalence) {
      throw new Error("완전 일치 이름에는 기존 공식 identity 적용 규칙만 사용할 수 있습니다.");
    }
  } else {
    if (rule.outcome !== "apply_verified_name_equivalence" || !rule.verifiedEquivalence) {
      throw new Error("원문명이 다르면 검증된 이름 동등성 근거가 필요합니다.");
    }
    assertVerifiedNameEquivalence(
      rule.verifiedEquivalence,
      normalizedReceiptName,
      normalizedOfficialName,
      proposal.evidence,
      proposal.review,
      `${proposal.receipt.receiptId}:${proposal.receipt.receiptItemId}`,
      proposal.receipt.unitPriceKrw,
      proposal.officialListing.officialPrice,
      [
        proposal.officialListing.channelId,
        proposal.officialListing.sourceProductCodeNamespace,
        proposal.officialListing.sourceProductCode,
      ].join(":"),
    );
  }
  if (
    !rule.importedOfficialFields.includes("brand")
    || proposal.normalizedIdentity.brand === null
  ) {
    throw new Error("승인 가능한 이름 규칙에는 공식 브랜드 근거가 필요합니다.");
  }
  if (proposal.normalizedIdentity.apparelSize) {
    if (!rule.importedOfficialFields.includes("apparelSize")) {
      throw new Error("의류 연결에는 공식 의류 사이즈 근거가 필요합니다.");
    }
  } else if (proposal.normalizedIdentity.kitComponents) {
    if (!rule.importedOfficialFields.includes("kitComponents")) {
      throw new Error("복합 키트 연결에는 공식 구성품 근거가 필요합니다.");
    }
  } else if (proposal.normalizedIdentity.wiperBladeFitment) {
    if (!rule.importedOfficialFields.includes("wiperBladeFitment")) {
      throw new Error("와이퍼 연결에는 공식 길이 fitment 근거가 필요합니다.");
    }
  } else {
    for (const requiredField of ["contentAmount", "contentUnit"] as const) {
      if (
        !rule.importedOfficialFields.includes(requiredField)
        || proposal.normalizedIdentity[requiredField] === null
      ) {
        throw new Error("승인 가능한 이름 규칙에는 공식 내용량·단위 근거가 필요합니다.");
      }
    }
  }
}

function normalizeProductNameForDiscovery(value: string) {
  return value
    .replace(/^\s*\(\d+(?:\.\d+)?\)\s*/u, "")
    .replace(/[^0-9A-Za-z가-힣]+/g, "")
    .toLocaleLowerCase("ko-KR");
}

export const OFFICIAL_NAME_DISCOVERY_SIMILARITY_THRESHOLD = 0.85;

function editDistance(left: string, right: string) {
  const leftCodePoints = Array.from(left);
  const rightCodePoints = Array.from(right);
  const previous = Array.from({ length: rightCodePoints.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftCodePoints.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= rightCodePoints.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1]
          + (leftCodePoints[leftIndex - 1] === rightCodePoints[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[rightCodePoints.length];
}

function discoverySimilarityBasisPoints(left: string, right: string) {
  const normalizedLeft = normalizeProductNameForDiscovery(left);
  const normalizedRight = normalizeProductNameForDiscovery(right);
  const longest = Math.max(Array.from(normalizedLeft).length, Array.from(normalizedRight).length);
  if (longest === 0) return 0;
  return Math.floor((1 - editDistance(normalizedLeft, normalizedRight) / longest) * 10_000);
}

function receiptCoverageSimilarity(receiptName: string, officialName: string) {
  const receiptCodePoints = Array.from(receiptName);
  const officialCodePoints = Array.from(officialName);
  if (receiptCodePoints.length === 0 || officialCodePoints.length === 0) return 0;
  if (officialCodePoints.length < receiptCodePoints.length) {
    return 1 - (editDistance(receiptName, officialName) / receiptCodePoints.length);
  }
  let bestSimilarity = 0;
  for (
    let start = 0;
    start <= officialCodePoints.length - receiptCodePoints.length;
    start += 1
  ) {
    const officialWindow = officialCodePoints
      .slice(start, start + receiptCodePoints.length)
      .join("");
    bestSimilarity = Math.max(
      bestSimilarity,
      1 - (editDistance(receiptName, officialWindow) / receiptCodePoints.length),
    );
  }
  return bestSimilarity;
}

function deriveSingleCodePointInsertionDeletion(
  receiptCodePoints: string[],
  officialCodePoints: string[],
) {
  const officialIsLonger = officialCodePoints.length === receiptCodePoints.length + 1;
  const receiptIsLonger = receiptCodePoints.length === officialCodePoints.length + 1;
  if (!officialIsLonger && !receiptIsLonger) return null;
  const longer = officialIsLonger ? officialCodePoints : receiptCodePoints;
  const shorter = officialIsLonger ? receiptCodePoints : officialCodePoints;
  const editIndexes = longer.flatMap((_, index) => (
    longer.filter((__, candidateIndex) => candidateIndex !== index).every(
      (value, candidateIndex) => value === shorter[candidateIndex],
    ) ? [index] : []
  ));
  if (editIndexes.length !== 1) return null;
  const zeroBasedEditIndex = editIndexes[0];
  return {
    editDirection: officialIsLonger
      ? "insert_official_code_point_into_receipt" as const
      : "delete_receipt_code_point" as const,
    zeroBasedEditIndex,
    editedCodePoint: longer[zeroBasedEditIndex],
  };
}

/**
 * Returns a single official name when at least 85% of the normalized receipt
 * name matches one contiguous official-name window. A leading parenthesized
 * numeric receipt classification code is ignored for discovery only. This
 * selector does not prove identity or relax the approval contract; the raw
 * pair still needs a frozen audited equivalence proof.
 */
export function findUniqueOfficialRelaxedNameMatch<T extends { sourceNameRaw: string }>(
  listings: T[],
  receiptName: string,
) {
  const expectedName = normalizeProductNameForDiscovery(receiptName);
  if (Array.from(expectedName).length < 6) return null;
  const ranked = listings.flatMap((listing) => {
    const candidateName = normalizeProductNameForDiscovery(listing.sourceNameRaw);
    if (!candidateName) return [];
    const longest = Math.max(Array.from(expectedName).length, Array.from(candidateName).length);
    const distance = editDistance(expectedName, candidateName);
    const similarity = Math.max(
      longest === 0 ? 0 : 1 - (distance / longest),
      receiptCoverageSimilarity(expectedName, candidateName),
    );
    return [{ listing, similarity, distance, longest }];
  }).sort((left, right) => (
    right.similarity - left.similarity || left.distance - right.distance
  ));
  const best = ranked[0];
  if (!best || best.similarity < OFFICIAL_NAME_DISCOVERY_SIMILARITY_THRESHOLD) return null;
  if (ranked[1]?.similarity >= OFFICIAL_NAME_DISCOVERY_SIMILARITY_THRESHOLD) return null;
  return best.listing;
}

export function findExpectedCatalogProductId(
  variants: StrictCatalogVariant[],
  expected: Omit<StrictCatalogVariant, "id">,
) {
  const matches = variants.filter((variant) => {
    const specificationMatches = variant.specification.trim() === expected.specification.trim()
      || (
        variant.specification.trim() === ""
        && variant.specificationStatus === "verified"
        && variant.contentAmount === expected.contentAmount
        && variant.contentUnit === expected.contentUnit
        && variant.packageCount === expected.packageCount
      );
    return (
    variant.standardProductId === expected.standardProductId
    && normalizeProductNameForExactMatch(variant.canonicalName)
      === normalizeProductNameForExactMatch(expected.canonicalName)
    && specificationMatches
    && canonicalJson(variant.attributes) === canonicalJson(expected.attributes)
    && variant.specificationStatus === expected.specificationStatus
    && variant.contentAmount === expected.contentAmount
    && variant.contentUnit === expected.contentUnit
    && variant.packageCount === expected.packageCount
    && variant.referenceUnit === expected.referenceUnit
    );
  });
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
  return sha256CanonicalJson(canonicalJson(proposal.executionTarget));
}

export function receiptRevisionMatchesLiveCandidate(
  proposalRevision: string,
  currentRevision: string,
) {
  if (proposalRevision === currentRevision) return true;

  // Proposals created before receipt-v1 used a short row fingerprint. Accept
  // that legacy token only after every other frozen receipt field matches.
  return currentRevision.startsWith("receipt-v1:")
    && /^[a-f0-9]{16}$/i.test(proposalRevision);
}

export async function buildReviewedLinkProposalExecutionIdentity(
  proposal: ReviewedLinkProposal,
) {
  const inputCanonicalJson = canonicalJson({
    receipt: proposal.receipt,
    officialListing: proposal.officialListing,
  });
  const targetCanonicalJson = canonicalJson(proposal.executionTarget);
  const inputFingerprint = await sha256CanonicalJson(inputCanonicalJson);
  const targetFingerprint = await sha256CanonicalJson(targetCanonicalJson);
  const idempotencyKey = `standard-product-link:${targetFingerprint.slice("sha256:".length)}`;
  if (
    proposal.inputFingerprint !== inputFingerprint
    || proposal.approval.targetFingerprint !== targetFingerprint
    || proposal.execution.idempotencyKey !== idempotencyKey
  ) {
    throw new Error("LinkProposal의 실행 지문과 동결 대상이 일치하지 않습니다.");
  }

  const target = proposal.executionTarget;
  const approvalStatement = [
    `영수증 ${proposal.receipt.sourceLabel}/${proposal.receipt.sourceProductCode}`,
    `공식 ${proposal.officialListing.channelId}/${proposal.officialListing.sourceProductCodeNamespace}:${proposal.officialListing.sourceProductCode}`,
    `${target.brandEvidence.canonicalName} ${target.normalizedIdentity.productFamilyName} / ${target.normalizedIdentity.variantName}`,
    target.plannedEffects.join(","),
  ].join(" · ") + ` 연결을 승인합니다. [${targetFingerprint}]`;

  return {
    caseId: proposal.caseId,
    inputFingerprint,
    targetFingerprint,
    inputCanonicalJson,
    targetCanonicalJson,
    idempotencyKey,
    approvalStatement,
    executionTarget: target,
  };
}

export async function parseReviewedLinkProposal(
  rawJson: string,
  expected: Pick<StrictRegistrationIdentityInput, "caseId" | "receipt" | "officialListing">,
): Promise<ReviewedLinkProposal> {
  const proposal = parseReviewedLinkProposalEnvelope(rawJson);
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

export async function parseReviewedLinkProposalForLiveCandidate(
  rawJson: string,
  current: Pick<StrictRegistrationIdentityInput, "receipt" | "officialListing">,
): Promise<ReviewedLinkProposal> {
  const proposal = parseReviewedLinkProposalEnvelope(rawJson);
  const proposalInputCanonicalJson = canonicalJson({
    receipt: proposal.receipt,
    officialListing: proposal.officialListing,
  });
  const proposalInputFingerprint = await sha256CanonicalJson(proposalInputCanonicalJson);
  const reviewedTargetFingerprint = await reviewedLinkProposalTargetFingerprint(proposal);
  const sameReceipt = (
    proposal.receipt.receiptId === current.receipt.receiptId
    && proposal.receipt.receiptItemId === current.receipt.receiptItemId
    && receiptRevisionMatchesLiveCandidate(
      proposal.receipt.receiptRevision,
      current.receipt.receiptRevision,
    )
    && proposal.receipt.sourceCatalogNamespace === current.receipt.sourceCatalogNamespace
    && proposal.receipt.sourceLabel === current.receipt.sourceLabel
    && proposal.receipt.sourceProductCode === current.receipt.sourceProductCode
    && proposal.receipt.sourceNameRaw === current.receipt.sourceNameRaw
    && proposal.receipt.observedAt.slice(0, 10) === current.receipt.observedAt.slice(0, 10)
    && proposal.receipt.unitPriceKrw === current.receipt.unitPriceKrw
    && proposal.receipt.quantity === current.receipt.quantity
  );
  const sameOfficialListing = (
    proposal.officialListing.channelId === current.officialListing.channelId
    && proposal.officialListing.sourceProductCodeNamespace
      === current.officialListing.sourceProductCodeNamespace
    && proposal.officialListing.sourceProductCode === current.officialListing.sourceProductCode
    && proposal.officialListing.snapshotId === current.officialListing.snapshotId
    && proposal.officialListing.snapshotHash === current.officialListing.snapshotHash
    && proposal.officialListing.sourceNameRaw === current.officialListing.sourceNameRaw
    && proposal.officialListing.specificationTextRaw
      === current.officialListing.specificationTextRaw
    && canonicalJson(proposal.officialListing.officialPrice ?? null)
      === canonicalJson(current.officialListing.officialPrice ?? null)
    && current.officialListing.sourceRefs.every((sourceRef) => (
      proposal.officialListing.sourceRefs.includes(sourceRef)
    ))
    && canonicalJson(proposal.officialListing.image)
      === canonicalJson(current.officialListing.image)
  );
  if (
    proposal.inputFingerprint !== proposalInputFingerprint
    || proposal.approval.targetFingerprint !== reviewedTargetFingerprint
    || !sameReceipt
    || !sameOfficialListing
  ) {
    throw new Error("LinkProposal의 동결 입력이 현재 영수증·공식 상품 기록과 일치하지 않습니다.");
  }
  return proposal;
}

export function parseReviewedLinkProposalEnvelope(rawJson: string): ReviewedLinkProposal {
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
  assertReviewedSameChannelNameRule(proposal);
  const targetIdentity = {
    brand: proposal.executionTarget.normalizedIdentity.brand,
    productFamilyName: proposal.executionTarget.normalizedIdentity.productFamilyName,
    variantName: proposal.executionTarget.normalizedIdentity.variantName,
    contentAmount: proposal.executionTarget.normalizedIdentity.contentAmount,
    contentUnit: proposal.executionTarget.normalizedIdentity.contentUnit,
    packageCount: proposal.executionTarget.normalizedIdentity.packageCount,
    gtin: proposal.executionTarget.normalizedIdentity.gtin,
    ...("apparelSize" in proposal.executionTarget.normalizedIdentity
      ? { apparelSize: proposal.executionTarget.normalizedIdentity.apparelSize ?? null }
      : {}),
    ...("kitComponents" in proposal.executionTarget.normalizedIdentity
      ? { kitComponents: proposal.executionTarget.normalizedIdentity.kitComponents ?? null }
      : {}),
    ...("wiperBladeFitment" in proposal.executionTarget.normalizedIdentity
      ? { wiperBladeFitment: proposal.executionTarget.normalizedIdentity.wiperBladeFitment ?? null }
      : {}),
  };
  const targetCoupangOffer = proposal.coupangOffer ? {
    productUrl: proposal.coupangOffer.url,
    listedPriceKrw: proposal.coupangOffer.totalPriceKrw,
    quantity: proposal.coupangOffer.quantity,
    contentAmount: proposal.coupangOffer.contentAmount,
    contentUnit: proposal.coupangOffer.contentUnit,
    maxBundleQuantity: proposal.coupangOffer.maxBundleQuantity,
    maxBundleListedPriceKrw: proposal.coupangOffer.maxBundleTotalPriceKrw,
  } : null;
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
  if (
    proposal.executionTarget.caseId !== proposal.caseId
    || proposal.executionTarget.inputFingerprint !== proposal.inputFingerprint
    || canonicalJson(proposal.executionTarget.sameChannelNameRule)
      !== canonicalJson(proposal.sameChannelNameRule)
    || canonicalJson(targetIdentity) !== canonicalJson(proposal.normalizedIdentity)
    || canonicalJson(proposal.executionTarget.decision) !== canonicalJson(proposal.decision)
    || canonicalJson(proposal.executionTarget.coupangOffer) !== canonicalJson(targetCoupangOffer)
    || canonicalJson(proposal.executionTarget.representativeImage)
      !== canonicalJson(proposal.representativeImage)
    || canonicalJson(proposal.executionTarget.evidence) !== canonicalJson(proposal.evidence)
    || canonicalJson(proposal.executionTarget.review) !== canonicalJson(proposal.review)
    || canonicalJson(proposal.executionTarget.plannedEffects)
      !== canonicalJson(proposal.plannedEffects)
    || proposal.executionTarget.officialSpecificationCheck.specificationTextRaw
      !== proposal.officialListing.specificationTextRaw
    || proposal.executionTarget.brandEvidence.canonicalName
      !== proposal.normalizedIdentity.brand
    || proposal.execution.idempotencyKey
      !== `standard-product-link:${proposal.approval.targetFingerprint.slice("sha256:".length)}`
  ) {
    throw new Error("LinkProposal 요약과 실행 대상이 일치하지 않습니다.");
  }
  return proposal;
}

export function assertReviewedProposalMatchesExecutionTarget(
  proposal: ReviewedLinkProposal,
  targetCanonicalJson: string,
) {
  if (canonicalJson(proposal.executionTarget) !== targetCanonicalJson) {
    throw new Error("독립 검토 대상과 현재 적용 대상·효과가 일치하지 않습니다.");
  }
}

export function parseOfficialSpecification(value: string): {
  contentAmount: number;
  contentUnit: CatalogContentUnit;
} | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|each|개|입)$/iu);
  if (!match) return null;
  const parsedAmount = Number(match[1]);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return null;
  const rawUnit = match[2].toLocaleLowerCase("en-US");
  const contentAmount = rawUnit === "kg" ? parsedAmount * 1000 : parsedAmount;
  const contentUnit: CatalogContentUnit = rawUnit === "개" || rawUnit === "입" || rawUnit === "each"
    ? "each"
    : rawUnit === "kg"
      ? "g"
      : rawUnit as CatalogContentUnit;
  return { contentAmount, contentUnit };
}

export type ParsedStructuredOfficialSpecification = {
  contentAmount: number;
  contentUnit: CatalogContentUnit;
  packageCount: number;
  parseRule:
    | "count_only_v1"
    | "per_item_times_count_v1"
    | "per_item_times_count_with_total_v1"
    | "total_amount_per_count_v1"
    | "numeric_spec_unit_from_official_name_v1";
  packageCountBasis: "explicit_specification" | "default_one_absent_count";
  parsedTotalContentAmount?: number;
  matchedOfficialNameFragment?: string;
};

export function parseCompositeKitSpecification(
  value: string,
): CompositeKitComponent[] | null {
  const match = value.normalize("NFKC").trim().match(
    /^면도기\s*(\d+)\s*면도날\s*(\d+)$/u,
  );
  if (!match) return null;
  const handleQuantity = Number(match[1]);
  const bladeQuantity = Number(match[2]);
  if (
    !Number.isInteger(handleQuantity)
    || handleQuantity <= 0
    || !Number.isInteger(bladeQuantity)
    || bladeQuantity <= 0
  ) return null;
  return [
    { componentType: "razor_handle", quantity: handleQuantity, unit: "each" },
    { componentType: "razor_blade", quantity: bladeQuantity, unit: "each" },
  ];
}

export function parseOfficialWiperBladeFitment(
  value: string,
  officialNameRaw: string,
): WiperBladeFitment | null {
  if (!officialNameRaw.normalize("NFKC").includes("와이퍼")) return null;
  const match = value.normalize("NFKC").trim().match(/^(\d{3})\s*mm$/iu);
  if (!match) return null;
  const lengthMm = Number(match[1]);
  if (!Number.isInteger(lengthMm) || lengthMm < 250 || lengthMm > 800) return null;
  return { lengthMm };
}

function normalizeStructuredContentUnit(rawUnit: string): {
  multiplier: number;
  contentUnit: CatalogContentUnit;
} | null {
  const normalizedUnit = rawUnit.toLocaleLowerCase("en-US");
  if (normalizedUnit === "kg") return { multiplier: 1000, contentUnit: "g" };
  if (normalizedUnit === "g" || normalizedUnit === "ml") {
    return { multiplier: 1, contentUnit: normalizedUnit };
  }
  return null;
}

export function parseStructuredOfficialSpecification(
  value: string,
  officialNameRaw: string,
): ParsedStructuredOfficialSpecification | null {
  const normalizedValue = value.normalize("NFKC").trim();
  const perItemTimesCountWithTotal = normalizedValue.match(
    /^(\d+(?:\.\d+)?)\s*(kg|g|ml)\s*[xX×*]\s*(\d+)\s*개(?:입)?\s*\/\s*(\d+(?:\.\d+)?)\s*(kg|g|ml)$/iu,
  );
  if (perItemTimesCountWithTotal) {
    const itemUnit = normalizeStructuredContentUnit(perItemTimesCountWithTotal[2]);
    const totalUnit = normalizeStructuredContentUnit(perItemTimesCountWithTotal[5]);
    const contentAmount = Number(perItemTimesCountWithTotal[1]) * (itemUnit?.multiplier ?? 0);
    const packageCount = Number(perItemTimesCountWithTotal[3]);
    const statedTotal = Number(perItemTimesCountWithTotal[4]) * (totalUnit?.multiplier ?? 0);
    if (
      itemUnit
      && totalUnit
      && itemUnit.contentUnit === totalUnit.contentUnit
      && Number.isFinite(contentAmount)
      && contentAmount > 0
      && Number.isInteger(packageCount)
      && packageCount > 0
      && statedTotal === contentAmount * packageCount
    ) {
      return {
        contentAmount,
        contentUnit: itemUnit.contentUnit,
        packageCount,
        parseRule: "per_item_times_count_with_total_v1",
        packageCountBasis: "explicit_specification",
        parsedTotalContentAmount: statedTotal,
      };
    }
  }
  const totalPerCount = normalizedValue.match(
    /^(\d+(?:\.\d+)?)\s*(kg|g|ml)\s*\/\s*(\d+)\s*매입$/iu,
  );
  if (totalPerCount) {
    const unit = normalizeStructuredContentUnit(totalPerCount[2]);
    const total = Number(totalPerCount[1]) * (unit?.multiplier ?? 0);
    const packageCount = Number(totalPerCount[3]);
    const contentAmount = total / packageCount;
    if (
      unit
      && Number.isFinite(total)
      && total > 0
      && Number.isInteger(packageCount)
      && packageCount > 0
      && Number.isFinite(contentAmount)
      && contentAmount > 0
    ) {
      return {
        contentAmount,
        contentUnit: unit.contentUnit,
        packageCount,
        parseRule: "total_amount_per_count_v1",
        packageCountBasis: "explicit_specification",
        parsedTotalContentAmount: total,
      };
    }
  }

  const perItemTimesCount = normalizedValue.match(
    /^(\d+(?:\.\d+)?)\s*(kg|g|ml)\s*[xX×*]\s*(\d+)\s*개입$/iu,
  );
  if (perItemTimesCount) {
    const unit = normalizeStructuredContentUnit(perItemTimesCount[2]);
    const contentAmount = Number(perItemTimesCount[1]) * (unit?.multiplier ?? 0);
    const packageCount = Number(perItemTimesCount[3]);
    if (
      unit
      && Number.isFinite(contentAmount)
      && contentAmount > 0
      && Number.isInteger(packageCount)
      && packageCount > 0
    ) {
      return {
        contentAmount,
        contentUnit: unit.contentUnit,
        packageCount,
        parseRule: "per_item_times_count_v1",
        packageCountBasis: "explicit_specification",
      };
    }
  }

  const countOnly = normalizedValue.match(/^(\d+)\s*매$/u);
  if (countOnly) {
    const packageCount = Number(countOnly[1]);
    if (Number.isInteger(packageCount) && packageCount > 0) {
      return {
        contentAmount: 1,
        contentUnit: "each",
        packageCount,
        parseRule: "count_only_v1",
        packageCountBasis: "explicit_specification",
      };
    }
  }

  const numericOnly = normalizedValue.match(/^(\d+(?:\.\d+)?)$/u);
  if (!numericOnly) return null;
  const numericValue = Number(numericOnly[1]);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  const escapedNumber = numericOnly[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fragmentPattern = new RegExp(
    `(?<![\\d.])${escapedNumber}\\s*(kg|g|ml)(?![\\p{L}\\d.])`,
    "giu",
  );
  const fragments = [...officialNameRaw.normalize("NFKC").matchAll(fragmentPattern)];
  if (fragments.length !== 1) return null;
  const unit = normalizeStructuredContentUnit(fragments[0][1]);
  if (!unit) return null;
  return {
    contentAmount: numericValue * unit.multiplier,
    contentUnit: unit.contentUnit,
    packageCount: 1,
    parseRule: "numeric_spec_unit_from_official_name_v1",
    packageCountBasis: "default_one_absent_count",
    matchedOfficialNameFragment: fragments[0][0],
  };
}

function hasExplicitPackageCount(value: string) {
  return /(?:[xX×*]\s*\d+|\d+\s*(?:개입|입|팩))/u.test(value);
}

function assertCompleteAssessment(
  input: Pick<
    StrictRegistrationIdentityInput,
    "receipt" | "officialListing" | "assessment"
  >,
  coupangProductUrl?: string,
  assessmentMode: RegistrationAssessmentMode = "independent",
) {
  const requireCoupang = Boolean(coupangProductUrl);
  const { decision, evidence, review } = input.assessment;
  if (
    review.verdict !== "approve"
    || (assessmentMode === "independent" && review.reviewerAgent !== "pricetrace_independent_reviewer")
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
    && (
      !requireCoupang
      || evidence.some((item) => (
        item.sourceType === "coupang"
        && item.url === coupangProductUrl
        && item.claims.length > 0
        && item.sourceRefs.length > 0
      ))
    )
  );
  if (!hasRequiredEvidence) {
    throw new Error(
      requireCoupang
        ? "영수증·공식 상품·쿠팡 정확 옵션 근거가 모두 필요합니다."
        : "영수증과 공식 상품 근거가 모두 필요합니다.",
    );
  }
}

export async function buildStrictRegistrationIdentity(
  input: StrictRegistrationIdentityInput,
  options: { assessmentMode?: RegistrationAssessmentMode } = {},
) {
  if (input.receipt.sourceCatalogNamespace !== input.officialListing.channelId) {
    throw new Error("영수증 판매처와 공식 상품의 카탈로그 채널이 일치하지 않습니다.");
  }
  const normalizedReceiptName = normalizeProductNameForExactMatch(input.receipt.sourceNameRaw);
  const normalizedOfficialName = normalizeProductNameForExactMatch(input.officialListing.sourceNameRaw);
  if (!normalizedReceiptName || !normalizedOfficialName) {
    throw new Error("영수증명과 공식 상품명 원문이 필요합니다.");
  }
  const exactNameMatch = normalizedReceiptName === normalizedOfficialName;
  if (exactNameMatch && input.verifiedNameEquivalence) {
    throw new Error("완전 일치 이름에는 검증된 이름 동등성 예외를 사용할 수 없습니다.");
  }
  if (!exactNameMatch && !input.verifiedNameEquivalence && options.assessmentMode !== "admin_direct") {
    throw new Error("영수증명과 공식 상품명이 다르면 검증된 이름 동등성 근거가 필요합니다.");
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
  assertCompleteAssessment(input, input.target.coupangProductUrl, options.assessmentMode);
  if (input.verifiedNameEquivalence) {
    assertVerifiedNameEquivalence(
      input.verifiedNameEquivalence,
      normalizedReceiptName,
      normalizedOfficialName,
      input.assessment.evidence,
      input.assessment.review,
      `${input.receipt.receiptId}:${input.receipt.receiptItemId}`,
      input.receipt.unitPriceKrw,
      input.officialListing.officialPrice,
      [
        input.officialListing.channelId,
        input.officialListing.sourceProductCodeNamespace,
        input.officialListing.sourceProductCode,
      ].join(":"),
    );
  }
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
    !Number.isFinite(input.target.coupangContentAmount)
    || input.target.coupangContentAmount <= 0
    || input.target.coupangContentUnit !== input.target.contentUnit
    || (
      input.target.contentUnit === "each"
      && input.target.coupangContentAmount !== input.target.contentAmount
    )
  ) {
    throw new Error(
      "쿠팡 정확 옵션은 양수 개당 내용량과 적용 판매 규격과 같은 단위가 필요합니다. 개 단위는 판매 규격과 같아야 합니다.",
    );
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
    ...(input.officialListing.officialPrice
      ? { officialPrice: { ...input.officialListing.officialPrice } }
      : {}),
    image: { ...input.officialListing.image },
  };
  const inputCanonicalJson = canonicalJson({ receipt, officialListing });
  const inputFingerprint = await sha256CanonicalJson(inputCanonicalJson);
  const officialHasExplicitPackageCount = hasExplicitPackageCount(
    input.officialListing.sourceNameRaw,
  );
  const sameChannelNameRule = {
    sameChannel: true,
    normalization: "remove_unicode_whitespace_only",
    normalizedReceiptName,
    normalizedOfficialName,
    exactNameMatch,
    outcome: exactNameMatch
      ? "apply_official_identity"
      : input.verifiedNameEquivalence
        ? "apply_verified_name_equivalence"
        : "not_applicable",
    importedOfficialFields: officialHasExplicitPackageCount
      ? ["brand", "contentAmount", "contentUnit", "packageCount"]
      : ["brand", "contentAmount", "contentUnit"],
    ...(input.verifiedNameEquivalence
      ? { verifiedEquivalence: { ...input.verifiedNameEquivalence } }
      : {}),
  };
  const officialSpecificationCheck = {
    specificationTextRaw: input.officialListing.specificationTextRaw,
    parsedContentAmount: parsedOfficialSpecification.contentAmount,
    parsedContentUnit: parsedOfficialSpecification.contentUnit,
    parsedPackageCount: officialPackageCount,
    packageCountBasis: officialHasExplicitPackageCount
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
      mode: options.assessmentMode === "admin_direct"
        ? "authenticated_admin_direct_registration"
        : "authenticated_admin_explicit_second_step",
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
    executionTarget: target,
  };
}

export async function buildLinkOnlyRegistrationIdentity(
  input: LinkOnlyRegistrationIdentityInput,
  options: { assessmentMode?: RegistrationAssessmentMode } = {},
) {
  if (input.receipt.sourceCatalogNamespace !== input.officialListing.channelId) {
    throw new Error("영수증 판매처와 공식 상품의 카탈로그 채널이 일치하지 않습니다.");
  }
  const normalizedReceiptName = normalizeProductNameForExactMatch(input.receipt.sourceNameRaw);
  const normalizedOfficialName = normalizeProductNameForExactMatch(
    input.officialListing.sourceNameRaw,
  );
  if (!normalizedReceiptName || !normalizedOfficialName) {
    throw new Error("영수증명과 공식 상품명 원문이 필요합니다.");
  }
  const exactNameMatch = normalizedReceiptName === normalizedOfficialName;
  if (input.userSelectedOfficialVariant) {
    const expectedReceiptSourceId = `${input.receipt.receiptId}:${input.receipt.receiptItemId}`;
    const expectedOfficialSourceId = [
      input.officialListing.channelId,
      input.officialListing.sourceProductCodeNamespace,
      input.officialListing.sourceProductCode,
    ].join(":");
    userSelectedOfficialVariantSchema.parse(input.userSelectedOfficialVariant);
    if (
      input.userSelectedOfficialVariant.selectedReceiptSourceId !== expectedReceiptSourceId
      || input.userSelectedOfficialVariant.selectedOfficialSourceId !== expectedOfficialSourceId
      || input.userSelectedOfficialVariant.selectedSpecificationTextRaw
        !== input.officialListing.specificationTextRaw
    ) {
      throw new Error("사용자 선택은 동결 영수증 행·공식 상품·규격에 정확히 묶여야 합니다.");
    }
  }
  if (input.verifiedNameEquivalence?.method === "explicit_user_selected_frozen_pair_v1") {
    const selection = input.userSelectedOfficialVariant;
    if (
      !selection
      || selection.selectedReceiptSourceId
        !== input.verifiedNameEquivalence.selectedReceiptSourceId
      || selection.selectedOfficialSourceId
        !== input.verifiedNameEquivalence.selectedOfficialSourceId
      || selection.selectionSourceRef
        !== input.verifiedNameEquivalence.userSelectionSourceRef
      || selection.selectionContentHash
        !== input.verifiedNameEquivalence.userSelectionContentHash
    ) {
      throw new Error("사용자 선택 이름 예외는 같은 동결 선택 증명에 연결되어야 합니다.");
    }
  }
  if (exactNameMatch && input.verifiedNameEquivalence) {
    throw new Error("완전 일치 이름에는 검증된 이름 동등성 예외를 사용할 수 없습니다.");
  }
  if (!exactNameMatch && !input.verifiedNameEquivalence && options.assessmentMode !== "admin_direct") {
    throw new Error("영수증명과 공식 상품명이 다르면 검증된 이름 동등성 근거가 필요합니다.");
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
        || input.target.representativeImageExpectedCurrent?.imageUrl
          !== input.officialListing.image.url
  ) {
    throw new Error("대표 이미지 생성·정확 재사용 상태가 현재 표준 상품과 일치하지 않습니다.");
  }
  assertCompleteAssessment(input, undefined, options.assessmentMode);
  if (input.verifiedNameEquivalence) {
    assertVerifiedNameEquivalence(
      input.verifiedNameEquivalence,
      normalizedReceiptName,
      normalizedOfficialName,
      input.assessment.evidence,
      input.assessment.review,
      `${input.receipt.receiptId}:${input.receipt.receiptItemId}`,
      input.receipt.unitPriceKrw,
      input.officialListing.officialPrice,
      [
        input.officialListing.channelId,
        input.officialListing.sourceProductCodeNamespace,
        input.officialListing.sourceProductCode,
      ].join(":"),
    );
  }
  if (input.target.specificationStatus !== "verified") {
    throw new Error("공식 근거와 일치하는 검증된 규격만 연결할 수 있습니다.");
  }

  const officialHasExplicitPackageCount = hasExplicitPackageCount(
    input.officialListing.sourceNameRaw,
  );
  let officialSpecificationCheck: z.infer<typeof contentSpecificationCheckSchema>
    | z.infer<typeof structuredContentSpecificationCheckSchema>
    | z.infer<typeof apparelSpecificationCheckSchema>
    | z.infer<typeof compositeKitSpecificationCheckSchema>
    | z.infer<typeof wiperBladeSpecificationCheckSchema>;
  let importedOfficialFields: string[];
  if (input.target.apparelSize) {
    const parsedApparelSize = parseOfficialApparelSize(
      input.officialListing.specificationTextRaw,
    );
    if (
      !parsedApparelSize
      || canonicalJson(parsedApparelSize) !== canonicalJson(input.target.apparelSize)
      || input.target.contentAmount !== 1
      || input.target.contentUnit !== "each"
      || input.target.packageCount !== 1
      || input.target.referenceUnit !== 100
    ) {
      throw new Error("공식 의류 사이즈와 적용할 typed apparelSize가 일치하지 않습니다.");
    }
    officialSpecificationCheck = {
      kind: "apparel_size",
      specificationTextRaw: input.officialListing.specificationTextRaw,
      parsedApparelSize,
      matchesTarget: true,
    };
    importedOfficialFields = ["brand", "apparelSize"];
  } else if (input.target.kitComponents) {
    const parsedKitComponents = parseCompositeKitSpecification(
      input.officialListing.specificationTextRaw,
    );
    if (
      !parsedKitComponents
      || canonicalJson(parsedKitComponents) !== canonicalJson(input.target.kitComponents)
      || input.target.contentAmount !== 1
      || input.target.contentUnit !== "each"
      || input.target.packageCount !== 1
      || input.target.referenceUnit !== 100
    ) {
      throw new Error("공식 복합 키트 구성과 적용할 구성품·1 each 판매 단위가 일치하지 않습니다.");
    }
    officialSpecificationCheck = {
      kind: "composite_kit",
      specificationTextRaw: input.officialListing.specificationTextRaw,
      parseRule: "razor_handle_blade_kit_v1",
      parsedSellableContentAmount: 1,
      parsedSellableContentUnit: "each",
      parsedSellablePackageCount: 1,
      kitComponents: parsedKitComponents,
      matchesTarget: true,
    };
    importedOfficialFields = ["brand", "kitComponents"];
  } else if (input.target.wiperBladeFitment) {
    const parsedWiperBladeFitment = parseOfficialWiperBladeFitment(
      input.officialListing.specificationTextRaw,
      input.officialListing.sourceNameRaw,
    );
    if (
      !parsedWiperBladeFitment
      || canonicalJson(parsedWiperBladeFitment) !== canonicalJson(input.target.wiperBladeFitment)
      || input.target.contentAmount !== 1
      || input.target.contentUnit !== "each"
      || input.target.packageCount !== 1
      || input.target.referenceUnit !== 100
    ) {
      throw new Error("공식 와이퍼 길이 규격과 적용할 typed fitment, 1 each 판매 단위가 일치하지 않습니다.");
    }
    officialSpecificationCheck = {
      kind: "wiper_blade_fitment",
      specificationTextRaw: input.officialListing.specificationTextRaw,
      parsedWiperBladeFitment,
      matchesTarget: true,
    };
    importedOfficialFields = ["brand", "wiperBladeFitment"];
  } else {
    const parsedStructuredSpecification = parseStructuredOfficialSpecification(
      input.officialListing.specificationTextRaw,
      input.officialListing.sourceNameRaw,
    );
    const parsedOfficialSpecification = parsedStructuredSpecification
      ? null
      : parseOfficialSpecification(input.officialListing.specificationTextRaw);
    if (!parsedStructuredSpecification && !parsedOfficialSpecification) {
      throw new Error("공식 규격 원문을 내용량과 단위로 엄격하게 해석할 수 없습니다.");
    }
    const officialPackageCount = parsedStructuredSpecification?.packageCount
      ?? inferOfficialPackageCount(input.officialListing.sourceNameRaw);
    const officialContentAmount = parsedStructuredSpecification?.contentAmount
      ?? parsedOfficialSpecification?.contentAmount;
    const officialContentUnit = parsedStructuredSpecification?.contentUnit
      ?? parsedOfficialSpecification?.contentUnit;
    if (
      officialContentAmount !== input.target.contentAmount
      || officialContentUnit !== input.target.contentUnit
      || officialPackageCount !== input.target.packageCount
    ) {
      throw new Error("공식 규격 원문과 적용할 내용량·단위·개수가 일치하지 않습니다.");
    }
    if (parsedStructuredSpecification) {
      officialSpecificationCheck = {
        kind: "structured_content",
        specificationTextRaw: input.officialListing.specificationTextRaw,
        parseRule: parsedStructuredSpecification.parseRule,
        parsedContentAmount: parsedStructuredSpecification.contentAmount,
        parsedContentUnit: parsedStructuredSpecification.contentUnit,
        parsedPackageCount: parsedStructuredSpecification.packageCount,
        packageCountBasis: parsedStructuredSpecification.packageCountBasis,
        ...(parsedStructuredSpecification.parsedTotalContentAmount
          ? { parsedTotalContentAmount: parsedStructuredSpecification.parsedTotalContentAmount }
          : {}),
        ...(parsedStructuredSpecification.matchedOfficialNameFragment
          ? { matchedOfficialNameFragment: parsedStructuredSpecification.matchedOfficialNameFragment }
          : {}),
        matchesTarget: true,
      };
      importedOfficialFields = parsedStructuredSpecification.packageCountBasis
        === "explicit_specification"
        ? ["brand", "contentAmount", "contentUnit", "packageCount"]
        : ["brand", "contentAmount", "contentUnit"];
    } else {
      officialSpecificationCheck = {
        kind: "content",
        specificationTextRaw: input.officialListing.specificationTextRaw,
        parsedContentAmount: parsedOfficialSpecification!.contentAmount,
        parsedContentUnit: parsedOfficialSpecification!.contentUnit,
        parsedPackageCount: officialPackageCount,
        packageCountBasis: officialHasExplicitPackageCount
          ? "explicit"
          : "default_one_absent_count",
        matchesTarget: true,
      };
      importedOfficialFields = officialHasExplicitPackageCount
        ? ["brand", "contentAmount", "contentUnit", "packageCount"]
        : ["brand", "contentAmount", "contentUnit"];
    }
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
    ...(input.officialListing.officialPrice
      ? { officialPrice: { ...input.officialListing.officialPrice } }
      : {}),
    image: { ...input.officialListing.image },
  };
  const inputCanonicalJson = canonicalJson({ receipt, officialListing });
  const inputFingerprint = await sha256CanonicalJson(inputCanonicalJson);
  const sameChannelNameRule = {
    sameChannel: true,
    normalization: "remove_unicode_whitespace_only",
    normalizedReceiptName,
    normalizedOfficialName,
    exactNameMatch,
    outcome: exactNameMatch
      ? "apply_official_identity"
      : input.verifiedNameEquivalence
        ? "apply_verified_name_equivalence"
        : "not_applicable",
    importedOfficialFields,
    ...(input.verifiedNameEquivalence
      ? { verifiedEquivalence: { ...input.verifiedNameEquivalence } }
      : {}),
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
    apparelSize: input.target.apparelSize,
    ...(input.target.kitComponents
      ? { kitComponents: input.target.kitComponents.map((component) => ({ ...component })) }
      : {}),
    ...(input.target.wiperBladeFitment
      ? { wiperBladeFitment: { ...input.target.wiperBladeFitment } }
      : {}),
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
    "update_representative_image",
  ];
  const target = {
    executionMode: "link_only_v1",
    caseId: input.caseId.trim(),
    inputFingerprint,
    approvalPolicy: {
      mode: options.assessmentMode === "admin_direct"
        ? "authenticated_admin_direct_registration"
        : "authenticated_admin_explicit_second_step",
      requiredStatementPrefix: "APPROVE_STANDARD_PRODUCT_LINK",
      statementTemplateVersion: "link-approval-ko-v1",
      oneTimeTargetFingerprint: true,
    },
    sameChannelNameRule,
    ...(input.userSelectedOfficialVariant
      ? { userSelectedOfficialVariant: { ...input.userSelectedOfficialVariant } }
      : {}),
    officialSpecificationCheck,
    normalizedIdentity,
    brandEvidence,
    decision,
    coupangOffer: null,
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
    executionTarget: target,
  };
}

export function rebuildReviewedLinkProposalForAdminTarget(
  proposal: ReviewedLinkProposal,
  identity: {
    targetCanonicalJson: string;
    targetFingerprint: string;
    idempotencyKey: string;
  },
) {
  const executionTarget = strictExecutionTargetSchema.parse(
    JSON.parse(identity.targetCanonicalJson),
  );
  if (canonicalJson(executionTarget) !== identity.targetCanonicalJson) {
    throw new Error("수정된 승인 대상의 canonical JSON이 일치하지 않습니다.");
  }

  return parseReviewedLinkProposalEnvelope(JSON.stringify({
    ...proposal,
    status: "approval_requested",
    sameChannelNameRule: executionTarget.sameChannelNameRule,
    normalizedIdentity: {
      ...proposal.normalizedIdentity,
      brand: executionTarget.normalizedIdentity.brand,
      productFamilyName: executionTarget.normalizedIdentity.productFamilyName,
      variantName: executionTarget.normalizedIdentity.variantName,
      contentAmount: executionTarget.normalizedIdentity.contentAmount,
      contentUnit: executionTarget.normalizedIdentity.contentUnit,
      packageCount: executionTarget.normalizedIdentity.packageCount,
      gtin: executionTarget.normalizedIdentity.gtin,
      ...("apparelSize" in executionTarget.normalizedIdentity
        ? { apparelSize: executionTarget.normalizedIdentity.apparelSize ?? null }
        : {}),
      ...("kitComponents" in executionTarget.normalizedIdentity
        ? { kitComponents: executionTarget.normalizedIdentity.kitComponents ?? null }
        : {}),
      ...("wiperBladeFitment" in executionTarget.normalizedIdentity
        ? { wiperBladeFitment: executionTarget.normalizedIdentity.wiperBladeFitment ?? null }
        : {}),
    },
    decision: executionTarget.decision,
    coupangOffer: executionTarget.coupangOffer ? {
      ...proposal.coupangOffer,
      url: executionTarget.coupangOffer.productUrl,
      totalPriceKrw: executionTarget.coupangOffer.listedPriceKrw,
      quantity: executionTarget.coupangOffer.quantity,
      contentAmount: executionTarget.coupangOffer.contentAmount,
      contentUnit: executionTarget.coupangOffer.contentUnit,
      maxBundleQuantity: executionTarget.coupangOffer.maxBundleQuantity,
      maxBundleTotalPriceKrw: executionTarget.coupangOffer.maxBundleListedPriceKrw,
    } : null,
    representativeImage: executionTarget.representativeImage,
    executionTarget,
    evidence: executionTarget.evidence,
    review: executionTarget.review,
    plannedEffects: executionTarget.plannedEffects,
    approval: {
      status: "requested",
      targetFingerprint: identity.targetFingerprint,
    },
    execution: {
      status: "not_started",
      idempotencyKey: identity.idempotencyKey,
      appliedAt: null,
      result: null,
    },
  }));
}
