import { describe, expect, it } from "vitest";
import { mapReceipt } from "./receipt";
import { createUniversalReceipt } from "./receipt.fixture";
import { estimateBasket, marketObservations, marketSummary, median } from "./market-analytics";

const receipt = (store: string, date: string, price: number) => mapReceipt(createUniversalReceipt(store, date, `${store}-${date}`, price));
describe("market analytics", () => { it("calculates median and a store basket estimate", () => { const receipts = [receipt("A", "2026-07-01", 1000), receipt("A", "2026-07-02", 1200), receipt("B", "2026-07-02", 900)]; const observations = marketObservations(receipts, "P1", "A"); expect(median([1000, 1200, 1100])).toBe(1100); expect(marketSummary(observations)).toMatchObject({ count: 2, latest: 1200, minimum: 1000, maximum: 1200, median: 1100 }); expect(estimateBasket(receipts, "B", [{ sourceProductCode: "P1", quantity: 2 }]).totalKrw).toBe(1800); }); });

it("excludes restaurant benefit lines while retaining regular siblings", () => {
  const source = createUniversalReceipt("식당", "2026-08-26", "BENEFIT-OBSERVATION", 1_000, "P1");
  source.merchant.business_kind = "food_service";
  source.line_items.push({
    ...source.line_items[0],
    id: "included-line",
    description: "포함 반찬",
    source_line_references: ["2"],
    identifiers: [{ scheme: "merchant_sku", value: "P1" }],
    unit_price_amount_minor: 0,
    gross_amount_minor: 0,
    net_amount_minor: 0,
    food_service: { role: "side", applies_to_line_id: null, benefit_kind: "included" },
  });
  source.line_items[0].food_service = { role: "main", applies_to_line_id: null, benefit_kind: null };
  const mapped = mapReceipt(source);

  expect(marketObservations([mapped], "P1")).toHaveLength(1);
  expect(marketObservations([mapped], "P1")[0].unitPriceKrw).toBe(1_000);
});
