import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapPublicBrand, PublicBrandRowSchema } from "../domain/brand-hierarchy";
import type { PublicStandardCatalogV5Row } from "../domain/public-standard-catalog-v5";
import { ProductCatalogRepository } from "./product-catalog.repository";

export type BrandProduct = {
  id: string; standardProductId: string; name: string; brandId: string | null;
  brandName: string | null; parentBrandId: string | null; parentBrandName: string | null;
  categoryName: string | null; contentAmount: number; contentUnit: string; packageCount: number;
};

export function mapBrandProducts(rows: PublicStandardCatalogV5Row[]): BrandProduct[] {
  // Several seller mappings may publish the same exact specification.
  const products = new Map<string, BrandProduct>();
  for (const row of rows) {
    const product = { id: row.catalog_product_id, standardProductId: row.standard_product_id,
      name: row.standard_name, brandId: row.brand_id, brandName: row.brand_name,
      parentBrandId: row.parent_brand_id, parentBrandName: row.parent_brand_name,
      categoryName: row.standard_category_name, contentAmount: row.content_amount,
      contentUnit: row.content_unit, packageCount: row.package_count };
    const previous = products.get(product.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(product)) {
      throw new Error("같은 판매 규격의 브랜드 정보가 조회 중 변경되었습니다.");
    }
    products.set(product.id, product);
  }
  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
}

export class PublicBrandRepository {
  constructor(private readonly client: SupabaseClient) {}

  async search(query: string, signal: AbortSignal) {
    const brands = [];
    const seen = new Set<string>();
    for (let offset = 0; offset <= 1000000;) {
      signal.throwIfAborted();
      const { data, error } = await this.client.rpc("get_public_brand_catalog_v1", {
        p_query: query || null, p_limit: 200, p_offset: offset,
      }).abortSignal(signal);
      signal.throwIfAborted();
      if (error) throw new Error("브랜드를 불러오지 못했습니다. 잠시 후 다시 시도하세요.");
      const rows = z.array(PublicBrandRowSchema).parse(data);
      for (const row of rows) {
        if (seen.has(row.brand_id)) throw new Error("브랜드 목록이 조회 중 변경되었습니다. 다시 불러오세요.");
        seen.add(row.brand_id);
        brands.push(mapPublicBrand(row));
      }
      if (rows.length < 200) return brands;
      offset += rows.length;
    }
    throw new Error("브랜드 목록이 조회 범위를 초과했습니다. 검색어를 입력하세요.");
  }

  async loadProducts(signal: AbortSignal) {
    return mapBrandProducts(await new ProductCatalogRepository(this.client).loadHierarchyRows(signal));
  }
}
