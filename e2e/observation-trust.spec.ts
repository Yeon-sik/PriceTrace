import { expect, test, type Page } from "@playwright/test";

// Public receipt data: three observations at two sellers (2026-05-08, 2026-06-12, 2026-07-14), same price.
const productName = "닭가슴살단백질바베리";

async function openProductCard(page: Page) {
  await page.goto("/PriceTrace?view=products");
  await page.getByRole("searchbox", { name: "상품 검색" }).fill(productName);
  const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: productName, exact: true }) }).first();
  await expect(card).toBeVisible();
  return card;
}

test("가격 이력에서 그룹의 모든 판매처 관측을 판매처별로 열람한다", async ({ page }) => {
  const card = await openProductCard(page);
  await card.getByRole("button", { name: `${productName} 가격 이력 보기`, exact: true }).click();

  const dialog = page.getByRole("dialog", { name: productName });
  const sellerTabs = dialog.getByRole("group", { name: "판매처별 관측 기록" });
  await expect(sellerTabs.getByRole("button")).toHaveCount(2);
  await expect(sellerTabs.getByRole("button", { name: /와마트 일산점/ })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog).toContainText("2026.07.14");

  await sellerTabs.getByRole("button", { name: /국군복지단 바다마을마트/ }).click();
  await expect(sellerTabs.getByRole("button", { name: /국군복지단 바다마을마트/ })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog).toContainText("2026.05.08");
  await expect(dialog).toContainText("2026.06.12");

  const graph = dialog.getByRole("img", { name: /관측일 간격에 비례/ });
  await expect(graph).toBeVisible();
  const xs = await graph.locator("circle").evaluateAll((circles) => circles.map((circle) => Number(circle.getAttribute("cx"))));
  expect(xs).toEqual([12, 288]);
});

test("판매처가 합쳐진 상품도 장바구니에 남고, 가격을 관측한 판매처 하나로 귀속된다", async ({ page }) => {
  const card = await openProductCard(page);
  await card.getByRole("button", { name: `${productName} 장바구니에 담기`, exact: true }).click();
  await page.getByRole("dialog", { name: "몇 개 담을까요?" }).getByRole("button", { name: "장바구니에 담기", exact: true }).click();
  await page.getByRole("dialog", { name: "장바구니에 담겼습니다" }).getByRole("button", { name: "장바구니 바로가기", exact: true }).click();

  const line = page.getByRole("article").filter({ has: page.getByRole("heading", { name: productName, exact: true }) });
  await expect(line).toBeVisible();
  await expect(line).toContainText("와마트 일산점 · 1,110원");
  await expect(line).not.toContainText("국군복지단 바다마을마트");
  await expect(page.getByRole("complementary", { name: "장바구니 요약" })).toContainText("1개 상품 · 총 1개");

  await page.getByRole("button", { name: "가격 추적기 홈" }).click();
  await expect(page.getByText("1개 상품 · 총 1개", { exact: true })).toBeVisible();
  await expect(page.getByText("예상 합계", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "장바구니 열기, 담긴 아이템 1개", exact: true })).toBeVisible();
});

test("판매처 정보 행 전체가 44px 이상의 터치 영역이다", async ({ page }) => {
  const card = await openProductCard(page);
  const row = card.getByRole("button", { name: /판매처 \d+곳 정보 보기/ });
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(150);
  await row.click();
  await expect(page.getByRole("dialog")).toContainText("국군복지단 바다마을마트");
});
