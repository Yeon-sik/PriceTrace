import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const getNutritionClient = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase/nutrition-client", () => ({
  getNutritionSupabaseBrowserClient: getNutritionClient,
}));

import { RestaurantMenuSourceRepository } from "./restaurant-menu-source.repository";

function queryResult(data: unknown[], error: { code?: string; message?: string } | null = null) {
  const query: {
    select: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    ilike: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: (resolve: (value: { data: unknown[]; error: { code?: string; message?: string } | null }) => unknown) => unknown;
  } = {
    select: vi.fn(() => query),
    is: vi.fn(() => query),
    ilike: vi.fn(() => query),
    eq: vi.fn(() => query),
    limit: vi.fn(async () => ({ data, error })),
    then: (resolve) => resolve({ data, error }),
  };
  return query;
}

describe("RestaurantMenuSourceRepository FitnessApp fallback", () => {
  beforeEach(() => {
    getNutritionClient.mockReset();
  });

  it("reads the real food columns and merges exact IDs from approved links", async () => {
    const foodRows = [{
      id: "fitness-food-1",
      brand: "우리 식당",
      name: "비빔밥",
      kind: "external_menu",
      source_reference: "https://example.test/menu",
    }];
    const foodByBrand = queryResult(foodRows);
    const foodByName = queryResult(foodRows);
    const links = queryResult([{
      nutrition_food_id: "fitness-food-1",
      catalog_product_id: "22222222-2222-4222-8222-222222222222",
    }]);
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST202", message: "function missing from schema cache" },
      }),
      from: vi.fn()
        .mockReturnValueOnce(foodByBrand)
        .mockReturnValueOnce(foodByName)
        .mockReturnValueOnce(links),
    } as unknown as SupabaseClient;
    getNutritionClient.mockReturnValue(client);

    const rows = await new RestaurantMenuSourceRepository().searchFitnessMenus("비빔밥");

    expect(rows).toMatchObject([{
      id: "fitnessapp:fitness-food-1",
      restaurantName: "우리 식당",
      menuName: "비빔밥",
      catalogProductId: "22222222-2222-4222-8222-222222222222",
    }]);
    expect(foodByBrand.select).toHaveBeenCalledWith("id,brand,name,kind,source_reference");
    expect(foodByName.select).toHaveBeenCalledWith("id,brand,name,kind,source_reference");
    expect(links.select).toHaveBeenCalledWith("nutrition_food_id,catalog_product_id");
  });

  it("does not fabricate an exact ID when link rows cannot be read", async () => {
    const foodRows = [{
      id: "fitness-food-2",
      brand: "우리 식당",
      name: "비빔밥",
      kind: "external_menu",
      source_reference: null,
    }];
    const foodByBrand = queryResult(foodRows);
    const foodByName = queryResult(foodRows);
    const links = queryResult([], { code: "42501", message: "permission denied" });
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "42501", message: "permission denied for function" },
      }),
      from: vi.fn()
        .mockReturnValueOnce(foodByBrand)
        .mockReturnValueOnce(foodByName)
        .mockReturnValueOnce(links),
    } as unknown as SupabaseClient;
    getNutritionClient.mockReturnValue(client);

    const rows = await new RestaurantMenuSourceRepository().searchFitnessMenus("비빔밥");

    expect(rows[0]?.catalogProductId).toBeNull();
  });
});
