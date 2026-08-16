#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { z } from "zod";

const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nullableText = z.string().trim().min(1).nullable();
const dateTime = z.string().datetime({ offset: true });

const receiptSchema = z
  .object({
    receiptId: z.string().trim().min(1),
    receiptItemId: z.string().trim().min(1),
    receiptRevision: z.string().trim().min(1),
    sourceCatalogNamespace: nullableText,
    sourceLabel: z.string().trim().min(1),
    sourceProductCode: z.string().trim().min(1),
    sourceNameRaw: z.string().trim().min(1),
    observedAt: dateTime,
    unitPriceKrw: z.number().int().nonnegative(),
    quantity: z.number().int().positive()
  })
  .strict();

const officialListingSchema = z
  .object({
    channelId: z.string().trim().min(1),
    sourceProductCodeNamespace: z.string().trim().min(1),
    sourceProductCode: z.string().trim().min(1),
    snapshotId: z.string().uuid(),
    snapshotHash: fingerprintSchema,
    sourceNameRaw: z.string().trim().min(1),
    specificationTextRaw: nullableText,
    sourceRefs: z.array(z.string().trim().min(1)).min(1),
    officialPrice: z.object({
      amountKrw: z.number().int().nonnegative(),
      sourceText: z.string().trim().min(1),
      observedAt: dateTime
    }).strict().nullable().optional(),
    image: z.object({
      url: z.string().url().startsWith("https://"),
      contentHash: fingerprintSchema,
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      byteLength: z.number().int().positive()
    }).nullable()
  })
  .strict();

const verifiedNameEquivalenceBaseSchema = z.object({
    scope: z.literal("frozen_receipt_official_pair_only"),
    supportingEvidenceSourceIds: z.array(z.string().trim().min(1)).min(2),
    supportingSourceRefs: z.array(z.string().trim().min(1)).min(2),
    reviewerAgent: z.literal("pricetrace_independent_reviewer"),
    reviewedAt: dateTime,
    conclusion: z.literal("same_exact_sellable_variant")
  });
const verifiedNameEquivalenceSchema = z.discriminatedUnion("method", [
  verifiedNameEquivalenceBaseSchema.extend({
    method: z.literal("single_unicode_code_point_substitution_v1"),
    zeroBasedCodePointIndex: z.number().int().nonnegative(),
    receiptCodePoint: z.string().min(1),
    officialCodePoint: z.string().min(1)
  }).strict(),
  verifiedNameEquivalenceBaseSchema.extend({
    method: z.literal("single_unicode_code_point_insertion_deletion_v1"),
    editDirection: z.enum([
      "insert_official_code_point_into_receipt",
      "delete_receipt_code_point"
    ]),
    zeroBasedEditIndex: z.number().int().nonnegative(),
    editedCodePoint: z.string().min(1),
    receiptCodePointLength: z.number().int().positive(),
    officialCodePointLength: z.number().int().positive(),
    discoverySimilarityBasisPoints: z.number().int().min(9000).max(10000),
    uniqueOfficialCandidate: z.literal(true)
  }).strict(),
  verifiedNameEquivalenceBaseSchema.extend({
    method: z.literal("official_name_contains_receipt_name_v1"),
    zeroBasedOfficialCodePointIndex: z.number().int().nonnegative(),
    receiptCodePointLength: z.number().int().positive(),
    officialCodePointLength: z.number().int().positive(),
    officialPrefix: z.string(),
    officialSuffix: z.string(),
    officialDisplayedPriceKrw: z.number().int().nonnegative(),
    officialPriceObservedAt: dateTime,
    uniqueOfficialCandidate: z.literal(true)
  }).strict(),
  verifiedNameEquivalenceBaseSchema.extend({
    method: z.literal("explicit_user_selected_frozen_pair_v1"),
    selectedReceiptSourceId: z.string().trim().min(1),
    selectedOfficialSourceId: z.string().trim().min(1),
    selectedNormalizedReceiptName: z.string().min(1),
    selectedNormalizedOfficialName: z.string().min(1),
    userSelectionSourceRef: z.string().trim().min(1),
    userSelectionContentHash: fingerprintSchema
  }).strict()
]);

const compositeKitComponentSchema = z.object({
  componentType: z.enum(["razor_handle", "razor_blade"]),
  quantity: z.number().int().positive(),
  unit: z.literal("each")
}).strict();

const wiperBladeFitmentSchema = z.object({
  lengthMm: z.number().int().min(250).max(800)
}).strict();

const sameChannelNameRuleSchema = z
  .object({
    sameChannel: z.boolean(),
    normalization: z.literal("remove_unicode_whitespace_only"),
    normalizedReceiptName: z.string().min(1),
    normalizedOfficialName: z.string().min(1),
    exactNameMatch: z.boolean(),
    outcome: z.enum([
      "apply_official_identity",
      "apply_verified_name_equivalence",
      "discovery_only",
      "not_applicable"
    ]),
    importedOfficialFields: z.array(
      z.enum([
        "brand",
        "contentAmount",
        "contentUnit",
        "packageCount",
        "apparelSize",
        "kitComponents",
        "wiperBladeFitment",
        "gtin"
      ])
    ),
    verifiedEquivalence: verifiedNameEquivalenceSchema.optional()
  })
  .strict();

const apparelSizeSchema = z.object({
  alpha: z.enum(["S", "M", "L", "XL", "XXL", "XXXL"]),
  kr: z.union([
    z.literal(90),
    z.literal(95),
    z.literal(100),
    z.literal(105),
    z.literal(110),
    z.literal(115)
  ]),
  label: z.enum(["S(90)", "M(95)", "L(100)", "XL(105)", "XXL(110)", "XXXL(115)"])
}).strict().superRefine((size, context) => {
  if (`${size.alpha}(${size.kr})` !== size.label) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["label"],
      message: "apparel alpha size and Korean size must match"
    });
  }
});

const normalizedIdentitySchema = z
  .object({
    brand: nullableText,
    productFamilyName: nullableText,
    variantName: nullableText,
    contentAmount: z.number().positive().nullable(),
    contentUnit: z.enum(["g", "ml", "each"]).nullable(),
    packageCount: z.number().int().positive().nullable(),
    gtin: nullableText,
    apparelSize: apparelSizeSchema.nullable().optional(),
    kitComponents: z.array(compositeKitComponentSchema).length(2).nullable().optional(),
    wiperBladeFitment: wiperBladeFitmentSchema.nullable().optional()
  })
  .strict();

const decisionActionSchema = z.enum([
  "reuse_variant",
  "create_variant",
  "create_family_and_variant",
  "insufficient_evidence",
  "reject"
]);

const decisionSchema = z
  .object({
    action: decisionActionSchema,
    standardProductId: z.string().uuid().nullable(),
    catalogProductId: z.string().uuid().nullable(),
    proposedStandardName: nullableText,
    proposedVariantName: nullableText,
    confidence: z.enum(["high", "medium", "low"]),
    matchedFields: z.array(z.string().trim().min(1)),
    conflictingFields: z.array(z.string().trim().min(1)),
    missingFields: z.array(z.string().trim().min(1))
  })
  .strict();

const coupangOfferSchema = z
  .object({
    url: z.string().url(),
    totalPriceKrw: z.number().int().positive(),
    quantity: z.number().int().positive(),
    contentAmount: z.number().positive(),
    contentUnit: z.enum(["g", "ml", "each"]),
    observedAt: dateTime,
    maxBundleQuantity: z.number().int().positive().nullable(),
    maxBundleTotalPriceKrw: z.number().int().positive().nullable()
  })
  .strict();

const evidenceSchema = z
  .object({
    sourceType: z.enum([
      "receipt",
      "official_channel",
      "manufacturer",
      "brand",
      "retailer",
      "coupang",
      "database"
    ]),
    sourceId: z.string().trim().min(1),
    authority: z.enum(["primary", "secondary", "transactional"]),
    url: z.string().url().nullable(),
    capturedAt: dateTime,
    claims: z.array(z.string().trim().min(1)).min(1),
    sourceRefs: z.array(z.string().trim().min(1)).min(1)
  })
  .strict();

const reviewSchema = z
  .object({
    verdict: z.enum(["approve", "needs_more_evidence", "reject"]),
    reviewerAgent: z.string().trim().min(1),
    counterCandidates: z.array(z.string().trim().min(1)),
    conflicts: z.array(z.string().trim().min(1)),
    evidenceQuality: z.enum(["sufficient", "partial", "insufficient"]),
    notes: z.array(z.string().trim().min(1))
  })
  .strict();

const effectSchema = z.enum([
  "reuse_standard_family",
  "create_standard_family",
  "reuse_catalog_variant",
  "create_catalog_variant",
  "link_official_listing",
  "verify_receipt_mapping",
  "register_coupang_offer",
  "update_representative_image"
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
    imageUrl: z.string().url().startsWith("https://")
  }).strict().nullable()
}).strict();

const contentSpecificationCheckSchema = z.object({
  kind: z.literal("content").optional(),
  specificationTextRaw: z.string().trim().min(1),
  parsedContentAmount: z.number().positive(),
  parsedContentUnit: z.enum(["g", "ml", "each"]),
  parsedPackageCount: z.number().int().positive(),
  packageCountBasis: z.enum(["explicit", "default_one_absent_count"]),
  matchesTarget: z.literal(true)
}).strict();

const structuredContentSpecificationCheckSchema = z.object({
  kind: z.literal("structured_content"),
  specificationTextRaw: z.string().trim().min(1),
  parseRule: z.enum([
    "count_only_v1",
    "per_item_times_count_v1",
    "per_item_times_count_with_total_v1",
    "total_amount_per_count_v1",
    "numeric_spec_unit_from_official_name_v1"
  ]),
  parsedContentAmount: z.number().positive(),
  parsedContentUnit: z.enum(["g", "ml", "each"]),
  parsedPackageCount: z.number().int().positive(),
  packageCountBasis: z.enum([
    "explicit_specification",
    "default_one_absent_count"
  ]),
  parsedTotalContentAmount: z.number().positive().optional(),
  matchedOfficialNameFragment: z.string().trim().min(1).optional(),
  matchesTarget: z.literal(true)
}).strict();

const apparelSpecificationCheckSchema = z.object({
  kind: z.literal("apparel_size"),
  specificationTextRaw: z.string().trim().min(1),
  parsedApparelSize: apparelSizeSchema,
  matchesTarget: z.literal(true)
}).strict();

const compositeKitSpecificationCheckSchema = z.object({
  kind: z.literal("composite_kit"),
  specificationTextRaw: z.string().trim().min(1),
  parseRule: z.literal("razor_handle_blade_kit_v1"),
  parsedSellableContentAmount: z.literal(1),
  parsedSellableContentUnit: z.literal("each"),
  parsedSellablePackageCount: z.literal(1),
  kitComponents: z.array(compositeKitComponentSchema).length(2),
  matchesTarget: z.literal(true)
}).strict();

const wiperBladeSpecificationCheckSchema = z.object({
  kind: z.literal("wiper_blade_fitment"),
  specificationTextRaw: z.string().trim().min(1),
  parsedWiperBladeFitment: wiperBladeFitmentSchema,
  matchesTarget: z.literal(true)
}).strict();

const userSelectedOfficialVariantSchema = z.object({
  scope: z.literal("frozen_receipt_official_pair_only"),
  selectedReceiptSourceId: z.string().trim().min(1),
  selectedOfficialSourceId: z.string().trim().min(1),
  selectedSpecificationTextRaw: z.string().trim().min(1),
  selectionSourceRef: z.string().trim().min(1),
  selectionContentHash: fingerprintSchema,
  selectedAt: dateTime
}).strict();

const strictExecutionTargetSchema = z.object({
  executionMode: z.enum(["strict_v6", "link_only_v1"]).optional(),
  caseId: z.string().trim().min(1),
  inputFingerprint: fingerprintSchema,
  approvalPolicy: z.object({
    mode: z.literal("authenticated_admin_explicit_second_step"),
    requiredStatementPrefix: z.literal("APPROVE_STANDARD_PRODUCT_LINK"),
    statementTemplateVersion: z.literal("link-approval-ko-v1"),
    oneTimeTargetFingerprint: z.literal(true)
  }).strict(),
  sameChannelNameRule: sameChannelNameRuleSchema,
  userSelectedOfficialVariant: userSelectedOfficialVariantSchema.optional(),
  officialSpecificationCheck: z.union([
    contentSpecificationCheckSchema,
    structuredContentSpecificationCheckSchema,
    apparelSpecificationCheckSchema,
    compositeKitSpecificationCheckSchema,
    wiperBladeSpecificationCheckSchema
  ]),
  normalizedIdentity: z.object({
    brand: z.string().trim().min(1),
    productFamilyName: z.string().trim().min(1),
    variantName: z.string().trim().min(1),
    specificationStatus: z.literal("verified"),
    contentAmount: z.number().positive(),
    contentUnit: z.enum(["g", "ml", "each"]),
    packageCount: z.number().int().positive(),
    referenceUnit: z.union([z.literal(10), z.literal(100), z.literal(1000)]),
    gtin: z.null(),
    apparelSize: apparelSizeSchema.nullable().optional(),
    kitComponents: z.array(compositeKitComponentSchema).length(2).nullable().optional(),
    wiperBladeFitment: wiperBladeFitmentSchema.nullable().optional()
  }).strict(),
  brandEvidence: z.object({
    canonicalName: z.string().trim().min(1),
    receiptObservedName: nullableText,
    officialObservedName: z.string().trim().min(1),
    officialSourceLabel: z.string().trim().min(1),
    productReferenceUrl: z.string().url()
  }).strict(),
  decision: decisionSchema,
  coupangOffer: z.object({
    productUrl: z.string().url(),
    listedPriceKrw: z.number().int().positive(),
    quantity: z.number().int().positive(),
    contentAmount: z.number().positive(),
    contentUnit: z.enum(["g", "ml", "each"]),
    maxBundleQuantity: z.number().int().positive().nullable(),
    maxBundleListedPriceKrw: z.number().int().positive().nullable()
  }).strict().nullable(),
  representativeImage: representativeImageSchema,
  evidence: z.array(evidenceSchema).min(1),
  review: reviewSchema,
  plannedEffects: z.array(effectSchema).min(1)
}).strict();

const approvalSchema = z
  .object({
    status: z.enum(["not_requested", "requested", "approved", "expired"]),
    approvalRef: nullableText,
    userApprovalText: nullableText,
    approvedAt: dateTime.nullable(),
    targetFingerprint: fingerprintSchema
  })
  .strict();

const executionSchema = z
  .object({
    status: z.enum(["not_started", "applied", "failed", "unknown"]),
    idempotencyKey: z.string().trim().min(1),
    appliedAt: dateTime.nullable(),
    result: z.record(z.string()).nullable()
  })
  .strict();

const proposalSchema = z
  .object({
    schemaVersion: z.literal("pricetrace-link-proposal.v3"),
    caseId: z.string().trim().min(1),
    status: z.enum([
      "draft",
      "insufficient_evidence",
      "rejected",
      "approval_requested",
      "approved",
      "applied",
      "failed",
      "unknown"
    ]),
    inputFingerprint: fingerprintSchema,
    receipt: receiptSchema,
    officialListing: officialListingSchema,
    sameChannelNameRule: sameChannelNameRuleSchema,
    normalizedIdentity: normalizedIdentitySchema,
    decision: decisionSchema,
    coupangOffer: coupangOfferSchema.nullable(),
    representativeImage: representativeImageSchema.nullable(),
    executionTarget: strictExecutionTargetSchema.nullable(),
    evidence: z.array(evidenceSchema).min(1),
    review: reviewSchema,
    plannedEffects: z.array(effectSchema),
    approval: approvalSchema,
    execution: executionSchema
  })
  .strict()
  .superRefine((proposal, context) => {
    const issue = (path, message) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });

    if (new Set(proposal.plannedEffects).size !== proposal.plannedEffects.length) {
      issue(["plannedEffects"], "plannedEffects must not contain duplicates");
    }

    const nameRule = proposal.sameChannelNameRule;
    const normalizedReceiptName = normalizeSameChannelName(
      proposal.receipt.sourceNameRaw
    );
    const normalizedOfficialName = normalizeSameChannelName(
      proposal.officialListing.sourceNameRaw
    );
    const sameChannel =
      proposal.receipt.sourceCatalogNamespace !== null &&
      proposal.receipt.sourceCatalogNamespace ===
        proposal.officialListing.channelId;
    const exactNameMatch = normalizedReceiptName === normalizedOfficialName;

    if (nameRule.normalizedReceiptName !== normalizedReceiptName) {
      issue(
        ["sameChannelNameRule", "normalizedReceiptName"],
        `expected ${normalizedReceiptName}`
      );
    }
    if (nameRule.normalizedOfficialName !== normalizedOfficialName) {
      issue(
        ["sameChannelNameRule", "normalizedOfficialName"],
        `expected ${normalizedOfficialName}`
      );
    }
    if (nameRule.sameChannel !== sameChannel) {
      issue(
        ["sameChannelNameRule", "sameChannel"],
        `expected ${sameChannel} from receipt.sourceCatalogNamespace and officialListing.channelId`
      );
    }
    if (nameRule.exactNameMatch !== exactNameMatch) {
      issue(
        ["sameChannelNameRule", "exactNameMatch"],
        `expected ${exactNameMatch} after removing Unicode whitespace only`
      );
    }
    if (
      new Set(nameRule.importedOfficialFields).size !==
      nameRule.importedOfficialFields.length
    ) {
      issue(
        ["sameChannelNameRule", "importedOfficialFields"],
        "importedOfficialFields must not contain duplicates"
      );
    }

    const decision = proposal.decision;
    const requiredOfficialIdentityFields = proposal.normalizedIdentity.apparelSize
      ? ["brand", "apparelSize"]
      : proposal.normalizedIdentity.kitComponents
        ? ["brand", "kitComponents"]
        : proposal.normalizedIdentity.wiperBladeFitment
          ? ["brand", "wiperBladeFitment"]
          : ["brand", "contentAmount", "contentUnit"];
    if (sameChannel && exactNameMatch) {
      if (nameRule.outcome !== "apply_official_identity") {
        issue(
          ["sameChannelNameRule", "outcome"],
          "same-channel exact names require apply_official_identity"
        );
      }
      if (nameRule.verifiedEquivalence) {
        issue(
          ["sameChannelNameRule", "verifiedEquivalence"],
          "exact names cannot use a verified-name-equivalence exception"
        );
      }

      for (const requiredField of requiredOfficialIdentityFields) {
        if (!nameRule.importedOfficialFields.includes(requiredField)) {
          issue(
            ["sameChannelNameRule", "importedOfficialFields"],
            `apply_official_identity requires ${requiredField}`
          );
        }
      }

      for (const importedField of nameRule.importedOfficialFields) {
        if (proposal.normalizedIdentity[importedField] == null) {
          issue(
            ["normalizedIdentity", importedField],
            `${importedField} must be non-null when imported from official evidence`
          );
        }
      }
    } else if (sameChannel) {
      if (nameRule.outcome === "apply_verified_name_equivalence") {
        const proof = nameRule.verifiedEquivalence;
        if (!proof) {
          issue(
            ["sameChannelNameRule", "verifiedEquivalence"],
            "verified name equivalence requires an audited proof"
          );
        } else {
          const receiptCodePoints = Array.from(normalizedReceiptName);
          const officialCodePoints = Array.from(normalizedOfficialName);
          if (proof.method === "single_unicode_code_point_substitution_v1") {
            const differingIndexes = receiptCodePoints.flatMap((value, index) =>
              value === officialCodePoints[index] ? [] : [index]
            );
            const differenceIndex = differingIndexes[0];
            if (
              receiptCodePoints.length !== officialCodePoints.length ||
              differingIndexes.length !== 1 ||
              proof.zeroBasedCodePointIndex !== differenceIndex ||
              proof.receiptCodePoint !== receiptCodePoints[differenceIndex] ||
              proof.officialCodePoint !== officialCodePoints[differenceIndex]
            ) {
              issue(
                ["sameChannelNameRule", "verifiedEquivalence"],
                "verified equivalence must match exactly one Unicode code-point substitution in the frozen names"
              );
            }
          } else if (proof.method === "single_unicode_code_point_insertion_deletion_v1") {
            const derivedEdit = deriveSingleCodePointInsertionDeletion(
              receiptCodePoints,
              officialCodePoints
            );
            const similarityBasisPoints = discoverySimilarityBasisPoints(
              normalizedReceiptName,
              normalizedOfficialName
            );
            if (
              !derivedEdit ||
              proof.editDirection !== derivedEdit.editDirection ||
              proof.zeroBasedEditIndex !== derivedEdit.zeroBasedEditIndex ||
              proof.editedCodePoint !== derivedEdit.editedCodePoint ||
              proof.receiptCodePointLength !== receiptCodePoints.length ||
              proof.officialCodePointLength !== officialCodePoints.length ||
              proof.discoverySimilarityBasisPoints !== similarityBasisPoints ||
              similarityBasisPoints < 9000 ||
              proof.uniqueOfficialCandidate !== true
            ) {
              issue(
                ["sameChannelNameRule", "verifiedEquivalence"],
                "verified equivalence must match one >=90% Unicode code-point insertion or deletion in the frozen names"
              );
            }
          } else if (proof.method === "official_name_contains_receipt_name_v1") {
            const occurrenceIndexes = officialCodePoints.flatMap((_, index) =>
              receiptCodePoints.every((value, offset) =>
                officialCodePoints[index + offset] === value
              ) ? [index] : []
            );
            const occurrenceIndex = occurrenceIndexes[0];
            const officialPrefix = officialCodePoints.slice(0, occurrenceIndex).join("");
            const officialSuffix = officialCodePoints
              .slice(occurrenceIndex + receiptCodePoints.length)
              .join("");
            const officialPrice = proposal.officialListing.officialPrice;
            if (
              receiptCodePoints.length < 6 ||
              officialCodePoints.length <= receiptCodePoints.length ||
              receiptCodePoints.length / officialCodePoints.length < 0.6 ||
              occurrenceIndexes.length !== 1 ||
              proof.zeroBasedOfficialCodePointIndex !== occurrenceIndex ||
              proof.receiptCodePointLength !== receiptCodePoints.length ||
              proof.officialCodePointLength !== officialCodePoints.length ||
              proof.officialPrefix !== officialPrefix ||
              proof.officialSuffix !== officialSuffix ||
              proof.officialDisplayedPriceKrw !== proposal.receipt.unitPriceKrw ||
              officialPrice?.amountKrw !== proof.officialDisplayedPriceKrw ||
              officialPrice?.observedAt !== proof.officialPriceObservedAt
            ) {
              issue(
                ["sameChannelNameRule", "verifiedEquivalence"],
                "verified containment must freeze one unique official-name occurrence, its exact surrounding text, and an official price equal to the receipt unit price"
              );
            }
          } else {
            const officialSourceId = [
              proposal.officialListing.channelId,
              proposal.officialListing.sourceProductCodeNamespace,
              proposal.officialListing.sourceProductCode
            ].join(":");
            const receiptSourceId = `${proposal.receipt.receiptId}:${proposal.receipt.receiptItemId}`;
            if (
              proof.selectedReceiptSourceId !== receiptSourceId ||
              proof.selectedOfficialSourceId !== officialSourceId ||
              proof.selectedNormalizedReceiptName !== normalizedReceiptName ||
              proof.selectedNormalizedOfficialName !== normalizedOfficialName
            ) {
              issue(
                ["sameChannelNameRule", "verifiedEquivalence"],
                "explicit user selection must bind the frozen receipt row and official listing identity"
              );
            }
          }
          const sourceIds = new Set(proof.supportingEvidenceSourceIds);
          const sourceRefs = new Set(proof.supportingSourceRefs);
          if (sourceIds.size !== proof.supportingEvidenceSourceIds.length) {
            issue(
              ["sameChannelNameRule", "verifiedEquivalence", "supportingEvidenceSourceIds"],
              "supporting evidence source IDs must be unique"
            );
          }
          if (sourceRefs.size !== proof.supportingSourceRefs.length) {
            issue(
              ["sameChannelNameRule", "verifiedEquivalence", "supportingSourceRefs"],
              "supporting source refs must be unique"
            );
          }
          const supportingEvidence = proposal.evidence.filter((item) =>
            sourceIds.has(item.sourceId)
          );
          const officialSourceId = [
            proposal.officialListing.channelId,
            proposal.officialListing.sourceProductCodeNamespace,
            proposal.officialListing.sourceProductCode
          ].join(":");
          const hasOfficialEvidence = supportingEvidence.some((item) =>
            item.sourceType === "official_channel" &&
            item.authority === "primary" &&
            item.sourceId === officialSourceId
          );
          const hasIndependentPrimaryEvidence = supportingEvidence.some((item) =>
            ["manufacturer", "brand"].includes(item.sourceType) &&
            item.authority === "primary"
          );
          const receiptSourceId = `${proposal.receipt.receiptId}:${proposal.receipt.receiptItemId}`;
          const hasReceiptEvidence = supportingEvidence.some((item) =>
            item.sourceType === "receipt" &&
            item.authority === "transactional" &&
            item.sourceId === receiptSourceId
          );
          const evidenceRefs = new Set(
            supportingEvidence.flatMap((item) => item.sourceRefs)
          );
          if (
            supportingEvidence.length !== sourceIds.size ||
            !hasOfficialEvidence ||
            (proof.method !== "official_name_contains_receipt_name_v1"
              ? !hasIndependentPrimaryEvidence
              : !hasReceiptEvidence) ||
            (proof.method === "explicit_user_selected_frozen_pair_v1" && !hasReceiptEvidence) ||
            [...sourceRefs].some((sourceRef) => !evidenceRefs.has(sourceRef))
          ) {
            issue(
              ["sameChannelNameRule", "verifiedEquivalence"],
              proof.method !== "official_name_contains_receipt_name_v1"
                ? "verified equivalence requires matching official-channel and manufacturer/brand primary evidence"
                : "verified containment requires the frozen receipt row and matching official-channel name and price evidence"
            );
          }
          if (
            proof.reviewerAgent !== proposal.review.reviewerAgent ||
            proposal.review.verdict !== "approve" ||
            proposal.review.evidenceQuality !== "sufficient" ||
            proposal.review.conflicts.length > 0
          ) {
            issue(
              ["review"],
              "verified equivalence requires a sufficient conflict-free independent approval"
            );
          }
        }
        for (const requiredField of requiredOfficialIdentityFields) {
          if (!nameRule.importedOfficialFields.includes(requiredField)) {
            issue(
              ["sameChannelNameRule", "importedOfficialFields"],
              `apply_verified_name_equivalence requires ${requiredField}`
            );
          }
        }
        for (const importedField of nameRule.importedOfficialFields) {
          if (proposal.normalizedIdentity[importedField] == null) {
            issue(
              ["normalizedIdentity", importedField],
              `${importedField} must be non-null when imported from verified official evidence`
            );
          }
        }
      } else {
        if (nameRule.outcome !== "discovery_only") {
          issue(
            ["sameChannelNameRule", "outcome"],
            "unverified same-channel name mismatches are discovery_only"
          );
        }
        if (nameRule.verifiedEquivalence) {
          issue(
            ["sameChannelNameRule", "verifiedEquivalence"],
            "discovery_only cannot retain an apply proof"
          );
        }
        if (nameRule.importedOfficialFields.length > 0) {
          issue(
            ["sameChannelNameRule", "importedOfficialFields"],
            "discovery_only cannot import official identity fields"
          );
        }
        if (!["insufficient_evidence", "reject"].includes(decision.action)) {
          issue(
            ["decision", "action"],
            "discovery_only permits only insufficient_evidence or reject"
          );
        }
        if (proposal.plannedEffects.length > 0) {
          issue(
            ["plannedEffects"],
            "discovery_only cannot plan link, mapping, catalog, or registration effects"
          );
        }
        if (
          !["draft", "insufficient_evidence", "rejected"].includes(
            proposal.status
          )
        ) {
          issue(
            ["status"],
            "discovery_only cannot enter approval or execution states"
          );
        }
        if (proposal.approval.status !== "not_requested") {
          issue(
            ["approval", "status"],
            "discovery_only approval must remain not_requested"
          );
        }
        if (proposal.execution.status !== "not_started") {
          issue(
            ["execution", "status"],
            "discovery_only execution must remain not_started"
          );
        }
        if (proposal.review.verdict === "approve") {
          issue(
            ["review", "verdict"],
            "discovery_only cannot receive an approve verdict"
          );
        }
      }
    } else {
      if (nameRule.outcome !== "not_applicable") {
        issue(
          ["sameChannelNameRule", "outcome"],
          "different or unknown catalog channels require not_applicable"
        );
      }
      if (nameRule.importedOfficialFields.length > 0) {
        issue(
          ["sameChannelNameRule", "importedOfficialFields"],
          "not_applicable cannot import official identity fields"
        );
      }
      if (nameRule.verifiedEquivalence) {
        issue(
          ["sameChannelNameRule", "verifiedEquivalence"],
          "not_applicable cannot use a verified equivalence proof"
        );
      }
    }

    if (
      decision.action === "reuse_variant" &&
      (!decision.standardProductId || !decision.catalogProductId)
    ) {
      issue(
        ["decision"],
        "reuse_variant requires standardProductId and catalogProductId"
      );
    }

    if (
      decision.action === "create_variant" &&
      (!decision.standardProductId ||
        decision.catalogProductId ||
        !decision.proposedVariantName)
    ) {
      issue(
        ["decision"],
        "create_variant requires an existing family, no catalog ID, and a proposed variant name"
      );
    }

    if (
      decision.action === "create_family_and_variant" &&
      (decision.standardProductId ||
        decision.catalogProductId ||
        !decision.proposedStandardName ||
        !decision.proposedVariantName)
    ) {
      issue(
        ["decision"],
        "create_family_and_variant requires no existing IDs and both proposed names"
      );
    }

    const terminalNoWrite = ["insufficient_evidence", "reject"].includes(
      decision.action
    );
    if (terminalNoWrite && proposal.plannedEffects.length > 0) {
      issue(
        ["plannedEffects"],
        "insufficient_evidence and reject actions cannot plan writes"
      );
    }

    const positiveDecision = !terminalNoWrite;
    const requiresStrictExecutionTarget = positiveDecision && [
      "approval_requested",
      "approved",
      "applied",
      "failed",
      "unknown"
    ].includes(proposal.status);
    if (requiresStrictExecutionTarget && !proposal.executionTarget) {
      issue(
        ["executionTarget"],
        "approval and execution states require the exact strict-v6 canonical target"
      );
    }

    if (proposal.executionTarget) {
      const target = proposal.executionTarget;
      const executionMode = target.executionMode ?? "strict_v6";
      const targetIdentitySummary = {
        brand: target.normalizedIdentity.brand,
        productFamilyName: target.normalizedIdentity.productFamilyName,
        variantName: target.normalizedIdentity.variantName,
        contentAmount: target.normalizedIdentity.contentAmount,
        contentUnit: target.normalizedIdentity.contentUnit,
        packageCount: target.normalizedIdentity.packageCount,
        gtin: target.normalizedIdentity.gtin,
        ...(Object.hasOwn(target.normalizedIdentity, "apparelSize")
          ? { apparelSize: target.normalizedIdentity.apparelSize ?? null }
          : {}),
        ...(Object.hasOwn(target.normalizedIdentity, "kitComponents")
          ? { kitComponents: target.normalizedIdentity.kitComponents ?? null }
          : {}),
        ...(Object.hasOwn(target.normalizedIdentity, "wiperBladeFitment")
          ? { wiperBladeFitment: target.normalizedIdentity.wiperBladeFitment ?? null }
          : {})
      };
      const targetCoupangSummary = proposal.coupangOffer && {
        productUrl: proposal.coupangOffer.url,
        listedPriceKrw: proposal.coupangOffer.totalPriceKrw,
        quantity: proposal.coupangOffer.quantity,
        contentAmount: proposal.coupangOffer.contentAmount,
        contentUnit: proposal.coupangOffer.contentUnit,
        maxBundleQuantity: proposal.coupangOffer.maxBundleQuantity,
        maxBundleListedPriceKrw:
          proposal.coupangOffer.maxBundleTotalPriceKrw
      };
      const expectedEffects = [
        decision.standardProductId
          ? "reuse_standard_family"
          : "create_standard_family",
        decision.catalogProductId
          ? "reuse_catalog_variant"
          : "create_catalog_variant",
        "link_official_listing",
        "verify_receipt_mapping",
        ...(executionMode === "strict_v6" ? ["register_coupang_offer"] : []),
        "update_representative_image"
      ];
      const parsedSpecification = parseStrictSpecification(
        proposal.officialListing.specificationTextRaw
      );
      const parsedStructuredSpecification = parseStructuredSpecification(
        proposal.officialListing.specificationTextRaw,
        proposal.officialListing.sourceNameRaw
      );
      const parsedCompositeKit = parseCompositeKitSpecification(
        proposal.officialListing.specificationTextRaw
      );
      const parsedWiperBladeFitment = parseWiperBladeFitment(
        proposal.officialListing.specificationTextRaw,
        proposal.officialListing.sourceNameRaw
      );

      if (target.caseId !== proposal.caseId) {
        issue(["executionTarget", "caseId"], "must match caseId");
      }
      if (target.inputFingerprint !== proposal.inputFingerprint) {
        issue(
          ["executionTarget", "inputFingerprint"],
          "must match inputFingerprint"
        );
      }
      if (!sameCanonicalValue(target.sameChannelNameRule, nameRule)) {
        issue(
          ["executionTarget", "sameChannelNameRule"],
          "must match the reviewed same-channel rule"
        );
      }
      if (!sameCanonicalValue(targetIdentitySummary, proposal.normalizedIdentity)) {
        issue(
          ["executionTarget", "normalizedIdentity"],
          "must match the reviewed identity summary"
        );
      }
      if (!sameCanonicalValue(target.decision, decision)) {
        issue(
          ["executionTarget", "decision"],
          "must match the reviewed decision"
        );
      }
      if (target.userSelectedOfficialVariant) {
        const expectedReceiptSourceId = `${proposal.receipt.receiptId}:${proposal.receipt.receiptItemId}`;
        const expectedOfficialSourceId = [
          proposal.officialListing.channelId,
          proposal.officialListing.sourceProductCodeNamespace,
          proposal.officialListing.sourceProductCode
        ].join(":");
        if (
          target.userSelectedOfficialVariant.selectedReceiptSourceId !== expectedReceiptSourceId ||
          target.userSelectedOfficialVariant.selectedOfficialSourceId !== expectedOfficialSourceId ||
          target.userSelectedOfficialVariant.selectedSpecificationTextRaw !==
            proposal.officialListing.specificationTextRaw
        ) {
          issue(
            ["executionTarget", "userSelectedOfficialVariant"],
            "user selection must bind the frozen receipt row, official listing, and specification"
          );
        }
      }
      if (
        nameRule.verifiedEquivalence?.method === "explicit_user_selected_frozen_pair_v1"
      ) {
        const proof = nameRule.verifiedEquivalence;
        const selection = target.userSelectedOfficialVariant;
        if (
          !selection ||
          selection.selectedReceiptSourceId !== proof.selectedReceiptSourceId ||
          selection.selectedOfficialSourceId !== proof.selectedOfficialSourceId ||
          selection.selectionSourceRef !== proof.userSelectionSourceRef ||
          selection.selectionContentHash !== proof.userSelectionContentHash
        ) {
          issue(
            ["executionTarget", "userSelectedOfficialVariant"],
            "explicit user name equivalence requires the same frozen selection in the fingerprinted target"
          );
        }
      }
      if (
        (executionMode === "strict_v6" && (!target.coupangOffer || !proposal.coupangOffer)) ||
        (executionMode === "link_only_v1" && (target.coupangOffer || proposal.coupangOffer))
      ) {
        issue(
          ["executionTarget", "coupangOffer"],
          executionMode === "strict_v6"
            ? "strict_v6 requires an exact Coupang option"
            : "link_only_v1 must not contain a Coupang option"
        );
      }
      if (!sameCanonicalValue(target.coupangOffer, targetCoupangSummary)) {
        issue(
          ["executionTarget", "coupangOffer"],
          "must match the reviewed exact Coupang option"
        );
      }
      if (!sameCanonicalValue(target.representativeImage, proposal.representativeImage)) {
        issue(
          ["executionTarget", "representativeImage"],
          "must match the reviewed representative image"
        );
      }
      if (!sameCanonicalValue(target.evidence, proposal.evidence)) {
        issue(
          ["executionTarget", "evidence"],
          "must match the reviewed evidence"
        );
      }
      if (!sameCanonicalValue(target.review, proposal.review)) {
        issue(
          ["executionTarget", "review"],
          "must match the independent review"
        );
      }
      if (
        !sameCanonicalValue(target.plannedEffects, proposal.plannedEffects) ||
        !sameCanonicalValue(target.plannedEffects, expectedEffects)
      ) {
        issue(
          ["executionTarget", "plannedEffects"],
          `must exactly match the ${executionMode} effect order`
        );
      }
      const specificationCheck = target.officialSpecificationCheck;
      if (specificationCheck.kind === "apparel_size") {
        const parsedApparelSize = parseApparelSize(
          proposal.officialListing.specificationTextRaw
        );
        if (
          specificationCheck.specificationTextRaw !==
            proposal.officialListing.specificationTextRaw ||
          !parsedApparelSize ||
          !sameCanonicalValue(specificationCheck.parsedApparelSize, parsedApparelSize) ||
          !sameCanonicalValue(
            specificationCheck.parsedApparelSize,
            target.normalizedIdentity.apparelSize
          ) ||
          target.normalizedIdentity.contentAmount !== 1 ||
          target.normalizedIdentity.contentUnit !== "each" ||
          target.normalizedIdentity.packageCount !== 1 ||
          target.normalizedIdentity.referenceUnit !== 100 ||
          !nameRule.importedOfficialFields.includes("apparelSize")
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck"],
            "apparel specification must preserve the official numeric size and a separate typed apparelSize"
          );
        }
      } else if (specificationCheck.kind === "composite_kit") {
        const expectedCompositeCheck = parsedCompositeKit && {
          kind: "composite_kit",
          specificationTextRaw: proposal.officialListing.specificationTextRaw,
          parseRule: "razor_handle_blade_kit_v1",
          parsedSellableContentAmount: 1,
          parsedSellableContentUnit: "each",
          parsedSellablePackageCount: 1,
          kitComponents: parsedCompositeKit,
          matchesTarget: true
        };
        if (
          !expectedCompositeCheck ||
          !sameCanonicalValue(specificationCheck, expectedCompositeCheck) ||
          !sameCanonicalValue(specificationCheck.kitComponents, target.normalizedIdentity.kitComponents) ||
          target.normalizedIdentity.contentAmount !== 1 ||
          target.normalizedIdentity.contentUnit !== "each" ||
          target.normalizedIdentity.packageCount !== 1 ||
          target.normalizedIdentity.referenceUnit !== 100 ||
          !nameRule.importedOfficialFields.includes("kitComponents")
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck"],
            "composite kit must preserve the reproducible components and one sellable each"
          );
        }
      } else if (specificationCheck.kind === "wiper_blade_fitment") {
        if (
          specificationCheck.specificationTextRaw !== proposal.officialListing.specificationTextRaw ||
          !parsedWiperBladeFitment ||
          !sameCanonicalValue(specificationCheck.parsedWiperBladeFitment, parsedWiperBladeFitment) ||
          !sameCanonicalValue(target.normalizedIdentity.wiperBladeFitment, parsedWiperBladeFitment) ||
          target.normalizedIdentity.contentAmount !== 1 ||
          target.normalizedIdentity.contentUnit !== "each" ||
          target.normalizedIdentity.packageCount !== 1 ||
          target.normalizedIdentity.referenceUnit !== 100 ||
          !nameRule.importedOfficialFields.includes("wiperBladeFitment")
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck"],
            "wiper fitment must preserve a 250-800mm official wiper length and one sellable each"
          );
        }
      } else if (specificationCheck.kind === "structured_content") {
        const expectedStructuredCheck = parsedStructuredSpecification && {
          kind: "structured_content",
          specificationTextRaw: proposal.officialListing.specificationTextRaw,
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
          matchesTarget: true
        };
        if (
          !expectedStructuredCheck ||
          !sameCanonicalValue(specificationCheck, expectedStructuredCheck) ||
          specificationCheck.parsedContentAmount !== target.normalizedIdentity.contentAmount ||
          specificationCheck.parsedContentUnit !== target.normalizedIdentity.contentUnit ||
          specificationCheck.parsedPackageCount !== target.normalizedIdentity.packageCount
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck"],
            "structured specification must be independently reproducible from the frozen official fields"
          );
        }
        if (
          ["total_amount_per_count_v1", "per_item_times_count_with_total_v1"].includes(specificationCheck.parseRule) &&
          specificationCheck.parsedTotalContentAmount !==
            specificationCheck.parsedContentAmount * specificationCheck.parsedPackageCount
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck", "parsedTotalContentAmount"],
            "total amount must equal per-item content amount times package count"
          );
        }
        if (
          specificationCheck.packageCountBasis === "explicit_specification" &&
          !nameRule.importedOfficialFields.includes("packageCount")
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck", "packageCountBasis"],
            "explicit structured package count must import packageCount"
          );
        }
        if (
          specificationCheck.packageCountBasis === "default_one_absent_count" &&
          (target.normalizedIdentity.packageCount !== 1 ||
            nameRule.importedOfficialFields.includes("packageCount"))
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck", "packageCountBasis"],
            "default structured package count requires one and cannot import packageCount"
          );
        }
      } else {
        if (
          specificationCheck.specificationTextRaw !==
            proposal.officialListing.specificationTextRaw ||
          !parsedSpecification ||
          specificationCheck.parsedContentAmount !== parsedSpecification.contentAmount ||
          specificationCheck.parsedContentUnit !== parsedSpecification.contentUnit ||
          specificationCheck.parsedContentAmount !== target.normalizedIdentity.contentAmount ||
          specificationCheck.parsedContentUnit !== target.normalizedIdentity.contentUnit ||
          specificationCheck.parsedPackageCount !== target.normalizedIdentity.packageCount
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck"],
            "must match the frozen official specification and target variant"
          );
        }
        if (
          specificationCheck.packageCountBasis === "default_one_absent_count" &&
          (target.normalizedIdentity.packageCount !== 1 ||
            nameRule.importedOfficialFields.includes("packageCount"))
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck", "packageCountBasis"],
            "default package count requires one and cannot import packageCount"
          );
        }
        if (
          specificationCheck.packageCountBasis === "explicit" &&
          !nameRule.importedOfficialFields.includes("packageCount")
        ) {
          issue(
            ["executionTarget", "officialSpecificationCheck", "packageCountBasis"],
            "explicit package count must import packageCount"
          );
        }
      }
      if (target.brandEvidence.canonicalName !== proposal.normalizedIdentity.brand) {
        issue(
          ["executionTarget", "brandEvidence", "canonicalName"],
          "must match normalizedIdentity.brand"
        );
      }
      if (
        target.review.reviewerAgent !== "pricetrace_independent_reviewer" ||
        target.decision.matchedFields.length === 0
      ) {
        issue(
          ["executionTarget"],
          "must satisfy the current strict-v6 reviewer and non-empty matched-field contract"
        );
      }
    }

    const sourceTypes = new Set(proposal.evidence.map((item) => item.sourceType));
    if (
      positiveDecision &&
      (!sourceTypes.has("receipt") || !sourceTypes.has("official_channel"))
    ) {
      issue(
        ["evidence"],
        "a positive decision requires receipt and official_channel evidence"
      );
    }

    if (
      proposal.plannedEffects.includes("register_coupang_offer") &&
      (!proposal.coupangOffer || !sourceTypes.has("coupang"))
    ) {
      issue(
        ["coupangOffer"],
        "register_coupang_offer requires an offer and Coupang evidence"
      );
    }

    const imageEffect = proposal.plannedEffects.includes(
      "update_representative_image"
    );
    if (positiveDecision && proposal.status === "approval_requested") {
      if (!proposal.officialListing.image || !proposal.representativeImage) {
        issue(
          ["representativeImage"],
          "approval_requested requires a frozen official image and family representative-image target"
        );
      }
      if (!imageEffect) {
        issue(
          ["plannedEffects"],
          "approval_requested requires update_representative_image"
        );
      }
      const officialSourceId = [
        proposal.officialListing.channelId,
        proposal.officialListing.sourceProductCodeNamespace,
        proposal.officialListing.sourceProductCode
      ].join(":");
      const hasImageProvenance = proposal.evidence.some((item) =>
        item.sourceType === "official_channel" &&
        item.authority === "primary" &&
        item.sourceId === officialSourceId &&
        item.sourceRefs.some((sourceRef) =>
          proposal.officialListing.sourceRefs.includes(sourceRef)
        )
      );
      if (!hasImageProvenance) {
        issue(
          ["evidence"],
          "official representative image requires matching primary snapshot provenance"
        );
      }
    }
    if (imageEffect && (!proposal.officialListing.image || !proposal.representativeImage)) {
      issue(
        ["representativeImage"],
        "update_representative_image requires frozen official image metadata"
      );
    }
    if (proposal.officialListing.image && proposal.representativeImage) {
      const image = proposal.officialListing.image;
      const targetImage = proposal.representativeImage;
      if (
        targetImage.imageUrl !== image.url ||
        targetImage.contentHash !== image.contentHash ||
        targetImage.mediaType !== image.mediaType ||
        targetImage.byteLength !== image.byteLength
      ) {
        issue(
          ["representativeImage"],
          "representative image must exactly match the frozen official image"
        );
      }
      if (targetImage.action === "create" && targetImage.expectedCurrent !== null) {
        issue(
          ["representativeImage", "expectedCurrent"],
          "create requires expectedCurrent = null"
        );
      }
      if (
        targetImage.action === "reuse_exact" &&
        (!targetImage.expectedCurrent ||
          targetImage.expectedCurrent.imageUrl !== targetImage.imageUrl)
      ) {
        issue(
          ["representativeImage", "expectedCurrent"],
          "reuse_exact requires the same existing external image URL"
        );
      }
    }

    if (proposal.coupangOffer) {
      const hasMaxQuantity = proposal.coupangOffer.maxBundleQuantity !== null;
      const hasMaxPrice =
        proposal.coupangOffer.maxBundleTotalPriceKrw !== null;
      if (hasMaxQuantity !== hasMaxPrice) {
        issue(
          ["coupangOffer"],
          "max bundle quantity and total price must be both present or both null"
        );
      }
    }

    if (
      proposal.review.verdict === "approve" &&
      (proposal.review.evidenceQuality !== "sufficient" ||
        proposal.review.conflicts.length > 0 ||
        decision.conflictingFields.length > 0)
    ) {
      issue(
        ["review"],
        "approve requires sufficient evidence and no unresolved conflicts"
      );
    }

    if (
      proposal.status === "approval_requested" &&
      (proposal.review.verdict !== "approve" ||
        proposal.approval.status !== "requested")
    ) {
      issue(
        ["status"],
        "approval_requested requires an approved review and requested approval"
      );
    }

    if (proposal.status === "approval_requested") {
      if (terminalNoWrite) {
        issue(
          ["decision", "action"],
          "approval_requested requires a positive decision"
        );
      }
      if (proposal.decision.missingFields.length > 0) {
        issue(
          ["decision", "missingFields"],
          "approval_requested requires no blocking missing fields"
        );
      }
      if (proposal.plannedEffects.length === 0) {
        issue(
          ["plannedEffects"],
          "approval_requested requires a non-empty exact effect allowlist"
        );
      }
      if (proposal.execution.status !== "not_started") {
        issue(
          ["execution", "status"],
          "approval_requested requires execution to remain not_started"
        );
      }
    }

    if (
      ["approved", "applied", "failed", "unknown"].includes(proposal.status) &&
      (proposal.approval.status !== "approved" ||
        !proposal.approval.approvalRef ||
        !proposal.approval.userApprovalText ||
        !proposal.approval.approvedAt)
    ) {
      issue(
        ["approval"],
        "approved or execution states require complete approval metadata"
      );
    }

    if (
      proposal.execution.status === "applied" &&
      (proposal.status !== "applied" ||
        proposal.approval.status !== "approved" ||
        !proposal.execution.appliedAt ||
        !proposal.execution.result)
    ) {
      issue(
        ["execution"],
        "applied execution requires applied proposal status, approval, timestamp, and result"
      );
    }

    if (
      proposal.status === "insufficient_evidence" &&
      (proposal.decision.action !== "insufficient_evidence" ||
        proposal.review.verdict !== "needs_more_evidence")
    ) {
      issue(
        ["status"],
        "insufficient_evidence status requires the matching decision and review verdict"
      );
    }

    if (
      proposal.status === "rejected" &&
      (proposal.decision.action !== "reject" ||
        proposal.review.verdict !== "reject")
    ) {
      issue(
        ["status"],
        "rejected status requires the matching decision and review verdict"
      );
    }
  });

function normalizeSameChannelName(value) {
  return value.replace(/\p{White_Space}+/gu, "");
}

function normalizeDiscoveryName(value) {
  return value.replace(/[^0-9A-Za-z가-힣]+/g, "").toLocaleLowerCase("ko-KR");
}

function editDistance(left, right) {
  const leftCodePoints = Array.from(left);
  const rightCodePoints = Array.from(right);
  let previous = Array.from({ length: rightCodePoints.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= leftCodePoints.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= rightCodePoints.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1]
          + (leftCodePoints[leftIndex - 1] === rightCodePoints[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[rightCodePoints.length];
}

function discoverySimilarityBasisPoints(left, right) {
  const normalizedLeft = normalizeDiscoveryName(left);
  const normalizedRight = normalizeDiscoveryName(right);
  const longest = Math.max(Array.from(normalizedLeft).length, Array.from(normalizedRight).length);
  if (longest === 0) return 0;
  return Math.floor((1 - editDistance(normalizedLeft, normalizedRight) / longest) * 10_000);
}

function deriveSingleCodePointInsertionDeletion(receiptCodePoints, officialCodePoints) {
  const officialIsLonger = officialCodePoints.length === receiptCodePoints.length + 1;
  const receiptIsLonger = receiptCodePoints.length === officialCodePoints.length + 1;
  if (!officialIsLonger && !receiptIsLonger) return null;
  const longer = officialIsLonger ? officialCodePoints : receiptCodePoints;
  const shorter = officialIsLonger ? receiptCodePoints : officialCodePoints;
  const editIndexes = longer.flatMap((_, index) =>
    longer.filter((__, candidateIndex) => candidateIndex !== index).every(
      (value, candidateIndex) => value === shorter[candidateIndex]
    ) ? [index] : []
  );
  if (editIndexes.length !== 1) return null;
  const zeroBasedEditIndex = editIndexes[0];
  return {
    editDirection: officialIsLonger
      ? "insert_official_code_point_into_receipt"
      : "delete_receipt_code_point",
    zeroBasedEditIndex,
    editedCodePoint: longer[zeroBasedEditIndex]
  };
}

function parseStrictSpecification(value) {
  if (!value) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(kg|g|ml|each|개|입)$/iu);
  if (!match) return null;
  const rawUnit = match[2].toLocaleLowerCase("en-US");
  const parsedAmount = Number(match[1]);
  return {
    contentAmount: rawUnit === "kg" ? parsedAmount * 1000 : parsedAmount,
    contentUnit: ["each", "개", "입"].includes(rawUnit)
      ? "each"
      : rawUnit === "kg"
        ? "g"
        : rawUnit
  };
}

function parseCompositeKitSpecification(value) {
  const match = value?.normalize("NFKC").trim().match(
    /^면도기\s*(\d+)\s*면도날\s*(\d+)$/u
  );
  if (!match) return null;
  const handleQuantity = Number(match[1]);
  const bladeQuantity = Number(match[2]);
  if (
    !Number.isInteger(handleQuantity) || handleQuantity <= 0 ||
    !Number.isInteger(bladeQuantity) || bladeQuantity <= 0
  ) return null;
  return [
    { componentType: "razor_handle", quantity: handleQuantity, unit: "each" },
    { componentType: "razor_blade", quantity: bladeQuantity, unit: "each" }
  ];
}

function normalizeStructuredContentUnit(rawUnit) {
  const normalizedUnit = rawUnit.toLocaleLowerCase("en-US");
  if (normalizedUnit === "kg") return { multiplier: 1000, contentUnit: "g" };
  if (["g", "ml"].includes(normalizedUnit)) {
    return { multiplier: 1, contentUnit: normalizedUnit };
  }
  return null;
}

function parseWiperBladeFitment(value, officialNameRaw) {
  if (!value || !officialNameRaw?.normalize("NFKC").includes("와이퍼")) return null;
  const match = value.normalize("NFKC").trim().match(/^(\d{3})\s*mm$/iu);
  if (!match) return null;
  const lengthMm = Number(match[1]);
  if (!Number.isInteger(lengthMm) || lengthMm < 250 || lengthMm > 800) return null;
  return { lengthMm };
}

function parseStructuredSpecification(value, officialNameRaw) {
  if (!value || !officialNameRaw) return null;
  const normalizedValue = value.normalize("NFKC").trim();
  const perItemTimesCountWithTotal = normalizedValue.match(
    /^(\d+(?:\.\d+)?)\s*(kg|g|ml)\s*[xX×*]\s*(\d+)\s*개(?:입)?\s*\/\s*(\d+(?:\.\d+)?)\s*(kg|g|ml)$/iu
  );
  if (perItemTimesCountWithTotal) {
    const itemUnit = normalizeStructuredContentUnit(perItemTimesCountWithTotal[2]);
    const totalUnit = normalizeStructuredContentUnit(perItemTimesCountWithTotal[5]);
    const contentAmount = Number(perItemTimesCountWithTotal[1]) * (itemUnit?.multiplier ?? 0);
    const packageCount = Number(perItemTimesCountWithTotal[3]);
    const statedTotal = Number(perItemTimesCountWithTotal[4]) * (totalUnit?.multiplier ?? 0);
    if (
      itemUnit && totalUnit && itemUnit.contentUnit === totalUnit.contentUnit &&
      contentAmount > 0 && Number.isInteger(packageCount) && packageCount > 0 &&
      statedTotal === contentAmount * packageCount
    ) {
      return {
        contentAmount,
        contentUnit: itemUnit.contentUnit,
        packageCount,
        parseRule: "per_item_times_count_with_total_v1",
        packageCountBasis: "explicit_specification",
        parsedTotalContentAmount: statedTotal
      };
    }
  }
  const totalPerCount = normalizedValue.match(
    /^(\d+(?:\.\d+)?)\s*(kg|g|ml)\s*\/\s*(\d+)\s*매입$/iu
  );
  if (totalPerCount) {
    const unit = normalizeStructuredContentUnit(totalPerCount[2]);
    const total = Number(totalPerCount[1]) * (unit?.multiplier ?? 0);
    const packageCount = Number(totalPerCount[3]);
    const contentAmount = total / packageCount;
    if (unit && total > 0 && Number.isInteger(packageCount) && packageCount > 0) {
      return {
        contentAmount,
        contentUnit: unit.contentUnit,
        packageCount,
        parseRule: "total_amount_per_count_v1",
        packageCountBasis: "explicit_specification",
        parsedTotalContentAmount: total
      };
    }
  }
  const perItemTimesCount = normalizedValue.match(
    /^(\d+(?:\.\d+)?)\s*(kg|g|ml)\s*[xX×*]\s*(\d+)\s*개입$/iu
  );
  if (perItemTimesCount) {
    const unit = normalizeStructuredContentUnit(perItemTimesCount[2]);
    const contentAmount = Number(perItemTimesCount[1]) * (unit?.multiplier ?? 0);
    const packageCount = Number(perItemTimesCount[3]);
    if (unit && contentAmount > 0 && Number.isInteger(packageCount) && packageCount > 0) {
      return {
        contentAmount,
        contentUnit: unit.contentUnit,
        packageCount,
        parseRule: "per_item_times_count_v1",
        packageCountBasis: "explicit_specification"
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
        packageCountBasis: "explicit_specification"
      };
    }
  }
  const numericOnly = normalizedValue.match(/^(\d+(?:\.\d+)?)$/u);
  if (!numericOnly) return null;
  const escapedNumber = numericOnly[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fragmentPattern = new RegExp(
    `(?<![\\d.])${escapedNumber}\\s*(kg|g|ml)(?![\\p{L}\\d.])`,
    "giu"
  );
  const fragments = [...officialNameRaw.normalize("NFKC").matchAll(fragmentPattern)];
  if (fragments.length !== 1) return null;
  const unit = normalizeStructuredContentUnit(fragments[0][1]);
  if (!unit) return null;
  return {
    contentAmount: Number(numericOnly[1]) * unit.multiplier,
    contentUnit: unit.contentUnit,
    packageCount: 1,
    parseRule: "numeric_spec_unit_from_official_name_v1",
    packageCountBasis: "default_one_absent_count",
    matchedOfficialNameFragment: fragments[0][0]
  };
}

function parseApparelSize(value) {
  const match = value?.normalize("NFKC").trim().match(/^(?:SIZE\s*)?([0-9]{2,3})(?:\s*호)?$/iu);
  if (!match) return null;
  const sizes = new Map([
    [90, "S"],
    [95, "M"],
    [100, "L"],
    [105, "XL"],
    [110, "XXL"],
    [115, "XXXL"]
  ]);
  const kr = Number(match[1]);
  const alpha = sizes.get(kr);
  return alpha ? { alpha, kr, label: `${alpha}(${kr})` } : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }

  return value;
}

function sameCanonicalValue(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function sha256Fingerprint(value) {
  const canonicalJson = JSON.stringify(canonicalize(value));
  return `sha256:${createHash("sha256").update(canonicalJson).digest("hex")}`;
}

function calculateFingerprints(proposal) {
  const inputFingerprint = sha256Fingerprint({
    receipt: proposal.receipt,
    officialListing: proposal.officialListing
  });

  const targetFingerprint = sha256Fingerprint(
    proposal.executionTarget ?? {
      caseId: proposal.caseId,
      inputFingerprint,
      sameChannelNameRule: proposal.sameChannelNameRule,
      normalizedIdentity: proposal.normalizedIdentity,
      decision: proposal.decision,
      coupangOffer: proposal.coupangOffer,
      representativeImage: proposal.representativeImage,
      evidence: proposal.evidence,
      review: proposal.review,
      plannedEffects: proposal.plannedEffects
    }
  );

  return { inputFingerprint, targetFingerprint };
}

function printIssues(error) {
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    process.stderr.write(`- ${path}: ${issue.message}\n`);
  }
}

async function main() {
  const [, , proposalPath, option] = process.argv;
  if (!proposalPath || (option && option !== "--show-fingerprints")) {
    process.stderr.write(
      "Usage: validate-link-proposal.mjs <proposal.json> [--show-fingerprints]\n"
    );
    process.exitCode = 2;
    return;
  }

  let raw;
  try {
    raw = JSON.parse(await readFile(proposalPath, "utf8"));
  } catch (error) {
    process.stderr.write(`Could not read proposal JSON: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) {
    process.stderr.write("LinkProposal validation failed:\n");
    printIssues(parsed.error);
    process.exitCode = 1;
    return;
  }

  const calculated = calculateFingerprints(parsed.data);
  if (option === "--show-fingerprints") {
    process.stdout.write(`${JSON.stringify(calculated, null, 2)}\n`);
    return;
  }

  const errors = [];
  if (parsed.data.inputFingerprint !== calculated.inputFingerprint) {
    errors.push(
      `inputFingerprint mismatch: expected ${calculated.inputFingerprint}`
    );
  }
  if (
    parsed.data.approval.targetFingerprint !== calculated.targetFingerprint
  ) {
    errors.push(
      `approval.targetFingerprint mismatch: expected ${calculated.targetFingerprint}`
    );
  }
  if (
    parsed.data.executionTarget &&
    parsed.data.execution.idempotencyKey !==
      `standard-product-link:${calculated.targetFingerprint.slice("sha256:".length)}`
  ) {
    errors.push(
      "execution.idempotencyKey must be derived from approval.targetFingerprint"
    );
  }

  if (errors.length > 0) {
    process.stderr.write("LinkProposal fingerprint validation failed:\n");
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Valid LinkProposal ${parsed.data.caseId} (${parsed.data.status})\n`
  );
}

await main();
