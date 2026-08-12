import { describe, expect, it } from "vitest";
import {
  RestaurantMenuReadV1Schema,
  filterRestaurantMenuEntries,
  summarizeRestaurantMenuPrices,
} from "./restaurant-menu";

const revision = `sha256:${"b".repeat(64)}`;

function entry() {
  return RestaurantMenuReadV1Schema.parse({
    schemaVersion: "restaurant-menu-read.v1",
    namespace: "pricetrace",
    revision,
    restaurants: [{
      revision,
      restaurant: {
        id: "11111111-1111-4111-8111-111111111111",
        brandId: "22222222-2222-4222-8222-222222222222",
        brand: "한결식당",
        legalName: "한결푸드",
        cuisineType: "한식",
        officialSiteUrl: null,
        updatedAt: "2026-08-12T11:00:00+00:00",
      },
      locations: [{
        id: "33333333-3333-4333-8333-333333333333",
        sourceLabel: "public-receipt",
        sourceRestaurantCode: "merchant-1",
        locationLabel: "서울점",
        sourceUrl: null,
      }],
      menus: [{
        id: "44444444-4444-4444-8444-444444444444",
        catalogProductId: "55555555-5555-4555-8555-555555555555",
        standardProductId: "66666666-6666-4666-8666-666666666666",
        name: "비빔밥",
        categoryLabel: "식사",
        servingLabel: "1인분",
        officialUrl: null,
        updatedAt: "2026-08-12T11:00:00+00:00",
        revision,
        observations: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            restaurantSourceId: "33333333-3333-4333-8333-333333333333",
            locationLabel: "서울점",
            unitPriceKrw: 9000,
            quantity: 1,
            totalPriceKrw: 9000,
            observedAt: "2026-08-12T10:00:00+00:00",
            sourceType: "database_receipt",
            receiptReference: null,
            sourceUrl: null,
            verifiedAt: "2026-08-12T11:00:00+00:00",
          },
          {
            id: "88888888-8888-4888-8888-888888888888",
            restaurantSourceId: "33333333-3333-4333-8333-333333333333",
            locationLabel: "서울점",
            unitPriceKrw: 8000,
            quantity: 1,
            totalPriceKrw: 8000,
            observedAt: "2026-07-12T10:00:00+00:00",
            sourceType: "database_receipt",
            receiptReference: null,
            sourceUrl: null,
            verifiedAt: "2026-07-12T11:00:00+00:00",
          },
        ],
      }],
    }],
  }).restaurants[0];
}

describe("restaurant menu domain", () => {
  it("keeps restaurant brand and exact catalog product identity separate", () => {
    const restaurant = entry();
    expect(restaurant.restaurant.brand).toBe("한결식당");
    expect(restaurant.menus[0].catalogProductId).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("summarizes price history by observation time", () => {
    const summary = summarizeRestaurantMenuPrices(entry().menus[0]);
    expect(summary).toMatchObject({
      minimumPriceKrw: 8000,
      maximumPriceKrw: 9000,
      observationCount: 2,
    });
    expect(summary?.latest.unitPriceKrw).toBe(9000);
  });

  it("searches restaurant fields and menu fields without using names as identity", () => {
    const restaurant = entry();
    expect(filterRestaurantMenuEntries([restaurant], "서울점")).toHaveLength(1);
    expect(filterRestaurantMenuEntries([restaurant], "비빔밥")[0].menus).toHaveLength(1);
    expect(filterRestaurantMenuEntries([restaurant], "없는 메뉴")).toEqual([]);
  });

  it("rejects public observations that break price conservation", () => {
    const restaurant = entry();
    const invalidRestaurant = {
      ...restaurant,
      menus: [{
        ...restaurant.menus[0],
        observations: [{
          ...restaurant.menus[0].observations[0],
          totalPriceKrw: 8_999,
        }],
      }],
    };

    expect(RestaurantMenuReadV1Schema.safeParse({
      schemaVersion: "restaurant-menu-read.v1",
      namespace: "pricetrace",
      revision,
      restaurants: [invalidRestaurant],
    }).success).toBe(false);
  });

  it("rejects observations linked to a location outside the restaurant", () => {
    const restaurant = entry();
    const invalidRestaurant = {
      ...restaurant,
      menus: [{
        ...restaurant.menus[0],
        observations: [{
          ...restaurant.menus[0].observations[0],
          restaurantSourceId: "99999999-9999-4999-8999-999999999999",
        }],
      }],
    };

    expect(RestaurantMenuReadV1Schema.safeParse({
      schemaVersion: "restaurant-menu-read.v1",
      namespace: "pricetrace",
      revision,
      restaurants: [invalidRestaurant],
    }).success).toBe(false);
  });
});
