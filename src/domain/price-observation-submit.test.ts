import { describe, expect, it } from "vitest";
import { parsePriceObservationSubmitPayload, PriceObservationSubmitResponseSchema } from "./price-observation-submit";

const validPayload = {
  schema_version: "price-observation-submit.v1",
  store_id: "11111111-1111-4111-8111-111111111111",
  observed_on: "2026-08-12",
  catalog_product_id: "22222222-2222-4222-8222-222222222222",
  unit_price_krw: 12900,
  idempotency_key: "price-observation:example:1",
};

describe("PriceObservationSubmitPayloadSchema", () => {
  it("accepts the exact minimal submission payload", () => {
    expect(parsePriceObservationSubmitPayload(validPayload)).toEqual(validPayload);
  });

  it("rejects receipt, OCR, transaction, and submitter identity fields", () => {
    expect(() => parsePriceObservationSubmitPayload({
      ...validPayload,
      receipt_id: "receipt-local-only",
    })).toThrow();
    expect(() => parsePriceObservationSubmitPayload({
      ...validPayload,
      receipt_item_id: "receipt-item-local-only",
    })).toThrow();
    expect(() => parsePriceObservationSubmitPayload({
      ...validPayload,
      user_id: "33333333-3333-4333-8333-333333333333",
    })).toThrow();
  });

  it("requires exact product and store identity instead of a name fallback", () => {
    expect(() => parsePriceObservationSubmitPayload({
      ...validPayload,
      store_id: "store-name-only",
    })).toThrow();
    expect(() => parsePriceObservationSubmitPayload({
      ...validPayload,
      product_name: "name-only",
    })).toThrow();
    expect(() => parsePriceObservationSubmitPayload({
      ...validPayload,
      catalog_product_id: undefined,
    })).toThrow();
  });

  it("rejects invalid dates, negative prices, and blank idempotency keys", () => {
    expect(() => parsePriceObservationSubmitPayload({ ...validPayload, observed_on: "2026-02-30" })).toThrow();
    expect(() => parsePriceObservationSubmitPayload({ ...validPayload, unit_price_krw: -1 })).toThrow();
    expect(() => parsePriceObservationSubmitPayload({ ...validPayload, unit_price_krw: 2_147_483_648 })).toThrow();
    expect(() => parsePriceObservationSubmitPayload({ ...validPayload, idempotency_key: " " })).toThrow();
  });
});

describe("PriceObservationSubmitResponseSchema", () => {
  it("keeps replay and natural-deduplication outcomes explicit", () => {
    expect(PriceObservationSubmitResponseSchema.parse({
      observation_id: "44444444-4444-4444-8444-444444444444",
      replayed: false,
      applied_action: "deduplicated",
    }).applied_action).toBe("deduplicated");
  });
});
