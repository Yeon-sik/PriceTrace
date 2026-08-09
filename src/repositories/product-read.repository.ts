import type { SupabaseClient } from "@supabase/supabase-js";
import { ProductReadV1Schema, type ProductReadProduct, type ProductReadV1 } from "../domain/product-read";

function rpcErrorMessage(error: { message?: string } | null) {
  return error?.message?.trim() || "PriceTrace product-read.v1 RPC를 불러오지 못했습니다.";
}

export class ProductReadRepository {
  constructor(private readonly client: SupabaseClient) {}

  async read({
    catalogProductId = null,
    query = null,
    limit = 50,
  }: {
    catalogProductId?: string | null;
    query?: string | null;
    limit?: number;
  } = {}): Promise<ProductReadV1> {
    const { data, error } = await this.client.rpc("get_product_read_v1", {
      p_catalog_product_id: catalogProductId,
      p_query: query?.trim() || null,
      p_limit: Math.max(1, Math.min(Math.trunc(limit), 100)),
    });
    if (error) throw new Error(rpcErrorMessage(error));
    return ProductReadV1Schema.parse(data);
  }

  async readExactProduct(catalogProductId: string): Promise<ProductReadProduct | null> {
    const payload = await this.read({ catalogProductId, limit: 1 });
    const product = payload.products[0] ?? null;
    if (product && product.catalogProduct.id !== catalogProductId) {
      throw new Error("product-read.v1 RPC가 요청하지 않은 정확 규격을 반환했습니다.");
    }
    return product;
  }
}
