import { describe, expect, it } from "vitest";
import {
  DiningOutIdentityV1Schema,
  diningOutIdentityFromSelection,
} from "./dining-out-identity";

const restaurantId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const menuId = "33333333-3333-4333-8333-333333333333";
const catalogProductId = "44444444-4444-4444-8444-444444444444";

describe("dining-out-identity.v1", () => {
  it("maps the selected restaurant, location, menu, and exact catalog product IDs", () => {
    const identity = diningOutIdentityFromSelection(
      {
        restaurant: {
          id: restaurantId,
          brandId: null,
          brand: "텐진라면",
          legalName: null,
          cuisineType: null,
          category: null,
          fulfillmentModes: [],
          officialSiteUrl: null,
          updatedAt: "2026-08-16T00:00:00+00:00",
        },
        locations: [{
          id: locationId,
          sourceLabel: "manual",
          sourceRestaurantCode: "branch-1",
          locationLabel: "강남점",
          sourceUrl: null,
        }],
        menus: [{
          id: menuId,
          catalogProductId,
          standardProductId: "55555555-5555-4555-8555-555555555555",
          name: "텐진라멘",
          categoryLabel: null,
          servingLabel: "1인분",
          officialUrl: null,
          updatedAt: "2026-08-16T00:00:00+00:00",
          observations: [],
          revision: `sha256:${"a".repeat(64)}`,
        }],
        revision: `sha256:${"b".repeat(64)}`,
      },
      {
        id: locationId,
        sourceLabel: "manual",
        sourceRestaurantCode: "branch-1",
        locationLabel: "강남점",
        sourceUrl: null,
      },
      {
        id: menuId,
        catalogProductId,
        standardProductId: "55555555-5555-4555-8555-555555555555",
        name: "텐진라멘",
        categoryLabel: null,
        servingLabel: "1인분",
        officialUrl: null,
        updatedAt: "2026-08-16T00:00:00+00:00",
        observations: [],
        revision: `sha256:${"a".repeat(64)}`,
      },
    );

    expect(identity).toMatchObject({
      restaurantId,
      restaurantLocationId: locationId,
      restaurantMenuId: menuId,
      catalogProductId,
      branchName: "강남점",
    });
    expect(DiningOutIdentityV1Schema.parse(identity)).toEqual(identity);
  });
});
