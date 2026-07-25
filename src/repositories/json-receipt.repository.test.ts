import { describe, expect, it } from "vitest";
import { JsonReceiptRepository } from "./json-receipt.repository";

describe("JsonReceiptRepository", () => {
  it("loads every registered public demo receipt", () => {
    const receipts = new JsonReceiptRepository().loadAll();
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.retailChannel)).toEqual(["px", "unknown"]);
    expect(receipts[1]).toMatchObject({ storeLabel: "국군복지단 바다마을마트", catalogNamespace: null, totalPriceKrw: 381140 });
    expect(receipts[1].items).toHaveLength(64);
  });
});
