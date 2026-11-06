import { expect, test, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const vectors = JSON.parse(readFileSync("contracts/information-record.v1.cases.json", "utf8"));
const fixture = vectors.accepted.find((entry: { record: { owner_app: string } }) => entry.record.owner_app === "pricetrace").record;
const raw = JSON.stringify(fixture, null, 2).replace('"nested": [', '"huge": 90071992547409931234567890, "nested": [');
const owner = "00000000-0000-4000-8000-000000000011";
type Row = { record_id: string; user_id: string; payload_text: string; state: string; received_at: string; content_fingerprint: string };

async function prepare(page: Page, projection = false) {
  let signedIn = false;
  const rows: Row[] = [];
  const user = { id: owner, email: "inbox@example.invalid", role: "authenticated", aud: "authenticated", app_metadata: projection ? { role: "admin" } : {}, user_metadata: {}, created_at: "2026-11-06T00:00:00Z" };
  const productId = "99000000-0000-4000-8000-000000000002", storeId = "99000000-0000-4000-8000-000000000003";
  const publicPrices: unknown[] = [], reviews: Record<string, unknown>[] = [];
  let receipt: Record<string, unknown> | null = null, preparedSeller = false;
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
    if (resource === "get_price_observation_sources_v1") { await route.fulfill({ json: preparedSeller ? [{ store_id: storeId, display_name: "검증판매점", location_label: "확인지점" }] : [] }); return; }
    if (resource === "pricetrace_information_projection_receipts") { await route.fulfill({ json: receipt }); return; }
    if (resource === "pricetrace_seller_review_requests") { await route.fulfill({ json: reviews }); return; }
    if (resource === "submit_pricetrace_seller_review_v1") {
      const input = route.request().postDataJSON(); expect(input.p_expected_user_id).toBe(owner);
      const review = { request_id: input.p_request_id, user_id: owner, source_record_id: input.p_source_record_id, details: input.p_details, input_digest: "d".repeat(64), state: "pending", store_id: null, review_note: null, created_at: "2026-11-06T12:00:00Z" };
      reviews.push(review); await route.fulfill({ json: review }); return;
    }
    if (resource === "review_pricetrace_seller_v1") {
      const input = route.request().postDataJSON(); expect(input.p_approve).toBe(true); expect(input.p_expected_digest).toBe("d".repeat(64));
      Object.assign(reviews[0], { state: "approved", store_id: storeId, review_note: input.p_review_note }); preparedSeller = true;
      await route.fulfill({ json: reviews[0] }); return;
    }
    if (resource === "get_information_public_prices_v1") { await route.fulfill({ json: publicPrices }); return; }
    if (resource === "get_product_read_v1" && projection) {
      const revision = `sha256:${"a".repeat(64)}`, updatedAt = "2026-11-06T00:00:00Z";
      await route.fulfill({ json: { schemaVersion: "product-read.v1", namespace: "pricetrace", revision, products: [{ revision,
        standardProduct: { id: productId, name: "검증상품", brand: null, updatedAt },
        catalogProduct: { id: productId, name: "검증상품 40g", specificationText: "40 g", contentAmount: 40, contentUnit: "g", packageCount: 1, referenceUnit: 100, listingReferenceUrl: null, updatedAt }, sellerProducts: [], observations: [] }] } }); return;
    }
    if (resource === "preview_pricetrace_information_price_v1" || resource === "apply_pricetrace_information_price_v1") {
      const input = route.request().postDataJSON(); const source = rows.find(row => row.record_id === input.p_record_id)!;
      expect(input.p_expected_user_id).toBe(owner); expect(input.p_source_fingerprint).toBe(source.content_fingerprint);
      expect(input.p_mapping).toEqual({ catalog_product_id: productId, store_id: storeId, price_field: "price", date_field: "day" });
      const result = { status: "ready", account_id: owner, record_id: source.record_id, source_fingerprint: source.content_fingerprint, mapping_digest: "b".repeat(64),
        impact: { catalog_product_id: productId, product_name: "검증상품 40g", specification: "40 g", store_id: storeId, store_name: "검증판매점", location_label: "확인지점", observed_on: "2026-11-06", unit_price_krw: 1200, visibility: "public", additional_observations: 1, observation_count_before: 0, minimum_before: null, minimum_after: 1200 } };
      if (resource.startsWith("apply")) {
        expect(input.p_publication_approved).toBe(true); expect(input.p_mapping_digest).toBe("b".repeat(64));
        const applied = { ...result, status: "applied", observation_id: productId, applied_at: "2026-11-06T12:00:00Z", replayed: false };
        receipt = { result: applied, mapping: input.p_mapping }; source.state = "reviewed";
        if (!publicPrices.length) publicPrices.push({ observation_id: productId, catalog_product_id: productId, product_name: "검증상품 40g", store_id: storeId, store_name: "검증판매점", location_label: "확인지점", observed_on: "2026-11-06", unit_price_krw: 1200 });
        await route.fulfill({ json: applied }); return;
      }
      await route.fulfill({ json: result }); return;
    }
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

test("mobile seller review, explicit public price approval, durable receipt and native price display", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const rows = await prepare(page, true);
  const record = { ...fixture, title: "직접 전달 가격 관측", record_type: "pricetrace.observation", fields: [{ key: "price", value_type: "decimal", unit: "KRW", value: "1200.00" }, { key: "day", value_type: "date", value: "2026-11-06" }] };
  const original = JSON.stringify(record); await importRecord(page, original);
  await page.getByRole("button", { name: /직접 전달 가격 관측/ }).click();
  await expect(page.getByText("아직 승인된 공개 판매처가 없습니다.", { exact: false })).toBeVisible();
  await page.getByText("판매처 등록 신청·관리자 검토", { exact: true }).click();
  await page.getByLabel("정확한 판매처명", { exact: true }).fill("검증판매점");
  await page.getByLabel("지점·주소 또는 온라인 판매자 식별", { exact: true }).fill("확인지점");
  await page.getByLabel("공개 확인 URL (HTTPS)", { exact: true }).fill("https://example.test/exact-store");
  await page.getByLabel("판매처 확인 근거", { exact: true }).fill("비공개 판매처 근거");
  await page.getByRole("checkbox", { name: "정확한 판매처 식별과 근거를 확인했으며 관리자에게 이 신청을 보냅니다." }).check();
  await page.getByRole("button", { name: "판매처 검토 신청", exact: true }).click();
  const seller = page.getByRole("article", { name: "판매처 신청 검증판매점" });
  await expect(seller.getByText("관리자 검토 대기", { exact: true })).toBeVisible();
  await expect(seller.getByRole("button", { name: "이 판매처 공개 승인" })).toBeDisabled();
  await seller.getByLabel("관리자 검토 사유").fill("정확한 판매점 및 지점의 공개 식별 근거 확인");
  await seller.getByRole("checkbox").check(); await seller.getByRole("button", { name: "이 판매처 공개 승인" }).click();
  await expect(seller.getByText("승인됨 · 공개 판매처 목록에서 선택 가능")).toBeVisible();
  await page.getByText("판매처 등록 신청·관리자 검토", { exact: true }).click();
  await page.getByLabel("정확한 상품 검색").fill("검증상품"); await page.getByRole("button", { name: "검증된 상품 찾기" }).click();
  await page.getByRole("combobox", { name: "원문에서 확인한 상품", exact: true }).selectOption("99000000-0000-4000-8000-000000000002");
  await page.getByRole("combobox", { name: "원문에서 확인한 판매처", exact: true }).selectOption("99000000-0000-4000-8000-000000000003");
  await page.getByRole("combobox", { name: "선택한 상품 포장 1개의 가격 항목" }).selectOption("price"); await page.getByRole("combobox", { name: "관측일로 사용할 원문 항목" }).selectOption("day");
  await page.getByRole("button", { name: "반영 영향 미리보기" }).click();
  await expect(page.getByText("이 상품·판매처·날짜·가격은 로그인하지 않은 사람도 볼 수 있습니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "승인한 공개 가격 반영" })).toBeDisabled();
  expect(rows[0].state).toBe("pending"); expect(rows[0].payload_text).toBe(original);
  await page.getByRole("checkbox", { name: "위 계정과 원문 항목, 상품·판매처를 직접 확인했고 이 가격 정보의 공개 반영을 승인합니다." }).check();
  mkdirSync(".impeccable/review", { recursive: true }); await page.getByRole("region", { name: "공개 가격으로 반영", exact: true }).screenshot({ path: ".impeccable/review/projection-mobile-preview.png" });
  await page.getByRole("button", { name: "승인한 공개 가격 반영" }).click();
  await expect(page.getByText("반영 완료 · 관측 ID", { exact: false })).toBeVisible(); expect(rows[0].state).toBe("reviewed"); expect(rows[0].payload_text).toBe(original);
  await page.reload(); await page.getByRole("button", { name: /직접 전달 가격 관측/ }).click();
  await expect(page.getByRole("heading", { name: "반영 영수증" })).toBeVisible(); await expect(page.getByRole("button", { name: "승인한 공개 가격 반영" })).not.toBeVisible();
  await page.getByRole("link", { name: "상품 가격·통계에서 보기" }).click();
  await expect(page.getByText("공개 가격 관측 · 1건", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("검증상품 40g", { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByText("공개 가격 관측 · 1건", { exact: true }).first().locator("xpath=ancestor::article[1]").screenshot({ path: ".impeccable/review/projection-mobile-products.png" });
  await page.getByRole("button", { name: "검증상품 40g 가격 이력 보기", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("1,200");
  await page.screenshot({ path: ".impeccable/review/projection-mobile-trend.png" });
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
