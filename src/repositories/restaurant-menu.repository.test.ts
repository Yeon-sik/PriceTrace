import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { RestaurantMenuRepository } from "./restaurant-menu.repository";

const restaurantId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const menuId = "33333333-3333-4333-8333-333333333333";
const catalogProductId = "44444444-4444-4444-8444-444444444444";
const standardProductId = "55555555-5555-4555-8555-555555555555";
const locationId = "66666666-6666-4666-8666-666666666666";
const observationId = "77777777-7777-4777-8777-777777777777";
const rootCategoryId = "88888888-8888-4888-8888-888888888888";
const categoryId = "99999999-9999-4999-8999-999999999999";
const revision = `sha256:${"a".repeat(64)}`;

function readPayload(id = restaurantId) {
  return {
    schemaVersion: "restaurant-menu-read.v1",
    namespace: "pricetrace",
    revision,
    restaurants: [{
      revision,
      restaurant: {
        id,
        brandId,
        brand: "테스트 식당",
        legalName: null,
        cuisineType: "한식",
        category: {
          id: categoryId,
          slug: "bibimbap-rice-bowls",
          name: "비빔밥·덮밥",
          path: [
            { id: rootCategoryId, slug: "korean", name: "한식" },
            { id: categoryId, slug: "bibimbap-rice-bowls", name: "비빔밥·덮밥" },
          ],
        },
        officialSiteUrl: null,
        updatedAt: "2026-08-12T11:00:00+00:00",
      },
      locations: [{
        id: locationId,
        sourceLabel: "public-receipt",
        sourceRestaurantCode: "merchant-1",
        locationLabel: "본점",
        sourceUrl: null,
      }],
      menus: [{
        id: menuId,
        catalogProductId,
        standardProductId,
        name: "비빔밥",
        categoryLabel: "식사",
        servingLabel: "1인분",
        officialUrl: null,
        updatedAt: "2026-08-12T11:00:00+00:00",
        revision,
        observations: [{
          id: observationId,
          restaurantSourceId: locationId,
          locationLabel: "본점",
          unitPriceKrw: 9000,
          quantity: 1,
          totalPriceKrw: 9000,
          observedAt: "2026-08-12T10:00:00+00:00",
          sourceType: "database_receipt",
          receiptReference: null,
          sourceUrl: null,
          verifiedAt: "2026-08-12T11:00:00+00:00",
        }],
      }],
    }],
  };
}

describe("RestaurantMenuRepository", () => {
  it("reads a lightweight restaurant directory before loading a detail", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        schemaVersion: "restaurant-directory.v2",
        namespace: "pricetrace",
        revision,
        restaurants: [{
          revision,
          restaurant: readPayload().restaurants[0].restaurant,
          locations: readPayload().restaurants[0].locations,
          menuCount: 1,
          latestObservedAt: "2026-08-12T00:00:00+00:00",
        }],
      },
      error: null,
    });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const result = await repository.readDirectory({ query: "한식", limit: 500 });

    expect(rpc).toHaveBeenCalledWith("get_restaurant_directory_v2", {
      p_query: "한식",
      p_limit: 200,
    });
    expect(result.restaurants[0].menuCount).toBe(1);
    expect(result.restaurants[0].restaurant.category?.id).toBe(categoryId);
  });

  it("loads one restaurant detail by exact restaurant identity", async () => {
    const restaurant = readPayload().restaurants[0];
    const rpc = vi.fn().mockResolvedValue({
      data: {
        schemaVersion: "restaurant-detail.v2",
        namespace: "pricetrace",
        ...restaurant,
      },
      error: null,
    });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const result = await repository.readDetail(restaurantId);

    expect(rpc).toHaveBeenCalledWith("get_restaurant_detail_v2", {
      p_restaurant_id: restaurantId,
    });
    expect(result.restaurant.id).toBe(restaurantId);
    expect(result.menus[0].catalogProductId).toBe(catalogProductId);
  });

  it("falls back to the existing menu read RPC until the new directory RPC is deployed", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "get_restaurant_directory_v2" || name === "get_restaurant_directory_v1") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` },
        });
      }
      return Promise.resolve({ data: readPayload(), error: null });
    });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const result = await repository.readDirectory();

    expect(result.schemaVersion).toBe("restaurant-directory.v2");
    expect(result.restaurants[0].restaurant.id).toBe(restaurantId);
    expect(rpc).toHaveBeenCalledWith("get_restaurant_menu_read_v1", {
      p_restaurant_id: null,
      p_catalog_product_id: null,
      p_query: null,
      p_limit: 100,
    });
  });

  it("upgrades a deployed v1 directory response to the v2 client contract", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "get_restaurant_directory_v2") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function" },
        });
      }
      return Promise.resolve({
        data: {
          schemaVersion: "restaurant-directory.v1",
          namespace: "pricetrace",
          revision,
          restaurants: [{
            revision,
            restaurant: readPayload().restaurants[0].restaurant,
            locations: readPayload().restaurants[0].locations,
            menuCount: 1,
            latestObservedAt: null,
          }],
        },
        error: null,
      });
    });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const result = await repository.readDirectory();

    expect(result.schemaVersion).toBe("restaurant-directory.v2");
    expect(rpc).toHaveBeenNthCalledWith(2, "get_restaurant_directory_v1", {
      p_query: null,
      p_limit: 100,
    });
  });

  it("reads the category tree in stable hierarchy order", async () => {
    const rows = [{
      id: categoryId,
      parent_id: rootCategoryId,
      slug: "bibimbap-rice-bowls",
      display_name: "비빔밥·덮밥",
      depth: 1,
      sort_order: 10,
    }];
    const query = {
      select: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.order
      .mockReturnValueOnce(query)
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({ data: rows, error: null });
    const from = vi.fn().mockReturnValue(query);
    const repository = new RestaurantMenuRepository({ from } as unknown as SupabaseClient);

    const result = await repository.readCategories();

    expect(from).toHaveBeenCalledWith("restaurant_categories");
    expect(query.order.mock.calls).toEqual([["depth"], ["sort_order"], ["display_name"]]);
    expect(result).toEqual(rows);
  });

  it("keeps the existing admin menu usable while the category table rolls out", async () => {
    const query = {
      select: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.order
      .mockReturnValueOnce(query)
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST205", message: "Could not find the table public.restaurant_categories" },
      });
    const from = vi.fn().mockReturnValue(query);
    const repository = new RestaurantMenuRepository({ from } as unknown as SupabaseClient);

    await expect(repository.readCategories()).resolves.toEqual([]);
  });

  it("links and unlinks one user-selected restaurant category through the admin RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        restaurant_id: restaurantId,
        category_id: categoryId,
        category_slug: "bibimbap-rice-bowls",
        category_display_name: "비빔밥·덮밥",
      }],
      error: null,
    });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const result = await repository.setRestaurantCategory(restaurantId, categoryId);

    expect(rpc).toHaveBeenCalledWith("admin_set_restaurant_category_v1", {
      p_restaurant_id: restaurantId,
      p_category_id: categoryId,
    });
    expect(result.category_id).toBe(categoryId);
  });

  it("reads the versioned restaurant and exact menu contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: readPayload(), error: null });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const result = await repository.read({ restaurantId, limit: 500 });

    expect(rpc).toHaveBeenCalledWith("get_restaurant_menu_read_v1", {
      p_restaurant_id: restaurantId,
      p_catalog_product_id: null,
      p_query: null,
      p_limit: 200,
    });
    expect(result.restaurants[0].menus[0].catalogProductId).toBe(catalogProductId);
  });

  it("rejects a response outside the requested restaurant identity", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: readPayload("88888888-8888-4888-8888-888888888888"),
      error: null,
    });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.read({ restaurantId })).rejects.toThrow(/요청하지 않은 음식점 identity/);
  });

  it("registers one receipt-backed observation through the admin RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        restaurant_id: restaurantId,
        restaurant_location_id: locationId,
        restaurant_menu_id: menuId,
        catalog_product_id: catalogProductId,
        receipt_observation_id: observationId,
        replayed: false,
      }],
      error: null,
    });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const result = await repository.registerReceiptObservation({
      idempotencyKey: "registration-1",
      priceObservationId: observationId,
      restaurantId,
      restaurantName: "테스트 식당",
      restaurantLegalName: null,
      cuisineType: null,
      restaurantOfficialSiteUrl: null,
      restaurantSourceNamespace: "pricetrace-db-store",
      restaurantSourceCode: locationId,
      locationLabel: "본점",
      locationOfficialUrl: null,
      restaurantMenuId: menuId,
      menuName: "비빔밥",
      menuCategoryLabel: "식사",
      servingLabel: "1인분",
      menuOfficialUrl: null,
    });

    expect(result.catalogProductId).toBe(catalogProductId);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_restaurant_id: restaurantId,
      p_restaurant_menu_id: menuId,
      p_price_observation_id: observationId,
      p_restaurant_source_code: locationId,
    });
  });

  it("accepts only server-returned receipt candidates that preserve price totals", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        price_observation_id: observationId,
        store_id: locationId,
        store_name: "테스트 식당",
        location_label: "본점",
        store_product_id: "88888888-8888-4888-8888-888888888888",
        store_product_code: null,
        product_name: "비빔밥",
        receipt_id: "99999999-9999-4999-8999-999999999999",
        receipt_item_id: "item-1",
        observed_on: "2026-08-12",
        unit_price_krw: 9000,
        quantity: 1,
        total_price_krw: 9000,
      }],
      error: null,
    });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const candidates = await repository.readAdminReceiptCandidates();

    expect(rpc).toHaveBeenCalledWith("get_admin_restaurant_menu_receipt_candidates_v1");
    expect(candidates[0].price_observation_id).toBe(observationId);
  });
  it("runs automatic option recognition and supports exact manual override and clear", async () => {
    const linkRow = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      restaurant_id: restaurantId,
      parent_menu_id: menuId,
      option_menu_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      link_source: "automatic",
      confidence: 0.95,
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [linkRow], error: null })
      .mockResolvedValueOnce({ data: [{ ...linkRow, link_source: "manual", confidence: 1 }], error: null })
      .mockResolvedValueOnce({ data: [{ restaurant_id: restaurantId, option_menu_id: linkRow.option_menu_id, cleared: true }], error: null });
    const repository = new RestaurantMenuRepository({ rpc } as unknown as SupabaseClient);

    const automatic = await repository.autoLinkRestaurantMenuOptions(restaurantId);
    const manual = await repository.setRestaurantMenuOptionLink(restaurantId, menuId, linkRow.option_menu_id);
    const cleared = await repository.clearRestaurantMenuOptionLink(restaurantId, linkRow.option_menu_id);

    expect(automatic[0]).toMatchObject({ optionMenuId: linkRow.option_menu_id, source: "automatic" });
    expect(manual).toMatchObject({ parentMenuId: menuId, optionMenuId: linkRow.option_menu_id, source: "manual" });
    expect(cleared).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(1, "admin_auto_link_restaurant_menu_options_v1", {
      p_restaurant_id: restaurantId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "admin_set_restaurant_menu_option_link_v1", {
      p_restaurant_id: restaurantId,
      p_parent_menu_id: menuId,
      p_option_menu_id: linkRow.option_menu_id,
    });
  });

});
