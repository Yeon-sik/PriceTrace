import type {
  OfficialProductCandidate,
  StandardProductMapping,
} from "./official-product";

export const PX_CATALOG_NAMESPACE = "korean-military-px";

export type PendingProposalReceiptIdentity = {
  receiptId: string;
  receiptItemId: string;
  sourceCatalogNamespace: string | null;
  sourceLabel: string;
  sourceProductCode: string;
  sourceNameRaw: string;
};

export type StandardProductQueueReason =
  | "approval_pending"
  | "same_code_mapping_available"
  | "same_code_mapping_ambiguous"
  | "source_name_conflict"
  | "reviewed_display_name"
  | "low_confidence_source"
  | "official_exact_candidate"
  | "official_name_candidate"
  | "manual_research_required";

export type PxStandardProductQueueEntry<T> = {
  candidate: OfficialProductCandidate;
  reasons: StandardProductQueueReason[];
  sameCodeMappedProducts: T[];
  pendingApproval: boolean;
};

export type PxStandardProductQueueGroup<T> = {
  key: string;
  catalogNamespace: string | null;
  sourceProductCode: string;
  entries: PxStandardProductQueueEntry<T>[];
};

function normalizedSourceLabel(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function normalizedRawName(value: string) {
  return value.replace(/\p{White_Space}+/gu, "");
}

function candidateSellers(candidate: OfficialProductCandidate) {
  return candidate.storeLabels?.length
    ? candidate.storeLabels
    : [candidate.storeLabel];
}

export function isPxStandardProductCandidate(candidate: OfficialProductCandidate) {
  return candidate.catalogNamespace === PX_CATALOG_NAMESPACE
    || candidate.martTag?.trim().toLocaleLowerCase("ko-KR") === "px";
}

export function pendingProposalMatchesCandidate(
  candidate: OfficialProductCandidate,
  receipt: PendingProposalReceiptIdentity,
) {
  if (
    candidate.receiptId === receipt.receiptId
    && candidate.receiptItemId === receipt.receiptItemId
  ) return true;
  return candidate.catalogNamespace === receipt.sourceCatalogNamespace
    && candidate.sourceProductCode === receipt.sourceProductCode
    && candidate.productName === receipt.sourceNameRaw
    && candidateSellers(candidate).some((seller) => (
      normalizedSourceLabel(seller) === normalizedSourceLabel(receipt.sourceLabel)
    ));
}

function sameCodeMappingProducts<T>(
  candidate: OfficialProductCandidate,
  mappings: StandardProductMapping<T>[],
  pxSourceLabels: Set<string>,
) {
  const products = new Map<T, T>();
  for (const mapping of mappings) {
    if (!pxSourceLabels.has(normalizedSourceLabel(mapping.sourceLabel))) continue;
    if (mapping.sourceProductCode.trim() !== candidate.sourceProductCode.trim()) continue;
    products.set(mapping.product, mapping.product);
  }
  return [...products.values()];
}

function hasSourceNameConflict(
  candidate: OfficialProductCandidate,
  allCandidates: OfficialProductCandidate[],
) {
  const names = new Set(allCandidates.flatMap((other) => (
    other.catalogNamespace === candidate.catalogNamespace
    && other.sourceProductCode.trim() === candidate.sourceProductCode.trim()
      ? [normalizedRawName(other.productName)]
      : []
  )));
  return names.size > 1;
}

export function buildPxStandardProductQueueEntries<T>(
  candidates: OfficialProductCandidate[],
  mappings: StandardProductMapping<T>[],
  pendingReceipts: PendingProposalReceiptIdentity[],
  pxCatalogCandidates: OfficialProductCandidate[] = candidates,
) {
  const pxSourceLabels = new Set(
    pxCatalogCandidates
      .filter(isPxStandardProductCandidate)
      .flatMap(candidateSellers)
      .map(normalizedSourceLabel),
  );
  return candidates.filter(isPxStandardProductCandidate).map((candidate) => {
    const sameCodeMappedProducts = sameCodeMappingProducts(
      candidate,
      mappings,
      pxSourceLabels,
    );
    const pendingApproval = pendingReceipts.some((receipt) => (
      pendingProposalMatchesCandidate(candidate, receipt)
    ));
    const reasons: StandardProductQueueReason[] = [];
    if (pendingApproval) reasons.push("approval_pending");
    if (sameCodeMappedProducts.length === 1) reasons.push("same_code_mapping_available");
    if (sameCodeMappedProducts.length > 1) reasons.push("same_code_mapping_ambiguous");
    if (hasSourceNameConflict(candidate, candidates)) reasons.push("source_name_conflict");
    if (candidate.reviewedProductName) reasons.push("reviewed_display_name");
    if (candidate.receiptConfidence === "low" || candidate.receiptConfidence === "medium") {
      reasons.push("low_confidence_source");
    }
    if (candidate.officialDiscoveryMethod === "exact_name") {
      reasons.push("official_exact_candidate");
    } else if (candidate.officialSourceProductCode) {
      reasons.push("official_name_candidate");
    }
    if (!candidate.officialSourceProductCode && sameCodeMappedProducts.length === 0) {
      reasons.push("manual_research_required");
    }
    return { candidate, reasons, sameCodeMappedProducts, pendingApproval };
  });
}

function queueGroupKey(candidate: OfficialProductCandidate) {
  const namespace = candidate.catalogNamespace
    ?? `merchant:${normalizedSourceLabel(candidate.storeLabel)}`;
  return `${namespace}:${candidate.sourceProductCode.trim() || "no-code"}`;
}

export function groupPxStandardProductQueueEntries<T>(
  entries: PxStandardProductQueueEntry<T>[],
) {
  const groups = new Map<string, PxStandardProductQueueGroup<T>>();
  for (const entry of entries) {
    const key = queueGroupKey(entry.candidate);
    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.set(key, {
        key,
        catalogNamespace: entry.candidate.catalogNamespace,
        sourceProductCode: entry.candidate.sourceProductCode,
        entries: [entry],
      });
    }
  }
  return [...groups.values()].sort((left, right) => (
    left.sourceProductCode.localeCompare(right.sourceProductCode, "ko-KR")
  ));
}
