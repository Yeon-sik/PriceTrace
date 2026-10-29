import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StandaloneRestaurantAuthorityResponseSchema } from "./standalone-restaurant-authority";

const ids = {
  restaurantId: "11111111-1111-4111-8111-111111111111",
  restaurantLocationId: "22222222-2222-4222-8222-222222222222",
  restaurantMenuId: "33333333-3333-4333-8333-333333333333",
  catalogProductId: "44444444-4444-4444-8444-444444444444",
  standardProductId: "55555555-5555-4555-8555-555555555555",
};

const exactResponse = {
  schemaVersion: "receipt-independent-price-observation.v3",
  kind: "restaurant_purchase",
  observationId: "66666666-6666-4666-8666-666666666666",
  replayed: false,
  authorityStatus: "exact",
  merchantResolutionStatus: "exact",
  menuResolutionStatus: "exact",
  ocrResolution: null,
  authoritativeIds: ids,
};

describe("standalone restaurant authority response", () => {
  it("accepts exact authority only when all four domain IDs and an observation are present", () => {
    expect(StandaloneRestaurantAuthorityResponseSchema.parse(exactResponse).authorityStatus).toBe("exact");
    expect(() => StandaloneRestaurantAuthorityResponseSchema.parse({
      ...exactResponse,
      authoritativeIds: { ...ids, restaurantMenuId: null },
    })).toThrow();
  });

  it("requires OCR resolution and withholds every publishable ID while identity is unresolved", () => {
    const response = StandaloneRestaurantAuthorityResponseSchema.parse({
      ...exactResponse,
      observationId: null,
      authorityStatus: "needs_ocr_resolution",
      merchantResolutionStatus: "exact",
      menuResolutionStatus: "needs_ocr_resolution",
      ocrResolution: {
        schemaVersion: "ocr-resolution.v1",
        status: "needs_ocr_resolution",
        resolutionId: "77777777-7777-4777-8777-777777777777",
        reasonCode: "menu_identity_ambiguous",
        requiredSourceFacts: ["exact_menu_serving_label_or_source_menu_code"],
      },
      authoritativeIds: {
        restaurantId: null,
        restaurantLocationId: null,
        restaurantMenuId: null,
        catalogProductId: null,
        standardProductId: null,
      },
    });
    expect(response.authorityStatus).toBe("needs_ocr_resolution");
    expect(() => StandaloneRestaurantAuthorityResponseSchema.parse({
      ...response,
      authoritativeIds: { ...response.authoritativeIds, restaurantMenuId: ids.restaurantMenuId },
    })).toThrow();
  });

  it("rejects legacy responses with no authority status instead of treating them as exact", () => {
    const legacyResponse: Record<string, unknown> = { ...exactResponse };
    delete legacyResponse.authorityStatus;
    delete legacyResponse.merchantResolutionStatus;
    delete legacyResponse.menuResolutionStatus;
    delete legacyResponse.ocrResolution;
    expect(() => StandaloneRestaurantAuthorityResponseSchema.parse(legacyResponse)).toThrow();
  });

  it("rejects pending and unverified labels as authority values", () => {
    expect(() => StandaloneRestaurantAuthorityResponseSchema.parse({
      ...exactResponse,
      authorityStatus: "pending",
    })).toThrow();
    expect(() => StandaloneRestaurantAuthorityResponseSchema.parse({
      ...exactResponse,
      merchantResolutionStatus: "unverified",
    })).toThrow();
  });

  it("keeps both OCR resolution RPCs authenticated and patches deployed SQL definitions", () => {
    const migration = readFileSync(path.join(
      process.cwd(),
      "supabase/migrations/20260928041336_ocr_v5_standalone_and_menu_authority.sql",
    ), "utf8");
    expect(migration).toContain("pg_catalog.pg_get_functiondef(");
    expect(migration).toContain("private_resolve_ocr_standalone_restaurant_v1");
    expect(migration).toContain("resolve_ocr_receipt_menu_identity_v1");
    expect(migration).toContain("resolve_ocr_standalone_restaurant_menu_v1");
    expect(migration).toContain("grant execute on function public.resolve_ocr_receipt_menu_identity_v1(uuid, jsonb, boolean)");
    expect(migration).toContain("grant execute on function public.resolve_ocr_standalone_restaurant_menu_v1(uuid, jsonb, jsonb, boolean)");
    expect(migration).toContain("to authenticated;");
    expect(migration).toContain("candidate.user_id = v_user_id");
    expect(migration).toContain("restaurant_source_identity_insufficient");
    expect(migration).toContain("menu_identity_ambiguous");
  });
});
