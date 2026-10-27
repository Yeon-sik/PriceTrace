import { expect, test, type Page } from "@playwright/test";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function prepare(page: Page, entity: "brand" | "store" | "restaurant" = "restaurant") {
  const user = { id: id(11), aud: "authenticated", role: "authenticated", email: "owner@example.invalid",
    app_metadata: {}, user_metadata: {}, created_at: "2026-10-18T00:00:00Z" };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expires })}.fixture`,
    refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expires, expires_in: 3600, user };
  await page.context().addCookies([{ name: "sb-pricetrace-auth-token", value: `base64-${encode(session)}`,
    domain: "127.0.0.1", path: "/", httpOnly: false, sameSite: "Lax" }]);
  const names = {
    brand: { source: "테스트 한성 브랜드", target: "테스트한성브랜드" },
    store: { source: "한성마토", target: "한성마트" },
    restaurant: { source: "한성대학교 학식당", target: "한성대학교 학생식당" },
  }[entity];
  const source = { entity, sourceId: id(1), name: names.source, branchName: entity === "store" ? "본점" : null, context: null, selected: null };
  const choice = { id: id(2), name: names.target, branchName: source.branchName, context: null, similarity: 0.8889, matchKind: "similar" };
  const inventory = { schemaVersion: "identity-connections.v1", ownerId: user.id, truncated: false, sources: [source] };
  let connects = 0;
  let connected = false;
  const privateProductName = "연결 확인용 상품";
  await page.route("https://pricetrace.example.test/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const rpc = path.split("/").at(-1);
    let data: unknown = [];
    if (path === "/auth/v1/user") data = user;
    else if (rpc === "get_my_identity_connection_sources_v1") data = connected
      ? { ...inventory, sources: [{ ...source, selected: { id: choice.id, name: choice.name } }] } : inventory;
    else if (rpc === "search_my_identity_connections_v1") {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({ p_entity: entity, p_source_id: source.sourceId });
      data = { schemaVersion: "identity-search.v1", entity: source.entity, sourceId: source.sourceId, query: body.p_query, choices: [choice] };
    } else if (rpc === "connect_my_identity_v1") {
      expect(route.request().postDataJSON()).toMatchObject({ p_entity: entity, p_source_id: source.sourceId, p_target_id: choice.id, p_user_verified: true });
      connects++;
      connected = true;
      data = { ...inventory, sources: [{ ...source, selected: { id: choice.id, name: choice.name } }] };
    } else if (entity === "store" && path === "/rest/v1/price_observations") {
      data = [{
        id: id(30), user_id: user.id, receipt_item_id: null, observed_at: "2026-10-18", unit_price_krw: 1000,
        quantity: 1, catalog_product_id: null, verification_status: "verified", receipt_items: null,
        store_products: { id: id(31), user_id: user.id, store_id: source.sourceId, store_product_code: null,
          products: { id: id(33), user_id: user.id, name: privateProductName, purchase_type: "retail_product" },
          stores: { id: source.sourceId, user_id: user.id, name: source.name } },
      }];
    } else if (entity === "store" && path === "/rest/v1/owner_identity_connections") {
      data = connected ? [{ user_id: user.id, source_id: source.sourceId, target_id: choice.id, target_name: choice.name }] : [];
    } else if (rpc === "get_restaurant_directory_v2") data = { schemaVersion: "restaurant-directory.v2", namespace: "pricetrace", revision: `sha256:${"a".repeat(64)}`, restaurants: [] };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  const view = entity === "restaurant" ? "restaurants" : "products";
  const navigationLabel = entity === "restaurant" ? "음식점" : "상품 목록";
  await page.goto(`/PriceTrace?view=${view}`);
  await expect(page.getByRole("navigation", { name: "주요 메뉴", exact: true }).getByRole("button", { name: navigationLabel, exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "로그아웃", exact: true })).toBeVisible();
  await page.getByText("내 브랜드·가게·식당 연결", { exact: true }).click();
  const panel = page.locator("details").filter({ has: page.getByText("내 브랜드·가게·식당 연결", { exact: true }) });
  await panel.getByRole("button", { name: "내 기록 불러오기", exact: true }).click();
  await panel.getByLabel("연결할 입력값").selectOption(`${entity}:${source.sourceId}`);
  return { panel, source, choice, privateProductName, connects: () => connects };
}

test("기존 식당 선택 후 명시적 확정으로만 연결하고 검색 변경은 선택을 해제한다", async ({ page }, info) => {
  const { panel, connects } = await prepare(page);
  await panel.getByRole("button", { name: "검색", exact: true }).click();
  await panel.getByRole("button", { name: /한성대학교 학생식당/ }).click();
  expect(connects()).toBe(0);
  await expect(panel.getByRole("button", { name: "같은 항목으로 확인하고 연결" })).toBeVisible();
  await panel.screenshot({ path: info.outputPath("identity-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: info.outputPath("identity-mobile.png") });
  await panel.getByLabel("기존 식당 검색").fill("한성대학교");
  await expect(panel.getByRole("button", { name: "같은 항목으로 확인하고 연결" })).toHaveCount(0);
  await panel.getByRole("button", { name: "검색", exact: true }).click();
  await panel.getByRole("button", { name: /한성대학교 학생식당/ }).click();
  await panel.getByRole("button", { name: "같은 항목으로 확인하고 연결" }).click();
  await expect(panel.getByText("연결됨: 한성대학교 학생식당", { exact: true })).toBeVisible();
  expect(connects()).toBe(1);
  await expect(panel.getByText("원래 입력: 한성대학교 학식당", { exact: true })).toBeVisible();
});

test("브랜드 연결은 명시적 확정 후에만 저장되고 목록을 다시 읽어도 유지된다", async ({ page }) => {
  const { panel, source, choice, connects } = await prepare(page, "brand");
  await panel.getByRole("button", { name: "검색", exact: true }).click();
  await panel.getByRole("button", { name: new RegExp(choice.name) }).click();
  expect(connects()).toBe(0);
  await panel.getByRole("button", { name: "같은 항목으로 확인하고 연결" }).click();
  await expect(panel.getByText(`연결됨: ${choice.name}`, { exact: true })).toBeVisible();
  await expect(panel.getByText(`원래 입력: ${source.name}`, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "연결 목록 새로고침" }).click();
  await panel.getByLabel("연결할 입력값").selectOption(`brand:${source.sourceId}`);
  await expect(panel.getByText(`연결됨: ${choice.name}`, { exact: true })).toBeVisible();
  expect(connects()).toBe(1);
});

test("가게 연결 후 개인 상품의 판매처를 갱신하면서 원래 입력은 보존한다", async ({ page }) => {
  const { panel, source, choice, privateProductName, connects } = await prepare(page, "store");
  const product = page.getByRole("article").filter({ hasText: privateProductName });
  const sellers = page.getByRole("combobox", { name: "판매 마트", exact: true });
  await expect(product).toBeVisible();
  await expect(sellers.getByRole("option", { name: source.name, exact: true })).toHaveCount(1);
  await panel.getByRole("button", { name: "검색", exact: true }).click();
  await panel.getByRole("button", { name: new RegExp(choice.name) }).click();
  expect(connects()).toBe(0);
  await panel.getByRole("button", { name: "같은 항목으로 확인하고 연결" }).click();
  await expect(panel.getByText(`연결됨: ${choice.name}`, { exact: true })).toBeVisible();
  await expect(sellers.getByRole("option", { name: choice.name, exact: true })).toHaveCount(1);
  await expect(sellers.getByRole("option", { name: source.name, exact: true })).toHaveCount(0);
  await sellers.selectOption({ label: choice.name });
  await expect(product).toBeVisible();
  await expect(panel.getByText(`원래 입력: ${source.name} · 본점`, { exact: true })).toBeVisible();
  expect(connects()).toBe(1);
});
