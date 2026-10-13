import { expect, test, type Page } from "@playwright/test";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const price = (n: number, date: string, amount: number) => ({ id: uuid(n), purchaseSourceLineId: uuid(n + 100), observedOn: date,
  createdAt: `${date}T12:00:00Z`, quantity: 1, unitPriceKrw: amount, grossPriceKrw: amount, netPriceKrw: amount, discountPriceKrw: null });
const privateProjection = { schemaVersion: "owner-restaurant-read.v1", ownerId: uuid(11), restaurants: [{
  id: uuid(1), locationId: uuid(2), name: "한성대학교 학생식당", branchName: null, authorityStatus: "owner_confirmed",
  menus: [{ id: uuid(3), name: "돼지불백덮밥", servingLabel: null, priceHistory: [price(5, "2026-11-10", 6000), price(6, "2026-10-13", 5700)] },
    { id: uuid(4), name: "어묵우동", servingLabel: null, priceHistory: [price(7, "2026-11-10", 4000), price(8, "2026-10-13", 3800)] }],
}] };

async function prepare(page: Page, owner: number | null) {
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
    else if (rpc === "get_restaurant_directory_v2") data = { schemaVersion: "restaurant-directory.v2", namespace: "pricetrace", revision: `sha256:${"a".repeat(64)}`, restaurants: [] };
    else if (rpc === "get_my_owner_confirmed_restaurants_v1") { privateReads++; data = owner === 11 ? privateProjection : { ...privateProjection, ownerId: uuid(owner!), restaurants: [] }; }
    else if (path === "/auth/v1/logout") { await route.fulfill({ status: 204 }); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/PriceTrace?view=restaurants");
  return () => privateReads;
}

test("본인은 두 메뉴의 최신 관측과 가격 이력을 조회하고 공개 목록은 분리된다", async ({ page }, info) => {
  await prepare(page, 11);
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "내 확인 식당", exact: true }).click();
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toBeVisible();
  const pork = page.getByRole("article", { name: "돼지불백덮밥", exact: true });
  const udon = page.getByRole("article", { name: "어묵우동", exact: true });
  await expect(pork.getByText("6,000원", { exact: true }).first()).toBeVisible();
  await expect(udon.getByText("4,000원", { exact: true }).first()).toBeVisible();
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
  await page.getByRole("button", { name: "내 확인 식당", exact: true }).click();
  await expect(page.getByText("아직 확인한 식당이 없습니다.")).toBeVisible();
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toHaveCount(0);
});
test("anonymous는 private RPC를 호출하지 않는다", async ({ page }) => {
  const reads = await prepare(page, null);
  await page.getByRole("button", { name: "내 확인 식당", exact: true }).click();
  await expect(page.getByText("로그인이 필요합니다.")).toBeVisible();
  expect(reads()).toBe(0);
});
test("로그아웃하면 private 식당과 가격 기록이 즉시 사라진다", async ({ page }) => {
  await prepare(page, 11);
  await page.getByRole("button", { name: "내 확인 식당", exact: true }).click();
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByText("로그인이 필요합니다.")).toBeVisible();
  await expect(page.getByText("한성대학교 학생식당", { exact: true })).toHaveCount(0);
});
