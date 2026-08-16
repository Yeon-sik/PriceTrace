import { z } from "zod";

export const PRODUCT_READ_SCHEMA_VERSION = "product-read.v1" as const;
export const PRODUCT_READ_NAMESPACE = "pricetrace" as const;

export const Sha256RevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const httpUrlSchema = z.string().url().refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "출처 URL은 http 또는 https 주소여야 합니다.",
);

const offsetDateTimeSchema = z.string().datetime({ offset: true });

export const ProductReadSellerProductSchema = z.object({
  sellerLabel: z.string().trim().min(1).max(300),
  sourceProductCode: z.string().trim().min(1).max(128),
}).strict();

export const ProductReadObservationSchema = z.object({
  observationId: z.string().uuid(),
  sellerLabel: z.string().trim().min(1).max(300),
  listedPriceKrw: z.number().int().nonnegative(),
  shippingFeeKrw: z.number().int().nonnegative(),
  minimumOrderQuantity: z.number().int().positive(),
  checkoutPriceKrw: z.number().int().nonnegative(),
  observedAt: offsetDateTimeSchema,
  productUrl: httpUrlSchema,
  source: z.literal("verified-market-observation"),
}).strict().refine(
  (observation) => observation.checkoutPriceKrw
    === observation.listedPriceKrw * observation.minimumOrderQuantity
      + observation.shippingFeeKrw,
  {
    message: "관측 결제금액이 판매가, 최소 주문수량, 배송비와 일치하지 않습니다.",
    path: ["checkoutPriceKrw"],
  },
);

export const ProductReadProductSchema = z.object({
  revision: Sha256RevisionSchema,
  standardProduct: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(300),
    brand: z.string().trim().min(1).max(300).nullable(),
    updatedAt: offsetDateTimeSchema,
  }).strict(),
  catalogProduct: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(300),
    specificationText: z.string().trim().min(1).max(500).nullable(),
    contentAmount: z.number().positive(),
    contentUnit: z.enum(["g", "ml", "each"]),
    packageCount: z.number().int().positive(),
    referenceUnit: z.union([z.literal(10), z.literal(100), z.literal(1000)]),
    listingReferenceUrl: httpUrlSchema.nullable(),
    updatedAt: offsetDateTimeSchema,
  }).strict(),
  sellerProducts: z.array(ProductReadSellerProductSchema),
  observations: z.array(ProductReadObservationSchema),
}).strict().superRefine((product, context) => {
  const sellerProductKeys = new Set<string>();
  for (const [index, sellerProduct] of product.sellerProducts.entries()) {
    const key = `${sellerProduct.sellerLabel}\u0000${sellerProduct.sourceProductCode}`;
    if (sellerProductKeys.has(key)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "판매처 상품 identity가 중복되었습니다.",
        path: ["sellerProducts", index],
      });
    }
    sellerProductKeys.add(key);
  }

  const observationIds = new Set<string>();
  for (const [index, observation] of product.observations.entries()) {
    if (observationIds.has(observation.observationId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "가격 관측 ID가 중복되었습니다.",
        path: ["observations", index, "observationId"],
      });
    }
    observationIds.add(observation.observationId);
  }
});

export const ProductReadV1Schema = z.object({
  schemaVersion: z.literal(PRODUCT_READ_SCHEMA_VERSION),
  namespace: z.literal(PRODUCT_READ_NAMESPACE),
  revision: Sha256RevisionSchema,
  products: z.array(ProductReadProductSchema),
}).strict().superRefine((payload, context) => {
  const catalogProductIds = new Set<string>();
  for (const [index, product] of payload.products.entries()) {
    const catalogProductId = product.catalogProduct.id;
    if (catalogProductIds.has(catalogProductId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "정확한 판매 규격 ID가 중복되었습니다.",
        path: ["products", index, "catalogProduct", "id"],
      });
    }
    catalogProductIds.add(catalogProductId);
  }
});

export type ProductReadV1 = z.infer<typeof ProductReadV1Schema>;
export type ProductReadProduct = z.infer<typeof ProductReadProductSchema>;
export type ProductReadObservation = z.infer<typeof ProductReadObservationSchema>;
