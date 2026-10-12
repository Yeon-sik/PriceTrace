import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ProductObservationListing } from "../domain/product-browser";

const rowSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), receipt_item_id: z.string().nullable(),
  observed_at: z.string(), unit_price_krw: z.number().int().nonnegative(), quantity: z.number().int().positive(),
  catalog_product_id: z.string().uuid().nullable(), verification_status: z.literal("verified"),
  store_products: z.object({
    id: z.string().uuid(), user_id: z.string().uuid(), store_id: z.string().uuid(), store_product_code: z.string().nullable(),
    products: z.object({ id: z.string().uuid(), user_id: z.string().uuid(), name: z.string().min(1), purchase_type: z.string() }),
    stores: z.object({ id: z.string().uuid(), user_id: z.string().uuid(), name: z.string().min(1) }),
  }),
  receipt_items: z.object({ receipt_id: z.string().uuid(), total_price_krw: z.number().int() }).nullable(),
});

export function authenticatedProductListings(input: unknown, ownerId: string): ProductObservationListing[] {
  return z.array(rowSchema).parse(input).filter((row) => {
    const source = row.store_products;
    return row.user_id === ownerId && source.user_id === ownerId && source.products.user_id === ownerId
      && source.stores.user_id === ownerId && source.products.purchase_type === "retail_product";
  }).map((row) => ({
    id: row.id, storeProductId: row.store_products.id, catalogProductId: row.catalog_product_id,
    item: {
      id: row.receipt_item_id ?? row.id, receiptId: row.receipt_items?.receipt_id ?? row.id,
      sourceLineReferences: [], productName: row.store_products.products.name,
      sourceProductCode: row.store_products.store_product_code ?? "",
      unitPriceKrw: row.unit_price_krw, quantityValue: row.quantity,
      totalPriceKrw: row.receipt_items?.total_price_krw ?? row.unit_price_krw * row.quantity,
      confidence: "user_verified",
    },
    storeLabel: row.store_products.stores.name, sellerKey: `store:${row.store_products.store_id}`,
    catalogNamespace: null, observedAt: row.observed_at, martType: "regular", source: "receipt",
  }));
}

export class AuthenticatedProductObservationRepository {
  constructor(private readonly client: SupabaseClient) {}
  async load(): Promise<ProductObservationListing[]> {
    const { data: auth, error: authError } = await this.client.auth.getUser();
    if (authError || !auth.user) return [];
    const { data, error } = await this.client.from("price_observations")
      .select("id,user_id,receipt_item_id,observed_at,unit_price_krw,quantity,catalog_product_id,verification_status,store_products!inner(id,user_id,store_id,store_product_code,products!inner(id,user_id,name,purchase_type),stores!inner(id,user_id,name)),receipt_items(receipt_id,total_price_krw)")
      .eq("user_id", auth.user.id).eq("verification_status", "verified")
      .order("observed_at", { ascending: false }).limit(1000);
    if (error) throw new Error(error.message);
    return authenticatedProductListings(data ?? [], auth.user.id);
  }
}
