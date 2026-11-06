import { expect, test, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const vectors = JSON.parse(readFileSync("contracts/information-record.v1.cases.json", "utf8"));
const fixture = vectors.accepted.find((entry: { record: { owner_app: string } }) => entry.record.owner_app === "pricetrace").record;
const raw = JSON.stringify(fixture, null, 2).replace('"nested": [', '"huge": 90071992547409931234567890, "nested": [');
const owner = "00000000-0000-4000-8000-000000000011";
type Row = { record_id: string; user_id: string; payload_text: string; state: string; received_at: string; content_fingerprint: string };

async function prepare(page: Page) {
  let signedIn = false;
  const rows: Row[] = [];
  const user = { id: owner, email: "inbox@example.invalid", role: "authenticated", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-11-06T00:00:00Z" };
  await page.route("https://pricetrace.example.test/**", async route => {
    const url = new URL(route.request().url()); const resource = url.pathname.split("/").at(-1);
    if (resource === "token") {
      signedIn = true;
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      await route.fulfill({ json: { access_token: `${encoded({ alg: "HS256" })}.${encoded({ sub: owner, exp: expires })}.fixture`, refresh_token: "fixture", expires_at: expires, expires_in: 3600, token_type: "bearer", user } }); return;
    }
    if (resource === "user") { await route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? user : { message: "No session" } }); return; }
    if (resource === "logout") { signedIn = false; await route.fulfill({ json: {} }); return; }
    if (resource === "ingest_pricetrace_information_record_v1") {
      const input = route.request().postDataJSON(); expect(input.p_expected_user_id).toBe(owner);
      const payload = JSON.parse(input.p_payload_text); const existing = rows.find(row => row.record_id === payload.record_id);
      if (existing && existing.payload_text !== input.p_payload_text) { await route.fulfill({ status: 409, json: { code: "23505", message: "Conflict" } }); return; }
      const fingerprint = createHash("sha256").update(input.p_payload_text).digest("hex");
      if (!existing) rows.push({ user_id: owner, record_id: payload.record_id, payload_text: input.p_payload_text, state: "pending", received_at: "2026-11-06T12:00:00Z", content_fingerprint: fingerprint });
      await route.fulfill({ json: { record_id: payload.record_id, duplicate: !!existing, content_fingerprint: fingerprint } }); return;
    }
    if (resource === "pricetrace_information_inbox") {
      expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
      if (route.request().method() === "PATCH") {
        const row = rows.find(row => `eq.${row.record_id}` === url.searchParams.get("record_id"))!;
        row.state = route.request().postDataJSON().state;
        await route.fulfill({ json: { record_id: row.record_id } }); return;
      }
      await route.fulfill({ json: signedIn ? rows : [] }); return;
    }
    await route.fulfill({ json: [] });
  });
  await page.route("https://nutrition.example.test/**", route => route.fulfill({ json: [] }));
  await page.goto("/PriceTrace?view=information-inbox");
  await page.getByRole("button", { name: "로그인 / 계정 확인", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "로그인", exact: true });
  await dialog.getByLabel("이메일").fill("inbox@example.invalid"); await dialog.getByLabel("비밀번호").fill("fixture-password");
  await dialog.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("아직 기록이 없습니다.", { exact: false })).toBeVisible();
  return rows;
}

async function importRecord(page: Page, text: string) {
  await page.getByLabel("정보 파일 가져오기").setInputFiles({ name: "information.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await page.getByRole("checkbox", { name: "PriceTrace가 소유할 상품·서비스·가격 정보임을 확인했습니다." }).check();
  await page.getByRole("button", { name: "확인한 기록 가져오기", exact: true }).click();
}

test("private import, duplicate, conflict, export and account isolation", async ({ page }) => {
  const rows = await prepare(page);
  await importRecord(page, raw);
  await expect(page.getByRole("status")).toHaveText("내 비공개 보관함에 저장했습니다.");
  expect(rows).toHaveLength(1);
  await page.getByRole("button", { name: new RegExp(fixture.title) }).click();
  await expect(page.locator("pre")).toContainText("90071992547409931234567890");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "원본 JSON 내보내기" }).click();
  expect(readFileSync((await (await download).path())!, "utf8")).toBe(raw);
  await expect(page.getByRole("status")).toContainText("내보내기를 완료했습니다");
  await page.getByRole("combobox", { name: "검토 상태", exact: true }).selectOption("reviewed");
  await expect(page.getByRole("combobox", { name: "검토 상태", exact: true })).toHaveValue("reviewed");
  await importRecord(page, raw);
  await expect(page.getByRole("status")).toContainText("중복 저장하지 않았습니다"); expect(rows).toHaveLength(1);
  await importRecord(page, raw.replace(fixture.title, "충돌하는 변경"));
  await expect(page.getByRole("region", { name: "내 정보 보관함", exact: true }).getByRole("alert")).toContainText("같은 ID"); expect(rows).toHaveLength(1);
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByLabel("정보 파일 가져오기").setInputFiles({ name: "foreign.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(vectors.accepted[0].record)) });
  await expect(page.getByRole("region", { name: "내 정보 보관함", exact: true }).getByRole("alert")).toContainText("pricetrace 소유 정보"); expect(rows).toHaveLength(1);
  await page.getByLabel("정보 파일 가져오기").setInputFiles({ name: "bad-utf8.json", mimeType: "application/json", buffer: Buffer.from([0xc3, 0x28]) });
  await expect(page.getByRole("region", { name: "내 정보 보관함", exact: true }).getByRole("alert")).toBeVisible();
  expect(rows).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(fixture.title) }).click();
  await expect(page.locator("pre")).toContainText("12345678901234567890.0010");
  mkdirSync(".impeccable/review", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".impeccable/review/information-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("heading", { name: fixture.title })).not.toBeVisible();
});

test("mobile direct service record keeps decimal, units and sources", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const rows = await prepare(page);
  await page.getByText("관측 정보 직접 등록", { exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("자전거 수리 견적");
  await page.getByLabel("대상 종류").selectOption("service");
  await page.getByLabel("출처 메모 / 원문").fill("수리점 방문 시 받은 견적");
  await page.getByRole("button", { name: "항목 추가", exact: true }).click();
  await page.getByLabel("항목 키", { exact: true }).fill("observed_price");
  await page.getByLabel("표시 이름").fill("관측 가격");
  await page.getByLabel("자료형").selectOption("decimal");
  await page.getByLabel("값", { exact: true }).fill("12345678901234567890.0010");
  await page.getByLabel("단위 (알 때만)").fill("KRW");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "비공개 기록 저장", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("내 비공개 보관함에 저장했습니다.");
  const stored = JSON.parse(rows[0].payload_text);
  expect(stored.fields[1].value).toBe("12345678901234567890.0010"); expect(stored.fields[1].unit).toBe("KRW");
  expect(stored.fields[1].source_ids).toEqual(["manual-1"]); expect(stored.occurred_at).toBeUndefined();
  await page.getByRole("button", { name: /자전거 수리 견적/ }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  mkdirSync(".impeccable/review", { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: ".impeccable/review/information-mobile.png", fullPage: true });
  await page.goto("/PriceTrace?view=products");
  await page.getByRole("button", { name: "상품·서비스 정보 보관함", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내 정보 보관함" })).toBeVisible();
});
