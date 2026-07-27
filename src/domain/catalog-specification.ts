import type { ReferenceUnit } from "./canonical-price";

export const catalogSpecificationStatuses = ["verified", "placeholder"] as const;
export type CatalogSpecificationStatus = (typeof catalogSpecificationStatuses)[number];
export type CatalogContentUnit = "g" | "ml" | "each";

export const placeholderCatalogSpecification = {
  contentAmount: 1,
  contentUnit: "each" as const,
  packageCount: 1,
  referenceUnit: 100 as ReferenceUnit,
};

export function resolveCatalogSpecification(
  status: CatalogSpecificationStatus,
  values: {
    contentAmount: number;
    contentUnit: CatalogContentUnit;
    packageCount: number;
    referenceUnit: ReferenceUnit;
  },
) {
  return status === "placeholder" ? placeholderCatalogSpecification : values;
}

export function isCatalogSpecificationCalculationEligible(status: CatalogSpecificationStatus) {
  return status === "verified";
}

export function catalogSpecificationLabel(product: {
  specificationStatus: CatalogSpecificationStatus;
  specification?: string | null;
  contentAmount: number | null;
  contentUnit: CatalogContentUnit | null;
  packageCount: number;
}) {
  if (product.specificationStatus === "placeholder") return "규격 확인 필요";
  if (!product.contentAmount || !product.contentUnit) return product.specification ?? "규격 미입력";
  const unitLabel = product.contentUnit === "each" ? "개" : product.contentUnit;
  const base = `${product.contentAmount}${unitLabel}`;
  return product.packageCount > 1 ? `${base} × ${product.packageCount}` : base;
}
