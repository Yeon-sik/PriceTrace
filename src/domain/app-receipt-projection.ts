import { mapReceipt, ReceiptJsonSchema } from "./receipt";
import type { Receipt } from "./types";

/**
 * Creates the minimum receipt projection required by the product and market UI.
 * Private source metadata never crosses this boundary.
 */
export function createAppReceiptProjection(input: unknown, opaqueReceiptId: string, storeLabel?: string): Receipt {
  const source = ReceiptJsonSchema.parse(input);
  const mapped = mapReceipt(source);
  const receiptId = `private:${opaqueReceiptId}`;
  const purchasedOn = source.document.issued_on ?? mapped.purchasedAt.slice(0, 10);

  return {
    id: receiptId,
    storeLabel: storeLabel ?? mapped.storeLabel,
    storeAddress: null,
    storePhone: null,
    retailChannel: mapped.retailChannel,
    catalogNamespace: mapped.catalogNamespace,
    purchasedAt: purchasedOn,
    transactionNumber: "",
    currency: "KRW",
    totalPriceKrw: mapped.totalPriceKrw,
    items: mapped.items.map((item, index) => {
      const projectionLineId = `item-${String(index + 1).padStart(3, "0")}`;
      return {
        ...item,
        id: `${receiptId}:${projectionLineId}`,
        receiptId,
        sourceLineReferences: [projectionLineId],
      };
    }),
  };
}
