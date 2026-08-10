import { describe, expect, it } from "vitest";
import { buildAppNavigationUrl, readAppNavigationUrl } from "./app-navigation";

describe("app navigation URL", () => {
  it("reads supported pages and ignores an unknown view", () => {
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=products")).toEqual({
      page: "products",
      selectedMarket: null,
    });
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=unknown")).toEqual({
      page: "home",
      selectedMarket: null,
    });
  });

  it("keeps a selected market only on the market page", () => {
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=markets&store=이마트%20일산점")).toEqual({
      page: "markets",
      selectedMarket: "이마트 일산점",
    });
    expect(readAppNavigationUrl("https://example.test/PriceTrace?view=cart&store=이마트%20일산점")).toEqual({
      page: "cart",
      selectedMarket: null,
    });
  });

  it("builds shareable navigation URLs without discarding unrelated parameters", () => {
    expect(buildAppNavigationUrl("https://example.test/PriceTrace?campaign=summer#top", {
      page: "markets",
      selectedMarket: "이마트 일산점",
    })).toBe("/PriceTrace?campaign=summer&view=markets&store=%EC%9D%B4%EB%A7%88%ED%8A%B8+%EC%9D%BC%EC%82%B0%EC%A0%90#top");

    expect(buildAppNavigationUrl("https://example.test/PriceTrace?view=markets&store=이마트", {
      page: "home",
      selectedMarket: null,
    })).toBe("/PriceTrace");
  });
});
