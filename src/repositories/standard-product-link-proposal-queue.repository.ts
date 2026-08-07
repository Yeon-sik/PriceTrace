import { z } from "zod";
import {
  parseReviewedLinkProposalEnvelope,
  type ReviewedLinkProposal,
} from "../domain/standard-product-registration";

export const STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY =
  "price-trace-standard-product-link-proposals-v1";

const QueueItemEnvelopeSchema = z.object({
  id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
  proposal: z.unknown(),
});

const QueueSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  proposals: z.array(QueueItemEnvelopeSchema),
});

export type StandardProductLinkProposalQueueItem = {
  id: string;
  createdAt: string;
  proposal: ReviewedLinkProposal;
};

export type ProposalQueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function parseProposal(value: unknown) {
  return parseReviewedLinkProposalEnvelope(JSON.stringify(value));
}

export class StandardProductLinkProposalQueueRepository {
  constructor(private readonly storage?: ProposalQueueStorage) {}

  private getStorage() {
    return this.storage ?? (typeof window === "undefined" ? null : window.localStorage);
  }

  private readStoredQueue(): StandardProductLinkProposalQueueItem[] {
    const raw = this.getStorage()?.getItem(STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const snapshot = QueueSnapshotSchema.parse(JSON.parse(raw));
    return snapshot.proposals.map((item) => {
      const proposal = parseProposal(item.proposal);
      if (item.id !== proposal.approval.targetFingerprint) {
        throw new Error("저장된 제안서 식별자와 승인 대상 지문이 일치하지 않습니다.");
      }
      return { ...item, proposal };
    });
  }

  load(): StandardProductLinkProposalQueueItem[] {
    try {
      return this.readStoredQueue();
    } catch {
      return [];
    }
  }

  enqueue(rawProposal: string | ReviewedLinkProposal) {
    const proposal = typeof rawProposal === "string"
      ? parseReviewedLinkProposalEnvelope(rawProposal)
      : parseProposal(rawProposal);
    const id = proposal.approval.targetFingerprint;
    const existing = this.readStoredQueue().filter((item) => item.id !== id);
    const item: StandardProductLinkProposalQueueItem = {
      id,
      createdAt: new Date().toISOString(),
      proposal,
    };
    this.save([item, ...existing]);
    return item;
  }

  remove(id: string) {
    const next = this.load().filter((item) => item.id !== id);
    this.save(next);
    return next;
  }

  private save(proposals: StandardProductLinkProposalQueueItem[]) {
    const storage = this.getStorage();
    if (!storage) return;
    if (proposals.length === 0) {
      storage.removeItem(STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY);
      return;
    }
    storage.setItem(
      STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, proposals }),
    );
  }
}
