import { expect, test, type Page } from "@playwright/test";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const price = (n: number, date: string, amount: number) => ({ id: uuid(n), purchaseSourceLineId: uuid(n + 100), observedOn: date,
  createdAt: `${date}T12:00:00Z`, quantity: 1, unitPriceKrw: amount, grossPriceKrw: amount, netPriceKrw: amount, discountPriceKrw: null });
const privateProjection = { schemaVersion: "owner-restaurant-read.v3", ownerId: uuid(11), restaurants: [{
  id: uuid(1), locationId: uuid(2), name: "한성대학교 학생식당", branchName: null, authorityStatus: "owner_confirmed",
  menus: [{ id: uuid(3), name: "돼지불백덮밥", servingLabel: null, components: [{ id: uuid(9), name: "국물", role: "complimentary_side" }], priceHistory: [price(5, "2026-11-10", 6000), price(6, "2026-10-13", 5700)] },
    { id: uuid(4), name: "어묵우동", servingLabel: null, priceHistory: [price(7, "2026-11-10", 4000), price(8, "2026-10-13", 3800)] }],
}] };

async function prepare(page: Page, owner: number | null, privateProducts: unknown[] = []) {
  const user = owner ? { id: uuid(owner), aud: "authenticated", role: "authenticated", email: `owner-${owner}@example.invalid`,
    app_metadata: {}, user_metadata: {}, created_at: "2026-10-13T00:00:00Z" } : null;
  if (user) {
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const session = { access_token: `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: user.id, exp: expires })}.fixture`,
      refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expires, expires_in: 3600, user };
    await page.context().addCookies([{ name: "sb-pricetrace-auth-token", value: `base64-${encoded(session)}`, domain: "127.0.0.1", path: "/", httpOnly: false, sameSite: "Lax" }]);
  }
  let privateReads = 0;
  await page.route("https://pricetrace.example.test/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const rpc = path.split("/").at(-1);
    let data: unknown = [];
    if (path === "/auth/v1/user") data = user;
    else if (path === "/rest/v1/price_observations") data = owner === 11 ? privateProducts : [];
    else if (rpc === "get_restaurant_directory_v2") data = { schemaVersion: "restaurant-directory.v2", namespace: "pricetrace", revision: `sha256:${"a".repeat(64)}`, restaurants: [] };
    else if (rpc === "get_my_owner_confirmed_restaurants_v3") { privateReads++; data = owner === 11 ? privateProjection : { ...privateProjection, ownerId: uuid(owner!), restaurants: [] }; }
    else if (path === "/auth/v1/logout") { await route.fulfill({ status: 204 }); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  const initialProductRead = privateProducts.length > 0
    ? page.waitForResponse(response => new URL(response.url()).pathname === "/rest/v1/price_observations")
    : null;
  await page.goto("/PriceTrace?view=restaurants");
  if (initialProductRead) await (await initialProductRead).finished();
  const navigation = page.getByRole("navigation", { name: "주요 메뉴", exact: true });
  await expect(navigation.getByRole("button", { name: "음식점", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: owner ? "로그아웃" : "로그인", exact: true })).toBeVisible();
  // Exercise the visible entry point after the initial owner read completes.
  await page.getByRole("button", { name: "음식점", exact: true }).click();
  return () => privateReads;
}

async function openPrivateRestaurants(page: Page, expectRead = true) {
  const read = expectRead
    ? page.waitForResponse(response => new URL(response.url()).pathname === "/rest/v1/rpc/get_my_owner_confirmed_restaurants_v3")
    : null;
  await page.getByRole("button", { name: "내 확인 식당", exact: true }).click();
  if (read) await (await read).finished();
  await page.getByText("내 확인 식당을 불러오는 중입니다.", { exact: true }).waitFor({ state: "hidden" });
}

test("본인은 두 메뉴의 최신 관측과 가격 이력을 조회하고 공개 목록은 분리된다", async ({ page }, info) => {
  await prepare(page, 11);
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toHaveCount(0);
  await openPrivateRestaurants(page);
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toBeVisible();
  const pork = page.getByRole("article", { name: "돼지불백덮밥", exact: true });
  const udon = page.getByRole("article", { name: "어묵우동", exact: true });
  await expect(pork.getByText("6,000원", { exact: true }).first()).toBeVisible();
  await expect(udon.getByText("4,000원", { exact: true }).first()).toBeVisible();
  await expect(pork.getByRole("list", { name: "돼지불백덮밥 구성요소" })).toContainText("국물 · 함께 제공 · 가격 미관측");
  await expect(pork.getByRole("list", { name: "돼지불백덮밥 구성요소" })).not.toContainText("0원");
  await pork.getByText("가격 이력 2건", { exact: true }).click();
  await udon.getByText("가격 이력 2건", { exact: true }).click();
  await expect(pork.getByRole("table").getByText("5,700원", { exact: true })).toHaveCount(2);
  await expect(udon.getByRole("table").getByText("3,800원", { exact: true })).toHaveCount(2);
  await expect(pork.getByRole("table").getByText("2026-11-10")).toBeVisible();
  await page.screenshot({ path: info.outputPath("owner-restaurants-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pork.getByRole("heading", { name: "돼지불백덮밥" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("owner-restaurants-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "공개 식당", exact: true }).click();
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toHaveCount(0);
});
test("다른 로그인 사용자는 첫 owner의 식당을 볼 수 없다", async ({ page }) => {
  await prepare(page, 22);
  await openPrivateRestaurants(page);
  await expect(page.getByText("아직 확인한 식당이 없습니다.")).toBeVisible();
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toHaveCount(0);
});
test("anonymous는 private RPC를 호출하지 않는다", async ({ page }) => {
  const reads = await prepare(page, null);
  await openPrivateRestaurants(page, false);
  await expect(page.getByText("로그인이 필요합니다.")).toBeVisible();
  expect(reads()).toBe(0);
});
test("로그아웃하면 private 식당과 가격 기록이 즉시 사라진다", async ({ page }) => {
  await prepare(page, 11);
  await openPrivateRestaurants(page);
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByText("로그인이 필요합니다.")).toBeVisible();
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toHaveCount(0);
});

test("개인 구매 상품은 공개 홈의 관측 통계와 최근 기록에 섞이지 않는다", async ({ page }) => {
  const ownerId = uuid(11);
  await prepare(page, 11, [{
    id: uuid(30), user_id: ownerId, receipt_item_id: null,
    observed_at: "2026-11-10", unit_price_krw: 9000, quantity: 1,
    catalog_product_id: null, verification_status: "verified",
    store_products: {
      id: uuid(31), user_id: ownerId, store_id: uuid(32), store_product_code: null,
      products: { id: uuid(33), user_id: ownerId, name: "비공개 구매 상품", purchase_type: "retail_product" },
      stores: { id: uuid(32), user_id: ownerId, name: "비공개 판매처" },
    },
    receipt_items: null,
  }]);
  const productRead = page.waitForResponse(response => new URL(response.url()).pathname === "/rest/v1/price_observations");
  await page.getByRole("navigation", { name: "주요 메뉴", exact: true }).getByRole("button", { name: "상품 목록", exact: true }).click();
  await (await productRead).finished();
  await expect(page.getByRole("article").filter({ hasText: "비공개 구매 상품" })).toBeVisible();
  const purchaseRead = page.waitForResponse(response => new URL(response.url()).pathname === "/rest/v1/price_observations");
  await page.getByRole("button", { name: "가격 추적기 홈", exact: true }).click();
  await (await purchaseRead).finished();
  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  const publicSummary = page.locator('dl[aria-label="공개 영수증 기록 현황"]');
  await expect(page.getByRole("navigation", { name: "주요 메뉴", exact: true }).getByRole("button", { name: "홈", exact: true }))
    .toHaveAttribute("aria-current", "page");
  await expect(publicSummary).toContainText("223건");
  await expect(publicSummary).toContainText("4건");
  await expect(publicSummary).toContainText("3곳");
  await expect(publicSummary).toContainText("2026.07.14");
  await expect(main).not.toContainText("비공개 구매 상품");
  await expect(main).not.toContainText("비공개 판매처");
  await expect(page.getByRole("region", { name: "기록 탐색", exact: true })).not.toContainText("비공개 구매 상품");
});
