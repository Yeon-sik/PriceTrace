import { sellerIdentityKey, type ProductGroup, type ProductObservationListing } from "../../domain/product-browser";

/** Presentation order only. The existing product and seller identities remain intact. */
export function chronologicalObservations(group: ProductGroup): ProductObservationListing[] {
  return [...group.observations].sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
}

export function selectInstrumentGroups(groups: ProductGroup[]): ProductGroup[] {
  return groups.filter((group) => group.observations.length > 0).sort((a, b) =>
    b.observations.length - a.observations.length || a.id.localeCompare(b.id),
  ).slice(0, 5);
}

export function observationOverview(groups: ProductGroup[]) {
  const observations = groups.flatMap((group) => group.observations);
  return {
    observations: observations.length,
    sellers: new Set(observations.map(sellerIdentityKey)).size,
    latestDate: observations.reduce((latest, observation) => observation.observedAt > latest ? observation.observedAt : latest, ""),
    recent: [...groups].filter((group) => group.observations.length > 0).sort((a, b) =>
      b.latest.observedAt.localeCompare(a.latest.observedAt) || a.id.localeCompare(b.id),
    ).slice(0, 5),
  };
}

export function observationDate(value: string) {
  // Preserve the published observation date; do not reinterpret date-only facts in a timezone.
  return value.slice(0, 10).replaceAll("-", ".");
}
