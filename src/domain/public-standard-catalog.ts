import { z } from "zod";
import type { ProductSpecification } from "./canonical-price";

const httpUrlSchema = z.string().url().refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "쿠팡 상품 URL은 http 또는 https 주소여야 합니다.",
);

export const PublicStandardCatalogRowSchema = z.object({
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
});

export const PublicStandardCatalogRowsSchema = z.array(PublicStandardCatalogRowSchema).superRefine((rows, context) => {
  const catalogByCode = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    const existing = catalogByCode.get(row.source_product_code);
    if (existing && existing !== row.catalog_product_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "하나의 공개 상품 코드가 여러 판매 규격에 연결되었습니다.",
        path: [index, "catalog_product_id"],
      });
    }
    catalogByCode.set(row.source_product_code, row.catalog_product_id);
  }
});

export type PublicStandardCatalogRow = z.infer<typeof PublicStandardCatalogRowSchema>;

export type PublicCoupangPrice = {
  listedPriceKrw: number;
  quantity: number;
  contentAmount: number | null;
  contentUnit: ProductSpecification["contentUnit"] | null;
  productUrl: string;
  observedAt: string;
};

export function buildPublicStandardCatalogIndex(rows: PublicStandardCatalogRow[]) {
  const standardMappings = new Map<string, string>();
  const catalogSpecs = new Map<string, ProductSpecification & { standardProductId: string }>();
  const standardNames = new Map<string, string>();
  const coupangByStandard = new Map<string, PublicCoupangPrice>();

  for (const row of rows) {
    standardMappings.set(row.source_product_code, row.catalog_product_id);
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

    const existing = coupangByStandard.get(row.standard_product_id);
    if (!existing || row.coupang_observed_at > existing.observedAt) {
      coupangByStandard.set(row.standard_product_id, {
        listedPriceKrw: row.coupang_listed_price_krw,
        quantity: row.coupang_quantity,
        contentAmount: row.coupang_content_amount,
        contentUnit: row.coupang_content_unit,
        productUrl: row.coupang_product_url,
        observedAt: row.coupang_observed_at,
      });
    }
  }

  return { standardMappings, catalogSpecs, standardNames, coupangByStandard };
}
