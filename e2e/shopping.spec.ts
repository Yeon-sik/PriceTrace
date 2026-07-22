import { expect, test } from "@playwright/test";

test("공식 상품만 보여 주고 새로고침 뒤에도 장바구니를 유지한다", async ({ page }) => {
  const productName = "하겐다즈 미니컵 스트로베리";

  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: "상품 둘러보기 →" }).click();
  await expect(page.getByText("3개 공식 연결 상품 · 3개 관측 기록")).toBeVisible();

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
  await successDialog.getByRole("button", { name: "장바구니 바로가기", exact: true }).click();

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
