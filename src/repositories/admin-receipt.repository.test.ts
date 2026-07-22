import { describe, expect, it } from "vitest";
import type { Receipt } from "@/domain/types";
import { localReceiptsToAdminRecords } from "./admin-receipt.repository";

const receipt: Receipt = {
  id: "receipt-1",
  retailChannel: "regular",
  catalogNamespace: null,
  storeLabel: "테스트 마트",
  purchasedAt: "2026-07-22",
  transactionNumber: "TX-1",
  currency: "KRW",
  totalPriceKrw: 2_000,
  items: [{ id: "item-1", receiptId: "receipt-1", sourceLineReferences: ["1"], productName: "테스트 상품", sourceProductCode: "P-1", unitPriceKrw: 1_000, quantityValue: 2, totalPriceKrw: 2_000, confidence: "high" }],
};

describe("localReceiptsToAdminRecords", () => {
  it("preserves local receipt evidence and marks its source", () => {
    expect(localReceiptsToAdminRecords([receipt])).toEqual([{
      id: "receipt-1", userId: "local-demo", source: "local", storeLabel: "테스트 마트", purchasedAt: "2026-07-22", transactionNumber: "TX-1", totalPriceKrw: 2_000,
      items: [{ id: "item-1", productName: "테스트 상품", sourceProductCode: "P-1", quantity: 2, unitPriceKrw: 1_000, totalPriceKrw: 2_000 }],
    }]);
  });
});
