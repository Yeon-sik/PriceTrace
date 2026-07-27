import { expect, test } from "@playwright/test";

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
