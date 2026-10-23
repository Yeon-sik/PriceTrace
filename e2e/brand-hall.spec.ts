import { expect, test, type Page } from "@playwright/test";
import { v5Row } from "../src/domain/public-standard-catalog-v5.fixture";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const initialBrands = [
  { id: uuid(1), name: "빙그레", parent: null },
  { id: uuid(2), name: "더단백", parent: uuid(1) },
  { id: uuid(3), name: "더단백 드링크", parent: uuid(2) },
  { id: uuid(4), name: "별도 브랜드", parent: null },
];

async function prepare(page: Page, options: { admin?: boolean; empty?: boolean; failOnce?: boolean } = {}) {
  const brands: { id: string; name: string; parent: string | null }[] = options.empty ? [] : initialBrands.map((brand) => ({ ...brand }));
  const aliases = [{ id: uuid(20), brand_id: uuid(2), alias_name: "The Protein" }];
  const mutations: { rpc: string; args: Record<string, string | null> }[] = [];
  const user = options.admin ? { id: uuid(11), aud: "authenticated", role: "authenticated", email: "brand-admin@example.invalid",
    app_metadata: { role: "admin" }, user_metadata: {}, created_at: "2026-10-13T00:00:00Z" } : null;
  if (user) {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expires })}.fixture`,
      refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expires, expires_in: 3600, user };
    await page.context().addCookies([{ name: "sb-pricetrace-auth-token", value: `base64-${encode(session)}`, domain: "127.0.0.1", path: "/", httpOnly: false, sameSite: "Lax" }]);
  }
  let failed = false;
  await page.route("https://pricetrace.example.test/**", async (route) => {
    const url = new URL(route.request().url());
    const rpc = url.pathname.split("/").at(-1)!;
    const args = route.request().method() === "POST" ? route.request().postDataJSON() ?? {} : {};
    let data: unknown = [];
    if (url.pathname === "/auth/v1/user") data = user;
    else if (rpc === "get_public_brand_catalog_v1") {
      if (options.failOnce && !failed) { failed = true; await route.fulfill({ status: 503, json: { message: "fixture unavailable" } }); return; }
      const query = String(args.p_query ?? "").toLocaleLowerCase();
      data = brands.filter((brand) => !query || brand.name.includes(query) || aliases.some((alias) => alias.brand_id === brand.id && alias.alias_name.toLocaleLowerCase().includes(query)))
        .slice(args.p_offset ?? 0, (args.p_offset ?? 0) + (args.p_limit ?? 200))
        .map((brand) => {
          const alias = aliases.find((alias) => alias.brand_id === brand.id && alias.alias_name.toLocaleLowerCase().includes(query));
          return { brand_id: brand.id, canonical_name: brand.name, parent_brand_id: brand.parent,
            parent_canonical_name: brands.find((parent) => parent.id === brand.parent)?.name ?? null,
            matched_name: query && alias ? alias.alias_name : brand.name, match_kind: query && alias ? "alias" : "canonical",
            logo_url: null, official_site_url: "https://example.invalid/brand" };
        });
    } else if (rpc === "get_public_exact_standard_product_catalog_v5") {
      data = options.empty ? [] : [
        { ...v5Row(), catalog_product_id: uuid(101), source_product_code: "root-product", standard_name: "바나나맛 우유", brand_id: uuid(1), brand_name: "빙그레", parent_brand_id: null, parent_brand_name: null },
        { ...v5Row(), catalog_product_id: uuid(102), source_product_code: "child-product", standard_name: "더단백 드링크 초코", brand_id: uuid(2), brand_name: "더단백", parent_brand_id: uuid(1), parent_brand_name: "빙그레" },
      ];
    } else if (rpc === "brands") {
      data = brands.map((brand) => ({ id: brand.id, canonical_name: brand.name, parent_brand_id: brand.parent, logo_url: null, official_site_url: null, status: "active" }));
    } else if (rpc === "brand_aliases") data = aliases;
    else if (rpc === "admin_save_brand_v1") {
      mutations.push({ rpc, args });
      const id = args.p_brand_id || uuid(5);
      const brand = brands.find((brand) => brand.id === id);
      if (brand) { brand.name = args.p_canonical_name; brand.parent = args.p_parent_brand_id; }
      else brands.push({ id, name: args.p_canonical_name, parent: args.p_parent_brand_id });
      data = id;
    } else if (rpc === "admin_add_brand_alias_v1") {
      mutations.push({ rpc, args }); aliases.push({ id: uuid(21), brand_id: args.p_brand_id, alias_name: args.p_alias_name }); data = uuid(21);
    } else if (rpc === "admin_delete_brand_alias_v1") {
      mutations.push({ rpc, args }); const index = aliases.findIndex((alias) => alias.id === args.p_alias_id && alias.brand_id === args.p_brand_id);
      if (index !== -1) aliases.splice(index, 1); data = args.p_alias_id;
    }
    await route.fulfill({ contentType: "application/json", headers: { "content-range": Array.isArray(data) ? (data.length ? `0-${data.length - 1}/${data.length}` : "*/0") : "" }, body: JSON.stringify(data) });
  });
  return mutations;
}

test("public brand browsing, alias search, direct products, deep links and history", async ({ page }, info) => {
  await prepare(page);
  await page.goto("/PriceTrace?view=brands");
  await expect(page.getByRole("heading", { name: "브랜드관", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "빙그레", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`brandId=${uuid(1)}`));
  await expect(page.getByRole("button", { name: /바나나맛 우유/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /더단백 드링크 초코/ })).toHaveCount(0);
  await page.getByRole("button", { name: /바나나맛 우유/ }).click();
  await expect(page.getByRole("region", { name: "공개 상품 정보", exact: true })).toContainText(uuid(101));
  await page.getByRole("button", { name: /바나나맛 우유/ }).click();
  await expect(page.getByRole("region", { name: "공개 상품 정보", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "더단백 상위 브랜드: 빙그레" }).click();
  await expect(page.getByRole("navigation", { name: "브랜드 경로" })).toContainText("빙그레더단백");
  await expect(page.getByRole("button", { name: /더단백 드링크 초코/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "빙그레", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "더단백", exact: true })).toBeVisible();
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: info.outputPath("brand-detail-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "전체 브랜드", exact: true }).click();
  await page.getByLabel("브랜드 검색", { exact: true }).fill("더단백");
  await expect(page.getByRole("button", { name: "더단백 상위 브랜드: 빙그레", exact: true })).toBeVisible();
  await page.getByLabel("브랜드 검색", { exact: true }).fill("protein");
  await expect(page.getByRole("button", { name: /더단백.*검색된 별칭: The Protein/ })).toBeVisible();
  await page.getByRole("button", { name: /더단백.*검색된 별칭: The Protein/ }).click();
  await expect(page).toHaveURL(new RegExp(`brandId=${uuid(2)}`));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("navigation", { name: "모바일 주요 메뉴" }).getByRole("button", { name: "브랜드관", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("brand-detail-mobile.png"), fullPage: true });
  const privateRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("get_authenticated_identity_detail_v1")) privateRequests.push(request.url());
  });
  await page.getByRole("button", { name: /더단백 드링크 초코/ }).click();
  const publicProduct = page.getByRole("region", { name: "공개 상품 정보", exact: true });
  await expect(publicProduct).toBeVisible();
  await expect(publicProduct).toContainText("더단백 드링크 초코");
  await expect(publicProduct).toContainText(uuid(102));
  await expect(page).toHaveURL(new RegExp(`view=brands&brandId=${uuid(2)}`));
  expect(privateRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("brand-public-product-mobile.png"), fullPage: true });
  await page.goto(`/PriceTrace?view=brands&brandId=${uuid(3)}`);
  await expect(page.getByRole("navigation", { name: "브랜드 경로" })).toContainText("빙그레더단백더단백 드링크");
  await expect(page.getByRole("heading", { name: "더단백 드링크", exact: true })).toBeVisible();
});

test("public empty, failure/retry, missing identity and invalid UUID states", async ({ page }) => {
  await prepare(page, { failOnce: true });
  await page.goto("/PriceTrace?view=brands&brandId=invalid");
  await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("brandId")).toBe(false);
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByLabel("브랜드 검색", { exact: true })).toBeVisible();
  await page.getByLabel("브랜드 검색", { exact: true }).fill("없는브랜드");
  await expect(page.getByText("검색 결과가 없습니다.", { exact: true })).toBeVisible();
  await page.goto(`/PriceTrace?view=brands&brandId=${uuid(999)}`);
  await expect(page.getByText("공개 목록에서 이 브랜드를 찾을 수 없습니다.")).toBeVisible();
  await page.unroute("https://pricetrace.example.test/**");
  await prepare(page, { empty: true });
  await page.goto("/PriceTrace?view=brands");
  await expect(page.getByText("아직 공개된 브랜드가 없습니다.")).toBeVisible();
});

test("loading is explicit and a cancelled older search cannot replace the latest alias result", async ({ page }) => {
  await prepare(page);
  let releaseBrowse!: () => void;
  const browseGate = new Promise<void>((resolve) => { releaseBrowse = resolve; });
  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => { releaseSearch = resolve; });
  let oldFinished!: () => void;
  const finished = new Promise<void>((resolve) => { oldFinished = resolve; });
  await page.route("**/rest/v1/rpc/get_public_brand_catalog_v1", async (route) => {
    const query = route.request().postDataJSON()?.p_query;
    if (!query) await browseGate;
    if (query === "빙그레") {
      await searchGate;
      await route.fallback(); oldFinished(); return;
    }
    await route.fallback();
  });
  await page.goto("/PriceTrace?view=brands");
  await expect(page.getByText("브랜드관을 불러오는 중입니다.", { exact: true })).toBeVisible();
  releaseBrowse();
  const search = page.getByLabel("브랜드 검색", { exact: true });
  const oldRequest = page.waitForRequest((request) => request.url().endsWith("get_public_brand_catalog_v1") && request.postDataJSON()?.p_query === "빙그레");
  await search.fill("빙그레"); await oldRequest;
  await search.fill("protein");
  await expect(page.getByRole("button", { name: /더단백.*검색된 별칭: The Protein/ })).toBeVisible();
  releaseSearch(); await finished;
  await expect(page.getByRole("button", { name: /더단백.*검색된 별칭: The Protein/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "빙그레", exact: true })).toHaveCount(0);
});

test("admin manages explicit parents and aliases without direct table writes", async ({ page }, info) => {
  const mutations = await prepare(page, { admin: true });
  await page.goto("/PriceTrace?view=admin");
  await page.getByRole("tab", { name: "브랜드 관리", exact: true }).click();
  const panel = page.getByRole("region", { name: "브랜드 관리", exact: true });
  await panel.getByRole("button", { name: /^더단백/ }).filter({ has: page.getByText("더단백", { exact: true }) }).click();
  const picker = panel.getByRole("combobox", { name: "상위 브랜드", exact: true });
  await expect(picker.locator(`option[value="${uuid(2)}"]`)).toHaveCount(0);
  await expect(picker.locator(`option[value="${uuid(3)}"]`)).toHaveCount(0);
  await picker.selectOption(uuid(4));
  await panel.getByLabel("브랜드명", { exact: true }).fill("더단백 수정");
  await panel.getByRole("button", { name: "브랜드 저장", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("브랜드를 저장했습니다.");
  expect(mutations[0]).toMatchObject({ rpc: "admin_save_brand_v1", args: { p_brand_id: uuid(2), p_parent_brand_id: uuid(4), p_canonical_name: "더단백 수정" } });
  await panel.getByLabel("새 별칭", { exact: true }).fill("New Alias");
  await panel.getByRole("button", { name: "별칭 추가", exact: true }).click();
  await expect(panel.getByRole("button", { name: "New Alias 별칭 삭제", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await panel.getByRole("button", { name: "New Alias 별칭 삭제", exact: true }).click();
  await expect(panel.getByRole("button", { name: "New Alias 별칭 삭제", exact: true })).toHaveCount(0);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: info.outputPath("brand-admin-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("brand-admin-mobile.png"), fullPage: true });
  const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.right > innerWidth + 1 && getComputedStyle(element).position !== "fixed";
  }).slice(0, 10).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right })));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(overflow)).toBe(true);
  await panel.getByRole("button", { name: "새 브랜드", exact: true }).click();
  await expect(panel.getByLabel("브랜드명", { exact: true })).toBeFocused();
  await expect.poll(() => panel.getByLabel("브랜드명", { exact: true }).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="모바일 주요 메뉴"]')!.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom < nav.top;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath("brand-admin-editor-mobile.png"), fullPage: false });
  await panel.getByLabel("브랜드명", { exact: true }).fill("관리자 신규 브랜드");
  await panel.getByRole("button", { name: "브랜드 저장", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("브랜드를 저장했습니다.");
  expect(mutations.at(-1)).toMatchObject({ rpc: "admin_save_brand_v1", args: { p_brand_id: null, p_parent_brand_id: null } });
  await panel.getByRole("button", { name: /^빙그레/ }).click();
  await expect(panel.getByLabel("브랜드명", { exact: true })).toBeFocused();
  await expect(panel.getByLabel("브랜드명", { exact: true })).toHaveValue("빙그레");
});
