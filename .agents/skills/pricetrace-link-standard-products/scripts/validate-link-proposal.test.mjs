#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const validatorPath = join(scriptDirectory, "validate-link-proposal.mjs");
const templatePath = join(
  scriptDirectory,
  "..",
  "assets",
  "link-proposal.template.json"
);

const template = JSON.parse(await readFile(templatePath, "utf8"));
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "pricetrace-link-proposal-")
);

function validateFixture(name, proposal) {
  const fixturePath = join(temporaryDirectory, `${name}.json`);
  return writeFile(fixturePath, JSON.stringify(proposal, null, 2), "utf8").then(
    () =>
      spawnSync(
        process.execPath,
        [validatorPath, fixturePath, "--show-fingerprints"],
        { encoding: "utf8" }
      )
  );
}

function validateFinalFixture(name, proposal) {
  const fixturePath = join(temporaryDirectory, `${name}.json`);
  return writeFile(fixturePath, JSON.stringify(proposal, null, 2), "utf8").then(
    () =>
      spawnSync(
        process.execPath,
        [validatorPath, fixturePath],
        { encoding: "utf8" }
      )
  );
}

try {
  const whitespaceOnlyDifference = structuredClone(template);
  whitespaceOnlyDifference.receipt.sourceNameRaw = "Demo  Product\t500 ml";
  whitespaceOnlyDifference.officialListing.sourceNameRaw =
    "Demo Product500ml";
  whitespaceOnlyDifference.executionTarget.sameChannelNameRule.normalizedReceiptName =
    "DemoProduct500ml";
  whitespaceOnlyDifference.executionTarget.sameChannelNameRule.normalizedOfficialName =
    "DemoProduct500ml";

  const whitespaceResult = await validateFixture(
    "whitespace-only-difference",
    whitespaceOnlyDifference
  );
  assert.equal(
    whitespaceResult.status,
    0,
    `whitespace-only exact match should validate:\n${whitespaceResult.stderr}`
  );

  const validDiscoveryOnly = structuredClone(template);
  validDiscoveryOnly.status = "insufficient_evidence";
  validDiscoveryOnly.officialListing.sourceNameRaw = "Demo Product 501 ml";
  validDiscoveryOnly.sameChannelNameRule.normalizedOfficialName =
    "DemoProduct501ml";
  validDiscoveryOnly.sameChannelNameRule.exactNameMatch = false;
  validDiscoveryOnly.sameChannelNameRule.outcome = "discovery_only";
  validDiscoveryOnly.sameChannelNameRule.importedOfficialFields = [];
  validDiscoveryOnly.decision = {
    action: "insufficient_evidence",
    standardProductId: null,
    catalogProductId: null,
    proposedStandardName: null,
    proposedVariantName: null,
    confidence: "low",
    matchedFields: [],
    conflictingFields: ["official name differs after whitespace removal"],
    missingFields: ["exact same-channel name"]
  };
  validDiscoveryOnly.review = {
    verdict: "needs_more_evidence",
    reviewerAgent: "pricetrace_independent_reviewer",
    counterCandidates: ["Demo Product 501 ml"],
    conflicts: ["official name differs after whitespace removal"],
    evidenceQuality: "partial",
    notes: ["Candidate is discovery-only and cannot be linked."]
  };
  validDiscoveryOnly.plannedEffects = [];
  validDiscoveryOnly.executionTarget = null;
  validDiscoveryOnly.approval = {
    ...validDiscoveryOnly.approval,
    status: "not_requested"
  };

  const discoveryResult = await validateFixture(
    "valid-discovery-only",
    validDiscoveryOnly
  );
  assert.equal(
    discoveryResult.status,
    0,
    `discovery-only mismatch should validate without effects:\n${discoveryResult.stderr}`
  );

  const verifiedMismatch = structuredClone(template);
  verifiedMismatch.receipt.sourceNameRaw = "Demo Product 속 500 ml";
  verifiedMismatch.officialListing.sourceNameRaw = "Demo Product 숙 500 ml";
  const manufacturerEvidence = {
    sourceType: "manufacturer",
    sourceId: "manufacturer:demo-product-500ml",
    authority: "primary",
    url: "https://manufacturer.example/demo-product-500ml",
    capturedAt: "2026-08-03T00:00:00+09:00",
    claims: ["Manufacturer confirms the exact 500 ml sellable variant."],
    sourceRefs: ["manufacturer:demo-product-500ml"]
  };
  verifiedMismatch.evidence.push(manufacturerEvidence);
  verifiedMismatch.executionTarget.evidence.push(manufacturerEvidence);
  const verifiedRule = {
    ...verifiedMismatch.sameChannelNameRule,
    normalizedReceiptName: "DemoProduct속500ml",
    normalizedOfficialName: "DemoProduct숙500ml",
    exactNameMatch: false,
    outcome: "apply_verified_name_equivalence",
    verifiedEquivalence: {
      method: "single_unicode_code_point_substitution_v1",
      scope: "frozen_receipt_official_pair_only",
      zeroBasedCodePointIndex: 11,
      receiptCodePoint: "속",
      officialCodePoint: "숙",
      supportingEvidenceSourceIds: [
        "official-channel:official-listing-code:official-code-001",
        "manufacturer:demo-product-500ml"
      ],
      supportingSourceRefs: [
        "private-data/official/demo.json#official-code-001",
        "manufacturer:demo-product-500ml"
      ],
      reviewerAgent: "pricetrace_independent_reviewer",
      reviewedAt: "2026-08-03T00:00:00+09:00",
      conclusion: "same_exact_sellable_variant"
    }
  };
  verifiedMismatch.sameChannelNameRule = verifiedRule;
  verifiedMismatch.executionTarget.sameChannelNameRule = structuredClone(verifiedRule);
  const verifiedMismatchResult = await validateFixture(
    "valid-verified-name-equivalence",
    verifiedMismatch
  );
  assert.equal(
    verifiedMismatchResult.status,
    0,
    `verified mismatch should validate with independent primary evidence:\n${verifiedMismatchResult.stderr}`
  );

  const verifiedInsertionDeletion = structuredClone(template);
  verifiedInsertionDeletion.receipt.sourceNameRaw = "Demo Product 500 m";
  verifiedInsertionDeletion.officialListing.sourceNameRaw = "Demo Product 500 ml";
  verifiedInsertionDeletion.evidence.push(manufacturerEvidence);
  verifiedInsertionDeletion.executionTarget.evidence.push(manufacturerEvidence);
  const insertionDeletionRule = {
    ...verifiedInsertionDeletion.sameChannelNameRule,
    normalizedReceiptName: "DemoProduct500m",
    normalizedOfficialName: "DemoProduct500ml",
    exactNameMatch: false,
    outcome: "apply_verified_name_equivalence",
    verifiedEquivalence: {
      method: "single_unicode_code_point_insertion_deletion_v1",
      scope: "frozen_receipt_official_pair_only",
      editDirection: "insert_official_code_point_into_receipt",
      zeroBasedEditIndex: 15,
      editedCodePoint: "l",
      receiptCodePointLength: 15,
      officialCodePointLength: 16,
      discoverySimilarityBasisPoints: 9375,
      uniqueOfficialCandidate: true,
      supportingEvidenceSourceIds: [
        "official-channel:official-listing-code:official-code-001",
        "manufacturer:demo-product-500ml"
      ],
      supportingSourceRefs: [
        "private-data/official/demo.json#official-code-001",
        "manufacturer:demo-product-500ml"
      ],
      reviewerAgent: "pricetrace_independent_reviewer",
      reviewedAt: "2026-08-04T12:30:00+09:00",
      conclusion: "same_exact_sellable_variant"
    }
  };
  verifiedInsertionDeletion.sameChannelNameRule = insertionDeletionRule;
  verifiedInsertionDeletion.executionTarget.sameChannelNameRule = structuredClone(
    insertionDeletionRule
  );
  const verifiedInsertionDeletionResult = await validateFixture(
    "valid-verified-name-insertion-deletion",
    verifiedInsertionDeletion
  );
  assert.equal(
    verifiedInsertionDeletionResult.status,
    0,
    `verified insertion/deletion should validate with independent primary evidence:\n${verifiedInsertionDeletionResult.stderr}`
  );

  const invalidInsertionDeletionIndex = structuredClone(verifiedInsertionDeletion);
  invalidInsertionDeletionIndex.sameChannelNameRule.verifiedEquivalence.zeroBasedEditIndex = 14;
  invalidInsertionDeletionIndex.executionTarget.sameChannelNameRule = structuredClone(
    invalidInsertionDeletionIndex.sameChannelNameRule
  );
  const invalidInsertionDeletionIndexResult = await validateFixture(
    "invalid-verified-name-insertion-deletion-index",
    invalidInsertionDeletionIndex
  );
  assert.notEqual(invalidInsertionDeletionIndexResult.status, 0);
  assert.match(invalidInsertionDeletionIndexResult.stderr, />=90% Unicode code-point insertion or deletion/);

  const invalidInsertionDeletionSimilarity = structuredClone(verifiedInsertionDeletion);
  invalidInsertionDeletionSimilarity.sameChannelNameRule.verifiedEquivalence.discoverySimilarityBasisPoints = 9000;
  invalidInsertionDeletionSimilarity.executionTarget.sameChannelNameRule = structuredClone(
    invalidInsertionDeletionSimilarity.sameChannelNameRule
  );
  const invalidInsertionDeletionSimilarityResult = await validateFixture(
    "invalid-verified-name-insertion-deletion-similarity",
    invalidInsertionDeletionSimilarity
  );
  assert.notEqual(invalidInsertionDeletionSimilarityResult.status, 0);
  assert.match(invalidInsertionDeletionSimilarityResult.stderr, />=90% Unicode code-point insertion or deletion/);

  const verifiedContainment = structuredClone(template);
  verifiedContainment.receipt.sourceNameRaw = "Demo Product 500 ml";
  verifiedContainment.receipt.unitPriceKrw = 1000;
  verifiedContainment.officialListing.sourceNameRaw = "XDemo Product 500 mlY";
  verifiedContainment.officialListing.officialPrice = {
    amountKrw: 1000,
    sourceText: "1,000원",
    observedAt: "2026-08-03T00:00:00+09:00"
  };
  const containmentRule = {
    ...verifiedContainment.sameChannelNameRule,
    normalizedReceiptName: "DemoProduct500ml",
    normalizedOfficialName: "XDemoProduct500mlY",
    exactNameMatch: false,
    outcome: "apply_verified_name_equivalence",
    verifiedEquivalence: {
      method: "official_name_contains_receipt_name_v1",
      scope: "frozen_receipt_official_pair_only",
      zeroBasedOfficialCodePointIndex: 1,
      receiptCodePointLength: 16,
      officialCodePointLength: 18,
      officialPrefix: "X",
      officialSuffix: "Y",
      officialDisplayedPriceKrw: 1000,
      officialPriceObservedAt: "2026-08-03T00:00:00+09:00",
      uniqueOfficialCandidate: true,
      supportingEvidenceSourceIds: [
        "receipt-demo:item-demo",
        "official-channel:official-listing-code:official-code-001"
      ],
      supportingSourceRefs: [
        "private-data/receipts/demo.json#item-demo",
        "private-data/official/demo.json#official-code-001"
      ],
      reviewerAgent: "pricetrace_independent_reviewer",
      reviewedAt: "2026-08-03T00:05:00+09:00",
      conclusion: "same_exact_sellable_variant"
    }
  };
  verifiedContainment.sameChannelNameRule = containmentRule;
  verifiedContainment.executionTarget.sameChannelNameRule = structuredClone(containmentRule);
  const verifiedContainmentResult = await validateFixture(
    "valid-verified-name-containment",
    verifiedContainment
  );
  assert.equal(
    verifiedContainmentResult.status,
    0,
    `verified containment should validate with frozen receipt and official price evidence:\n${verifiedContainmentResult.stderr}`
  );

  const mismatchedContainmentPrice = structuredClone(verifiedContainment);
  mismatchedContainmentPrice.officialListing.officialPrice.amountKrw = 999;
  const mismatchedContainmentPriceResult = await validateFixture(
    "invalid-verified-name-containment-price",
    mismatchedContainmentPrice
  );
  assert.notEqual(mismatchedContainmentPriceResult.status, 0);
  assert.match(mismatchedContainmentPriceResult.stderr, /official price equal to the receipt unit price/);

  const descriptiveMatchedFields = structuredClone(verifiedMismatch);
  const reviewedMatches = [
    "same catalog channel",
    "single reviewed source-name substitution",
    "official specification"
  ];
  descriptiveMatchedFields.decision.matchedFields = reviewedMatches;
  descriptiveMatchedFields.executionTarget.decision.matchedFields = reviewedMatches;
  const descriptiveMatchedFieldsResult = await validateFixture(
    "valid-descriptive-matched-fields",
    descriptiveMatchedFields
  );
  assert.equal(
    descriptiveMatchedFieldsResult.status,
    0,
    `descriptive reviewed matches should validate:\n${descriptiveMatchedFieldsResult.stderr}`
  );

  const userAssertionOnly = structuredClone(verifiedMismatch);
  userAssertionOnly.evidence = userAssertionOnly.evidence.filter(
    (item) => item.sourceType !== "manufacturer"
  );
  userAssertionOnly.executionTarget.evidence = structuredClone(userAssertionOnly.evidence);
  const userAssertionResult = await validateFixture(
    "invalid-user-assertion-only-equivalence",
    userAssertionOnly
  );
  assert.notEqual(
    userAssertionResult.status,
    0,
    "a mismatch without manufacturer or brand primary evidence must be rejected"
  );
  assert.match(userAssertionResult.stderr, /manufacturer\/brand primary evidence/);

  const twoCharacterMismatch = structuredClone(verifiedMismatch);
  twoCharacterMismatch.officialListing.sourceNameRaw = "Demo Product 숙 501 ml";
  twoCharacterMismatch.sameChannelNameRule.normalizedOfficialName =
    "DemoProduct숙501ml";
  twoCharacterMismatch.executionTarget.sameChannelNameRule.normalizedOfficialName =
    "DemoProduct숙501ml";
  const twoCharacterResult = await validateFixture(
    "invalid-two-character-equivalence",
    twoCharacterMismatch
  );
  assert.notEqual(twoCharacterResult.status, 0);
  assert.match(twoCharacterResult.stderr, /exactly one Unicode code-point substitution/);

  const invalidReviewTimestamp = structuredClone(verifiedMismatch);
  invalidReviewTimestamp.sameChannelNameRule.verifiedEquivalence.reviewedAt = "not-a-date";
  invalidReviewTimestamp.executionTarget.sameChannelNameRule.verifiedEquivalence.reviewedAt = "not-a-date";
  const invalidReviewTimestampResult = await validateFixture(
    "invalid-equivalence-review-timestamp",
    invalidReviewTimestamp
  );
  assert.notEqual(invalidReviewTimestampResult.status, 0);

  const invalidFuzzyLink = structuredClone(template);
  invalidFuzzyLink.officialListing.sourceNameRaw = "Demo Product 501 ml";
  invalidFuzzyLink.sameChannelNameRule.normalizedOfficialName =
    "DemoProduct501ml";
  invalidFuzzyLink.sameChannelNameRule.exactNameMatch = false;

  const invalidResult = await validateFixture(
    "invalid-fuzzy-link",
    invalidFuzzyLink
  );
  assert.notEqual(
    invalidResult.status,
    0,
    "a non-whitespace name mismatch must not validate as a positive link"
  );
  assert.match(
    invalidResult.stderr,
    /discovery_only/,
    "mismatch failure should identify the discovery_only rule"
  );

  const invalidApprovalWithMissingFields = structuredClone(template);
  invalidApprovalWithMissingFields.decision.missingFields = [
    "blocking package count"
  ];

  const missingFieldsResult = await validateFixture(
    "approval-with-missing-fields",
    invalidApprovalWithMissingFields
  );
  assert.notEqual(
    missingFieldsResult.status,
    0,
    "approval_requested must reject blocking missing fields"
  );
  assert.match(
    missingFieldsResult.stderr,
    /no blocking missing fields/,
    "approval failure should identify blocking missing fields"
  );

  const invalidApprovalWithoutEffects = structuredClone(template);
  invalidApprovalWithoutEffects.plannedEffects = [];

  const noEffectsResult = await validateFixture(
    "approval-without-effects",
    invalidApprovalWithoutEffects
  );
  assert.notEqual(
    noEffectsResult.status,
    0,
    "approval_requested must reject an empty effect allowlist"
  );
  assert.match(
    noEffectsResult.stderr,
    /non-empty exact effect allowlist/,
    "approval failure should identify the empty effect allowlist"
  );

  const validFinalResult = await validateFinalFixture("valid-final", template);
  assert.equal(
    validFinalResult.status,
    0,
    `the template must pass final fingerprint validation:\n${validFinalResult.stderr}`
  );

  const invalidExecutionEvidence = structuredClone(template);
  invalidExecutionEvidence.executionTarget.evidence =
    invalidExecutionEvidence.executionTarget.evidence.slice(0, 2);
  const executionEvidenceResult = await validateFixture(
    "execution-target-evidence-drift",
    invalidExecutionEvidence
  );
  assert.notEqual(
    executionEvidenceResult.status,
    0,
    "the frozen strict-v6 target must include the exact reviewed evidence"
  );
  assert.match(executionEvidenceResult.stderr, /reviewed evidence/);

  const invalidIdempotencyKey = structuredClone(template);
  invalidIdempotencyKey.execution.idempotencyKey = "standard-product-link:wrong";
  const idempotencyResult = await validateFinalFixture(
    "invalid-idempotency-key",
    invalidIdempotencyKey
  );
  assert.notEqual(
    idempotencyResult.status,
    0,
    "the idempotency key must be derived from the approved strict-v6 target"
  );
  assert.match(idempotencyResult.stderr, /idempotencyKey/);

  process.stdout.write(
    "Validated strict-v6 target alignment, exact-name rules, and approval gates.\n"
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
