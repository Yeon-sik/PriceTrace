import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ProductObservationListing } from "@/domain/product-browser";
const rowsSchema = z.array(z.object({ observation_id: z.string().uuid(), catalog_product_id: z.string().uuid(), product_name: z.string(),
  store_id: z.string().uuid(), store_name: z.string(), location_label: z.string().nullable(), observed_on: z.string(), unit_price_krw: z.number().int().nonnegative() }));
export function publicPriceListings(input: unknown): ProductObservationListing[] {
  return [...new Map(rowsSchema.parse(input).map(row => [row.observation_id, row])).values()].map(row => ({
    id: `public-price:${row.observation_id}`, catalogProductId: row.catalog_product_id,
    item: { id: `public-price:${row.observation_id}`, receiptId: `public-price:${row.observation_id}`, sourceLineReferences: [],
      productName: row.product_name, sourceProductCode: row.catalog_product_id, unitPriceKrw: row.unit_price_krw,
      quantityValue: 1, totalPriceKrw: row.unit_price_krw, confidence: "user_verified" },
    storeLabel: row.location_label ? `${row.store_name} · ${row.location_label}` : row.store_name,
    sellerKey: `public-store:${row.store_id}`, catalogNamespace: "public-price", observedAt: row.observed_on, martType: "regular", source: "public",
  }));
}
export class PublicPriceObservationRepository {
  constructor(private readonly client: SupabaseClient) {}
  async load(): Promise<ProductObservationListing[]> {
    const all = new Map<string, ProductObservationListing>();
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await this.client.rpc("get_information_public_prices_v1", { p_offset: offset, p_limit: 500 });
      if (error) throw new Error("공개 가격 관측을 불러오지 못했습니다.");
      const page = publicPriceListings(data); const before = all.size;
      page.forEach(row => all.set(row.id, row));
      if (page.length < 500) return [...all.values()];
      if (before === all.size) throw new Error("공개 가격 목록의 다음 페이지를 확인하지 못했습니다.");
    }
  }
}
