import { expect, test, type Page } from "@playwright/test";

const nutritionCatalogProductId = "22222222-2222-4222-8222-222222222222";
const nutritionStandardProductId = "11111111-1111-4111-8111-111111111111";
const nutritionFoodId = "fitness-haagendazs-strawberry";
const productRevision = `sha256:${"a".repeat(64)}`;
const nutritionRevision = `sha256:${"b".repeat(64)}`;

async function mockProductNutritionContracts(page: Page, { nutritionOffline = false } = {}) {
  let proposalCreated = false;
  let proposalBody: Record<string, unknown> | null = null;

  await page.route("**/rest/v1/rpc/get_public_exact_standard_product_catalog_v2", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{
        source_label: "와마트 일산점",
        source_product_code: "210059",
        catalog_product_id: nutritionCatalogProductId,
        standard_product_id: nutritionStandardProductId,
        standard_name: "하겐다즈 미니컵 스트로베리",
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
      }]),
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
  await page.route("**/rest/v1/rpc/get_product_read_v1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "product-read.v1",
        namespace: "pricetrace",
        revision: productRevision,
        products: [{
          revision: productRevision,
          standardProduct: {
            id: nutritionStandardProductId,
            name: "하겐다즈 미니컵 스트로베리",
            brand: "하겐다즈",
            updatedAt: "2026-08-09T01:00:00+00:00",
          },
          catalogProduct: {
            id: nutritionCatalogProductId,
            name: "하겐다즈 미니컵 스트로베리 100ml",
            specificationText: "100ml",
            contentAmount: 100,
            contentUnit: "ml",
            packageCount: 1,
            referenceUnit: 100,
            listingReferenceUrl: "https://example.com/haagendazs",
            updatedAt: "2026-08-09T01:00:00+00:00",
          },
          sellerProducts: [{ sellerLabel: "와마트 일산점", sourceProductCode: "210059" }],
          observations: [],
        }],
      }),
    });
  });

  await page.route("**/rest/v1/rpc/get_nutrition_read_v1", async (route) => {
    if (nutritionOffline) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "nutrition offline" }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{
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
          fiber_grams: null,
          added_sugars_grams: null,
          trans_fat_grams: null,
          cholesterol_mg: null,
        },
        micronutrients: {},
        source_type: "manufacturer_label",
        source_reference: "https://example.com/nutrition",
        source_revision: "label-v2",
        revision: 2,
        catalog_product_id: null,
      }]),
    });
  });
  await page.route("**/rest/v1/rpc/get_product_nutrition_link_state_v1", async (route) => {
    if (nutritionOffline) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "nutrition offline" }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "product-nutrition-link-state.v1",
        revision: nutritionRevision,
        namespace: "pricetrace",
        catalogProductId: nutritionCatalogProductId,
        approvedLinks: [],
        pendingProposals: proposalCreated ? [{
          schemaVersion: "product-nutrition-link-proposal.v1",
          id: "33333333-3333-4333-8333-333333333333",
          action: "link",
          identity: {
            namespace: "pricetrace",
            catalogProductId: nutritionCatalogProductId,
            nutritionFoodId,
          },
          status: "pending",
          sourceRevision: productRevision,
          createdAt: "2026-08-09T03:00:00+00:00",
        }] : [],
      }),
    });
  });
  await page.route("**/rest/v1/rpc/propose_product_nutrition_link_v1", async (route) => {
    proposalBody = route.request().postDataJSON() as Record<string, unknown>;
    proposalCreated = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "product-nutrition-link-proposal.v1",
        id: "33333333-3333-4333-8333-333333333333",
        action: "link",
        identity: {
          namespace: "pricetrace",
          catalogProductId: nutritionCatalogProductId,
          nutritionFoodId,
        },
        status: "pending",
        sourceRevision: productRevision,
        createdAt: "2026-08-09T03:00:00+00:00",
      }),
    });
  });

  return { getProposalBody: () => proposalBody };
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

  await catalogTabs.getByRole("button", { name: /공식 상품만/ }).click();
  await expect(page.getByRole("region", { name: "PX 공식 판매상품" })).toBeVisible();
  await expect(page.getByText("PX 공식 등재", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "일반 마트", exact: true }).click();
  await expect(page.getByRole("region", { name: "PX 공식 판매상품" })).toHaveCount(0);
  await expect(page.getByText("일반 마트 조건에 해당하는 공식 상품 컬렉션이 없습니다.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "PX (군마트)", exact: true }).click();
  await expect(page.getByRole("region", { name: "PX 공식 판매상품" })).toBeVisible();

  await catalogTabs.getByRole("button", { name: "표준 상품만", exact: true }).click();
  await expect(page.getByRole("region", { name: "PX 공식 판매상품" })).toHaveCount(0);
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
  await product
    .getByRole("button", { name: `${productName} 장바구니에 담기`, exact: true })
    .click();

  const quantityDialog = page.getByRole("dialog", { name: "몇 개 담을까요?" });
  await quantityDialog.getByRole("spinbutton", { name: "추가할 수량" }).fill("3");
  await quantityDialog.getByRole("button", { name: "장바구니에 담기", exact: true }).click();

  const successDialog = page.getByRole("dialog", { name: "장바구니에 담겼습니다" });
  await successDialog.getByRole("button", { name: "계속 둘러보기", exact: true }).click();

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

  await page.reload();
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("button", { name: "장바구니 3" })
    .click();
  await expect(page.getByRole("complementary", { name: "장바구니 합계" })).toContainText("총 3개");
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
  await expect(page.getByRole("button", { name: "장바구니 열기, 담긴 아이템 0개", exact: true })).toBeVisible();
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

test("상품 상세에서 정확 ID와 revision으로 Nutrition 연결 제안을 저장한다", async ({ page }) => {
  const contracts = await mockProductNutritionContracts(page);
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  const standardCard = page.getByRole("article").filter({
    has: page.getByRole("button", { name: "하겐다즈 미니컵 스트로베리 하위 상품 보기", exact: true }),
  });
  await standardCard.getByRole("button", { name: "하겐다즈 미니컵 스트로베리 하위 상품 보기", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "하겐다즈 미니컵 스트로베리" });
  await expect(dialog.getByRole("heading", { name: "Fitness 공개 영양" })).toBeVisible();
  await expect(dialog).toContainText("이름은 후보 탐색에만 사용");
  await expect(dialog).toContainText(nutritionCatalogProductId);
  await expect(dialog.getByText("하겐다즈 스트로베리 영양", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "연결 제안", exact: true }).click();

  await expect(dialog.getByText("연결 제안을 Nutrition 승인 대기열에 저장했습니다.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "연결 승인 대기", exact: true })).toBeDisabled();
  expect(contracts.getProposalBody()).toMatchObject({
    p_action: "link",
    p_namespace: "pricetrace",
    p_catalog_product_id: nutritionCatalogProductId,
    p_nutrition_food_id: nutritionFoodId,
    p_source_revision: productRevision,
    p_source: {
      system: "PriceTrace",
      contract: "product-read.v1",
      catalogProductId: nutritionCatalogProductId,
      candidateEvidence: {
        nutritionFoodName: "하겐다즈 스트로베리 영양",
        nutritionContract: "nutrition-read.v1",
        nutritionSourceRevision: "label-v2",
        nutritionRevision: 2,
      },
    },
  });
});

test("Nutrition 장애를 상품·가격 상세와 분리한다", async ({ page }) => {
  await mockProductNutritionContracts(page, { nutritionOffline: true });
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();

  await page.getByRole("button", {
    name: "하겐다즈 미니컵 스트로베리 하위 상품 보기",
    exact: true,
  }).click();

  const dialog = page.getByRole("dialog", { name: "하겐다즈 미니컵 스트로베리" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("nutrition offline");
  await expect(dialog).toContainText("가격·판매처 상세에는 영향이 없습니다.");
  await expect(dialog.getByText("판매처별 최근 단위가격", { exact: true })).toBeVisible();
});
