import { describe, expect, it } from "vitest";
import { buildSanitizedOrderCapture, parseOrderCaptureText } from "../domain/order-capture";
import {
  ORDER_CAPTURE_STORAGE_KEY,
  OrderCaptureRepository,
  type OrderCaptureStorage,
} from "./order-capture.repository";

function memoryStorage(): OrderCaptureStorage & { value: string | null } {
  return {
    value: null,
    getItem(key) {
      return key === ORDER_CAPTURE_STORAGE_KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === ORDER_CAPTURE_STORAGE_KEY) this.value = value;
    },
    removeItem(key) {
      if (key === ORDER_CAPTURE_STORAGE_KEY) this.value = null;
    },
  };
}

const ocr = `
주문상세
상품 가격 7,900 원
배송비 0 원
총 결제금액 7,900 원
배송완료 · 7/27(월) 도착
로켓 테스트 케이블, 1개
7,900 원 · 1개
바로구매
`;

function fixture() {
  return buildSanitizedOrderCapture({
    id: "11111111-1111-4111-8111-111111111111",
    extraction: parseOrderCaptureText(ocr),
    captureHashes: [`sha256:${"a".repeat(64)}`],
    now: "2026-08-20T03:00:00+09:00",
  });
}

describe("OrderCaptureRepository", () => {
  it("stores only the strict sanitized snapshot and replaces the same capture atomically", () => {
    const storage = memoryStorage();
    const repository = new OrderCaptureRepository(storage);
    const capture = fixture();

    repository.upsert(capture);
    repository.upsert({
      ...capture,
      revision: 2,
      updatedAt: "2026-08-20T04:00:00+09:00",
    });

    expect(repository.load()).toHaveLength(1);
    expect(repository.load()[0].revision).toBe(2);
    expect(storage.value).not.toContain("rawText");
  });

  it("does not partially load a corrupted snapshot", () => {
    const storage = memoryStorage();
    storage.value = JSON.stringify({
      schemaVersion: 1,
      captures: [fixture(), { unsafe: true }],
    });

    expect(new OrderCaptureRepository(storage).load()).toEqual([]);
  });

  it("removes the storage key when the final local capture is deleted", () => {
    const storage = memoryStorage();
    const repository = new OrderCaptureRepository(storage);
    repository.upsert(fixture());

    repository.remove("11111111-1111-4111-8111-111111111111");

    expect(storage.value).toBeNull();
  });
});
