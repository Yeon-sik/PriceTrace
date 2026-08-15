import { describe, expect, it } from "vitest";
import { buildAppNavigationUrl, readAppNavigationUrl } from "./app-navigation";

describe("app navigation URL", () => {
  it("reads supported pages and ignores an unknown view", () => {
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=products")).toEqual({
      page: "products",
      selectedMarket: null,
      selectedRestaurant: null,
    });
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=unknown")).toEqual({
      page: "home",
      selectedMarket: null,
      selectedRestaurant: null,
    });
  });

  it("keeps a selected market only on the market page", () => {
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=markets&store=이마트%20일산점")).toEqual({
      page: "markets",
      selectedMarket: "이마트 일산점",
      selectedRestaurant: null,
    });
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=cart&store=이마트%20일산점")).toEqual({
      page: "cart",
      selectedMarket: null,
      selectedRestaurant: null,
    });
  });

  it("keeps an exact restaurant identity only on the restaurant page", () => {
    const restaurantId = "11111111-1111-4111-8111-111111111111";
    expect(readAppNavigationUrl(`https://example.test/PriceTrace?view=restaurants&restaurant=${restaurantId}`)).toEqual({
      page: "restaurants",
      selectedMarket: null,
      selectedRestaurant: restaurantId,
    });
    expect(readAppNavigationUrl(`https://example.test/PriceTrace?view=products&restaurant=${restaurantId}`)).toEqual({
      page: "products",
      selectedMarket: null,
      selectedRestaurant: null,
    });
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=restaurants&restaurant=한결식당")).toEqual({
      page: "restaurants",
      selectedMarket: null,
      selectedRestaurant: null,
    });
  });

  it("builds shareable navigation URLs without discarding unrelated parameters", () => {
    expect(buildAppNavigationUrl("https://example.test/PriceTrace?campaign=summer#top", {
      page: "markets",
      selectedMarket: "이마트 일산점",
      selectedRestaurant: null,
    })).toBe("/PriceTrace?campaign=summer&view=markets&store=%EC%9D%B4%EB%A7%88%ED%8A%B8+%EC%9D%BC%EC%82%B0%EC%A0%90#top");

    expect(buildAppNavigationUrl("https://example.test/PriceTrace?view=markets&store=이마트", {
      page: "home",
      selectedMarket: null,
      selectedRestaurant: null,
    })).toBe("/PriceTrace");
  });

  it("builds a shareable exact restaurant URL", () => {
    expect(buildAppNavigationUrl("https://example.test/PriceTrace", {
      page: "restaurants",
      selectedMarket: null,
      selectedRestaurant: "11111111-1111-4111-8111-111111111111",
    })).toBe("/PriceTrace?view=restaurants&restaurant=11111111-1111-4111-8111-111111111111");
  });
});
