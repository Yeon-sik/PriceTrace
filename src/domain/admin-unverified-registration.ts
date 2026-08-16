import { z } from "zod";

const httpUrlSchema = z.string().trim().url().refine(
  (value) => value.startsWith("https://") || value.startsWith("http://"),
  "출처 URL은 http 또는 https 주소여야 합니다.",
);

const nullableTextSchema = z.string().trim().max(500).nullable();
const nullableUrlSchema = httpUrlSchema.nullable();
const offsetDateTimeSchema = z.string().datetime({ offset: true });

export const AdminUnverifiedProductSaleRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  catalogProductId: z.string().uuid().nullable(),
  standardName: z.string().trim().max(300),
  brandName: nullableTextSchema,
  listingName: z.string().trim().max(300),
  specification: nullableTextSchema,
  contentAmount: z.number().positive().nullable(),
  contentUnit: z.enum(["g", "ml", "each"]).nullable(),
  packageCount: z.number().int().positive().nullable(),
  referenceUnit: z.union([z.literal(10), z.literal(100), z.literal(1000)]).nullable(),
  listingReferenceUrl: nullableUrlSchema,
  sellerName: z.string().trim().min(1).max(300),
  sourceProductCode: nullableTextSchema,
  productUrl: httpUrlSchema,
  listedPriceKrw: z.number().int().nonnegative(),
  shippingFeeKrw: z.number().int().nonnegative(),
  minimumOrderQuantity: z.number().int().positive(),
  observedAt: offsetDateTimeSchema,
}).strict().superRefine((request, context) => {
  if (request.catalogProductId === null) {
    if (!request.standardName) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["standardName"], message: "새 상품명은 필수입니다." });
    }
    if (!request.listingName) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["listingName"], message: "판매 규격명은 필수입니다." });
    }
    if (request.contentAmount === null || request.contentUnit === null || request.packageCount === null || request.referenceUnit === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["contentAmount"], message: "새 상품의 정확한 규격은 필수입니다." });
    }
    if (request.listingReferenceUrl === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["listingReferenceUrl"], message: "새 상품의 확인 URL은 필수입니다." });
    }
  }
  if (request.contentUnit === "each" && request.referenceUnit !== null && request.referenceUnit !== 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceUnit"], message: "개 단위의 기준은 100으로 고정합니다." });
  }
});

export type AdminUnverifiedProductSaleRequest = z.infer<typeof AdminUnverifiedProductSaleRequestSchema>;

export type AdminUnverifiedRetailCatalogOption = {
  id: string;
  standard_product_id: string;
  canonical_name: string;
  specification: string | null;
  content_amount: number | null;
  content_unit: "g" | "ml" | "each" | null;
  package_count: number;
  reference_unit: 10 | 100 | 1000;
  listing_reference_url: string | null;
  verification_status: "verified" | "unverified";
  standard_name: string;
  brand: string | null;
};

export const AdminUnverifiedProductSaleRpcRowSchema = z.object({
  standard_product_id: z.string().uuid(),
  catalog_product_id: z.string().uuid(),
  market_price_observation_id: z.string().uuid(),
  verification_status: z.literal("unverified"),
  replayed: z.boolean(),
}).strict();

export type AdminUnverifiedProductSaleResult = {
  standardProductId: string;
  catalogProductId: string;
  marketPriceObservationId: string;
  verificationStatus: "unverified";
  replayed: boolean;
};

export function adminUnverifiedProductSaleResultFromRpc(input: unknown): AdminUnverifiedProductSaleResult {
  const row = AdminUnverifiedProductSaleRpcRowSchema.parse(input);
  return {
    standardProductId: row.standard_product_id,
    catalogProductId: row.catalog_product_id,
    marketPriceObservationId: row.market_price_observation_id,
    verificationStatus: row.verification_status,
    replayed: row.replayed,
  };
}

export const AdminUnverifiedRestaurantMenuRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  restaurantId: z.string().uuid().nullable(),
  restaurantName: z.string().trim().min(1).max(200),
  restaurantLegalName: nullableTextSchema,
  cuisineType: nullableTextSchema,
  restaurantOfficialSiteUrl: nullableUrlSchema,
  sourceNamespace: z.literal("admin-manual"),
  sourceLocationCode: z.string().trim().min(1).max(200),
  locationLabel: nullableTextSchema,
  locationOfficialUrl: nullableUrlSchema,
  restaurantMenuId: z.string().uuid().nullable(),
  menuName: z.string().trim().min(1).max(300),
  menuCategoryLabel: nullableTextSchema,
  servingLabel: z.string().trim().min(1).max(100),
  menuOfficialUrl: nullableUrlSchema,
  unitPriceKrw: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  observedOn: z.string().date(),
  sourceUrl: nullableUrlSchema,
  note: nullableTextSchema,
}).strict();

export type AdminUnverifiedRestaurantMenuRequest = z.infer<typeof AdminUnverifiedRestaurantMenuRequestSchema>;

export const AdminUnverifiedRestaurantMenuRpcRowSchema = z.object({
  restaurant_id: z.string().uuid(),
  restaurant_location_id: z.string().uuid(),
  restaurant_menu_id: z.string().uuid(),
  catalog_product_id: z.string().uuid(),
  manual_observation_id: z.string().uuid(),
  verification_status: z.literal("unverified"),
  replayed: z.boolean(),
}).strict();

export type AdminUnverifiedRestaurantMenuResult = {
  restaurantId: string;
  restaurantLocationId: string;
  restaurantMenuId: string;
  catalogProductId: string;
  manualObservationId: string;
  verificationStatus: "unverified";
  replayed: boolean;
};

export function adminUnverifiedRestaurantMenuResultFromRpc(input: unknown): AdminUnverifiedRestaurantMenuResult {
  const row = AdminUnverifiedRestaurantMenuRpcRowSchema.parse(input);
  return {
    restaurantId: row.restaurant_id,
    restaurantLocationId: row.restaurant_location_id,
    restaurantMenuId: row.restaurant_menu_id,
    catalogProductId: row.catalog_product_id,
    manualObservationId: row.manual_observation_id,
    verificationStatus: row.verification_status,
    replayed: row.replayed,
  };
}
