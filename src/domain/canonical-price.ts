export type CanonicalPriceObservation = {
  locationLabel: string | null;
  unitPriceKrw: number;
  observedAt: string;
  measurementUnit: string;
};

export type ProductSpecification = {
  contentAmount: number;
  contentUnit: "g" | "ml" | "each";
  packageCount: number;
};

export type MarketPriceObservation = {
  sellerName: string;
  listedPriceKrw: number;
  shippingFeeKrw: number;
  minimumOrderQuantity: number;
  observedAt: string;
  verificationStatus: "pending" | "verified" | "rejected";
};

export type NormalizedMarketPrice = MarketPriceObservation & {
  effectivePriceKrw: number;
  pricePerReferenceUnitKrw: number;
  referenceLabel: string;
};

export function normalizeMarketPrice(observation: MarketPriceObservation, specification: ProductSpecification): NormalizedMarketPrice {
  if (!Number.isFinite(specification.contentAmount) || specification.contentAmount <= 0 || !Number.isInteger(specification.packageCount) || specification.packageCount <= 0) throw new Error("상품 규격이 올바르지 않습니다.");
  const referenceQuantity = specification.contentUnit === "each" ? 1 : 100;
  const totalContent = specification.contentAmount * specification.packageCount;
  const effectivePriceKrw = observation.listedPriceKrw + observation.shippingFeeKrw;
  return {
    ...observation,
    effectivePriceKrw,
    pricePerReferenceUnitKrw: Math.round((effectivePriceKrw * referenceQuantity) / totalContent),
    referenceLabel: specification.contentUnit === "each" ? "1개당" : `100${specification.contentUnit}당`,
  };
}

export function lowestVerifiedMarketPrice(observations: MarketPriceObservation[], specification: ProductSpecification): NormalizedMarketPrice | null {
  const verified = observations.filter((observation) => observation.verificationStatus === "verified").map((observation) => normalizeMarketPrice(observation, specification));
  return verified.sort((left, right) => left.pricePerReferenceUnitKrw - right.pricePerReferenceUnitKrw || left.effectivePriceKrw - right.effectivePriceKrw || right.observedAt.localeCompare(left.observedAt))[0] ?? null;
}

export type LocationPriceSummary = {
  locationLabel: string;
  latestKrw: number;
  minimumKrw: number;
  maximumKrw: number;
  observationCount: number;
  measurementUnits: string[];
};

export function summarizeCanonicalPrices(observations: CanonicalPriceObservation[]): LocationPriceSummary[] {
  const byLocation = new Map<string, CanonicalPriceObservation[]>();
  for (const observation of observations) {
    const location = observation.locationLabel ?? "출처 미상";
    byLocation.set(location, [...(byLocation.get(location) ?? []), observation]);
  }
  return [...byLocation.entries()].map(([locationLabel, rows]) => {
    const ordered = [...rows].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
    const prices = ordered.map((row) => row.unitPriceKrw);
    return {
      locationLabel,
      latestKrw: ordered[0].unitPriceKrw,
      minimumKrw: Math.min(...prices),
      maximumKrw: Math.max(...prices),
      observationCount: rows.length,
      measurementUnits: [...new Set(rows.map((row) => row.measurementUnit))],
    };
  }).sort((left, right) => left.latestKrw - right.latestKrw);
}
