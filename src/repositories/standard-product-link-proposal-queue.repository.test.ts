import { describe, expect, it } from "vitest";
import proposalTemplate from "../../.agents/skills/pricetrace-link-standard-products/assets/link-proposal.template.json";
import {
  buildReviewedLinkProposalExecutionIdentity,
  canonicalJson,
  parseReviewedLinkProposalEnvelope,
  rebuildReviewedLinkProposalForAdminTarget,
  sha256CanonicalJson,
} from "../domain/standard-product-registration";
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
