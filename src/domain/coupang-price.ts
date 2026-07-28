import { normalizeMarketPrice, type ProductSpecification, type ReferenceUnit } from "./canonical-price";

export type CoupangPriceObservation = {
  listedPriceKrw: number;
  quantity: number;
  maxBundleQuantity: number | null;
  maxBundleListedPriceKrw: number | null;
  contentAmount: number | null;
  contentUnit: ProductSpecification["contentUnit"] | null;
  productUrl: string;
  observedAt: string;
};

export type CoupangOffer = {
  kind: "required" | "maxBundle";
  listedPriceKrw: number;
  quantity: number;
  pricePerItemKrw: number;
  unitPriceKrw: number | null;
  referenceLabel: string | null;
};

export type ResolvedCoupangPrice = CoupangPriceObservation & {
  requiredOffer: CoupangOffer;
  maxBundleOffer: CoupangOffer | null;
  cheapestOffer: CoupangOffer;
  bundleSavingsKrw: number | null;
  bundleUnitSavingsKrw: number | null;
};

export type OptionalCoupangBundle = {
  maxBundleQuantity: number | null;
  maxBundleListedPriceKrw: number | null;
};

export function parseRequiredCoupangPrice(priceValue: string, quantityValue: string):
  | { value: { listedPriceKrw: number; quantity: number }; error: null }
  | { value: null; error: string } {
  const listedPriceKrw = Number(priceValue);
  const quantity = Number(quantityValue);
  if (!Number.isInteger(listedPriceKrw) || listedPriceKrw <= 0) {
    return { value: null, error: "필수 판매 가격은 0원보다 큰 정수여야 합니다." };
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { value: null, error: "필수 판매 개수는 1개 이상의 정수여야 합니다." };
  }
  return { value: { listedPriceKrw, quantity }, error: null };
}

export function parseOptionalCoupangBundle(quantityValue: string, priceValue: string):
  | { value: OptionalCoupangBundle; error: null }
  | { value: null; error: string } {
  const hasQuantity = quantityValue.trim() !== "";
  const hasPrice = priceValue.trim() !== "";
  if (!hasQuantity && !hasPrice) {
    return { value: { maxBundleQuantity: null, maxBundleListedPriceKrw: null }, error: null };
  }
  if (!hasQuantity || !hasPrice) {
    return { value: null, error: "최대 묶음 개수와 묶음 총가격을 함께 입력하세요." };
  }
  const maxBundleQuantity = Number(quantityValue);
  const maxBundleListedPriceKrw = Number(priceValue);
  if (!Number.isInteger(maxBundleQuantity) || maxBundleQuantity < 2) {
    return { value: null, error: "최대 묶음 개수는 2개 이상의 정수여야 합니다." };
  }
  if (!Number.isInteger(maxBundleListedPriceKrw) || maxBundleListedPriceKrw <= 0) {
    return { value: null, error: "최대 묶음 총가격은 0원보다 큰 정수여야 합니다." };
  }
  return { value: { maxBundleQuantity, maxBundleListedPriceKrw }, error: null };
}

export function resolveCoupangPrice(entry: CoupangPriceObservation, referenceUnit: ReferenceUnit | null): ResolvedCoupangPrice {
  const storedQuantity = Number.isInteger(entry.quantity) && entry.quantity > 0 ? entry.quantity : 1;
  const requiredOffer = buildOffer(
    "required",
    entry.listedPriceKrw,
    storedQuantity,
    entry,
    referenceUnit,
  );
  const maxBundleOffer = entry.maxBundleQuantity !== null
    && entry.maxBundleListedPriceKrw !== null
    && entry.maxBundleQuantity >= 2
    && entry.maxBundleListedPriceKrw > 0
    ? buildOffer(
        "maxBundle",
        entry.maxBundleListedPriceKrw,
        entry.maxBundleQuantity,
        entry,
        referenceUnit,
      )
    : null;
  const cheapestOffer = maxBundleOffer?.unitPriceKrw !== null
    && maxBundleOffer?.unitPriceKrw !== undefined
    && (
      requiredOffer.unitPriceKrw === null
      || maxBundleOffer.listedPriceKrw * requiredOffer.quantity
        < requiredOffer.listedPriceKrw * maxBundleOffer.quantity
    )
    ? maxBundleOffer
    : requiredOffer;
  const bundleSavingsKrw = maxBundleOffer
    ? Math.round(
        requiredOffer.listedPriceKrw * maxBundleOffer.quantity / requiredOffer.quantity
          - maxBundleOffer.listedPriceKrw,
      )
    : null;
  const bundleUnitSavingsKrw = maxBundleOffer
    && requiredOffer.unitPriceKrw !== null
    && maxBundleOffer.unitPriceKrw !== null
    ? requiredOffer.unitPriceKrw - maxBundleOffer.unitPriceKrw
    : null;

  return {
    ...entry,
    requiredOffer,
    maxBundleOffer,
    cheapestOffer,
    bundleSavingsKrw,
    bundleUnitSavingsKrw,
  };
}

function buildOffer(
  kind: CoupangOffer["kind"],
  listedPriceKrw: number,
  quantity: number,
  entry: Pick<CoupangPriceObservation, "contentAmount" | "contentUnit" | "observedAt">,
  referenceUnit: ReferenceUnit | null,
): CoupangOffer {
  const specification = entry.contentAmount !== null && entry.contentUnit !== null && referenceUnit !== null
    ? { contentAmount: entry.contentAmount, contentUnit: entry.contentUnit, packageCount: quantity, referenceUnit }
    : null;
  const normalized = specification
    ? normalizeMarketPrice({
        sellerName: "쿠팡",
        listedPriceKrw,
        shippingFeeKrw: 0,
        minimumOrderQuantity: 1,
        observedAt: entry.observedAt,
        verificationStatus: "verified",
      }, specification)
    : null;
  return {
    kind,
    listedPriceKrw,
    quantity,
    pricePerItemKrw: Math.round(listedPriceKrw / quantity),
    unitPriceKrw: normalized?.pricePerReferenceUnitKrw ?? null,
    referenceLabel: normalized?.referenceLabel ?? null,
  };
}
