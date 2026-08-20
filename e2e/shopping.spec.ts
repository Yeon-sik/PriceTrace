import { expect, test, type Page } from "@playwright/test";

const nutritionCatalogProductId = "22222222-2222-4222-8222-222222222222";
const secondNutritionCatalogProductId = "33333333-3333-4333-8333-333333333333";
const nutritionStandardProductId = "11111111-1111-4111-8111-111111111111";
const nutritionCategoryId = "44444444-4444-4444-8444-444444444444";
const nutritionFoodId = "fitness-haagendazs-strawberry";
const kaguriCatalogProductId = "96eed0f6-1cfa-401a-850f-670d71c44d6f";

async function mockProductNutritionContracts(page: Page, {
  nutritionOffline = false,
  approvedNutrition = true,
  includeSecondVariant = false,
  failedNutritionCatalogProductId = null as string | null,
  kaguri = false,
} = {}) {
  let currentNutritionOffline = nutritionOffline;
  const requestedNutritionCatalogIds: string[] = [];
  const catalogId = nutritionCatalogProductId;
  const standardId = nutritionStandardProductId;
  const productName = "하겐다즈 미니컵 스트로베리";
  const nutritionRow = kaguri ? {
    contract_version: "nutrition-read.v1",
    nutrition_food_id: "eddcbbb8-eaa6-4be0-9bae-cbc4dc37f41f",
    name: "카구리 큰사발면",
    kind: "external_menu",
    basis_amount: 103,
    basis_unit: "g",
    prep_state: "unspecified",
    nutrition_values: {
      fat_grams: 15,
      sodium_mg: 1550,
      carbs_grams: 73,
      fiber_grams: null,
      sugars_grams: 5,
      calories_kcal: 455,
      protein_grams: 7,
      cholesterol_mg: 0,
      trans_fat_grams: null,
      added_sugars_grams: null,
      saturated_fat_grams: 8,
    },
    micronutrients: {},
    source_type: "pricetrace_manual",
    source_reference: `catalogProductId:${kaguriCatalogProductId}`,
    source_revision: null,
    revision: 1,
    catalog_product_id: kaguriCatalogProductId,
    catalog_product_revision: "sha256:4a0e24d2150802a2a85d228f35104e56ec5ff75c3366f1e17414f63963a6864b",
    catalog_content_amount: 103,
    catalog_content_unit: "g",
    catalog_package_count: 1,
  } : {
    contract_version: "nutrition-read.v1",
    nutrition_food_id: nutritionFoodId,
    name: "하겐다즈 스트로베리 영양",
    kind: "external_menu",
    basis_amount: 100,
    basis_unit: "ml",
    prep_state: "frozen",
    nutrition_values: {
      calories_kcal: 230,
      protein_grams: 4,
      carbs_grams: 25,
      fat_grams: 13,
      sodium_mg: 60,
      saturated_fat_grams: 8,
      sugars_grams: 21,
      fiber_grams: 1,
      added_sugars_grams: null,
      trans_fat_grams: 0,
      cholesterol_mg: 45,
    },
    micronutrients: {},
    source_type: "manufacturer_label",
    source_reference: "https://example.com/nutrition",
    source_revision: "label-v2",
    revision: 2,
    catalog_product_id: catalogId,
  };

  await page.route("**/rest/v1/rpc/get_public_exact_standard_product_catalog_v4", async (route) => {
    const catalogRows = [{
      source_label: "와마트 일산점",
      source_product_code: "210059",
      catalog_product_id: catalogId,
      standard_product_id: standardId,
      standard_name: productName,
      brand_name: null,
      standard_category_id: nutritionCategoryId,
      standard_category_slug: "ice-cream",
      standard_category_name: "아이스크림",
      content_amount: 100,
      content_unit: "ml",
      package_count: 1,
      reference_unit: 100,
      coupang_listed_price_krw: null,
      coupang_quantity: null,
      coupang_content_amount: null,
      coupang_content_unit: null,
      coupang_max_bundle_quantity: null,
      coupang_max_bundle_listed_price_krw: null,
      coupang_product_url: null,
      coupang_observed_at: null,
    }];
    if (includeSecondVariant) {
      catalogRows.push({
        ...catalogRows[0],
        source_product_code: "200183",
        catalog_product_id: secondNutritionCatalogProductId,
      });
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(catalogRows),
    });
  });
  await page.route("**/rest/v1/standard_product_images*", async (route) => {
    await route.fulfill({ contentType: "application/json", body: "[]" });
  });
  await page.route("**/auth/v1/user", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "No test user" }),
    });
  });
  await page.route("**/rest/v1/rpc/get_public_product_nutrition_v1", async (route) => {
    const requestBody = route.request().postDataJSON() as { p_catalog_product_id?: string };
    const requestedCatalogProductId = requestBody.p_catalog_product_id ?? "";
    requestedNutritionCatalogIds.push(requestedCatalogProductId);
    if (currentNutritionOffline || requestedCatalogProductId === failedNutritionCatalogProductId) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "nutrition offline" }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(approvedNutrition ? (kaguri ? {
        ...nutritionRow,
        catalog_product_id: requestedCatalogProductId,
      } : [{
        ...nutritionRow,
        catalog_product_id: requestedCatalogProductId,
      }]) : []),
    });
  });

  return {
    setNutritionOffline(value: boolean) {
      currentNutritionOffline = value;
    },
    requestedNutritionCatalogIds,
  };
}

test("전체 상품에서 공식 상품을 함께 보여 주고 상품 계층과 마트 범위를 따로 거른다", async ({ page }) => {
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  const catalogTabs = page.getByRole("group", { name: "상품 데이터 계층" });
  await expect(catalogTabs.getByRole("button", { name: "전체 상품", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(catalogTabs.getByRole("button", { name: "표준 상품만", exact: true })).toBeVisible();
  await expect(catalogTabs.getByRole("button", { name: /공식 상품만/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "PX 공식 판매상품" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "표준 상품 연결 전 공식 판매상품", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "일반 마트", exact: true }).click();
  await page.getByRole("combobox", { name: "정렬" }).selectOption("sellers");
  await expect(page.getByRole("region", { name: "PX 공식 판매상품" })).toHaveCount(0);

  await catalogTabs.getByRole("button", { name: /공식 상품만/ }).click();
  await expect(page.getByRole("region", { name: "PX 공식 판매상품" })).toBeVisible();
  await expect(page.getByText("PX 공식 등재", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("PX 공식 판매상품 전체 · 특정 지점의 판매·재고 정보가 아닙니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "판매처 유형" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "판매 마트" })).toHaveCount(0);

  await catalogTabs.getByRole("button", { name: "표준 상품만", exact: true }).click();
  await expect(page.getByRole("region", { name: "PX 공식 판매상품" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "판매처 유형" }).getByRole("button", { name: "전체", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "정렬" })).toHaveValue("cheap");
});

test("공유 URL과 브라우저 뒤로가기로 주요 화면 상태를 복원한다", async ({ page }) => {
  await page.goto("/PriceTrace?view=products");
  await expect(page.getByRole("heading", { name: "상품 목록", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?view=products$/);

  const mainNavigation = page.getByRole("navigation", { name: "주요 메뉴" });
  await mainNavigation.getByRole("button", { name: /^장바구니/ }).click();
  await expect(page.getByRole("heading", { name: "장바구니", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?view=cart$/);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "상품 목록", exact: true })).toBeVisible();
  await expect(mainNavigation.getByRole("button", { name: "상품 목록", exact: true })).toHaveAttribute("aria-current", "page");

  await mainNavigation.getByRole("button", { name: "판매처 기록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "판매처 기록", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?view=markets$/);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "상품 목록", exact: true })).toBeVisible();
});

test("로그인 dialog를 Esc로 닫으면 실행 버튼으로 포커스를 복원한다", async ({ page }) => {
  await page.goto("/PriceTrace");
  const loginButton = page.getByRole("button", { name: "로그인", exact: true });
  await loginButton.click();

  const loginDialog = page.getByRole("dialog", { name: "로그인", exact: true });
  await expect(loginDialog.getByRole("textbox", { name: "이메일" })).toBeFocused();
  await page.keyboard.press("Escape");

  await expect(loginDialog).toHaveCount(0);
  await expect(loginButton).toBeFocused();
});

test("공개 관측 상품을 보여 주고 새로고침 뒤에도 장바구니를 유지한다", async ({ page }) => {
  const productName = "하겐다즈 미니컵 스트로베리";

  await page.goto("/PriceTrace");
  await expect(page.getByText("기존 화면 데이터는 유지됩니다.", { exact: false })).toHaveCount(0);
  const emptyFloatingCart = page.getByRole("button", {
    name: "장바구니 열기, 담긴 아이템 0개",
    exact: true,
  });
  await expect(emptyFloatingCart).toBeVisible();
  await expect(emptyFloatingCart).not.toContainText("총합");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  const product = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: productName, exact: true }),
  });
  await expect(product).toContainText("2,030원");
  const addButton = product.getByRole("button", { name: `${productName} 장바구니에 담기`, exact: true });
  await addButton.click();

  const quantityDialog = page.getByRole("dialog", { name: "몇 개 담을까요?" });
  await expect(quantityDialog).toContainText("최근 관측가 2,030원 · 2026-07-14 관측");
  const quantityInput = quantityDialog.getByRole("spinbutton", { name: "추가할 수량" });
  await expect(quantityInput).toBeFocused();
  await quantityInput.fill("3");
  await quantityDialog.getByRole("button", { name: "장바구니에 담기", exact: true }).click();

  const successDialog = page.getByRole("dialog", { name: "장바구니에 담겼습니다" });
  await expect(successDialog.getByRole("button", { name: "장바구니 바로가기", exact: true })).toBeFocused();
  await successDialog.getByRole("button", { name: "계속 둘러보기", exact: true }).click();
  await expect(addButton).toBeFocused();

  const filledFloatingCart = page.getByRole("button", {
    name: "장바구니 열기, 담긴 아이템 3개, 총합 6,090원",
    exact: true,
  });
  await expect(filledFloatingCart).toBeVisible();
  await expect(filledFloatingCart).toContainText("총합");
  await expect(filledFloatingCart).toContainText("6,090원");
  await filledFloatingCart.click();
  await expect(filledFloatingCart).toHaveCount(0);

  const cartSummary = page.getByRole("complementary", { name: "장바구니 합계" });
  await expect(cartSummary).toContainText("총 3개");
  await expect(cartSummary).toContainText("6,090원");
  await expect(page.getByRole("article").filter({ hasText: "최근 관측가 (2026-07-14)" })).toBeVisible();
  const cartQuantityInput = page.getByRole("spinbutton", { name: `${productName} 수량` });
  await cartQuantityInput.fill("1.5");
  await expect(cartQuantityInput).toHaveValue("1");
  await expect(cartSummary).toContainText("총 1개");
  await expect(cartSummary).toContainText("2,030원");

  await page.reload();
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("button", { name: "장바구니 1" })
    .click();
  await expect(page.getByRole("complementary", { name: "장바구니 합계" })).toContainText("총 1개");
});

test("큰 대표 이미지도 상품 이름 위의 이미지 영역을 벗어나지 않는다", async ({ page }) => {
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  const card = page.getByRole("article").first();
  const imageSlot = card.getByTestId("product-image-slot");
  await imageSlot.evaluate((element) => {
    const image = document.createElement("img");
    image.alt = "대표 이미지 레이아웃 테스트";
    image.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600'%3E%3Ccircle cx='300' cy='300' r='280' fill='%23e7c6a2'/%3E%3C/svg%3E";
    element.replaceChildren(image);
  });

  const image = imageSlot.getByRole("img", { name: "대표 이미지 레이아웃 테스트" });
  await expect(image).toBeVisible();
  const [imageBox, headingBox] = await Promise.all([
    image.boundingBox(),
    card.getByRole("heading").first().boundingBox(),
  ]);

  expect(imageBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(imageBox!.y + imageBox!.height).toBeLessThanOrEqual(headingBox!.y);
});

test("상품 이미지를 화면 이동 없이 확대하고 Esc로 닫는다", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("price-tracker-official-products-v1", JSON.stringify({
      schemaVersion: 1,
      products: {
        "korean-military-px:210059:하겐다즈 미니컵 스트로베리": {
          officialName: "하겐다즈 스트로베리 미니컵",
          officialUrl: "https://example.com/haagendazs",
          sourceName: "E2E 검증 데이터",
          imageUrl: "https://images.example.test/haagendazs.svg",
          matchMethod: "official_verified",
          updatedAt: "2026-07-28T00:00:00.000Z",
        },
      },
    }));
  });
  await page.route("https://images.example.test/**", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: "<svg xmlns='http://www.w3.org/2000/svg' width='800' height='800'><rect width='800' height='800' fill='#f4e9da'/><circle cx='400' cy='400' r='260' fill='#b21f35'/></svg>",
    });
  });
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  const card = page.getByRole("article").filter({ hasText: "하겐다즈" }).first();
  const zoomButton = card.getByRole("button", { name: /하겐다즈.*이미지 확대 보기/ });
  await expect(zoomButton).toBeVisible();
  await zoomButton.click();

  const dialog = page.getByRole("dialog", { name: /하겐다즈.*이미지 확대 보기/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: /하겐다즈.*제품 사진/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(zoomButton).toBeFocused();
});

test("상품 카드의 액션 행은 내용 길이가 달라도 같은 줄에 고정된다", async ({ page }) => {
  await page.goto("/PriceTrace");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();
  await expect(page.getByRole("heading", { name: "상품 목록", exact: true })).toBeVisible();

  const cards = page.getByRole("article");
  expect(await cards.count()).toBeGreaterThanOrEqual(4);
  const actionTops = await Promise.all(
    [0, 1, 2, 3].map(async (index) => {
      const box = await cards.nth(index).getByRole("button", { name: /장바구니에 담기$/ }).boundingBox();
      expect(box).not.toBeNull();
      return box!.y;
    }),
  );

  expect(Math.max(...actionTops) - Math.min(...actionTops)).toBeLessThanOrEqual(1);
});

test("개별 상품 카드의 상품명, 판매처, 가격을 촘촘하게 표시한다", async ({ page }) => {
  await page.goto("/PriceTrace");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();
  await expect(page.getByRole("heading", { name: "상품 목록", exact: true })).toBeVisible();

  const card = page.getByRole("article").first();
  const [headingBox, sellerBox, priceBox] = await Promise.all([
    card.getByRole("heading").first().boundingBox(),
    card.locator("p").first().boundingBox(),
    card.locator("strong").first().boundingBox(),
  ]);

  expect(headingBox).not.toBeNull();
  expect(sellerBox).not.toBeNull();
  expect(priceBox).not.toBeNull();
  expect(sellerBox!.y - (headingBox!.y + headingBox!.height)).toBeLessThanOrEqual(4);
  expect(priceBox!.y - (sellerBox!.y + sellerBox!.height)).toBeLessThanOrEqual(4);
});

test("상품 가격 이력에서 판매처 기준을 확인하고 판매처별 상품 기록으로 이동한다", async ({ page }) => {
  const productName = "하겐다즈 미니컵 스트로베리";

  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();
  await expect(page.getByRole("heading", { name: "상품 목록", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "상품 목록", exact: true })).toBeVisible();
  const product = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: productName, exact: true }),
  });
  await product.getByRole("button", { name: `${productName} 가격 이력 보기`, exact: true }).click();

  const priceDialog = page.getByRole("dialog", { name: productName });
  await expect(priceDialog).toContainText("판매처");
  await expect(priceDialog).toContainText("코드");
  await expect(priceDialog).toContainText("최근 관측가");
  await expect(priceDialog).toContainText("가격 변동 추이");
  await expect(priceDialog).toContainText("변동 이력");
  const storeButton = priceDialog.getByRole("button", { name: /판매처 정보 보기$/ });
  const storeLabel = (await storeButton.getAttribute("aria-label"))?.replace(/ 판매처 정보 보기$/, "");
  expect(storeLabel).toBeTruthy();
  await storeButton.click();

  await expect(page.getByRole("heading", { name: storeLabel!, exact: true })).toBeVisible();
  await expect(page.getByText("검증 공개 판매처", { exact: false })).toBeVisible();
  await expect(page.getByText("사업자등록번호:", { exact: false })).toBeVisible();
  await expect(page.getByText("공개 판매처 ID:", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "상품별 가격 변동" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "판매처 상품 검색" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2회 이상 추적만" })).toBeVisible();
});

test("모바일에서도 판매처 기록과 상품 검색에 접근할 수 있다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/PriceTrace");

  const mobileNav = page.getByRole("navigation", { name: "모바일 주요 메뉴" });
  await expect(page.locator('button[aria-label="장바구니 열기, 담긴 아이템 0개"]')).toBeHidden();
  await expect(mobileNav.getByRole("button", { name: "장바구니", exact: true })).toBeVisible();
  await expect(mobileNav.getByRole("button", { name: "판매처 기록", exact: true })).toBeVisible();
  await mobileNav.getByRole("button", { name: "판매처 기록", exact: true }).click();

  await expect(page.getByRole("heading", { name: "판매처 기록", exact: true })).toBeVisible();
  const verifiedMarketCard = page.getByRole("button").filter({ hasText: "검증 공개 영수증" }).first();
  const storeLabel = await verifiedMarketCard.locator("strong").textContent();
  expect(storeLabel).toBeTruthy();
  await verifiedMarketCard.click();
  await expect(page.getByRole("heading", { name: storeLabel!, exact: true })).toBeVisible();
  await expect(page.getByText("마트 주소:", { exact: false })).toBeVisible();
  await expect(page.getByText("마트 연락처:", { exact: false })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "판매처 상품 검색" })).toBeVisible();
});

test("표준 상품 정보에서 승인된 영양을 별도 영양성분표로 보여 준다", async ({ page }) => {
  await mockProductNutritionContracts(page);
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  const standardCard = page.getByRole("article").filter({
    has: page.getByRole("button", { name: "하겐다즈 미니컵 스트로베리 정보 보기", exact: true }),
  });
  const informationButton = standardCard.getByRole("button", { name: "하겐다즈 미니컵 스트로베리 정보 보기", exact: true });
  await expect(informationButton).toHaveText("정보 보기");
  await informationButton.click();

  const dialog = page.getByRole("dialog", { name: "하겐다즈 미니컵 스트로베리" });
  const nutritionButton = dialog.getByRole("button", { name: "영양 정보 확인", exact: true });
  await expect(nutritionButton).toBeVisible();
  await expect(dialog).not.toContainText("영양 연결을 확인할 정확한 판매 규격");
  await expect(dialog).not.toContainText(nutritionCatalogProductId);

  await nutritionButton.click();

  const nutritionDialog = page.getByRole("dialog", { name: "기준 단위당 영양 정보" });
  await expect(nutritionDialog).toBeVisible();
  const nutritionCloseButton = nutritionDialog.getByRole("button", { name: "영양 정보 닫기" });
  await expect(nutritionCloseButton).toBeFocused();
  await nutritionCloseButton.press("Tab");
  await expect(nutritionDialog.getByText("기록된 값 보기", { exact: false })).toBeFocused();
  const nutritionFacts = nutritionDialog.getByRole("article", { name: "하겐다즈 스트로베리 영양 영양성분표" });
  await expect(nutritionFacts).toContainText("100ml");
  await expect(nutritionFacts).toContainText("열량");
  await expect(nutritionFacts).toContainText("230kcal");
  await expect(nutritionFacts).toContainText("트랜스지방");
  await expect(nutritionFacts).toContainText("0g");
  await expect(nutritionFacts).toContainText("콜레스테롤");
  await expect(nutritionFacts).toContainText("45mg");

  await page.keyboard.press("Escape");
  await expect(nutritionDialog).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(nutritionButton).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(informationButton).toBeFocused();
});

test("카구리 실응답의 기록 기준량과 같은 단위 환산을 영양 모달에 함께 보여 준다", async ({ page }) => {
  await mockProductNutritionContracts(page, { kaguri: true });
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();
  await page.getByRole("button", { name: "하겐다즈 미니컵 스트로베리 정보 보기", exact: true }).click();
  await page.getByRole("button", { name: "영양 정보 확인", exact: true }).click();

  const nutritionDialog = page.getByRole("dialog", { name: "기준 단위당 영양 정보" });
  const nutritionFacts = nutritionDialog.getByRole("article", { name: "카구리 큰사발면 영양성분표" });
  await expect(nutritionDialog.getByText("기록된 값 보기", { exact: false })).toBeVisible();
  await expect(nutritionDialog.getByText("카구리 큰사발면 · 103g")).toBeHidden();
  await expect(nutritionDialog.getByRole("table")).toHaveCount(1);
  await nutritionDialog.getByText("기록된 값 보기", { exact: false }).click();
  await expect(nutritionDialog.getByText("카구리 큰사발면 · 103g")).toBeVisible();
  await expect(nutritionFacts).toContainText("기준 단위당 영양성분");
  await expect(nutritionDialog).toContainText("455kcal");
  await expect(nutritionFacts).toContainText("441.75kcal");
  await expect(nutritionDialog).toContainText("1,550mg");
  await expect(nutritionFacts).toContainText("1,504.85mg");
  await expect(nutritionFacts).toContainText("100ml");
  await expect(nutritionFacts).toContainText("100serving");
  await expect(nutritionFacts).toContainText("-");
});

test("여러 정확 규격 중 일부 영양 조회가 실패해도 확인된 영양은 유지한다", async ({ page }) => {
  const nutritionMock = await mockProductNutritionContracts(page, {
    includeSecondVariant: true,
    failedNutritionCatalogProductId: secondNutritionCatalogProductId,
  });
  await page.goto("/PriceTrace?view=products");

  await page.getByRole("button", {
    name: "하겐다즈 미니컵 스트로베리 정보 보기",
    exact: true,
  }).click();
  const productDialog = page.getByRole("dialog", { name: "하겐다즈 미니컵 스트로베리" });
  await expect(productDialog).toContainText("하위 상품 2개");
  await productDialog.getByRole("button", { name: "영양 정보 확인", exact: true }).click();

  const nutritionDialog = page.getByRole("dialog", { name: "기준 단위당 영양 정보" });
  await expect(nutritionDialog.getByRole("article", { name: "하겐다즈 스트로베리 영양 영양성분표" })).toBeVisible();
  await expect(nutritionDialog).toContainText("일부 공개 영양정보를 불러오지 못했습니다.");
  await expect.poll(() => [...new Set(nutritionMock.requestedNutritionCatalogIds)].sort()).toEqual([
    nutritionCatalogProductId,
    secondNutritionCatalogProductId,
  ]);
});

test("승인된 영양 내용이 없으면 영양 팝업에 내용없음을 표시한다", async ({ page }) => {
  await mockProductNutritionContracts(page, { approvedNutrition: false });
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  await page.getByRole("button", {
    name: "하겐다즈 미니컵 스트로베리 정보 보기",
    exact: true,
  }).click();
  await page.getByRole("button", { name: "영양 정보 확인", exact: true }).click();

  const nutritionDialog = page.getByRole("dialog", { name: "기준 단위당 영양 정보" });
  await expect(nutritionDialog.getByText("내용없음", { exact: true })).toBeVisible();
});

test("Nutrition 장애를 상품·가격 상세와 분리한다", async ({ page }) => {
  await mockProductNutritionContracts(page, { nutritionOffline: true });
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  await page.getByRole("button", {
    name: "하겐다즈 미니컵 스트로베리 정보 보기",
    exact: true,
  }).click();

  const dialog = page.getByRole("dialog", { name: "하겐다즈 미니컵 스트로베리" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("판매처별 최근 단위가격", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "영양 정보 확인", exact: true }).click();

  const nutritionDialog = page.getByRole("dialog", { name: "기준 단위당 영양 정보" });
  await expect(nutritionDialog).toContainText("영양 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  await expect(nutritionDialog).not.toContainText("nutrition offline");
  await expect(nutritionDialog.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
});

test("영양 정보 일시 장애 뒤 팝업에서 다시 시도할 수 있다", async ({ page }) => {
  const nutritionMock = await mockProductNutritionContracts(page, { nutritionOffline: true });
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();
  await page.getByRole("button", {
    name: "하겐다즈 미니컵 스트로베리 정보 보기",
    exact: true,
  }).click();
  await page.getByRole("button", { name: "영양 정보 확인", exact: true }).click();

  const nutritionDialog = page.getByRole("dialog", { name: "기준 단위당 영양 정보" });
  const retryButton = nutritionDialog.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retryButton).toBeVisible();
  nutritionMock.setNutritionOffline(false);
  await retryButton.click();
  await expect(nutritionDialog.getByRole("article", { name: "하겐다즈 스트로베리 영양 영양성분표" })).toBeVisible();
});
