import { z } from "zod";

export const ORDER_CAPTURE_SCHEMA_VERSION = 1 as const;
export const ORDER_CAPTURE_PARSER_VERSION = "order-capture-parser.v1" as const;

export const OrderCapturePlatformSchema = z.enum([
  "coupang",
  "iherb",
  "myprotein",
  "naver",
  "unknown",
]);

export const OrderCaptureLinkSchema = z.object({
  state: z.enum([
    "unlinked",
    "verified_mapping_suggested",
    "verified_mapping_confirmed",
    "user_selected_pending_admin",
    "admin_request_pending",
  ]),
  standardProductId: z.string().uuid().nullable(),
  catalogProductId: z.string().uuid().nullable(),
  requestId: z.string().uuid().nullable(),
}).strict().superRefine((link, context) => {
  if (link.catalogProductId !== null && link.standardProductId === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "정확 규격을 연결하려면 표준 상품 ID도 필요합니다.",
      path: ["standardProductId"],
    });
  }
  if (link.state === "unlinked" && (
    link.standardProductId !== null
    || link.catalogProductId !== null
    || link.requestId !== null
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "미연결 상품에는 연결 ID를 저장할 수 없습니다.",
    });
  }
  if (link.state === "admin_request_pending" && link.requestId === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "관리자 검토 대기 상태에는 요청 ID가 필요합니다.",
      path: ["requestId"],
    });
  }
});

export const OrderCaptureItemSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(500),
  optionText: z.string().trim().min(1).max(500).nullable(),
  sourceLabel: z.string().trim().min(1).max(100).nullable(),
  sellerLabel: z.string().trim().min(1).max(300).nullable(),
  sourceProductCode: z.string().trim().min(1).max(128).nullable(),
  quantity: z.number().int().positive().nullable(),
  unitPriceMinor: z.number().int().nonnegative().nullable(),
  lineTotalMinor: z.number().int().nonnegative().nullable(),
  confidence: z.enum(["high", "medium", "low", "user_verified"]),
  link: OrderCaptureLinkSchema,
}).strict();

const nullableAmountSchema = z.number().int().nonnegative().nullable();

export const SanitizedOrderCaptureSchema = z.object({
  schemaVersion: z.literal(ORDER_CAPTURE_SCHEMA_VERSION),
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  state: z.enum(["draft", "reviewed_partial", "verified"]),
  platform: OrderCapturePlatformSchema,
  order: z.object({
    orderNumber: z.string().trim().min(1).max(128).nullable(),
    orderedOn: z.string().date().nullable(),
    deliveredOn: z.string().date().nullable(),
    status: z.enum(["ordered", "paid", "shipped", "delivered", "cancelled", "refunded", "unknown"]),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  }).strict(),
  payment: z.object({
    itemsSubtotalMinor: nullableAmountSchema,
    shippingFeeMinor: nullableAmountSchema,
    discountMinor: nullableAmountSchema,
    paidAmountMinor: nullableAmountSchema,
    method: z.enum(["card", "bank_transfer", "mobile_payment", "points", "mixed", "unknown"]),
  }).strict(),
  items: z.array(OrderCaptureItemSchema).max(100),
  source: z.object({
    captureHashes: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)).min(1).max(20),
    captureCount: z.number().int().min(1).max(20),
    ocrEngine: z.literal("tesseract.js@7"),
    ocrLanguages: z.tuple([z.literal("kor"), z.literal("eng")]),
    parserVersion: z.literal(ORDER_CAPTURE_PARSER_VERSION),
    extractedAt: z.string().datetime({ offset: true }),
  }).strict(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((capture, context) => {
  if (capture.source.captureCount !== capture.source.captureHashes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "캡처 수와 이미지 지문 수가 일치하지 않습니다.",
      path: ["source", "captureCount"],
    });
  }

  const hasMoney = Object.values(capture.payment).some((value) => typeof value === "number")
    || capture.items.some((item) => item.unitPriceMinor !== null || item.lineTotalMinor !== null);
  if (hasMoney && capture.order.currency === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "금액이 있으면 통화가 필요합니다.",
      path: ["order", "currency"],
    });
  }
});

export type OrderCapturePlatform = z.infer<typeof OrderCapturePlatformSchema>;
export type OrderCaptureItem = z.infer<typeof OrderCaptureItemSchema>;
export type SanitizedOrderCapture = z.infer<typeof SanitizedOrderCaptureSchema>;

export type OrderCaptureExtraction = Pick<
  SanitizedOrderCapture,
  "platform" | "order" | "payment" | "items"
>;

const emptyLink = (): OrderCaptureItem["link"] => ({
  state: "unlinked",
  standardProductId: null,
  catalogProductId: null,
  requestId: null,
});

const ignoredNameLine = /^(?:주문\s*세부\s*정보|주문상세|결제\s*정보|배송\s*날짜|배송완료|카드영수증\s*보기|구매후기\s*작성하기|재구매하기|바로구매|상품\s*가격|배송비|총\s*결제금액|수량|상품\s*합계|개당\s*가격)/i;

function linesFrom(rawText: string) {
  return rawText
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function integerAmount(value: string | undefined) {
  if (!value) return null;
  const amount = Number(value.replace(/[^0-9]/g, ""));
  return Number.isSafeInteger(amount) ? amount : null;
}

function amountForLabel(lines: string[], label: RegExp) {
  for (const line of lines) {
    if (!label.test(line)) continue;
    const match = line.match(/(?:₩|￦|W)?\s*([0-9][0-9,\s]*)\s*원?/i);
    const amount = integerAmount(match?.[1]);
    if (amount !== null) return amount;
  }
  return null;
}

function fullKoreanDate(rawText: string, prefix?: RegExp) {
  const datePattern = /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
  const dateLines = rawText.split(/\n+/);
  const prefixIndex = prefix ? dateLines.findIndex((line) => prefix.test(line)) : -1;
  const source = prefix
    ? prefixIndex >= 0 ? dateLines.slice(prefixIndex, prefixIndex + 3).join(" ") : ""
    : rawText;
  const match = source.match(datePattern);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function cleanProductName(lines: string[]) {
  return lines
    .filter((line) => !ignoredNameLine.test(line))
    .filter((line) => !/^\d{1,2}:\d{2}$/.test(line))
    .filter((line) => !/^20\d{2}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일$/.test(line))
    .filter((line) => !/^\d{1,2}[/.]\d{1,2}(?:\([^)]+\))?\s*(?:도착)?$/.test(line))
    .filter((line) => !/^\(?\d{5}\)?\s/.test(line))
    .filter((line) => !/^0\d{1,2}\*+\d+$/.test(line))
    .map((line) => line.replace(/^(?:🚀\s*)?로켓\s*/u, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function baseExtraction(platform: OrderCapturePlatform): OrderCaptureExtraction {
  return {
    platform,
    order: {
      orderNumber: null,
      orderedOn: null,
      deliveredOn: null,
      status: "unknown",
      currency: null,
    },
    payment: {
      itemsSubtotalMinor: null,
      shippingFeeMinor: null,
      discountMinor: null,
      paidAmountMinor: null,
      method: "unknown",
    },
    items: [],
  };
}

export function detectOrderCapturePlatform(rawText: string): OrderCapturePlatform {
  if (/iherb|아이허브|구매후기\s*작성하기|재구매하기/i.test(rawText)) return "iherb";
  if (/쿠팡|카드영수증\s*보기|바로구매|(?:🚀\s*)?로켓/iu.test(rawText)) return "coupang";
  if (/myprotein|마이프로틴/i.test(rawText)) return "myprotein";
  if (/네이버\s*페이|npay|스마트스토어|네이버\s*배송/i.test(rawText)) return "naver";
  return "unknown";
}

function parseIherb(rawText: string): OrderCaptureExtraction {
  const extraction = baseExtraction("iherb");
  const lines = linesFrom(rawText);
  extraction.order.deliveredOn = fullKoreanDate(rawText, /배송\s*날짜/i);
  extraction.order.status = /배송완료/i.test(rawText) ? "delivered" : "unknown";
  extraction.order.currency = /₩|￦|\bKRW\b/i.test(rawText) ? "KRW" : null;

  let blockStart = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const unitMatch = lines[index].match(/개당\s*가격\s*[:：]?\s*(?:₩|￦|W)?\s*([0-9][0-9,\s]*)/i);
    if (!unitMatch) continue;
    const unitPriceMinor = integerAmount(unitMatch[1]);
    let quantity: number | null = null;
    let lineTotalMinor: number | null = null;
    let blockEnd = index;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      const quantityMatch = lines[cursor].match(/수량\s*[:：]?\s*(\d+)/i);
      const totalMatch = lines[cursor].match(/상품\s*합계\s*[:：]?\s*(?:₩|￦|W)?\s*([0-9][0-9,\s]*)/i);
      if (quantityMatch) quantity = Number(quantityMatch[1]);
      if (totalMatch) {
        lineTotalMinor = integerAmount(totalMatch[1]);
        blockEnd = cursor;
        break;
      }
    }
    const name = cleanProductName(lines.slice(blockStart, index));
    blockStart = blockEnd + 1;
    if (!name) continue;
    extraction.items.push({
      id: `item-${extraction.items.length + 1}`,
      name,
      optionText: null,
      sourceLabel: null,
      sellerLabel: null,
      sourceProductCode: null,
      quantity,
      unitPriceMinor,
      lineTotalMinor,
      confidence: unitPriceMinor !== null && quantity !== null && lineTotalMinor !== null
        ? "medium"
        : "low",
      link: emptyLink(),
    });
  }
  return extraction;
}

function parseCoupang(rawText: string): OrderCaptureExtraction {
  const extraction = baseExtraction("coupang");
  const lines = linesFrom(rawText);
  extraction.order.status = /배송완료/i.test(rawText) ? "delivered" : "unknown";
  extraction.order.deliveredOn = fullKoreanDate(rawText, /배송완료|도착/i);
  extraction.order.currency = /원|₩|￦|\bKRW\b/i.test(rawText) ? "KRW" : null;
  extraction.payment.itemsSubtotalMinor = amountForLabel(lines, /^상품\s*가격/i);
  extraction.payment.shippingFeeMinor = amountForLabel(lines, /^배송비/i);
  extraction.payment.paidAmountMinor = amountForLabel(lines, /^총\s*결제금액/i);
  extraction.payment.method = /VISA|MASTER|AMEX|카드|일시불/i.test(rawText) ? "card" : "unknown";

  let lastDeliveredIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (/배송완료/i.test(lines[index])) lastDeliveredIndex = index;
  }
  let blockStart = Math.max(0, lastDeliveredIndex + 1);
  for (let index = blockStart; index < lines.length; index += 1) {
    const priceQuantity = lines[index].match(/([0-9][0-9,\s]*)\s*원?\s*[·•]\s*(\d+)\s*개/i);
    if (!priceQuantity) continue;
    const lineTotalMinor = integerAmount(priceQuantity[1]);
    const quantity = Number(priceQuantity[2]);
    const name = cleanProductName(lines.slice(blockStart, index));
    blockStart = index + 1;
    if (!name) continue;
    extraction.items.push({
      id: `item-${extraction.items.length + 1}`,
      name,
      optionText: null,
      sourceLabel: null,
      sellerLabel: null,
      sourceProductCode: null,
      quantity,
      unitPriceMinor: lineTotalMinor !== null && lineTotalMinor % quantity === 0
        ? lineTotalMinor / quantity
        : null,
      lineTotalMinor,
      confidence: lineTotalMinor !== null ? "medium" : "low",
      link: emptyLink(),
    });
  }
  return extraction;
}

function parseGeneric(rawText: string, platform: OrderCapturePlatform): OrderCaptureExtraction {
  const extraction = baseExtraction(platform);
  const lines = linesFrom(rawText);
  const orderNumberMatch = rawText.match(/(?:주문\s*번호|order\s*(?:number|no\.?))\s*[:#]?\s*([A-Z0-9-]{4,128})/i);
  extraction.order.orderNumber = orderNumberMatch?.[1] ?? null;
  extraction.order.orderedOn = fullKoreanDate(rawText, /주문\s*(?:일|날짜)|order\s*date/i);
  extraction.order.status = /배송완료|delivered/i.test(rawText) ? "delivered" : "unknown";
  extraction.order.currency = /원|₩|￦|\bKRW\b/i.test(rawText) ? "KRW" : null;
  extraction.payment.paidAmountMinor = amountForLabel(lines, /^(?:총\s*결제금액|결제금액|order\s*total|total)/i);
  return extraction;
}

export function parseOrderCaptureText(rawText: string): OrderCaptureExtraction {
  const platform = detectOrderCapturePlatform(rawText);
  if (platform === "iherb") return parseIherb(rawText);
  if (platform === "coupang") return parseCoupang(rawText);
  return parseGeneric(rawText, platform);
}

export function mergeOrderCaptureExtractions(extractions: OrderCaptureExtraction[]) {
  if (extractions.length === 0) return baseExtraction("unknown");
  const platform = extractions.find((item) => item.platform !== "unknown")?.platform ?? "unknown";
  const samePlatform = extractions.filter((item) => item.platform === platform || item.platform === "unknown");
  const firstValue = <T,>(values: (T | null)[]) => values.find((value): value is T => value !== null) ?? null;
  const itemKeys = new Set<string>();
  const items = samePlatform.flatMap((extraction) => extraction.items).filter((item) => {
    const key = [item.name, item.quantity, item.lineTotalMinor].join("\u0000").toLocaleLowerCase("ko-KR");
    if (itemKeys.has(key)) return false;
    itemKeys.add(key);
    return true;
  }).map((item, index) => ({ ...item, id: `item-${index + 1}` }));

  return {
    platform,
    order: {
      orderNumber: firstValue(samePlatform.map((item) => item.order.orderNumber)),
      orderedOn: firstValue(samePlatform.map((item) => item.order.orderedOn)),
      deliveredOn: firstValue(samePlatform.map((item) => item.order.deliveredOn)),
      status: samePlatform.find((item) => item.order.status !== "unknown")?.order.status ?? "unknown",
      currency: firstValue(samePlatform.map((item) => item.order.currency)),
    },
    payment: {
      itemsSubtotalMinor: firstValue(samePlatform.map((item) => item.payment.itemsSubtotalMinor)),
      shippingFeeMinor: firstValue(samePlatform.map((item) => item.payment.shippingFeeMinor)),
      discountMinor: firstValue(samePlatform.map((item) => item.payment.discountMinor)),
      paidAmountMinor: firstValue(samePlatform.map((item) => item.payment.paidAmountMinor)),
      method: samePlatform.find((item) => item.payment.method !== "unknown")?.payment.method ?? "unknown",
    },
    items,
  } satisfies OrderCaptureExtraction;
}

export function buildSanitizedOrderCapture({
  id,
  extraction,
  captureHashes,
  now = new Date().toISOString(),
}: {
  id: string;
  extraction: OrderCaptureExtraction;
  captureHashes: string[];
  now?: string;
}) {
  return SanitizedOrderCaptureSchema.parse({
    schemaVersion: ORDER_CAPTURE_SCHEMA_VERSION,
    id,
    revision: 1,
    state: "draft",
    ...extraction,
    items: extraction.items.map((item) => ({
      ...item,
      sourceLabel: item.sourceLabel ?? (extraction.platform === "unknown"
        ? null
        : sourceLabelForPlatform(extraction.platform)),
    })),
    source: {
      captureHashes,
      captureCount: captureHashes.length,
      ocrEngine: "tesseract.js@7",
      ocrLanguages: ["kor", "eng"],
      parserVersion: ORDER_CAPTURE_PARSER_VERSION,
      extractedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  });
}

export function orderCaptureReviewIssues(capture: SanitizedOrderCapture) {
  const issues: string[] = [];
  if (capture.platform === "unknown") issues.push("주문 플랫폼을 확인하세요.");
  if (capture.order.orderNumber === null) issues.push("주문번호가 보이지 않습니다.");
  if (capture.order.orderedOn === null) issues.push("주문일이 보이지 않습니다.");
  if (capture.payment.paidAmountMinor === null) issues.push("총 결제금액이 보이지 않습니다.");
  if (capture.items.length === 0) issues.push("추출된 상품이 없습니다.");
  if (capture.items.some((item) => item.quantity === null || item.lineTotalMinor === null)) {
    issues.push("수량 또는 상품금액이 누락된 상품이 있습니다.");
  }
  return issues;
}

export function reviewOrderCapture(capture: SanitizedOrderCapture, now = new Date().toISOString()) {
  const issues = orderCaptureReviewIssues(capture);
  return SanitizedOrderCaptureSchema.parse({
    ...capture,
    revision: capture.revision + 1,
    state: issues.length === 0 ? "verified" : "reviewed_partial",
    items: capture.items.map((item) => ({ ...item, confidence: "user_verified" as const })),
    updatedAt: now,
  });
}

export const OrderProductLinkRequestInputSchema = z.object({
  clientRequestId: z.string().uuid(),
  requestFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  requestKind: z.enum(["link_existing", "create_variant", "register_new"]),
  platform: OrderCapturePlatformSchema.exclude(["unknown"]),
  sourceLabel: z.string().trim().min(1).max(100),
  sellerLabel: z.string().trim().min(1).max(300).nullable(),
  sourceProductCode: z.string().trim().min(1).max(128).nullable(),
  productName: z.string().trim().min(1).max(500),
  optionText: z.string().trim().min(1).max(500).nullable(),
  suggestedStandardProductId: z.string().uuid().nullable(),
  suggestedCatalogProductId: z.string().uuid().nullable(),
}).strict().superRefine((request, context) => {
  if (request.requestKind === "link_existing" && request.suggestedCatalogProductId === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "기존 정확 규격 연결 요청에는 정확 규격 ID가 필요합니다.",
      path: ["suggestedCatalogProductId"],
    });
  }
  if (request.requestKind === "create_variant" && request.suggestedStandardProductId === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "새 규격 요청에는 표준 상품 ID가 필요합니다.",
      path: ["suggestedStandardProductId"],
    });
  }
  if (request.requestKind === "register_new" && (
    request.suggestedStandardProductId !== null
    || request.suggestedCatalogProductId !== null
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "신규 표준 상품 요청에는 기존 상품 ID를 넣지 않습니다.",
    });
  }
});

export type OrderProductLinkRequestInput = z.infer<typeof OrderProductLinkRequestInputSchema>;

export function sourceLabelForPlatform(platform: Exclude<OrderCapturePlatform, "unknown">) {
  return {
    coupang: "쿠팡",
    iherb: "iHerb",
    myprotein: "MyProtein",
    naver: "네이버",
  }[platform];
}
