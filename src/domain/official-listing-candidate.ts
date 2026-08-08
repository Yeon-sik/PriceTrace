import {
  findUniqueOfficialContainedNameMatch,
  findUniqueOfficialExactNameMatch,
  findUniqueOfficialRelaxedNameMatch,
} from "./standard-product-registration";

export type OfficialListingDiscoveryMethod =
  | "exact_name"
  | "relaxed_name"
  | "contained_name"
  | "reviewed_display_name";

export function findOfficialListingCandidate<T extends {
  sourceNameRaw: string;
  officialPrice: { amountKrw: number } | null;
}>(
  listings: T[],
  receiptName: string,
  receiptUnitPriceKrw: number,
): { listing: T; method: Exclude<OfficialListingDiscoveryMethod, "reviewed_display_name"> } | null {
  const exact = findUniqueOfficialExactNameMatch(listings, receiptName);
  if (exact) return { listing: exact, method: "exact_name" };
  const relaxed = findUniqueOfficialRelaxedNameMatch(listings, receiptName);
  if (relaxed) return { listing: relaxed, method: "relaxed_name" };
  const contained = findUniqueOfficialContainedNameMatch(
    listings,
    receiptName,
    receiptUnitPriceKrw,
  );
  return contained ? { listing: contained, method: "contained_name" } : null;
}
