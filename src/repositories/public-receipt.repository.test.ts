import { describe, expect, it } from "vitest";
import { PublicReceiptRepository } from "./public-receipt.repository";

describe("PublicReceiptRepository", () => {
  it("loads verified public receipts and receipt-linked observations", () => {
    const result = new PublicReceiptRepository().loadAll();
    const receiptIds = new Set(result.receipts.map((receipt) => receipt.id));

    expect(result.receipts.length).toBeGreaterThan(0);
    expect(result.observations.length).toBeGreaterThan(0);
    expect(result.receipts.every((receipt) => receipt.source === "public")).toBe(true);
    expect(result.receipts.every((receipt) => /^\d{4}-\d{2}-\d{2}_\d{3}$/.test(receipt.id))).toBe(true);
    expect(result.receipts.every((receipt) => receipt.publicReceiptFileName === `${receipt.id}.json`)).toBe(true);
    expect(result.receipts.every((receipt) => receipt.storeId && receipt.storeLabel)).toBe(true);
    expect(result.observations.every((observation) => receiptIds.has(observation.item.receiptId))).toBe(true);
  });
});
