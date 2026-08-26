import { describe, expect, it } from "vitest";
import {
  RestaurantDetailV1Schema,
  RestaurantDirectoryV1Schema,
  RestaurantMenuReadV1Schema,
  RestaurantProfileEditorUpdateRequestSchema,
  filterRestaurantDirectoryEntries,
  filterRestaurantMenuEntries,
  filterRestaurantMenus,
  groupRestaurantMenusForDisplay,
  inferRestaurantMenuOptionParent,
  restaurantMenuNameLooksLikeOption,
  restaurantDirectoryCategories,
  restaurantMenuCategories,
  summarizeRestaurantMenuPrices,
} from "./restaurant-menu";

const revision = `sha256:${"b".repeat(64)}`;
const rootCategoryId = "99999999-9999-4999-8999-999999999999";
const leafCategoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
        category: {
          id: leafCategoryId,
          slug: "bibimbap-rice-bowls",
          name: "비빔밥·덮밥",
          path: [
            { id: rootCategoryId, slug: "korean", name: "한식" },
            { id: leafCategoryId, slug: "bibimbap-rice-bowls", name: "비빔밥·덮밥" },
          ],
        },
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
  it("validates the directory and detail contracts separately", () => {
    const restaurant = entry();
    const directory = RestaurantDirectoryV1Schema.parse({
      schemaVersion: "restaurant-directory.v2",
      namespace: "pricetrace",
      revision,
      restaurants: [{
        revision,
        restaurant: restaurant.restaurant,
        locations: restaurant.locations,
        menuCount: restaurant.menus.length,
        latestObservedAt: restaurant.menus[0].observations[0].observedAt,
      }],
    });
    const detail = RestaurantDetailV1Schema.parse({
      schemaVersion: "restaurant-detail.v2",
      namespace: "pricetrace",
      revision,
      restaurant: restaurant.restaurant,
      locations: restaurant.locations,
      menus: restaurant.menus,
    });

    expect(directory.restaurants[0].menuCount).toBe(1);
    expect(directory.restaurants[0].restaurant.category?.path).toHaveLength(2);
    expect(detail.menus[0].catalogProductId).toBe(restaurant.menus[0].catalogProductId);
  });

  it("continues accepting the v1 restaurant shape while v2 rolls out", () => {
    const restaurant = entry();
    const { category: _category, ...legacyRestaurant } = restaurant.restaurant;
    void _category;
    const parsed = RestaurantDirectoryV1Schema.parse({
      schemaVersion: "restaurant-directory.v1",
      namespace: "pricetrace",
      revision,
      restaurants: [{
        revision,
        restaurant: legacyRestaurant,
        locations: restaurant.locations,
        menuCount: 1,
        latestObservedAt: null,
      }],
    });

    expect(parsed.restaurants[0].restaurant.category).toBeNull();
    expect(parsed.restaurants[0].restaurant.fulfillmentModes).toEqual([]);
  });

  it("publishes only confirmed restaurant-level fulfilment modes", () => {
    const restaurant = entry();
    restaurant.restaurant.fulfillmentModes = [
      { type: "delivery", evidence: "receipt" },
      { type: "takeout", evidence: "manual" },
    ];
    expect(RestaurantDirectoryV1Schema.parse({
      schemaVersion: "restaurant-directory.v2",
      namespace: "pricetrace",
      revision,
      restaurants: [{ revision, restaurant: restaurant.restaurant, locations: restaurant.locations, menuCount: 1, latestObservedAt: null }],
    }).restaurants[0].restaurant.fulfillmentModes).toEqual(restaurant.restaurant.fulfillmentModes);
  });

  it("keeps restaurant brand and exact catalog product identity separate", () => {
    const restaurant = entry();
    expect(restaurant.restaurant.brand).toBe("한결식당");
    expect(restaurant.menus[0].catalogProductId).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("requires a source URL and a valid Korean business registration number for profile edits", () => {
    const base = {
      restaurantId: "11111111-1111-4111-8111-111111111111",
      restaurantLocationId: "33333333-3333-4333-8333-333333333333",
      canonicalName: "한결식당",
      legalName: null,
      cuisineType: null,
      officialSiteUrl: null,
      locationLabel: "서울점",
      locationOfficialUrl: null,
      businessRegistrationNumber: "123-45-67890",
      address: null,
      phone: null,
      sourceUrl: "https://example.com/store",
    };
    expect(RestaurantProfileEditorUpdateRequestSchema.parse(base).businessRegistrationNumber).toBe("123-45-67890");
    expect(() => RestaurantProfileEditorUpdateRequestSchema.parse({ ...base, sourceUrl: "" })).toThrow(/URL/);
    expect(() => RestaurantProfileEditorUpdateRequestSchema.parse({ ...base, businessRegistrationNumber: "1234" })).toThrow(/사업자등록번호/);
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

  it("filters the directory and menu categories as separate navigation concerns", () => {
    const restaurant = entry();
    const directory = RestaurantDirectoryV1Schema.parse({
      schemaVersion: "restaurant-directory.v2",
      namespace: "pricetrace",
      revision,
      restaurants: [{
        revision,
        restaurant: restaurant.restaurant,
        locations: restaurant.locations,
        menuCount: 1,
        latestObservedAt: null,
      }],
    }).restaurants;

    expect(filterRestaurantDirectoryEntries(directory, "서울점")).toHaveLength(1);
    expect(filterRestaurantDirectoryEntries(directory, "덮밥")).toHaveLength(1);
    expect(restaurantDirectoryCategories(directory)).toEqual([
      { id: rootCategoryId, label: "한식", pathLabel: "한식", depth: 0 },
      {
        id: leafCategoryId,
        label: "비빔밥·덮밥",
        pathLabel: "한식 › 비빔밥·덮밥",
        depth: 1,
      },
    ]);
    expect(filterRestaurantDirectoryEntries(directory, "", rootCategoryId)).toHaveLength(1);
    expect(filterRestaurantDirectoryEntries(directory, "", leafCategoryId)).toHaveLength(1);
    expect(filterRestaurantDirectoryEntries(directory, "", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toEqual([]);
    expect(restaurantMenuCategories(restaurant.menus)).toEqual(["식사"]);
    expect(filterRestaurantMenus(restaurant.menus, "비빔밥", "식사")).toHaveLength(1);
    expect(filterRestaurantMenus(restaurant.menus, "비빔밥", "기타")).toEqual([]);
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
it("recognizes and groups a receipt-style menu option without changing exact identities", () => {
    const restaurant = entry();
    const parent = restaurant.menus[0];
    const option = {
      ...parent,
      id: "99999999-9999-4999-8999-999999999998",
      catalogProductId: "99999999-9999-4999-8999-999999999997",
      standardProductId: "99999999-9999-4999-8999-999999999996",
      name: "계란 후라이 추가",
      categoryLabel: "추가",
      observations: [],
    };
    const link = {
      id: "99999999-9999-4999-8999-999999999995",
      parentMenuId: parent.id,
      optionMenuId: option.id,
      source: "automatic" as const,
      confidence: 0.95,
    };

    expect(restaurantMenuNameLooksLikeOption(option.name)).toBe(true);
    expect(inferRestaurantMenuOptionParent([parent, option], option.id)).toBe(parent.id);

    const groups = groupRestaurantMenusForDisplay(
      [parent, option],
      [link],
      "계란",
      "전체",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].menu.id).toBe(parent.id);
    expect(groups[0].options).toHaveLength(1);
    expect(groups[0].options[0].menu.id).toBe(option.id);
  });

});
