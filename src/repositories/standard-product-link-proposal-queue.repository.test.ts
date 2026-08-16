import { describe, expect, it } from "vitest";
import proposalTemplate from "../../.agents/skills/pricetrace-link-standard-products/assets/link-proposal.template.json";
import {
  buildReviewedLinkProposalExecutionIdentity,
  canonicalJson,
  parseReviewedLinkProposalEnvelope,
  rebuildReviewedLinkProposalForAdminTarget,
  sha256CanonicalJson,
} from "../domain/standard-product-registration";
import { reconcilePxProposalRegistration } from "../domain/standard-product-link-proposal-reconciliation";
import {
  STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY,
  StandardProductLinkProposalQueueRepository,
} from "./standard-product-link-proposal-queue.repository";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe("StandardProductLinkProposalQueueRepository", () => {
  it("stores one validated proposal and removes it after approval", () => {
    const repository = new StandardProductLinkProposalQueueRepository(new MemoryStorage());

    const saved = repository.enqueue(JSON.stringify(proposalTemplate));

    expect(repository.load()).toHaveLength(1);
    expect(repository.load()[0]?.proposal.caseId).toBe(proposalTemplate.caseId);
    expect(repository.remove(saved.id)).toEqual([]);
    expect(repository.load()).toEqual([]);
  });

  it("removes several exact queue IDs in one snapshot update", () => {
    const repository = new StandardProductLinkProposalQueueRepository(new MemoryStorage());
    const saved = repository.enqueue(JSON.stringify(proposalTemplate));

    expect(repository.removeMany([saved.id])).toEqual([]);
    expect(repository.load()).toEqual([]);
  });

  it("reconciles only an exact PX source mapping with the same registered target", () => {
    const proposal = parseReviewedLinkProposalEnvelope(JSON.stringify(proposalTemplate));
    const pxProposal = {
      ...proposal,
      receipt: {
        ...proposal.receipt,
        sourceCatalogNamespace: "korean-military-px",
      },
    };
    const identity = pxProposal.executionTarget.normalizedIdentity;
    const catalogProductId = "11111111-1111-4111-8111-111111111111";
    const standardProductId = "22222222-2222-4222-8222-222222222222";
    const mappings = [{
      sourceLabel: pxProposal.receipt.sourceLabel,
      sourceProductCode: pxProposal.receipt.sourceProductCode,
      catalogProductId,
    }];
    const variants = [{
      id: catalogProductId,
      standardProductId,
      canonicalName: identity.variantName,
      specificationStatus: identity.specificationStatus,
      contentAmount: identity.contentAmount,
      contentUnit: identity.contentUnit,
      packageCount: identity.packageCount,
      referenceUnit: identity.referenceUnit,
    }];
    const standards = [{
      id: standardProductId,
      canonicalName: identity.productFamilyName,
    }];

    expect(reconcilePxProposalRegistration(pxProposal, mappings, variants, standards))
      .toEqual({ status: "already_registered", catalogProductId, standardProductId });
    expect(reconcilePxProposalRegistration(pxProposal, [{
      ...mappings[0],
      sourceLabel: "다른 판매처",
    }], variants, standards)).toEqual({ status: "active" });
    expect(reconcilePxProposalRegistration(pxProposal, mappings, [{
      ...variants[0],
      canonicalName: "다른 판매 규격",
    }], standards)).toMatchObject({ status: "mapping_collision", catalogProductId });
  });

  it("replaces a duplicate fingerprint instead of growing the queue", () => {
    const repository = new StandardProductLinkProposalQueueRepository(new MemoryStorage());
    repository.enqueue(JSON.stringify(proposalTemplate));
    repository.enqueue(JSON.stringify(proposalTemplate));

    expect(repository.load()).toHaveLength(1);
  });

  it("rebuilds an edited admin target as one fully validated proposal", async () => {
    const proposal = parseReviewedLinkProposalEnvelope(JSON.stringify(proposalTemplate));
    const productFamilyName = "관리자 수정 표준 상품";
    const executionTarget = {
      ...proposal.executionTarget,
      normalizedIdentity: {
        ...proposal.executionTarget.normalizedIdentity,
        productFamilyName,
      },
      decision: {
        ...proposal.executionTarget.decision,
        proposedStandardName: productFamilyName,
      },
    };
    const targetCanonicalJson = canonicalJson(executionTarget);
    const targetFingerprint = await sha256CanonicalJson(targetCanonicalJson);

    const rebuilt = rebuildReviewedLinkProposalForAdminTarget(proposal, {
      targetCanonicalJson,
      targetFingerprint,
      idempotencyKey: `standard-product-link:${targetFingerprint.slice("sha256:".length)}`,
    });

    expect(rebuilt.normalizedIdentity.productFamilyName).toBe(productFamilyName);
    expect(rebuilt.executionTarget.normalizedIdentity.productFamilyName).toBe(productFamilyName);
    expect(rebuilt.approval.targetFingerprint).toBe(targetFingerprint);
  });

  it("executes an unchanged approval from the frozen proposal target", async () => {
    const proposal = parseReviewedLinkProposalEnvelope(JSON.stringify(proposalTemplate));
    const executionTarget = {
      ...proposal.executionTarget,
      brandEvidence: {
        ...proposal.executionTarget.brandEvidence,
        officialSourceLabel: "welfare.mil.kr",
      },
    };
    const targetCanonicalJson = canonicalJson(executionTarget);
    const targetFingerprint = await sha256CanonicalJson(targetCanonicalJson);
    const frozen = rebuildReviewedLinkProposalForAdminTarget(proposal, {
      targetCanonicalJson,
      targetFingerprint,
      idempotencyKey: `standard-product-link:${targetFingerprint.slice("sha256:".length)}`,
    });

    const identity = await buildReviewedLinkProposalExecutionIdentity(frozen);

    expect(identity.targetCanonicalJson).toBe(canonicalJson(frozen.executionTarget));
    expect(identity.targetFingerprint).toBe(frozen.approval.targetFingerprint);
    expect(identity.executionTarget.brandEvidence.officialSourceLabel).toBe("welfare.mil.kr");
    expect(identity.executionTarget.brandEvidence.productReferenceUrl).toBe(
      "https://example.com/official-code-001",
    );
  });

  it("rejects an invalid proposal without changing the existing queue", () => {
    const storage = new MemoryStorage();
    const repository = new StandardProductLinkProposalQueueRepository(storage);
    repository.enqueue(JSON.stringify(proposalTemplate));

    expect(() => repository.enqueue(JSON.stringify({ schemaVersion: "wrong" }))).toThrow();
    expect(repository.load()).toHaveLength(1);
  });

  it("returns an empty queue when the stored snapshot is invalid", () => {
    const storage = new MemoryStorage();
    const invalidSnapshot = JSON.stringify({
      schemaVersion: 1,
      proposals: [{ id: "bad", createdAt: "bad", proposal: {} }],
    });
    storage.setItem(STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY, invalidSnapshot);

    const repository = new StandardProductLinkProposalQueueRepository(storage);
    expect(repository.load()).toEqual([]);
    expect(() => repository.enqueue(JSON.stringify(proposalTemplate))).toThrow();
    expect(storage.getItem(STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY)).toBe(invalidSnapshot);
  });
});
