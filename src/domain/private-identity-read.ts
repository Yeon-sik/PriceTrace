import { z } from "zod";

export const PRIVATE_IDENTITY_READ_SCHEMA_VERSION = "private-identity-read.v1" as const;
export const PRIVATE_IDENTITY_READ_NAMESPACE = "pricetrace" as const;

const uuidSchema = z.string().uuid();
const dateSchema = z.string().date();
const timestampSchema = z.string().datetime({ offset: true });
const nullableUuidSchema = uuidSchema.nullable();

export const PrivateIdentitySelectorSchema = z.object({
  type: z.enum(["store", "store_product", "restaurant_menu", "catalog_product"]),
  id: uuidSchema,
}).strict();

export const PrivateIdentityStoreSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1),
  merchantName: z.string().trim().min(1).nullable(),
  branchName: z.string().trim().min(1).nullable(),
  businessKind: z.string().trim().min(1),
  merchantId: z.string().trim().min(1).nullable(),
  catalogNamespace: z.string().trim().min(1).nullable(),
  businessRegistrationNumber: z.string().trim().min(1).nullable(),
  address: z.string().trim().min(1).nullable(),
  phone: z.string().trim().min(1).nullable(),
  createdAt: timestampSchema,
}).strict();

export const PrivateIdentityProductSchema = z.object({
  id: uuidSchema,
  name: z.string().trim().min(1),
  purchaseType: z.string().trim().min(1),
  categoryId: nullableUuidSchema,
  categoryTags: z.array(z.string()),
  createdAt: timestampSchema,
}).strict();

export const PrivateIdentityStoreProductSchema = z.object({
  id: uuidSchema,
  storeId: uuidSchema,
  productId: uuidSchema,
  storeProductCode: z.string().trim().min(1).nullable(),
}).strict();

export const PrivateIdentityCatalogProductSchema = z.object({
  id: uuidSchema,
  standardProductId: uuidSchema,
  purchaseType: z.string().trim().min(1),
  name: z.string().trim().min(1),
  brand: z.string().trim().min(1).nullable(),
  specification: z.string().trim().min(1).nullable(),
  specificationStatus: z.string().trim().min(1),
  contentAmount: z.number().positive().nullable(),
  contentUnit: z.string().trim().min(1).nullable(),
  packageCount: z.number().int().positive(),
  referenceUnit: z.number().int().positive(),
  listingReferenceUrl: z.string().url().nullable(),
  updatedAt: timestampSchema,
}).strict();

export const PrivateIdentityRestaurantMenuSchema = z.object({
  id: uuidSchema,
  restaurantId: uuidSchema,
  restaurantName: z.string().trim().min(1),
  catalogProductId: uuidSchema,
  name: z.string().trim().min(1),
  categoryLabel: z.string().trim().min(1).nullable(),
  servingLabel: z.string().trim().min(1),
  officialUrl: z.string().url().nullable(),
  reviewStatus: z.string().trim().min(1),
  status: z.string().trim().min(1),
  updatedAt: timestampSchema,
}).strict();

export const PrivateIdentityPriceObservationSchema = z.object({
  id: uuidSchema,
  storeProductId: uuidSchema,
  receiptItemId: z.string().trim().min(1),
  catalogProductId: nullableUuidSchema,
  observedAt: dateSchema,
  unitPriceKrw: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  measurementUnit: z.string().trim().min(1),
  locationLabel: z.string().trim().min(1).nullable(),
  verificationStatus: z.string().trim().min(1),
}).strict();

const identityFields = {
  productId: nullableUuidSchema,
  storeProductId: nullableUuidSchema,
  catalogProductId: nullableUuidSchema,
  restaurantMenuId: nullableUuidSchema,
};

export const PrivateIdentitySourceLineSchema = z.object({
  sourceLineId: z.string().trim().min(1),
  lineOrdinal: z.number().int().positive().nullable(),
  type: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
  sourceLineReferences: z.array(z.string().trim().min(1)),
  merchantSku: z.string().trim().min(1).nullable(),
  quantityValue: z.number().positive().nullable(),
  quantityUnit: z.string().trim().min(1).nullable(),
  unitPriceAmountMinor: z.number().int().nonnegative().nullable(),
  grossAmountMinor: z.number().int().nonnegative(),
  discountAmountMinor: z.number().int().nonnegative(),
  taxAmountMinor: z.number().int().nonnegative(),
  netAmountMinor: z.number().int().nullable(),
  taxRatePercent: z.number().nonnegative().nullable(),
  foodServiceRole: z.string().trim().min(1).nullable(),
  appliesToSourceLineId: z.string().trim().min(1).nullable(),
  ...identityFields,
}).strict();

export const PrivateIdentityReceiptItemSchema = z.object({
  id: z.string().trim().min(1),
  lineOrdinal: z.number().int().positive(),
  sourceLineId: z.string().trim().min(1).nullable(),
  ...identityFields,
  unitPriceKrw: z.number().int().nonnegative(),
  purchasedQuantity: z.number().int().positive(),
  totalPriceKrw: z.number().int().nonnegative(),
}).strict().refine(
  (item) => item.totalPriceKrw === item.unitPriceKrw * item.purchasedQuantity,
  { message: "private receipt item total must equal unit price multiplied by quantity", path: ["totalPriceKrw"] },
);

export const PrivateIdentityReceiptSchema = z.object({
  id: uuidSchema,
  storeId: uuidSchema,
  purchasedAt: dateSchema,
  transactionNumber: z.string().trim().min(1),
  totalPriceKrw: z.number().int().nonnegative(),
  items: z.array(PrivateIdentityReceiptItemSchema),
  sourceLines: z.array(PrivateIdentitySourceLineSchema),
}).strict();

export const PrivateIdentityReadSchema = z.object({
  schemaVersion: z.literal(PRIVATE_IDENTITY_READ_SCHEMA_VERSION),
  namespace: z.literal(PRIVATE_IDENTITY_READ_NAMESPACE),
  selector: PrivateIdentitySelectorSchema,
  stores: z.array(PrivateIdentityStoreSchema),
  products: z.array(PrivateIdentityProductSchema),
  storeProducts: z.array(PrivateIdentityStoreProductSchema),
  catalogProducts: z.array(PrivateIdentityCatalogProductSchema),
  restaurantMenus: z.array(PrivateIdentityRestaurantMenuSchema),
  receipts: z.array(PrivateIdentityReceiptSchema),
  priceObservations: z.array(PrivateIdentityPriceObservationSchema),
}).strict();

export type PrivateIdentitySelector = z.infer<typeof PrivateIdentitySelectorSchema>;
export type PrivateIdentityRead = z.infer<typeof PrivateIdentityReadSchema>;
export type PrivateIdentityStore = z.infer<typeof PrivateIdentityStoreSchema>;
export type PrivateIdentityProduct = z.infer<typeof PrivateIdentityProductSchema>;
export type PrivateIdentityStoreProduct = z.infer<typeof PrivateIdentityStoreProductSchema>;
export type PrivateIdentityCatalogProduct = z.infer<typeof PrivateIdentityCatalogProductSchema>;
export type PrivateIdentityRestaurantMenu = z.infer<typeof PrivateIdentityRestaurantMenuSchema>;
export type PrivateIdentityPriceObservation = z.infer<typeof PrivateIdentityPriceObservationSchema>;
export type PrivateIdentitySourceLine = z.infer<typeof PrivateIdentitySourceLineSchema>;
export type PrivateIdentityReceiptItem = z.infer<typeof PrivateIdentityReceiptItemSchema>;
export type PrivateIdentityReceipt = z.infer<typeof PrivateIdentityReceiptSchema>;
