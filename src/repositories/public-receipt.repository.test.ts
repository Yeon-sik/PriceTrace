import { describe, expect, it } from "vitest";
import { distinctSellerCount } from "../domain/product-browser";
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

    const samePhysicalSeller = result.observations.filter(
      (observation) =>
        observation.storeLabel === "국군복지단 바다마을마트"
        && observation.item.sourceProductCode === "250277",
    );
    expect(samePhysicalSeller.length).toBeGreaterThan(1);
    expect(new Set(samePhysicalSeller.map((observation) => observation.sellerKey))).toEqual(new Set(["merchant:3490700"]));
    expect(distinctSellerCount(samePhysicalSeller)).toBe(1);
  });
});
