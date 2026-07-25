import { z } from "zod";

const receiptItemSchema = z.object({
  id: z.string().min(1),
  receiptId: z.string().min(1),
  sourceLineReferences: z.array(z.string()),
  productName: z.string().min(1),
  sourceProductCode: z.string(),
  unitPriceKrw: z.number().int().nonnegative(),
  quantityValue: z.number().int().positive(),
  totalPriceKrw: z.number().int().nonnegative(),
  confidence: z.enum(["high", "medium", "low", "user_verified"]),
});

const receiptSchema = z.object({
  id: z.string().min(1),
  storeLabel: z.string().min(1),
  storeAddress: z.string().nullable().optional(),
  storePhone: z.string().nullable().optional(),
  retailChannel: z.enum(["px", "regular", "unknown"]),
  catalogNamespace: z.string().nullable(),
  purchasedAt: z.string().date(),
  transactionNumber: z.literal(""),
  currency: z.literal("KRW"),
  totalPriceKrw: z.number().int(),
  items: z.array(receiptItemSchema),
});

export const PrivateReceiptResponseSchema = z.object({
  revision: z.string().min(1),
  receipts: z.array(receiptSchema),
  warnings: z.array(z.string()),
});
