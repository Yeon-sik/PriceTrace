import { normalizeMarketPrice, type MarketPriceObservation, type ProductSpecification } from "./canonical-price";

export type StandardProductVariant = ProductSpecification & {
  id: string;
  listingName: string;
  sellerName: string;
  observedAt: string;
  listedPriceKrw: number;
  shippingFeeKrw?: number;
};

export type StandardProductSummary = {
  id: string;
  name: string;
  lowestUnitPriceKrw: number;
  unitLabel: string;
  lowestVariant: StandardProductVariant;
  variants: StandardProductVariant[];
  sellerCount: number;
};

export function summarizeStandardProducts(products: { id: string; name: string }[], variantsByProduct: Record<string, StandardProductVariant[]>): StandardProductSummary[] {
  return products.flatMap((product) => {
    const variants = variantsByProduct[product.id] ?? [];
    const priced = variants.map((variant) => ({ variant, normalized: normalizeMarketPrice({ sellerName: variant.sellerName, listedPriceKrw: variant.listedPriceKrw, shippingFeeKrw: variant.shippingFeeKrw ?? 0, minimumOrderQuantity: 1, observedAt: variant.observedAt, verificationStatus: "verified" } satisfies MarketPriceObservation, variant) }));
    const lowest = priced.sort((left, right) => left.normalized.pricePerReferenceUnitKrw - right.normalized.pricePerReferenceUnitKrw || right.normalized.observedAt.localeCompare(left.normalized.observedAt))[0];
    return lowest ? [{ id: product.id, name: product.name, lowestUnitPriceKrw: lowest.normalized.pricePerReferenceUnitKrw, unitLabel: lowest.normalized.referenceLabel, lowestVariant: lowest.variant, variants, sellerCount: new Set(variants.map((variant) => variant.sellerName)).size }] : [];
  }).sort((left, right) => left.lowestUnitPriceKrw - right.lowestUnitPriceKrw || left.name.localeCompare(right.name));
}
