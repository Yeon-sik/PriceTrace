import { describe, expect, it } from "vitest";
import { JsonReceiptRepository } from "./json-receipt.repository";

describe("JsonReceiptRepository", () => {
  it("loads every registered public demo receipt", () => {
    const receipts = new JsonReceiptRepository().loadAll();
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.retailChannel)).toEqual(["px", "px"]);
    expect(receipts[1]).toMatchObject({ storeLabel: "PX 데모마트 B점", catalogNamespace: "korean-military-px", totalPriceKrw: 5840 });
    expect(receipts[1].items).toHaveLength(2);
  });
});
