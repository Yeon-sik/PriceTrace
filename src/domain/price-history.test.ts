import { describe, expect, it } from "vitest";
import { mapReceipt } from "./receipt";
import { createUniversalReceipt } from "./receipt.fixture";
import { observationsForProduct, priceSummary, productsFromReceipts } from "./price-history";

const receipt = (date: string, price: number) => mapReceipt(createUniversalReceipt("매장", date, date, price));
describe("price history", () => { it("summarizes product observations newest first", () => { const receipts = [receipt("2026-07-14", 1000), receipt("2026-07-15", 1200)]; const observations = observationsForProduct(receipts, "P1"); expect(productsFromReceipts(receipts)).toHaveLength(1); expect(priceSummary(observations)).toMatchObject({ count: 2, latest: 1200, previous: 1000, changeKrw: 200, minimum: 1000, maximum: 1200 }); }); });

it("does not expose benefit lines as product history", () => {
  const source = createUniversalReceipt("식당", "2026-08-26", "BENEFIT-HISTORY", 1_000, "P1");
  source.merchant.business_kind = "food_service";
  source.line_items[0].food_service = { role: "main", applies_to_line_id: null, benefit_kind: null };
  source.line_items.push({
    ...source.line_items[0],
    id: "included-line",
    description: "포함 반찬",
    source_line_references: ["2"],
    unit_price_amount_minor: 0,
    gross_amount_minor: 0,
    net_amount_minor: 0,
    food_service: { role: "side", applies_to_line_id: null, benefit_kind: "included" },
  });
  const mapped = mapReceipt(source);

  expect(productsFromReceipts([mapped])).toHaveLength(1);
  expect(observationsForProduct([mapped], "P1")).toHaveLength(1);
});
