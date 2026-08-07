import { expect, test } from "@playwright/test";

test("official product cards can be added to cart", async ({ page }) => {
  await page.goto("/PriceTrace");
  await page.getByRole("button", { name: /상품 둘러보기/ }).click();

  const catalogTabs = page.getByRole("group").first();
  await catalogTabs.getByRole("button").nth(2).click();

  const officialSection = page.locator("section[aria-label]").filter({ has: page.locator("article") }).first();
  await expect(officialSection).toBeVisible();

  const officialCard = officialSection.getByRole("article").first();
  await officialCard.getByRole("button").click();

  const quantityDialog = page.getByRole("dialog").first();
  await expect(quantityDialog).toContainText("공식 표시가");
  await quantityDialog.getByRole("spinbutton").fill("2");
  await quantityDialog.getByRole("button").last().click();

  const noticeDialog = page.getByRole("dialog").first();
  await expect(noticeDialog).toContainText("장바구니에 담겼습니다");
  await noticeDialog.getByRole("button").last().click();

  const cartSummary = page.getByRole("complementary", { name: "장바구니 합계" });
  await expect(cartSummary).toContainText("총 2개");
  await expect(page.getByRole("article").filter({ hasText: "공식 표시가" })).toBeVisible();
});
