import type { OfficialProductCandidate } from "./official-product";

export type StandardProductConnectionQueueExclusion = {
  sourceLabel: string;
  sourceProductCode: string;
  sourceNameRaw: string;
  reason: "already_registered_duplicate";
  sourceRef: string;
};

/**
 * Explicit workflow exclusions recorded during product-link investigation.
 * These entries only hide duplicate work from the connection queue; they do
 * not create or imply a standard-product mapping.
 */
export const standardProductConnectionQueueExclusions = [
  {
    sourceLabel: "국군복지단 바다마을마트",
    sourceProductCode: "250538",
    sourceNameRaw: "초간편 만능대패 삼겹살",
    reason: "already_registered_duplicate",
    sourceRef: "docs/예외처리_2026-08-03.md",
  },
  {
    sourceLabel: "와마트 일산점",
    sourceProductCode: "260150",
    sourceNameRaw: "더단백 크런치바 초코",
    reason: "already_registered_duplicate",
    sourceRef: "docs/예외처리_2026-08-03.md",
  },
  {
    sourceLabel: "와마트 일산점",
    sourceProductCode: "260207",
    sourceNameRaw: "쉬림프 스파이시 투움바 파스타",
    reason: "already_registered_duplicate",
    sourceRef: "docs/예외처리_2026-08-03.md",
  },
] as const satisfies readonly StandardProductConnectionQueueExclusion[];

function normalizedSourceLabel(value: string) {
  return value.trim().toLocaleLowerCase("ko-KR");
}

export function isExcludedFromStandardProductConnectionQueue(
  candidate: OfficialProductCandidate,
) {
  const sourceLabels = candidate.storeLabels?.length
    ? candidate.storeLabels
    : [candidate.storeLabel];
  const candidateCode = candidate.sourceProductCode.trim();

  return standardProductConnectionQueueExclusions.some((exclusion) => (
    exclusion.sourceProductCode === candidateCode
    && sourceLabels.some((sourceLabel) => (
      normalizedSourceLabel(sourceLabel)
      === normalizedSourceLabel(exclusion.sourceLabel)
    ))
  ));
}
