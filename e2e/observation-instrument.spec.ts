import { expect, test } from "@playwright/test";

test("observation instrument exposes real date and price with a native keyboard control", async ({ page }) => {
  await page.goto("/PriceTrace");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("가격의 순간을");
  const slider = page.getByRole("slider", { name: "관측 시점 선택" });
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await expect(slider).toHaveAttribute("aria-valuetext", /2026\.05\.08, 1,080원, 1번째 기록/);
  await expect(page.getByTestId("instrument-price")).toHaveText("1,080원");
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", /2026\.06\.12, 1,080원, 6번째 기록/);
  await page.getByRole("button", { name: /전체 가격 기록/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("reduced motion retains the complete instrument and mobile navigation without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/PriceTrace");
  const instrument = page.getByTestId("observation-instrument");
  await instrument.hover();
  await expect(instrument).toHaveAttribute("data-motion-active", "false");
  await expect(page.getByRole("slider")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("navigation", { name: "모바일 주요 메뉴" }).getByRole("button", { name: "장바구니" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "장바구니" })).toBeVisible();
  await page.getByRole("button", { name: "가격 추적기 홈" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("가격의 순간을");
});

test("signature interaction becomes static offscreen and is recreated safely after navigation", async ({ page }) => {
  await page.goto("/PriceTrace");
  const instrument = page.getByTestId("observation-instrument");
  await instrument.hover();
  await expect(instrument).toHaveAttribute("data-motion-active", "true");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(instrument).toHaveAttribute("data-motion-active", "false");
  await page.getByRole("button", { name: "가격 추적기 홈" }).click();
  await page.getByRole("navigation", { name: "주요 메뉴", exact: true }).getByRole("button", { name: "장바구니" }).click();
  await page.getByRole("button", { name: "가격 추적기 홈" }).click();
  await expect(page.getByRole("slider", { name: "관측 시점 선택" })).toBeVisible();
});

test("mobile catalog keeps search and prices visible while filter state remains available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/PriceTrace?view=products");
  await expect(page.getByRole("searchbox", { name: "상품 검색" })).toBeVisible({ timeout: 15000 });
  const toggle = page.getByRole("button", { name: /필터·정렬/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByRole("group", { name: "상품 필터·정렬", exact: true }).getByRole("combobox", { name: "정렬", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "간식", exact: true }).click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("간식");
  await expect(page.getByRole("button", { name: "필터 초기화" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
