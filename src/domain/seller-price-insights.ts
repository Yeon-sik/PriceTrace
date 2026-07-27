import type { ProductGroup, ProductObservationListing } from "./product-browser";
import type { Confidence } from "./types";

export type PricePointSource = "receipt" | "public" | "stored";

export type SellerPricePoint = {
  sellerLabel: string;
  observedAt: string;
  priceKrw: number;
  confidence: Confidence | null;
  source: PricePointSource;
};

export type SellerPriceSummary = {
  sellerLabel: string;
  latestPriceKrw: number;
  latestObservedAt: string;
  previousPriceKrw: number | null;
  changeKrw: number | null;
  changePercent: number | null;
  minimumPriceKrw: number;
  maximumPriceKrw: number;
  observationCount: number;
  snapshotCount: number;
  highConfidenceRatio: number | null;
  sources: PricePointSource[];
};

type PriceSnapshot = SellerPricePoint & { sourceCount: number };

function isHighConfidence(confidence: Confidence | null) {
  return confidence === "high" || confidence === "user_verified";
}

function snapshotsForSeller(points: SellerPricePoint[]) {
  const byObservedAt = new Map<string, PriceSnapshot>();
  for (const point of points) {
    const existing = byObservedAt.get(point.observedAt);
    if (!existing || point.priceKrw < existing.priceKrw) {
      byObservedAt.set(point.observedAt, { ...point, sourceCount: (existing?.sourceCount ?? 0) + 1 });
    } else {
      existing.sourceCount += 1;
    }
  }
  return [...byObservedAt.values()].sort((left, right) => left.observedAt.localeCompare(right.observedAt));
}

/**
 * 판매처별 최신 관측 스냅샷을 비교한다.
 *
 * 같은 날짜(또는 공개 데이터의 같은 월)에 여러 관측이 있으면 그 시점의
 * 기록된 최저가를 대표값으로 사용한다. 판매처 순위는 역대 최저가가 아니라
 * 각 판매처의 최신 스냅샷끼리만 비교한다.
 */
export function summarizeSellerPrices(points: SellerPricePoint[]): SellerPriceSummary[] {
  const bySeller = new Map<string, SellerPricePoint[]>();
  for (const point of points) {
    if (!point.sellerLabel.trim() || !Number.isInteger(point.priceKrw) || point.priceKrw < 0) continue;
    bySeller.set(point.sellerLabel, [...(bySeller.get(point.sellerLabel) ?? []), point]);
  }

  return [...bySeller.entries()].map(([sellerLabel, sellerPoints]) => {
    const snapshots = snapshotsForSeller(sellerPoints);
    const latest = snapshots.at(-1)!;
    const previous = snapshots.at(-2) ?? null;
    const previousPriceKrw = previous?.priceKrw ?? null;
    const changeKrw = previousPriceKrw === null ? null : latest.priceKrw - previousPriceKrw;
    const highConfidenceCount = sellerPoints.filter((point) => isHighConfidence(point.confidence)).length;
    const knownConfidenceCount = sellerPoints.filter((point) => point.confidence !== null).length;
    const prices = sellerPoints.map((point) => point.priceKrw);

    return {
      sellerLabel,
      latestPriceKrw: latest.priceKrw,
      latestObservedAt: latest.observedAt,
      previousPriceKrw,
      changeKrw,
      changePercent: previousPriceKrw === null || previousPriceKrw === 0
        ? null
        : ((latest.priceKrw - previousPriceKrw) / previousPriceKrw) * 100,
      minimumPriceKrw: Math.min(...prices),
      maximumPriceKrw: Math.max(...prices),
      observationCount: sellerPoints.length,
      snapshotCount: snapshots.length,
      highConfidenceRatio: knownConfidenceCount === 0 ? null : highConfidenceCount / knownConfidenceCount,
      sources: [...new Set(sellerPoints.map((point) => point.source))],
    };
  }).sort((left, right) =>
    left.latestPriceKrw - right.latestPriceKrw
    || right.latestObservedAt.localeCompare(left.latestObservedAt)
    || left.sellerLabel.localeCompare(right.sellerLabel, "ko-KR"));
}

export function sellerPricePointsFromObservations(observations: ProductObservationListing[]): SellerPricePoint[] {
  return observations.map((observation) => ({
    sellerLabel: observation.storeLabel,
    observedAt: observation.observedAt,
    priceKrw: observation.item.unitPriceKrw,
    confidence: observation.item.confidence,
    source: observation.source ?? "receipt",
  }));
}

export function sellerPricePointsFromGroup(group: ProductGroup) {
  return sellerPricePointsFromObservations(group.observations);
}
