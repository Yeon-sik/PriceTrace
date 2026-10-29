import { describe, expect, it } from "vitest";
import {
  OrderProductLinkRequestInputSchema,
  SanitizedOrderCaptureSchema,
  buildSanitizedOrderCapture,
  mergeOrderCaptureExtractions,
  orderCaptureReviewIssues,
  parseOrderCaptureText,
  reviewOrderCapture,
} from "./order-capture";

const imageHashA = `sha256:${"a".repeat(64)}`;
const imageHashB = `sha256:${"b".repeat(64)}`;
const captureId = "11111111-1111-4111-8111-111111111111";
const now = "2026-08-20T03:00:00+09:00";

const iherbOcr = `
02:21
주문 세부 정보
배송완료
배송 날짜
2024년 7월 19일
NOW Foods, L-아르기닌, 더블
스트렝스, 1,000mg, 120정
개당 가격: ₩24,791
수량: 1
상품 합계: ₩24,791
구매후기 작성하기 재구매하기
Country Farms, Super Greens,
알칼리화 포뮬러, 무맛, 300g
(10.6oz)
개당 가격: ₩25,503
수량: 1
상품 합계: ₩25,503
구매후기 작성하기 재구매하기
NOW Foods, 스포츠, L- 글루타민
분말, 454g(1lbs)
개당 가격: ₩33,069
수량: 1
상품 합계: ₩33,069
`;

const coupangOcr = `
주문상세
결제 정보
상품 가격 7,900 원
배송비 0 원
VISA / 일시불 7,900 원
총 결제금액 7,900 원
카드영수증 보기
SYNTHETIC_RECIPIENT_SHOULD_DROP
SYNTHETIC_ADDRESS_SHOULD_DROP
SYNTHETIC_PHONE_SHOULD_DROP
배송요청사항 · SYNTHETIC_DELIVERY_NOTE_SHOULD_DROP
배송완료 · 7/27(월) 도착
🚀 로켓 아트뮤 네오 C타입-C타입 100W
240W 5A PD 고속충전 케이블, 화이트, 1개,
150cm
7,900 원 · 1개
바로구매
`;

describe("online order capture parsing", () => {
  it("extracts only visible iHerb product facts and keeps the partial order incomplete", () => {
    const extraction = parseOrderCaptureText(iherbOcr);

    expect(extraction.platform).toBe("iherb");
    expect(extraction.order.deliveredOn).toBe("2024-07-19");
    expect(extraction.order.orderNumber).toBeNull();
    expect(extraction.payment.paidAmountMinor).toBeNull();
    expect(extraction.items).toEqual([
      expect.objectContaining({
        name: "NOW Foods, L-아르기닌, 더블 스트렝스, 1,000mg, 120정",
        quantity: 1,
        unitPriceMinor: 24_791,
        lineTotalMinor: 24_791,
      }),
      expect.objectContaining({
        name: "Country Farms, Super Greens, 알칼리화 포뮬러, 무맛, 300g (10.6oz)",
        quantity: 1,
        lineTotalMinor: 25_503,
      }),
      expect.objectContaining({
        name: "NOW Foods, 스포츠, L- 글루타민 분말, 454g(1lbs)",
        quantity: 1,
        lineTotalMinor: 33_069,
      }),
    ]);

    const capture = buildSanitizedOrderCapture({
      id: captureId,
      extraction,
      captureHashes: [imageHashA],
      now,
    });
    expect(orderCaptureReviewIssues(capture)).toContain("총 결제금액이 보이지 않습니다.");
    expect(reviewOrderCapture(capture, now).state).toBe("reviewed_partial");
  });

  it("drops synthetic Coupang recipient fields while extracting payment and product facts", () => {
    const extraction = parseOrderCaptureText(coupangOcr);

    expect(extraction).toMatchObject({
      platform: "coupang",
      order: {
        orderNumber: null,
        deliveredOn: null,
        status: "delivered",
        currency: "KRW",
      },
      payment: {
        itemsSubtotalMinor: 7_900,
        shippingFeeMinor: 0,
        paidAmountMinor: 7_900,
        method: "card",
      },
    });
    expect(extraction.items).toEqual([
      expect.objectContaining({
        name: "아트뮤 네오 C타입-C타입 100W 240W 5A PD 고속충전 케이블, 화이트, 1개, 150cm",
        quantity: 1,
        unitPriceMinor: 7_900,
        lineTotalMinor: 7_900,
      }),
    ]);

    const stored = JSON.stringify(buildSanitizedOrderCapture({
      id: captureId,
      extraction,
      captureHashes: [imageHashA],
      now,
    }));
    expect(stored).not.toContain("SYNTHETIC_RECIPIENT_SHOULD_DROP");
    expect(stored).not.toContain("SYNTHETIC_ADDRESS_SHOULD_DROP");
    expect(stored).not.toContain("SYNTHETIC_PHONE_SHOULD_DROP");
    expect(stored).not.toContain("VISA");
  });

  it("merges multiple screenshots without inventing missing order facts or duplicate products", () => {
    const first = parseOrderCaptureText(coupangOcr);
    const second = {
      ...first,
      order: { ...first.order, orderNumber: "123456789" },
    };
    const merged = mergeOrderCaptureExtractions([first, second]);

    expect(merged.order.orderNumber).toBe("123456789");
    expect(merged.order.orderedOn).toBeNull();
    expect(merged.items).toHaveLength(1);
    expect(buildSanitizedOrderCapture({
      id: captureId,
      extraction: merged,
      captureHashes: [imageHashA, imageHashB],
      now,
    }).source.captureCount).toBe(2);
  });

  it("rejects persisted PII and raw OCR fields because the local contract is a strict allowlist", () => {
    const capture = buildSanitizedOrderCapture({
      id: captureId,
      extraction: parseOrderCaptureText(coupangOcr),
      captureHashes: [imageHashA],
      now,
    });

    expect(() => SanitizedOrderCaptureSchema.parse({
      ...capture,
      recipient: { phone: "SYNTHETIC_PHONE_SHOULD_REJECT" },
    })).toThrow();
    expect(() => SanitizedOrderCaptureSchema.parse({
      ...capture,
      source: { ...capture.source, rawText: coupangOcr },
    })).toThrow();
  });

  it("keeps the shared admin request free of order and payment data", () => {
    const request = {
      clientRequestId: "22222222-2222-4222-8222-222222222222",
      requestFingerprint: `sha256:${"c".repeat(64)}`,
      requestKind: "register_new",
      platform: "coupang",
      sourceLabel: "쿠팡",
      sellerLabel: null,
      sourceProductCode: null,
      productName: "아트뮤 네오 C타입-C타입 케이블",
      optionText: "화이트, 150cm",
      suggestedStandardProductId: null,
      suggestedCatalogProductId: null,
    };

    expect(OrderProductLinkRequestInputSchema.parse(request)).toEqual(request);
    expect(() => OrderProductLinkRequestInputSchema.parse({
      ...request,
      paidAmountMinor: 7_900,
      orderNumber: "1234",
    })).toThrow();
  });
});
