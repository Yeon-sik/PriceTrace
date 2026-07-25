import { describe, expect, it } from "vitest";
import { JsonReceiptRepository } from "./json-receipt.repository";

describe("JsonReceiptRepository", () => {
  it("loads only the synthetic settlement demo receipt", () => {
    const receipts = new JsonReceiptRepository().loadAll();
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      retailChannel: "px",
      storeAddress: null,
      storePhone: null,
    });
  });
});
