import { z } from "zod";
import type { ProductSpecification } from "./canonical-price";
import type { CoupangPriceObservation } from "./coupang-price";

const httpUrlSchema = z.string().url().refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "쿠팡 상품 URL은 http 또는 https 주소여야 합니다.",
);

export const PublicStandardCatalogRowSchema = z.object({
  source_label: z.string().trim().min(1).max(200).optional(),
  source_product_code: z.string().trim().min(1).max(128),
  catalog_product_id: z.string().uuid(),
  standard_product_id: z.string().uuid(),
  standard_name: z.string().trim().min(1).max(300),
  content_amount: z.number().positive(),
  content_unit: z.enum(["g", "ml", "each"]),
  package_count: z.number().int().positive(),
  reference_unit: z.union([z.literal(10), z.literal(100), z.literal(1000)]),
  coupang_listed_price_krw: z.number().int().nonnegative().nullable(),
  coupang_quantity: z.number().int().positive().nullable(),
  coupang_content_amount: z.number().positive().nullable(),
  coupang_content_unit: z.enum(["g", "ml", "each"]).nullable(),
  coupang_max_bundle_quantity: z.number().int().min(2).nullable().optional().default(null),
  coupang_max_bundle_listed_price_krw: z.number().int().positive().nullable().optional().default(null),
  coupang_product_url: httpUrlSchema.nullable(),
  coupang_observed_at: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((row, context) => {
  const requiredCoupangValues = [
    row.coupang_listed_price_krw,
    row.coupang_quantity,
    row.coupang_product_url,
    row.coupang_observed_at,
  ];
  const populatedCount = requiredCoupangValues.filter((value) => value !== null).length;
  if (populatedCount !== 0 && populatedCount !== requiredCoupangValues.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "쿠팡 가격 정보는 모두 존재하거나 모두 null이어야 합니다.",
      path: ["coupang_listed_price_krw"],
    });
  }
  const specificationValues = [row.coupang_content_amount, row.coupang_content_unit];
  const specificationCount = specificationValues.filter((value) => value !== null).length;
  if (specificationCount !== 0 && specificationCount !== specificationValues.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "쿠팡 기준 용량과 단위는 함께 존재해야 합니다.",
      path: ["coupang_content_amount"],
    });
  }
  if (populatedCount === 0 && specificationCount !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "쿠팡 가격이 없으면 기준 용량도 비어 있어야 합니다.",
      path: ["coupang_content_amount"],
    });
  }
  const bundleValues = [
    row.coupang_max_bundle_quantity,
    row.coupang_max_bundle_listed_price_krw,
  ];
  const bundleCount = bundleValues.filter((value) => value !== null).length;
  if (bundleCount !== 0 && bundleCount !== bundleValues.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "쿠팡 최대 묶음 개수와 총가격은 함께 존재해야 합니다.",
      path: ["coupang_max_bundle_quantity"],
    });
  }
  if (populatedCount === 0 && bundleCount !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "쿠팡 필수 판매 가격이 없으면 최대 묶음 가격도 비어 있어야 합니다.",
      path: ["coupang_max_bundle_quantity"],
    });
  }
});

export const PublicStandardCatalogRowsSchema = z.array(PublicStandardCatalogRowSchema).superRefine((rows, context) => {
  const catalogBySourceProduct = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    const sourceProductKey = row.source_label
      ? publicStandardMappingKey(row.source_label, row.source_product_code)
      : row.source_product_code;
    const existing = catalogBySourceProduct.get(sourceProductKey);
    if (existing && existing !== row.catalog_product_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "하나의 공개 판매처 상품이 여러 판매 규격에 연결되었습니다.",
        path: [index, "catalog_product_id"],
      });
    }
    catalogBySourceProduct.set(sourceProductKey, row.catalog_product_id);
  }
});

export type PublicStandardCatalogRow = z.infer<typeof PublicStandardCatalogRowSchema>;

export type PublicCoupangPrice = CoupangPriceObservation;

export function publicStandardMappingKey(sourceLabel: string, sourceProductCode: string) {
  return `${sourceLabel}:${sourceProductCode}`;
}

export function buildPublicStandardCatalogIndex(rows: PublicStandardCatalogRow[]) {
  // Keep the previous RPC shape readable while the app and database migration roll out.
  const standardMappings = new Map<string, string>();
  const exactStandardMappings = new Map<string, string>();
  const catalogSpecs = new Map<string, ProductSpecification & { standardProductId: string }>();
  const standardNames = new Map<string, string>();
  const coupangByStandard = new Map<string, PublicCoupangPrice>();

  for (const row of rows) {
    if (row.source_label) {
      exactStandardMappings.set(
        publicStandardMappingKey(row.source_label, row.source_product_code),
        row.catalog_product_id,
      );
    } else {
      standardMappings.set(row.source_product_code, row.catalog_product_id);
    }
    catalogSpecs.set(row.catalog_product_id, {
      contentAmount: row.content_amount,
      contentUnit: row.content_unit,
      packageCount: row.package_count,
      referenceUnit: row.reference_unit,
      standardProductId: row.standard_product_id,
    });
    standardNames.set(row.standard_product_id, row.standard_name);

    if (
      row.coupang_listed_price_krw === null
      || row.coupang_quantity === null
      || row.coupang_product_url === null
      || row.coupang_observed_at === null
    ) continue;

    const observation = {
      listedPriceKrw: row.coupang_listed_price_krw,
      quantity: row.coupang_quantity,
      maxBundleQuantity: row.coupang_max_bundle_quantity,
      maxBundleListedPriceKrw: row.coupang_max_bundle_listed_price_krw,
      contentAmount: row.coupang_content_amount,
      contentUnit: row.coupang_content_unit,
      productUrl: row.coupang_product_url,
      observedAt: row.coupang_observed_at,
    };
    const existingStandardPrice = coupangByStandard.get(row.standard_product_id);
    if (!existingStandardPrice || row.coupang_observed_at > existingStandardPrice.observedAt) {
      coupangByStandard.set(row.standard_product_id, observation);
    }
  }

  return { standardMappings, exactStandardMappings, catalogSpecs, standardNames, coupangByStandard };
}
