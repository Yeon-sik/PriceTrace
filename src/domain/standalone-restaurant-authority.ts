import { z } from "zod";
import { OcrResolutionSchema } from "./verified-receipt-ingestion";

const nullableUuidSchema = z.string().uuid().nullable();

export const StandaloneRestaurantAuthorityResponseSchema = z.object({
  schemaVersion: z.literal("receipt-independent-price-observation.v3"),
  kind: z.literal("restaurant_purchase"),
  observationId: nullableUuidSchema,
  replayed: z.boolean(),
  authorityStatus: z.enum(["exact", "needs_ocr_resolution"]),
  merchantResolutionStatus: z.enum(["exact", "needs_ocr_resolution"]),
  menuResolutionStatus: z.enum(["exact", "needs_ocr_resolution"]),
  ocrResolution: OcrResolutionSchema.nullable(),
  authoritativeIds: z.object({
    restaurantId: nullableUuidSchema,
    restaurantLocationId: nullableUuidSchema,
    restaurantMenuId: nullableUuidSchema,
    catalogProductId: nullableUuidSchema,
    standardProductId: nullableUuidSchema,
  }).strict(),
}).strict().superRefine((response, context) => {
  const ids = response.authoritativeIds;
  if (response.authorityStatus === "exact") {
    if (response.merchantResolutionStatus !== "exact" || response.menuResolutionStatus !== "exact") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["authorityStatus"], message: "exact authority requires exact Restaurant and Menu resolution." });
    }
    if (response.observationId === null || ids.restaurantId === null || ids.restaurantLocationId === null
      || ids.restaurantMenuId === null || ids.catalogProductId === null || ids.standardProductId === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["authoritativeIds"], message: "exact publication requires all Restaurant, Location, Menu, and Catalog IDs." });
    }
    if (response.ocrResolution !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["ocrResolution"], message: "exact authority cannot retain an unresolved OCR resolution." });
    }
    return;
  }

  if (response.menuResolutionStatus !== "needs_ocr_resolution"
    || response.observationId !== null
    || ids.restaurantId !== null || ids.restaurantLocationId !== null
    || ids.restaurantMenuId !== null || ids.catalogProductId !== null
    || ids.standardProductId !== null
    || response.ocrResolution?.status !== "needs_ocr_resolution") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["authorityStatus"], message: "unresolved authority must not expose publication IDs or an observation." });
  }
});

export type StandaloneRestaurantAuthorityResponse = z.infer<typeof StandaloneRestaurantAuthorityResponseSchema>;
