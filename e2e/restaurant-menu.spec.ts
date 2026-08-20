import { expect, test } from "@playwright/test";

const restaurantId = "11111111-1111-4111-8111-111111111111";
const catalogProductId = "22222222-2222-4222-8222-222222222222";
const rootCategoryId = "88888888-8888-4888-8888-888888888888";
const categoryId = "99999999-9999-4999-8999-999999999999";
const revision = `sha256:${"a".repeat(64)}`;
const restaurant = {
  id: restaurantId,
  brandId: "33333333-3333-4333-8333-333333333333",
  brand: "한결식당",
  legalName: "한결푸드",
  cuisineType: "비빔밥·덮밥",
  category: {
    id: categoryId,
    slug: "bibimbap-rice-bowls",
    name: "비빔밥·덮밥",
    path: [
      { id: rootCategoryId, slug: "korean", name: "한식" },
      { id: categoryId, slug: "bibimbap-rice-bowls", name: "비빔밥·덮밥" },
    ],
  },
  officialSiteUrl: "https://example.com/restaurant",
  updatedAt: "2026-08-12T11:00:00+00:00",
};
const locations = [{
  id: "44444444-4444-4444-8444-444444444444",
  sourceLabel: "public-receipt",
  sourceRestaurantCode: "merchant-1",
  locationLabel: "강남점",
  sourceUrl: null,
}];
const menus = [{
  id: "55555555-5555-4555-8555-555555555555",
  catalogProductId,
  standardProductId: "66666666-6666-4666-8666-666666666666",
  name: "비빔밥",
  categoryLabel: "식사",
  servingLabel: "1인분",
  officialUrl: null,
  updatedAt: "2026-08-12T11:00:00+00:00",
  revision,
  observations: [{
    id: "77777777-7777-4777-8777-777777777777",
    restaurantSourceId: locations[0].id,
    locationLabel: "강남점",
    unitPriceKrw: 9000,
    quantity: 1,
    totalPriceKrw: 9000,
    observedAt: "2026-08-12T10:00:00+00:00",
    sourceType: "database_receipt",
    receiptReference: null,
    sourceUrl: null,
    verifiedAt: "2026-08-12T11:00:00+00:00",
  }],
}];

test("식당 목록에서 정확한 식당 상세로 들어가 메뉴·정보·출처를 탐색한다", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/rest/v1/rpc/get_restaurant_directory_v2", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "restaurant-directory.v2",
        namespace: "pricetrace",
        revision,
        restaurants: [{
          revision,
          restaurant,
          locations,
          menuCount: menus.length,
          latestObservedAt: "2026-08-12T00:00:00+00:00",
        }],
      }),
    });
  });
  await page.route("**/rest/v1/rpc/get_restaurant_detail_v2", async (route) => {
    const request = route.request().postDataJSON() as { p_restaurant_id?: string };
    expect(request.p_restaurant_id).toBe(restaurantId);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "restaurant-detail.v2",
        namespace: "pricetrace",
        revision,
        restaurant,
        locations,
        menus,
      }),
    });
  });
  await page.route("**/rest/v1/rpc/get_public_product_nutrition_v1", async (route) => {
    const request = route.request().postDataJSON() as { p_catalog_product_id?: string };
    expect(request.p_catalog_product_id).toBe(catalogProductId);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{
        contract_version: "nutrition-read.v1",
        nutrition_food_id: "external-menu-bibimbap",
        name: "비빔밥",
        kind: "external_menu",
        basis_amount: 1,
        basis_unit: "serving",
        prep_state: "as_served",
        nutrition_values: {
          calories_kcal: 650,
          protein_grams: 18,
          carbs_grams: 95,
          fat_grams: 20,
          sodium_mg: 1100,
          saturated_fat_grams: 5,
          sugars_grams: 10,
          fiber_grams: 8,
          added_sugars_grams: null,
          trans_fat_grams: 0,
          cholesterol_mg: 40,
        },
        micronutrients: {},
        source_type: "manual",
        source_reference: `catalogProductId:${catalogProductId}`,
        source_revision: "fitness-menu-v1",
        revision: 1,
        catalog_product_id: catalogProductId,
      }]),
    });
  });
  await page.route("**/auth/v1/user", async (route) => {
    await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });

  await page.goto("/PriceTrace?view=restaurants");
  await expect(page.getByRole("heading", { name: "음식점", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("한식 › 비빔밥·덮밥", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "↳ 비빔밥·덮밥", exact: true }).click();
  await page.getByRole("button", { name: /한결식당/ }).click();

  await expect(page).toHaveURL(new RegExp(`view=restaurants&restaurant=${restaurantId}`));
  await expect(page.getByRole("heading", { name: "한결식당", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "비빔밥", exact: true })).toBeVisible();
  await expect(page.getByText("9,000원", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(`catalog_product_id ${catalogProductId}`, { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "식당 정보" }).click();
  await expect(page.getByText("한결푸드", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /지점·출처/ }).click();
  await expect(page.getByText("강남점", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^메뉴/ }).click();

  await page.getByRole("button", { name: "Nutrition DB 영양성분", exact: true }).click();
  const nutritionDialog = page.getByRole("dialog", { name: "메뉴 영양 정보", exact: true });
  await expect(nutritionDialog).toContainText("한결식당 · 비빔밥");
  await expect(nutritionDialog).toContainText("650kcal");

  await page.keyboard.press("Escape");
  await page.goto(`/PriceTrace?view=restaurants&restaurant=${restaurantId}`);
  await expect(page.getByRole("heading", { name: "한결식당", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("tab", { name: /^메뉴/ })).toHaveAttribute("aria-selected", "true");
});
