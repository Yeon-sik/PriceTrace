export type CanonicalPriceObservation = {
  locationLabel: string | null;
  unitPriceKrw: number;
  observedAt: string;
  measurementUnit: string;
};

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
