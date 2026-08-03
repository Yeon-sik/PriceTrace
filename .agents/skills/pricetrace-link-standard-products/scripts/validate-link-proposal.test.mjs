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
