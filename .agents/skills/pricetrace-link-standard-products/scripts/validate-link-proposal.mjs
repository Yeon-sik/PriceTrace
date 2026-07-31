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
    image: z.object({
      url: z.string().url().startsWith("https://"),
      contentHash: fingerprintSchema,
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      byteLength: z.number().int().positive()
    }).nullable()
  })
  .strict();

const sameChannelNameRuleSchema = z
  .object({
    sameChannel: z.boolean(),
    normalization: z.literal("remove_unicode_whitespace_only"),
    normalizedReceiptName: z.string().min(1),
    normalizedOfficialName: z.string().min(1),
    exactNameMatch: z.boolean(),
    outcome: z.enum([
      "apply_official_identity",
      "discovery_only",
      "not_applicable"
    ]),
    importedOfficialFields: z.array(
      z.enum([
        "brand",
        "contentAmount",
        "contentUnit",
        "packageCount",
        "gtin"
      ])
    )
  })
  .strict();

const normalizedIdentitySchema = z
  .object({
    brand: nullableText,
    productFamilyName: nullableText,
    variantName: nullableText,
    contentAmount: z.number().positive().nullable(),
    contentUnit: z.enum(["g", "ml", "each"]).nullable(),
    packageCount: z.number().int().positive().nullable(),
    gtin: nullableText
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
    if (sameChannel && exactNameMatch) {
      if (nameRule.outcome !== "apply_official_identity") {
        issue(
          ["sameChannelNameRule", "outcome"],
          "same-channel exact names require apply_official_identity"
        );
      }

      for (const requiredField of ["brand", "contentAmount", "contentUnit"]) {
        if (!nameRule.importedOfficialFields.includes(requiredField)) {
          issue(
            ["sameChannelNameRule", "importedOfficialFields"],
            `apply_official_identity requires ${requiredField}`
          );
        }
      }

      for (const importedField of nameRule.importedOfficialFields) {
        if (proposal.normalizedIdentity[importedField] === null) {
          issue(
            ["normalizedIdentity", importedField],
            `${importedField} must be non-null when imported from official evidence`
          );
        }
      }
    } else if (sameChannel) {
      if (nameRule.outcome !== "discovery_only") {
        issue(
          ["sameChannelNameRule", "outcome"],
          "same-channel names with different non-whitespace characters are discovery_only"
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

function sha256Fingerprint(value) {
  const canonicalJson = JSON.stringify(canonicalize(value));
  return `sha256:${createHash("sha256").update(canonicalJson).digest("hex")}`;
}

function calculateFingerprints(proposal) {
  const inputFingerprint = sha256Fingerprint({
    receipt: proposal.receipt,
    officialListing: proposal.officialListing
  });

  const targetFingerprint = sha256Fingerprint({
    caseId: proposal.caseId,
    inputFingerprint,
    sameChannelNameRule: proposal.sameChannelNameRule,
    normalizedIdentity: proposal.normalizedIdentity,
    decision: proposal.decision,
    coupangOffer: proposal.coupangOffer,
    representativeImage: proposal.representativeImage,
    plannedEffects: proposal.plannedEffects
  });

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
