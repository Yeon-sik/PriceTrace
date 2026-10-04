import { expect, test, type Page, type Route } from "@playwright/test";

const catalogId = "10000000-0000-4000-8000-000000009999";
const standardId = "20000000-0000-4000-8000-000000009999";
const rowId = (index: number) => `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const publicName = "공개 카탈로그 상품";

function publicRows() {
  const row = (index: number) => ({
    source_label: "와마트 일산점", source_product_code: String(index).padStart(6, "0"),
    catalog_product_id: rowId(index), standard_product_id: rowId(index + 10000), standard_name: "페이지 fixture",
    content_amount: 100, content_unit: "ml", package_count: 1, reference_unit: 100,
    coupang_listed_price_krw: null, coupang_quantity: null, coupang_content_amount: null,
    coupang_content_unit: null, coupang_product_url: null, coupang_observed_at: null,
  });
  return [...Array.from({ length: 1000 }, (_, index) => row(index)), {
    ...row(9999), source_product_code: "210059", catalog_product_id: catalogId,
    standard_product_id: standardId, standard_name: publicName,
  }];
}

async function prepare(page: Page, { failPublicInitially = false } = {}) {
  let account: "A" | "B" | null = null;
  let failPublic = failPublicInitially;
  let failSignedIn = false;
  let delaySignedIn = false;
  let delayedRoute: Route | null = null;
  let delayedRows: unknown[] = [];
  const offsets: number[] = [];
  const requestErrors: string[] = [];

  function user(value: "A" | "B") {
    return { id: value === "A" ? rowId(99991) : rowId(99992), aud: "authenticated", role: "authenticated",
      email: `${value.toLowerCase()}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: "2026-10-05T00:00:00Z" };
  }

  await page.route("https://pricetrace.example.test/**", async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split("/").at(-1)!;
    if (resource === "token") {
      const body = route.request().postDataJSON() as { email: string };
      account = body.email.startsWith("a@") ? "A" : "B";
      const authUser = user(account);
      const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const expires = Math.floor(Date.now() / 1000) + 3600;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({
        access_token: `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: authUser.id, exp: expires })}.fixture`,
        refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expires, expires_in: 3600, user: authUser,
      }) });
      return;
    }
    if (resource === "user") {
      await route.fulfill({ status: account ? 200 : 401, contentType: "application/json", body: JSON.stringify(account ? user(account) : { message: "No test user" }) });
      return;
    }
    if (resource === "logout") {
      account = null;
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }
    const from = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    let rows: unknown[] = [];
    if (resource === "get_public_exact_standard_product_catalog_v4") {
      offsets.push(from);
      rows = publicRows();
      if (failPublic && from > 0) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "public page unavailable" }) });
        return;
      }
    } else if (resource === "source_product_mappings") {
      rows = [{ id: rowId(99999), source_label: "와마트 일산점", source_product_code: "210059", catalog_product_id: catalogId }];
    } else if (resource === "catalog_products") {
      rows = [{ id: catalogId, standard_product_id: standardId, content_amount: 100, content_unit: "ml", package_count: 1, reference_unit: 100 }];
    } else if (resource === "standard_products") {
      rows = [...Array.from({ length: 1000 }, (_, index) => ({ id: rowId(index), canonical_name: "추가 fixture", brand: null, category_id: null })),
        { id: standardId, canonical_name: `계정 ${account} 상품`, brand: null, category_id: null }];
      if (failSignedIn && from > 0) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "signed-in page unavailable" }) });
        return;
      }
      if (delaySignedIn && from > 0 && account === "A") {
        delayedRoute = route;
        delayedRows = rows.slice(from, from + limit);
        return;
      }
    }
    try {
      await route.fulfill({ contentType: "application/json", headers: {
        "content-range": rows.length ? `${from}-${Math.min(from + limit, rows.length) - 1}/${rows.length}` : "*/0",
      }, body: JSON.stringify(rows.slice(from, from + limit)) });
    } catch (error) {
      // Abort is expected for pages still in flight during sign-out/navigation.
      if (!String(error).includes("Target page, context or browser has been closed")) requestErrors.push(String(error));
    }
  });
  await page.goto("/PriceTrace?view=products");
  await page.getByRole("button", { name: "표준 상품만", exact: true }).click();
  return {
    offsets, requestErrors,
    failPublic(value: boolean) { failPublic = value; },
    failSignedIn(value: boolean) { failSignedIn = value; },
    delaySignedIn(value: boolean) { delaySignedIn = value; },
    hasDelayedPage() { return delayedRoute !== null; },
    async releaseDelayedPage() {
      if (!delayedRoute) throw new Error("No delayed page to release");
      await delayedRoute.fulfill({ contentType: "application/json", headers: { "content-range": "1000-1000/1001" }, body: JSON.stringify(delayedRows) }).catch(() => undefined);
    },
  };
}

async function signIn(page: Page, account: "A" | "B") {
  await page.getByRole("button", { name: /로그인/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "로그인", exact: true });
  await dialog.getByLabel("이메일").fill(`${account.toLowerCase()}@example.invalid`);
  await dialog.getByLabel("비밀번호").fill("fixture-password");
  await dialog.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test("공개 RPC 중간 페이지 실패 후 재시도로 마지막 페이지의 상품을 가져온다", async ({ page }) => {
  const f = await prepare(page, { failPublicInitially: true });
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toHaveCount(0);
  f.failPublic(false);
  await page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true }).click();
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toHaveCount(0);
  expect(f.offsets).toEqual([0, 1000, 0, 1000]);
});

test("추가 조회 실패 시 정상 화면을 보존하고 재시도로 전체 데이터를 교체한다", async ({ page }) => {
  const f = await prepare(page);
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  f.failSignedIn(true);
  await signIn(page, "A");
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toHaveCount(0);
  f.failSignedIn(false);
  await page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true }).click();
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toHaveCount(0);
  expect(f.offsets).toContain(1000);
  expect(f.requestErrors).toEqual([]);
});

test("계정 전환 후 취소된 이전 계정 페이지가 새 카탈로그를 덮어쓰지 않는다", async ({ page }) => {
  const f = await prepare(page);
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  f.failSignedIn(true);
  await signIn(page, "A");
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toBeVisible();
  f.failSignedIn(false);
  f.delaySignedIn(true);
  await page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true }).click();
  await expect.poll(() => f.hasDelayedPage()).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "상품 카탈로그를 불러오는 중" })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  await signIn(page, "B");
  await expect(page.getByRole("button", { name: "계정 B 상품 정보 보기", exact: true })).toBeVisible();
  await f.releaseDelayedPage();
  await expect(page.getByRole("button", { name: "계정 B 상품 정보 보기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toHaveCount(0);
});

test("로그아웃 후 재조회가 실패해도 이전 계정의 카탈로그를 노출하지 않는다", async ({ page }) => {
  const f = await prepare(page);
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  await signIn(page, "A");
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toBeVisible();
  f.failPublic(true);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toHaveCount(0);
  f.failPublic(false);
  await signIn(page, "B");
  await expect(page.getByRole("button", { name: "계정 B 상품 정보 보기", exact: true })).toBeVisible();
});
