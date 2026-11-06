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

async function prepare(page: Page, { failPublicInitially = false, adminSession = false } = {}) {
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
      email: adminSession ? `pricetrace-testing-account-${value.toLowerCase()}@example.invalid` : `${value.toLowerCase()}@example.invalid`,
      app_metadata: adminSession ? { role: "admin" } : {}, user_metadata: {}, created_at: "2026-10-05T00:00:00Z" };
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

test("비로그인 검색에서 제조사 규격을 표준 상품 카드와 상품 정보에 표시한다", async ({ page }) => {
  await prepare(page);
  await page.route("https://pricetrace.example.test/rest/v1/rpc/search_public_manufacturer_products_v1", async (route) => {
    const { p_query } = route.request().postDataJSON();
    expect(route.request().postDataJSON()).toEqual(p_query
      ? { p_query: "제조사 검증", p_limit: 20 }
      : { p_query: "", p_limit: 50 });
    await route.fulfill({ json: [{
      catalog_product_id: rowId(98765),
      product_name: "제조사 검증 상품",
      brand_name: "Fixture Brand",
      specification: "120정",
      manufacturer_sku: "TEST-120",
      manufacturer_url: "https://manufacturer.example/products/test-120",
    }] });
  });
  const browseRequest = page.waitForRequest((request) =>
    request.url().endsWith("/search_public_manufacturer_products_v1") && request.postDataJSON().p_query === "");
  await page.reload();
  await browseRequest;
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "제조사 검증 상품", exact: true }) });
  await expect(card.getByText("표준 상품", { exact: true })).toBeVisible();
  await expect(card).toContainText("120정");
  await card.getByRole("button", { name: "제조사 검증 상품 정보 보기" }).click();
  const detail = page.getByRole("dialog", { name: "제조사 검증 상품", exact: true });
  await expect(detail.getByRole("link", { name: "제조사 상품 정보" })).toHaveAttribute("href", "https://manufacturer.example/products/test-120");
  await expect(detail.getByRole("region", { name: "내 구매 기록" })).toContainText("로그인하면");
  await expect(page.getByRole("region", { name: "내 OCR 상품" })).toHaveCount(0);
});

test("표준 상품 정보에서 OCR 구매를 연결하면 원본 단가와 주문 결제액을 구분한다", async ({ page }, info) => {
  await prepare(page);
  await signIn(page, "A");
  const line = {
    purchase_source_line_id: rowId(777), product_client_key: "fixture-ocr-key",
    product_name: "OCR 검증용 상품", option_text: null, quantity: 1, platform_name: "검증용 구매 채널",
    seller_name: null, ordered_on: "2025-01-02", paid_on: null, unit_price_krw: 13000,
    item_net_price_krw: null, order_total_krw: 10000, order_line_count: 1,
  };
  let connected = false;
  await page.route("https://pricetrace.example.test/rest/v1/rpc/search_public_manufacturer_products_v1", (route) =>
    route.fulfill({ json: [{
      catalog_product_id: catalogId, product_name: "카탈로그 검증 상품", brand_name: "Fixture Brand",
      specification: "120정", manufacturer_sku: "TEST-120",
      manufacturer_url: "https://manufacturer.example/products/test-120",
    }] }));
  await page.route("https://pricetrace.example.test/rest/v1/rpc/get_my_catalog_purchase_context_v1", async (route) => {
    const args = route.request().postDataJSON();
    expect(args.p_catalog_product_ids).toEqual([catalogId]);
    const rows = args.p_query
      ? (connected ? [] : [{ ...line, catalog_product_id: null, owner_connected: false }])
      : (connected ? [{ ...line, catalog_product_id: catalogId, owner_connected: true }] : []);
    await route.fulfill({ json: rows });
  });
  await page.route("https://pricetrace.example.test/rest/v1/rpc/set_my_catalog_purchase_link_v1", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      p_catalog_product_id: catalogId, p_purchase_source_line_id: line.purchase_source_line_id, p_connected: true,
    });
    connected = true;
    await route.fulfill({ json: true });
  });

  await page.getByRole("searchbox", { name: "상품 검색" }).fill("카탈로그 검증");
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "카탈로그 검증 상품", exact: true }) });
  await card.getByRole("button", { name: "카탈로그 검증 상품 정보 보기" }).click();
  const detail = page.getByRole("dialog", { name: "카탈로그 검증 상품", exact: true });
  const history = detail.getByRole("region", { name: "내 구매 기록" });
  await history.getByRole("button", { name: "정보 연결", exact: true }).click();
  await history.getByRole("searchbox", { name: "내 OCR 구매 상품 검색" }).fill("검증용");
  await history.getByRole("button", { name: "연결할 구매 선택" }).click();
  await history.getByRole("button", { name: "이 상품으로 연결 확인" }).click();
  await expect(history).toContainText("품목 표시 단가");
  await expect(history).toContainText("13,000원");
  await expect(history).toContainText("주문 결제액");
  await expect(history).toContainText("10,000원");
  await expect(history).toContainText("판매처 확인 대기");
  await history.screenshot({ path: info.outputPath("connected-purchase-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(history.getByText("10,000원", { exact: true })).toBeVisible();
  await history.screenshot({ path: info.outputPath("connected-purchase-mobile.png") });
  await detail.getByRole("button", { name: "표준 상품 상세 닫기" }).click();
  await expect(card).toContainText("내 주문 결제액");
  await expect(card).toContainText("10,000원");
});

test("상품명 검색에 로그인한 계정의 OCR 후보만 별도로 표시한다", async ({ page }, info) => {
  await prepare(page, { adminSession: true });
  const ownerA = rowId(99991);
  const ownerB = rowId(99992);
  const candidateName = "예시 마그네슘 120정";
  const ownerReads: (string | null)[] = [];
  let failedFirstRead = false;
  await page.route("https://pricetrace.example.test/rest/v1/product_identity_candidates?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const owner = params.get("user_id");
    ownerReads.push(owner);
    expect(params.get("product_name")).toBe("ilike.%마그네슘%");
    expect(params.get("select")).toBe("id,client_key,product_name,brand,specification");
    if (!failedFirstRead && owner === `eq.${ownerA}`) {
      failedFirstRead = true;
      await route.fulfill({ status: 503, json: { message: "Temporary failure" } });
      return;
    }
    await route.fulfill({ json: owner === `eq.${ownerA}`
      ? [{ id: rowId(90001), client_key: "fixture-ocr-key", product_name: candidateName, brand: null, specification: null }]
      : [] });
  });

  await page.getByRole("button", { name: "전체 상품", exact: true }).click();
  await page.getByRole("searchbox", { name: "상품 검색" }).fill("마그네슘");
  const privateResults = page.getByRole("region", { name: "내 OCR 상품" });
  await expect(privateResults).toHaveCount(0);

  await signIn(page, "A");
  await page.getByRole("button", { name: "내 OCR 상품 다시 검색" }).click();
  await expect(privateResults.getByText(candidateName, { exact: true })).toBeVisible();
  await expect(privateResults).toContainText("내 계정에서만 표시");
  await privateResults.screenshot({ path: info.outputPath("owner-ocr-search-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(privateResults.getByText(candidateName, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await privateResults.screenshot({ path: info.outputPath("owner-ocr-search-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(privateResults).toHaveCount(0);
  await signIn(page, "B");
  await expect.poll(() => ownerReads.includes(`eq.${ownerB}`)).toBe(true);
  await expect(privateResults).toHaveCount(0);
  expect(ownerReads.every((owner) => owner === `eq.${ownerA}` || owner === `eq.${ownerB}`)).toBe(true);
});

function waitForCatalogPageFailure(page: Page, resource: string) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith(`/${resource}`)
      && url.searchParams.get("offset") === "1000" && response.status() === 503;
  }).then(response => response.finished());
}

function waitForSignedInCatalog(page: Page) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/standard_products")
      && url.searchParams.get("offset") === "1000" && response.status() === 200;
  }).then(response => response.finished());
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
  const failedPage = waitForCatalogPageFailure(page, "standard_products");
  await signIn(page, "A");
  await failedPage;
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toHaveCount(0);
  f.failSignedIn(false);
  const completedPage = waitForSignedInCatalog(page);
  await page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true }).click();
  await completedPage;
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toHaveCount(0);
  expect(f.offsets).toContain(1000);
  expect(f.requestErrors).toEqual([]);
});

test("계정 전환 후 취소된 이전 계정 페이지가 새 카탈로그를 덮어쓰지 않는다", async ({ page }) => {
  const f = await prepare(page);
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  f.failSignedIn(true);
  const failedPage = waitForCatalogPageFailure(page, "standard_products");
  await signIn(page, "A");
  await failedPage;
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toBeVisible();
  f.failSignedIn(false);
  f.delaySignedIn(true);
  await page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true }).click();
  await expect.poll(() => f.hasDelayedPage()).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "상품 카탈로그를 불러오는 중" })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  const completedPage = waitForSignedInCatalog(page);
  await signIn(page, "B");
  await completedPage;
  await expect(page.getByRole("button", { name: "계정 B 상품 정보 보기", exact: true })).toBeVisible();
  await f.releaseDelayedPage();
  await expect(page.getByRole("button", { name: "계정 B 상품 정보 보기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toHaveCount(0);
});

test("로그아웃 후 재조회가 실패해도 이전 계정의 카탈로그를 노출하지 않는다", async ({ page }) => {
  const f = await prepare(page);
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  const firstAccountPage = waitForSignedInCatalog(page);
  await signIn(page, "A");
  await firstAccountPage;
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toBeVisible();
  f.failPublic(true);
  const failedPage = waitForCatalogPageFailure(page, "get_public_exact_standard_product_catalog_v4");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await failedPage;
  await expect(page.getByRole("button", { name: "카탈로그 다시 불러오기", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `${publicName} 정보 보기`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "계정 A 상품 정보 보기", exact: true })).toHaveCount(0);
  f.failPublic(false);
  const completedPage = waitForSignedInCatalog(page);
  await signIn(page, "B");
  await completedPage;
  await expect(page.getByRole("button", { name: "계정 B 상품 정보 보기", exact: true })).toBeVisible();
});
