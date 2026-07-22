import { describe, expect, it } from "vitest";
import { mapReceipt } from "./receipt";
import { createUniversalReceipt } from "./receipt.fixture";
import { estimateBasket, marketObservations, marketSummary, median } from "./market-analytics";

const receipt = (store: string, date: string, price: number) => mapReceipt(createUniversalReceipt(store, date, `${store}-${date}`, price));
describe("market analytics", () => { it("calculates median and a store basket estimate", () => { const receipts = [receipt("A", "2026-07-01", 1000), receipt("A", "2026-07-02", 1200), receipt("B", "2026-07-02", 900)]; const observations = marketObservations(receipts, "P1", "A"); expect(median([1000, 1200, 1100])).toBe(1100); expect(marketSummary(observations)).toMatchObject({ count: 2, latest: 1200, minimum: 1000, maximum: 1200, median: 1100 }); expect(estimateBasket(receipts, "B", [{ sourceProductCode: "P1", quantity: 2 }]).totalKrw).toBe(1800); }); });
