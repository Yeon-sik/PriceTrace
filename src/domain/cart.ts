import type { PublicOfficialChannelListing } from "./public-official-channel-catalog";
import { mergeOfficialProductGroups, type ProductCategory, type ProductGroup } from "./product-browser";

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

// No cross-line money total: lines can come from different sellers and observation dates,
// so their sum is not a price anyone could pay at one place.
export type CartSummary = {
  items: CartProduct[];
  quantities: Record<string, number>;
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
    totalQuantity: items.reduce((sum, product) => sum + quantities[product.id], 0),
  };
}

export function cartProductFromGroup(group: ProductGroup): CartProduct {
  // A merged display group lists several sellers; the line price belongs to the latest observation's seller only.
  return {
    id: group.id,
    productName: group.productName,
    sourceProductCode: group.sourceProductCode,
    storeLabel: group.latest.storeLabel,
    category: group.category,
    priceKrw: group.latestPriceKrw,
    priceObservedAt: group.latest.observedAt,
    priceSource: "receipt-observation",
    imageUrl: group.officialProduct?.imageUrl,
  };
}

/**
 * Every receipt-observation line the product browser can add, including the merged display
 * groups it shows. Without the merged ids a stored cart line would be silently dropped.
 */
export function cartProductsFromGroups(groups: readonly ProductGroup[]): CartProduct[] {
  const byId = new Map<string, CartProduct>();
  for (const group of [...groups, ...mergeOfficialProductGroups([...groups])]) {
    if (!byId.has(group.id)) byId.set(group.id, cartProductFromGroup(group));
  }
  return [...byId.values()];
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
