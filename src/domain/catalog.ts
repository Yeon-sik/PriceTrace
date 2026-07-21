export const PURCHASE_TYPES = ["retail_product", "menu_item", "raw_material", "property", "service"] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];

export interface CatalogCategory {
  id: string;
  purchaseType: PurchaseType;
  parentId: string | null;
  slug: string;
  displayName: string;
  depth: number;
}
