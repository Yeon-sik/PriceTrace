import { describe, expect, it } from "vitest";
import { cartProductFromGroup, cartProductFromOfficialListing, normalizeCartQuantity, summarizeCart } from "./cart";
import type { PublicOfficialChannelListing } from "./public-official-channel-catalog";
import { groupProductObservations, type ProductObservationListing } from "./product-browser";
import type { ReceiptItem } from "./types";

function officialListing(): PublicOfficialChannelListing {
  return {
    id: "korean-military-px:official:100",
    sourceProductCode: "100",
    sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
    sourceNameRaw: "공식 채널 상품",
    vendorNameRaw: "상품 업체",
    specificationTextRaw: "100g",
    category: "식품",
    categoryAssignment: { method: "curated_rule", basis: "test" },
    officialPrice: {
      amountKrw: 1_200,
      sourceText: "1,200원",
      observedAt: "2026-08-05T00:00:00.000Z",
    },
    publication: { status: "listed", locationScope: "channel_unspecified" },
    image: null,
    standardProductLink: { status: "unlinked", standardProductId: null },
    sourceRefs: ["source:100"],
  };
}

function standardProductGroup() {
  const item: ReceiptItem = {
    id: "receipt-1:line-1",
    receiptId: "receipt-1",
    sourceLineReferences: ["line-1"],
    productName: "test product",
    sourceProductCode: "product-1",
    unitPriceKrw: 1_500,
    quantityValue: 1,
    totalPriceKrw: 1_500,
    confidence: "high",
  };
  const listing: ProductObservationListing = {
    id: item.id,
    item,
    storeLabel: "test store",
    catalogNamespace: null,
    observedAt: "2026-08-05T00:00:00.000Z",
    martType: "regular",
  };
  const group = groupProductObservations([listing])[0];
  if (!group) throw new Error("test group was not created");
  return group;
}

describe("cart products", () => {
  it("converts a standard product card's concrete observation into a receipt-sourced cart product", () => {
    const group = standardProductGroup();

    expect(cartProductFromGroup(group)).toMatchObject({
      id: group.id,
      productName: group.productName,
      sourceProductCode: group.sourceProductCode,
      storeLabel: group.storeLabel,
      category: group.category,
      priceKrw: group.latestPriceKrw,
      priceObservedAt: group.latest.observedAt,
      priceSource: "receipt-observation",
    });
  });

  it("converts an official listing without treating it as a receipt observation", () => {
    expect(cartProductFromOfficialListing(officialListing())).toMatchObject({
      id: "official:korean-military-px:official:100",
      productName: "공식 채널 상품",
      storeLabel: "PX 공식 판매채널",
      category: "식품",
      priceKrw: 1_200,
      priceObservedAt: "2026-08-05T00:00:00.000Z",
      priceSource: "official-channel",
    });
  });

  it("summarizes only positive integer cart lines from one shared selector", () => {
    const receiptProduct = cartProductFromGroup(standardProductGroup());
    const officialProduct = cartProductFromOfficialListing(officialListing());

    expect(summarizeCart([receiptProduct, officialProduct], {
      [receiptProduct.id]: 2,
      [officialProduct.id]: 3,
      ignored: -1,
    })).toEqual({
      items: [receiptProduct, officialProduct],
      quantities: {
        [receiptProduct.id]: 2,
        [officialProduct.id]: 3,
      },
      totalKrw: 6_600,
      totalQuantity: 5,
    });

    expect(summarizeCart([receiptProduct], { [receiptProduct.id]: 1.5 })).toEqual({
      items: [receiptProduct],
      quantities: { [receiptProduct.id]: 1 },
      totalKrw: 1_500,
      totalQuantity: 1,
    });
  });

  it("normalizes positive fractional input without persisting invalid cart quantities", () => {
    expect(normalizeCartQuantity(1.5)).toBe(1);
    expect(normalizeCartQuantity(0)).toBeNull();
    expect(normalizeCartQuantity(Number.NaN)).toBeNull();
  });
});
