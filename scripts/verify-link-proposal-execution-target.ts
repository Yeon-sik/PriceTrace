import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  assertReviewedProposalMatchesExecutionTarget,
  buildStrictRegistrationIdentity,
  parseReviewedLinkProposalEnvelope,
} from "../src/domain/standard-product-registration";

const proposalPath = process.argv[2];
if (!proposalPath) {
  throw new Error("Usage: verify-link-proposal-execution-target.ts <proposal.json>");
}

const proposal = parseReviewedLinkProposalEnvelope(
  await readFile(proposalPath, "utf8"),
);
const target = proposal.executionTarget;
const sourceCatalogNamespace = proposal.receipt.sourceCatalogNamespace;
if (!sourceCatalogNamespace) {
  throw new Error("승인 가능한 영수증 카탈로그 채널이 없습니다.");
}

const identity = await buildStrictRegistrationIdentity({
  caseId: proposal.caseId,
  receipt: { ...proposal.receipt, sourceCatalogNamespace },
  officialListing: proposal.officialListing,
  assessment: {
    decision: {
      confidence: proposal.decision.confidence,
      matchedFields: proposal.decision.matchedFields,
      conflictingFields: proposal.decision.conflictingFields,
      missingFields: proposal.decision.missingFields,
    },
    evidence: proposal.evidence,
    review: proposal.review,
  },
  target: {
    standardProductId: proposal.decision.standardProductId,
    catalogProductId: proposal.decision.catalogProductId,
    standardName: target.normalizedIdentity.productFamilyName,
    listingName: target.normalizedIdentity.variantName,
    brandName: target.brandEvidence.canonicalName,
    receiptBrandName: target.brandEvidence.receiptObservedName,
    officialBrandName: target.brandEvidence.officialObservedName,
    officialBrandSourceLabel: target.brandEvidence.officialSourceLabel,
    productReferenceUrl: target.brandEvidence.productReferenceUrl,
    specificationStatus: target.normalizedIdentity.specificationStatus,
    contentAmount: target.normalizedIdentity.contentAmount,
    contentUnit: target.normalizedIdentity.contentUnit,
    packageCount: target.normalizedIdentity.packageCount,
    referenceUnit: target.normalizedIdentity.referenceUnit,
    coupangProductUrl: target.coupangOffer.productUrl,
    coupangListedPriceKrw: target.coupangOffer.listedPriceKrw,
    coupangQuantity: target.coupangOffer.quantity,
    coupangContentAmount: target.coupangOffer.contentAmount,
    coupangContentUnit: target.coupangOffer.contentUnit,
    coupangMaxBundleQuantity: target.coupangOffer.maxBundleQuantity,
    coupangMaxBundleListedPriceKrw: target.coupangOffer.maxBundleListedPriceKrw,
    representativeImageAction: target.representativeImage.action,
    representativeImageExpectedCurrent: target.representativeImage.expectedCurrent,
  },
});

assertReviewedProposalMatchesExecutionTarget(proposal, identity.targetCanonicalJson);
if (
  identity.inputFingerprint !== proposal.inputFingerprint
  || identity.targetFingerprint !== proposal.approval.targetFingerprint
  || identity.idempotencyKey !== proposal.execution.idempotencyKey
) {
  throw new Error("LinkProposal 지문 또는 멱등 키가 앱 strict-v6 실행값과 다릅니다.");
}

process.stdout.write(`${JSON.stringify({
  caseId: proposal.caseId,
  inputFingerprint: identity.inputFingerprint,
  targetFingerprint: identity.targetFingerprint,
  idempotencyKey: identity.idempotencyKey,
  canonicalTargetMatches: true,
}, null, 2)}\n`);
