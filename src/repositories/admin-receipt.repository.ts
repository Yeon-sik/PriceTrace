import type { SupabaseClient } from "@supabase/supabase-js";
import type { Receipt } from "@/domain/types";

export type AdminReceiptItemRecord = {
  id: string;
  productName: string;
  sourceProductCode: string;
  quantity: number;
  unitPriceKrw: number;
  totalPriceKrw: number;
};

export type AdminReceiptRecord = {
  id: string;
  userId: string;
  source: "database" | "local";
  storeLabel: string;
  purchasedAt: string;
  transactionNumber: string;
  totalPriceKrw: number;
  items: AdminReceiptItemRecord[];
};

export function localReceiptsToAdminRecords(receipts: Receipt[]): AdminReceiptRecord[] {
  return receipts.map((receipt) => ({
    id: receipt.id,
    userId: "local-demo",
    source: "local",
    storeLabel: receipt.storeLabel,
    purchasedAt: receipt.purchasedAt,
    transactionNumber: receipt.transactionNumber,
    totalPriceKrw: receipt.totalPriceKrw,
    items: receipt.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sourceProductCode: item.sourceProductCode,
      quantity: item.quantityValue,
      unitPriceKrw: item.unitPriceKrw,
      totalPriceKrw: item.totalPriceKrw,
    })),
  }));
}

type StoreRow = { id: string; name: string };
type ProductRow = { id: string; name: string };
type StoreProductRow = { id: string; product_id: string; store_product_code: string };
type ReceiptRow = { id: string; user_id: string; store_id: string; purchased_at: string; transaction_number: string; total_price_krw: number };
type ReceiptItemRow = { id: string; receipt_id: string; store_product_id: string; purchased_quantity: number; unit_price_krw: number; total_price_krw: number };

export class AdminReceiptRepository {
  constructor(private readonly client: SupabaseClient) {}

  async loadAll(): Promise<AdminReceiptRecord[]> {
    const [storesResult, productsResult, storeProductsResult, receiptsResult, itemsResult] = await Promise.all([
      this.client.from("stores").select("id,name"),
      this.client.from("products").select("id,name"),
      this.client.from("store_products").select("id,product_id,store_product_code"),
      this.client.from("receipts").select("id,user_id,store_id,purchased_at,transaction_number,total_price_krw").order("purchased_at", { ascending: false }),
      this.client.from("receipt_items").select("id,receipt_id,store_product_id,purchased_quantity,unit_price_krw,total_price_krw"),
    ]);
    const error = storesResult.error ?? productsResult.error ?? storeProductsResult.error ?? receiptsResult.error ?? itemsResult.error;
    if (error) throw error;

    const stores = new Map(((storesResult.data ?? []) as StoreRow[]).map((row) => [row.id, row.name]));
    const products = new Map(((productsResult.data ?? []) as ProductRow[]).map((row) => [row.id, row.name]));
    const storeProducts = new Map(((storeProductsResult.data ?? []) as StoreProductRow[]).map((row) => [row.id, row]));
    const itemsByReceipt = new Map<string, AdminReceiptItemRecord[]>();
    for (const row of (itemsResult.data ?? []) as ReceiptItemRow[]) {
      const storeProduct = storeProducts.get(row.store_product_id);
      const item: AdminReceiptItemRecord = {
        id: row.id,
        productName: products.get(storeProduct?.product_id ?? "") ?? "상품 정보 없음",
        sourceProductCode: storeProduct?.store_product_code ?? "-",
        quantity: row.purchased_quantity,
        unitPriceKrw: row.unit_price_krw,
        totalPriceKrw: row.total_price_krw,
      };
      itemsByReceipt.set(row.receipt_id, [...(itemsByReceipt.get(row.receipt_id) ?? []), item]);
    }

    return ((receiptsResult.data ?? []) as ReceiptRow[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      source: "database",
      storeLabel: stores.get(row.store_id) ?? "판매처 정보 없음",
      purchasedAt: row.purchased_at,
      transactionNumber: row.transaction_number,
      totalPriceKrw: row.total_price_krw,
      items: itemsByReceipt.get(row.id) ?? [],
    }));
  }
}
