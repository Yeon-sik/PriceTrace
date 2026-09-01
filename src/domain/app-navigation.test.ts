import { describe, expect, it } from "vitest";
import { buildAppNavigationUrl, buildIdentityNavigationUrl, readAppNavigationUrl } from "./app-navigation";

const noIdentity = {
  selectedStoreId: null,
  selectedStoreProductId: null,
  selectedRestaurantMenuId: null,
  selectedCatalogProductId: null,
};

describe("app navigation URL", () => {
  it("reads supported pages and ignores an unknown view", () => {
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=products")).toEqual({
      page: "products",
      selectedMarket: null,
      selectedRestaurant: null,
      ...noIdentity,
    });
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=unknown")).toEqual({
      page: "home",
      selectedMarket: null,
      selectedRestaurant: null,
      ...noIdentity,
    });
  });

  it("keeps a selected market only on the market page", () => {
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=markets&store=이마트%20일산점")).toEqual({
      page: "markets",
      selectedMarket: "이마트 일산점",
      selectedRestaurant: null,
      ...noIdentity,
    });
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=cart&store=이마트%20일산점")).toEqual({
      page: "cart",
      selectedMarket: null,
      selectedRestaurant: null,
      ...noIdentity,
    });
  });

  it("keeps an exact restaurant identity only on the restaurant page", () => {
    const restaurantId = "11111111-1111-4111-8111-111111111111";
    expect(readAppNavigationUrl(`https://example.test/PriceTrace?view=restaurants&restaurant=${restaurantId}`)).toEqual({
      page: "restaurants",
      selectedMarket: null,
      selectedRestaurant: restaurantId,
      ...noIdentity,
    });
    expect(readAppNavigationUrl(`https://example.test/PriceTrace?view=products&restaurant=${restaurantId}`)).toEqual({
      page: "products",
      selectedMarket: null,
      selectedRestaurant: null,
      ...noIdentity,
    });
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=restaurants&restaurant=한결식당")).toEqual({
      page: "restaurants",
      selectedMarket: null,
      selectedRestaurant: null,
      ...noIdentity,
    });
  });

  it("builds shareable navigation URLs without discarding unrelated parameters", () => {
    expect(buildAppNavigationUrl("https://example.test/PriceTrace?campaign=summer#top", {
      page: "markets",
      selectedMarket: "이마트 일산점",
      selectedRestaurant: null,
      ...noIdentity,
    })).toBe("/PriceTrace?campaign=summer&view=markets&store=%EC%9D%B4%EB%A7%88%ED%8A%B8+%EC%9D%BC%EC%82%B0%EC%A0%90#top");

    expect(buildAppNavigationUrl("https://example.test/PriceTrace?view=markets&store=이마트", {
      page: "home",
      selectedMarket: null,
      selectedRestaurant: null,
      ...noIdentity,
    })).toBe("/PriceTrace");
  });

  it("builds a shareable exact restaurant URL", () => {
    expect(buildAppNavigationUrl("https://example.test/PriceTrace", {
      page: "restaurants",
      selectedMarket: null,
      selectedRestaurant: "11111111-1111-4111-8111-111111111111",
      ...noIdentity,
    })).toBe("/PriceTrace?view=restaurants&restaurant=11111111-1111-4111-8111-111111111111");
  });

  it("reads exact identity deep-link selectors only on their owning page", () => {
    const storeId = "11111111-1111-4111-8111-111111111111";
    const storeProductId = "22222222-2222-4222-8222-222222222222";
    const menuId = "33333333-3333-4333-8333-333333333333";
    const catalogProductId = "44444444-4444-4444-8444-444444444444";

    expect(readAppNavigationUrl(`https://example.test/PriceTrace?view=markets&storeId=${storeId}`)).toMatchObject({
      page: "markets",
      selectedStoreId: storeId,
      selectedStoreProductId: null,
      selectedRestaurantMenuId: null,
      selectedCatalogProductId: null,
    });
    expect(readAppNavigationUrl(`https://example.test/PriceTrace?view=products&storeProductId=${storeProductId}&catalogProductId=${catalogProductId}`)).toMatchObject({
      page: "products",
      selectedStoreProductId: storeProductId,
      selectedCatalogProductId: catalogProductId,
    });
    expect(readAppNavigationUrl(`https://example.test/PriceTrace?view=restaurants&restaurantMenuId=${menuId}`)).toMatchObject({
      page: "restaurants",
      selectedRestaurantMenuId: menuId,
    });
    expect(readAppNavigationUrl(`https://example.test/PriceTrace?view=products&storeId=${storeId}`)).toMatchObject({
      page: "products",
      selectedStoreId: null,
    });
  });

  it("builds stable identity deep links with the PriceTrace selector name", () => {
    expect(buildIdentityNavigationUrl("https://example.test/PriceTrace?campaign=summer#top", {
      type: "store",
      id: "11111111-1111-4111-8111-111111111111",
    })).toBe("/PriceTrace?campaign=summer&view=markets&storeId=11111111-1111-4111-8111-111111111111#top");
    expect(buildIdentityNavigationUrl("https://example.test/PriceTrace", {
      type: "store_product",
      id: "22222222-2222-4222-8222-222222222222",
    })).toBe("/PriceTrace?view=products&storeProductId=22222222-2222-4222-8222-222222222222");
    expect(buildIdentityNavigationUrl("https://example.test/PriceTrace", {
      type: "restaurant_menu",
      id: "33333333-3333-4333-8333-333333333333",
    })).toBe("/PriceTrace?view=restaurants&restaurantMenuId=33333333-3333-4333-8333-333333333333");
    expect(buildIdentityNavigationUrl("https://example.test/PriceTrace", {
      type: "catalog_product",
      id: "44444444-4444-4444-8444-444444444444",
    })).toBe("/PriceTrace?view=products&catalogProductId=44444444-4444-4444-8444-444444444444");
  });
});
