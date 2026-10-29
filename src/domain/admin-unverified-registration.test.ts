import { describe, expect, it } from "vitest";
import {
  AdminUnverifiedProductSaleRequestSchema,
  AdminUnverifiedRestaurantMenuRequestSchema,
  adminUnverifiedProductSaleResultFromRpc,
  adminUnverifiedRestaurantMenuResultFromRpc,
} from "./admin-unverified-registration";

const productBase = {
  idempotencyKey: "admin-unverified-product:test-1",
  catalogProductId: null,
  standardName: "테스트 상품",
  brandName: "테스트 브랜드",
  listingName: "테스트 상품 500g",
  specification: "500g",
  contentAmount: 500,
  contentUnit: "g" as const,
  packageCount: 1,
  referenceUnit: 100 as const,
  listingReferenceUrl: "https://seller.example/products/test",
  sellerName: "테스트 판매처",
  sourceProductCode: "TEST-001",
  productUrl: "https://seller.example/products/test",
  listedPriceKrw: 5900,
  shippingFeeKrw: 0,
  minimumOrderQuantity: 1,
  observedAt: "2026-08-13T10:00:00+09:00",
};

describe("admin unverified registration contracts", () => {
  it("requires exact product specification evidence when creating a new catalog product", () => {
    expect(AdminUnverifiedProductSaleRequestSchema.safeParse({
      ...productBase,
      contentAmount: null,
      contentUnit: null,
      packageCount: null,
      referenceUnit: null,
      listingReferenceUrl: null,
    }).success).toBe(false);
  });

  it("allows a sale observation against an explicit existing catalog product", () => {
    expect(AdminUnverifiedProductSaleRequestSchema.safeParse({
      ...productBase,
      catalogProductId: "00000000-0000-4000-8000-000000000001",
      standardName: "",
      listingName: "",
      contentAmount: null,
      contentUnit: null,
      packageCount: null,
      referenceUnit: null,
      listingReferenceUrl: null,
    }).success).toBe(true);
  });

  it("does not allow a restaurant registration to use a non-manual source namespace", () => {
    expect(AdminUnverifiedRestaurantMenuRequestSchema.safeParse({
      idempotencyKey: "admin-unverified-restaurant:test-1",
      restaurantId: null,
      restaurantName: "테스트 식당",
      restaurantLegalName: null,
      cuisineType: null,
      restaurantOfficialSiteUrl: null,
      sourceNamespace: "official-menu",
      sourceLocationCode: "branch-1",
      locationLabel: "1호점",
      locationOfficialUrl: null,
      restaurantMenuId: null,
      menuName: "테스트 메뉴",
      menuCategoryLabel: null,
      servingLabel: "1인분",
      menuOfficialUrl: null,
      unitPriceKrw: 12000,
      quantity: 1,
      observedOn: "2026-08-13",
      sourceUrl: null,
      note: "영수증 없는 수동 등록",
    }).success).toBe(false);
  });

  it("accepts only unverified RPC results", () => {
    const productResult = adminUnverifiedProductSaleResultFromRpc({
      standard_product_id: "00000000-0000-4000-8000-000000000001",
      catalog_product_id: "00000000-0000-4000-8000-000000000002",
      market_price_observation_id: "00000000-0000-4000-8000-000000000003",
      verification_status: "unverified",
      replayed: false,
    });
    expect(productResult.verificationStatus).toBe("unverified");
    expect(() => adminUnverifiedProductSaleResultFromRpc({
      standard_product_id: productResult.standardProductId,
      catalog_product_id: productResult.catalogProductId,
      market_price_observation_id: productResult.marketPriceObservationId,
      verification_status: "verified",
      replayed: false,
    })).toThrow();

    expect(adminUnverifiedRestaurantMenuResultFromRpc({
      restaurant_id: "00000000-0000-4000-8000-000000000004",
      restaurant_location_id: "00000000-0000-4000-8000-000000000005",
      restaurant_menu_id: "00000000-0000-4000-8000-000000000006",
      catalog_product_id: "00000000-0000-4000-8000-000000000007",
      manual_observation_id: "00000000-0000-4000-8000-000000000008",
      verification_status: "unverified",
      replayed: true,
    }).verificationStatus).toBe("unverified");
  });
});
