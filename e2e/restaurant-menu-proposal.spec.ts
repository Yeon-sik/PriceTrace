import { expect, test, type Page } from "@playwright/test";

const ids = { admin: "10000000-0000-4000-8000-000000000001",
  restaurant: "20000000-0000-4000-8000-000000000001", location: "30000000-0000-4000-8000-000000000001",
  menu: "40000000-0000-4000-8000-000000000001", catalog: "50000000-0000-4000-8000-000000000001",
  proposal: "60000000-0000-4000-8000-000000000001", merchant: "70000000-0000-4000-8000-000000000001" };
const revision = `sha256:${"a".repeat(64)}`;
const restaurant = { id: ids.restaurant, brandId: null, brand: "확인 식당", legalName: null,
  cuisineType: null, category: null, officialSiteUrl: null, updatedAt: "2026-10-04T00:00:00Z" };
const locations = [{ id: ids.location, sourceLabel: "fixture", sourceRestaurantCode: "known-branch",
  locationLabel: "확인 지점", sourceUrl: null }];
const menus = [{ id: ids.menu, catalogProductId: ids.catalog,
  standardProductId: "80000000-0000-4000-8000-000000000001", name: "확인 메뉴", categoryLabel: null,
  servingLabel: "1회", officialUrl: null, updatedAt: "2026-10-04T00:00:00Z", revision, observations: [] }];
const proposal = { schemaVersion: "restaurant-menu-candidate.v1", candidateId: ids.proposal,
  reviewStatus: "pending", resolutionStatus: "unresolved", restaurantId: null, restaurantLocationId: null,
  restaurantMenuId: null, catalogProductId: null, proposedRestaurantId: ids.restaurant,
  proposedRestaurantLocationId: ids.location, merchantCandidateId: null, menuName: "제안 메뉴",
  metadata: {}, reviewNote: null, createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z" };

async function prepare(page: Page) {
  const user = { id: ids.admin, aud: "authenticated", role: "authenticated", email: "admin@example.invalid",
    app_metadata: { role: "admin" }, user_metadata: {}, created_at: "2026-10-04T00:00:00Z" };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = { access_token: `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: ids.admin, exp: expires })}.fixture`,
    refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expires, expires_in: 3600, user };
  await page.context().addCookies([{ name: "sb-pricetrace-auth-token",
    value: `base64-${encoded(session)}`, domain: "127.0.0.1", path: "/", httpOnly: false, sameSite: "Lax" }]);
  const requests: Array<{ rpc: string; args: Record<string, unknown> }> = [];
  let reviewed = false;
  await page.route("https://pricetrace.example.test/**", async (route) => {
    const url = new URL(route.request().url());
    const rpc = url.pathname.split("/").at(-1) ?? "";
    let body: unknown = [];
    if (url.pathname === "/auth/v1/user") body = user;
    else if (rpc === "get_restaurant_menu_read_v1") body = { schemaVersion: "restaurant-menu-read.v1", namespace: "pricetrace", revision,
      restaurants: [{ revision, restaurant, locations, menus }] };
    else if (rpc === "get_restaurant_directory_v2") body = { schemaVersion: "restaurant-directory.v2", namespace: "pricetrace", revision,
      restaurants: [{ revision, restaurant, locations, menuCount: 1, latestObservedAt: null }] };
    else if (rpc === "admin_list_restaurant_menu_candidates_v1") body = reviewed ? [] : [proposal];
    else if (rpc === "admin_list_pending_merchant_identity_candidates_v1") body = [{ candidate_id: ids.merchant,
      origin: "merchant_only", merchant_name: "제안 가게", branch_name: "확인 지점", address: null,
      phone: null, business_registration_number: null, business_kind: "food_service",
      source_namespace: null, source_code: null, created_at: "2026-10-04T00:00:00Z" }];
    else if (rpc === "admin_resolve_restaurant_menu_candidate_v1") {
      const args = route.request().postDataJSON() as Record<string, unknown>;
      requests.push({ rpc, args }); reviewed = true;
      body = args.p_decision === "accept" ? { ...proposal, reviewStatus: "accepted", resolutionStatus: "exact",
        restaurantId: ids.restaurant, restaurantLocationId: ids.location, restaurantMenuId: ids.menu, catalogProductId: ids.catalog }
        : { ...proposal, reviewStatus: "rejected", reviewNote: args.p_review_note };
    } else if (rpc === "admin_resolve_merchant_identity_candidate_v1") {
      const args = route.request().postDataJSON() as Record<string, unknown>; requests.push({ rpc, args });
      body = [{ candidate_id: ids.merchant, review_status: "accepted", restaurant_id: ids.restaurant, restaurant_location_id: ids.location }];
    } else if (rpc.startsWith("admin_register_") || rpc.includes("publish")) {
      requests.push({ rpc, args: {} });
      throw new Error("Proposal review must not register canonical entities or publish Nutrition");
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/PriceTrace?view=admin");
  await page.getByRole("tab", { name: "음식점·메뉴", exact: true }).click();
  return requests;
}

test("관리자가 메뉴 제안을 정확한 기존 identity로 승인하며 영양정보를 공개하지 않는다", async ({ page }) => {
  const requests = await prepare(page);
  const panel = page.getByRole("region", { name: "Fitness 메뉴 등록 제안 검토" });
  await panel.getByRole("combobox", { name: "검토할 제안", exact: true }).selectOption(ids.proposal);
  await panel.getByRole("combobox", { name: "검증된 메뉴", exact: true }).selectOption(ids.menu);
  await panel.getByRole("button", { name: "선택한 메뉴로 승인" }).click();
  await expect(panel.getByRole("status")).toContainText("영양정보 공개는 제안자가 직접 선택");
  expect(requests).toEqual([{ rpc: "admin_resolve_restaurant_menu_candidate_v1", args: {
    p_candidate_id: ids.proposal, p_decision: "accept", p_restaurant_id: ids.restaurant,
    p_restaurant_location_id: ids.location, p_restaurant_menu_id: ids.menu, p_catalog_product_id: ids.catalog, p_review_note: null } }]);
});
test("관리자가 메뉴 제안을 거절하면 exact identity를 할당하지 않는다", async ({ page }) => {
  const requests = await prepare(page);
  const panel = page.getByRole("region", { name: "Fitness 메뉴 등록 제안 검토" });
  await panel.getByRole("combobox", { name: "검토할 제안", exact: true }).selectOption(ids.proposal);
  await panel.getByLabel("검토 메모").fill("메뉴 확인 자료 부족");
  await panel.getByRole("button", { name: "제안 거절", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("거절");
  expect(requests[0].args).toMatchObject({ p_decision: "reject", p_restaurant_id: null,
    p_restaurant_location_id: null, p_restaurant_menu_id: null, p_catalog_product_id: null });
});
test("가게 제안 검토는 기존 가게 resolution RPC를 재사용한다", async ({ page }) => {
  const requests = await prepare(page);
  const panel = page.getByRole("region", { name: "Fitness 가게 등록 제안 검토" });
  await panel.getByRole("combobox", { name: "검토할 가게 제안", exact: true }).selectOption(ids.merchant);
  await panel.getByRole("combobox", { name: "검증된 가게", exact: true }).selectOption(ids.restaurant);
  await panel.getByRole("combobox", { name: "검증된 가게 지점", exact: true }).selectOption(ids.location);
  await panel.getByRole("button", { name: "선택한 가게·지점으로 승인" }).click();
  await expect(panel.getByRole("status")).toContainText("메뉴 등록 제안을 계속");
  expect(requests).toEqual([{ rpc: "admin_resolve_merchant_identity_candidate_v1", args: {
    p_candidate_id: ids.merchant, p_restaurant_id: ids.restaurant,
    p_restaurant_location_id: ids.location, p_decision: "accept" } }]);
});
