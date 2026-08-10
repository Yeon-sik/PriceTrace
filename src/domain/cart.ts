import type { PublicOfficialChannelListing } from "./public-official-channel-catalog";
import type { ProductCategory, ProductGroup } from "./product-browser";

export type CartProduct = {
  id: string;
  productName: string;
  sourceProductCode: string;
  storeLabel: string;
  category: ProductCategory;
  priceKrw: number;
  priceObservedAt: string;
  priceSource: "receipt-observation" | "official-channel";
  imageUrl?: string;
};

export type CartSummary = {
  items: CartProduct[];
  quantities: Record<string, number>;
  totalKrw: number;
  totalQuantity: number;
};

export function normalizeCartQuantity(quantity: number): number | null {
  if (!Number.isFinite(quantity)) return null;
  const normalized = Math.trunc(quantity);
  return normalized > 0 ? normalized : null;
}

export function summarizeCart(
  products: readonly CartProduct[],
  lines: Readonly<Record<string, number>>,
): CartSummary {
  const quantities: Record<string, number> = {};
  const items = products.filter((product) => {
    const quantity = normalizeCartQuantity(lines[product.id]);
    if (quantity === null) return false;
    quantities[product.id] = quantity;
    return true;
  });
  return {
    items,
    quantities,
    totalKrw: items.reduce((sum, product) => sum + product.priceKrw * quantities[product.id], 0),
    totalQuantity: items.reduce((sum, product) => sum + quantities[product.id], 0),
  };
}

export function cartProductFromGroup(group: ProductGroup): CartProduct {
  return {
    id: group.id,
    productName: group.productName,
    sourceProductCode: group.sourceProductCode,
    storeLabel: group.storeLabel,
    category: group.category,
    priceKrw: group.latestPriceKrw,
    priceObservedAt: group.latest.observedAt,
    priceSource: "receipt-observation",
    imageUrl: group.officialProduct?.imageUrl,
  };
}

export function cartProductFromOfficialListing(listing: PublicOfficialChannelListing): CartProduct {
  return {
    id: `official:${listing.id}`,
    productName: listing.sourceNameRaw,
    sourceProductCode: listing.sourceProductCode,
    storeLabel: "PX 공식 판매채널",
    category: listing.category,
    priceKrw: listing.officialPrice.amountKrw,
    priceObservedAt: listing.officialPrice.observedAt,
    priceSource: "official-channel",
    imageUrl: listing.image?.url,
  };
}
