import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductSpecification } from "../domain/canonical-price";
import {
  buildPublicStandardCatalogIndex,
  publicStandardMappingKey,
  PublicStandardCatalogRowsSchema,
  type PublicCoupangPrice,
  type PublicStandardCategory,
} from "../domain/public-standard-catalog";

// Keep each request within [api].max_rows in supabase/config.toml.
export const PRODUCT_CATALOG_PAGE_SIZE = 1000;

type PageError = { code?: string; message: string };
type PageResult<Row> = { data: Row[] | null; error: PageError | null; count?: number | null };

class CatalogPageError extends Error {
  constructor(readonly detail: PageError, readonly offset: number) {
    super(detail.message);
  }
}

export async function fetchCatalogPages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  keyOf: (row: Row) => string,
  signal: AbortSignal,
): Promise<Row[]> {
  const rowsByKey = new Map<string, Row>();
  let from = 0;
  let total: number | null = null;
  for (;;) {
    signal.throwIfAborted();
    const result = await fetchPage(from, from + PRODUCT_CATALOG_PAGE_SIZE - 1);
    signal.throwIfAborted();
    if (result.error) throw new CatalogPageError(result.error, from);
    if (!Array.isArray(result.data)) throw new Error("상품 카탈로그 페이지 형식이 올바르지 않습니다.");
    if (result.count != null) {
      if (!Number.isSafeInteger(result.count) || result.count < 0 || (total !== null && total !== result.count)) {
        throw new Error("상품 카탈로그가 조회 중 변경되었습니다. 다시 불러와 주세요.");
      }
      total = result.count;
    }

    const previousSize = rowsByKey.size;
    for (const row of result.data) {
      const key = keyOf(row);
      const existing = rowsByKey.get(key);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(row)) {
        throw new Error("같은 상품 identity의 카탈로그 정보가 조회 중 변경되었습니다.");
      }
      rowsByKey.set(key, row);
    }
    // Advance by the number actually returned, never by the number of unique rows.
    // An exact count also handles a target API cap lower than the requested page size.
    from += result.data.length;
    if (total !== null && from > total) throw new Error("상품 카탈로그 페이지 범위가 올바르지 않습니다.");
    if (result.data.length === 0) {
      if (total !== null && from < total) throw new Error("상품 카탈로그의 다음 페이지가 누락되었습니다.");
      return [...rowsByKey.values()];
    }
    if (total !== null ? from === total : result.data.length < PRODUCT_CATALOG_PAGE_SIZE) {
      if (total !== null && rowsByKey.size !== total) {
        throw new Error("상품 카탈로그 페이지가 겹쳐 일부 상품이 누락되었습니다. 다시 불러와 주세요.");
      }
      return [...rowsByKey.values()];
    }
    if (previousSize === rowsByKey.size) throw new Error("상품 카탈로그 페이지가 반복되었습니다.");
  }
}

export type ProductCatalogSnapshot = ReturnType<typeof buildPublicStandardCatalogIndex> & {
  standardImages: Map<string, string>;
};

export function emptyProductCatalog(): ProductCatalogSnapshot {
  return { ...buildPublicStandardCatalogIndex([]), standardImages: new Map() };
}

const publicRpcs = [
  "get_public_exact_standard_product_catalog_v4",
  "get_public_exact_standard_product_catalog_v3",
  "get_public_exact_standard_product_catalog_v2",
  "get_public_exact_standard_product_catalog",
  "get_public_standard_product_catalog",
] as const;

function isMissingRpc(error: unknown) {
  return error instanceof CatalogPageError && error.offset === 0 && (
    error.detail.code === "PGRST202" || error.detail.message.includes("Could not find the function")
  );
}

type PublicRowKey = { source_label?: string; source_product_code: string; catalog_product_id: string };

export class ProductCatalogRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async loadPublicRows(signal: AbortSignal, signedIn: boolean) {
    for (const rpc of publicRpcs) {
      try {
        const rows = await fetchCatalogPages<PublicRowKey>(
          (from, to) => {
            let query = this.client.rpc(rpc, {}, { count: "exact" });
            // The oldest RPC has no source_label column. All later versions do.
            if (rpc !== "get_public_standard_product_catalog") {
              query = query.order("source_label", { ascending: true });
            }
            return query
              .order("source_product_code", { ascending: true })
              .order("catalog_product_id", { ascending: true })
              .range(from, to)
              .abortSignal(signal);
          },
          (row) => JSON.stringify([row.source_label ?? null, row.source_product_code, row.catalog_product_id]),
          signal,
        );
        // Validate across page boundaries, including conflicting source mappings.
        return PublicStandardCatalogRowsSchema.parse(rows);
      } catch (error) {
        if (!isMissingRpc(error)) throw error;
        if (rpc === publicRpcs.at(-1) && !signedIn) throw error;
      }
    }
    // Preserve the pre-public-RPC signed-in table fallback; never use it for anon.
    return [];
  }

  async load(ownerId: string | null, signal: AbortSignal) {
    const [publicRows, images] = await Promise.all([
      this.loadPublicRows(signal, ownerId !== null),
      fetchCatalogPages<{ standard_product_id: string; image_url: string }>(
        (from, to) => this.client.from("standard_product_images")
          .select("standard_product_id,image_url", { count: "exact" })
          .order("standard_product_id", { ascending: true }).range(from, to).abortSignal(signal),
        (row) => row.standard_product_id,
        signal,
      ),
    ]);
    const publicCatalog: ProductCatalogSnapshot = {
      ...buildPublicStandardCatalogIndex(publicRows),
      standardImages: new Map(images.map((row) => [row.standard_product_id, row.image_url])),
    };
    if (ownerId === null) return { publicCatalog, catalog: publicCatalog };

    const [mappings, products, standards, categoryRows, prices] = await Promise.all([
      fetchCatalogPages<{ id: string; source_label: string; source_product_code: string; catalog_product_id: string }>(
        (from, to) => this.client.from("source_product_mappings")
          .select("id,source_label,source_product_code,catalog_product_id", { count: "exact" })
          .eq("review_status", "verified").order("id", { ascending: true }).range(from, to).abortSignal(signal),
        (row) => row.id, signal,
      ),
      fetchCatalogPages<{
        id: string; standard_product_id: string; content_amount: number | null; content_unit: string | null;
        package_count: number; reference_unit: number;
      }>(
        (from, to) => this.client.from("catalog_products")
          .select("id,standard_product_id,content_amount,content_unit,package_count,reference_unit", { count: "exact" })
          .eq("status", "active").eq("specification_status", "verified")
          .order("id", { ascending: true }).range(from, to).abortSignal(signal),
        (row) => row.id, signal,
      ),
      fetchCatalogPages<{ id: string; canonical_name: string; brand: string | null; category_id: string | null }>(
        (from, to) => this.client.from("standard_products")
          .select("id,canonical_name,brand,category_id", { count: "exact" })
          .eq("status", "active").order("id", { ascending: true }).range(from, to).abortSignal(signal),
        (row) => row.id, signal,
      ),
      fetchCatalogPages<{ id: string; slug: string; display_name: string }>(
        (from, to) => this.client.from("catalog_categories")
          .select("id,slug,display_name", { count: "exact" }).eq("purchase_type", "retail_product")
          .order("id", { ascending: true }).range(from, to).abortSignal(signal),
        (row) => row.id, signal,
      ),
      fetchCatalogPages<{
        id: string; standard_product_id: string; listed_price_krw: number; quantity: number;
        content_amount: number | null; content_unit: string | null; max_bundle_quantity: number | null;
        max_bundle_listed_price_krw: number | null; product_url: string; observed_at: string; created_at: string;
      }>(
        (from, to) => this.client.from("standard_product_coupang_prices")
          .select("id,standard_product_id,listed_price_krw,quantity,content_amount,content_unit,max_bundle_quantity,max_bundle_listed_price_krw,product_url,observed_at,created_at", { count: "exact" })
          .order("observed_at", { ascending: false }).order("created_at", { ascending: false })
          .order("id", { ascending: false }).range(from, to).abortSignal(signal),
        (row) => row.id, signal,
      ),
    ]);
    signal.throwIfAborted();
    const exactStandardMappings = new Map(publicCatalog.exactStandardMappings);
    for (const row of mappings) {
      exactStandardMappings.set(publicStandardMappingKey(row.source_label, row.source_product_code), row.catalog_product_id);
    }
    const catalogSpecs = new Map(publicCatalog.catalogSpecs);
    for (const row of products) {
      if (!row.content_amount || !row.content_unit) continue;
      catalogSpecs.set(row.id, {
        contentAmount: row.content_amount,
        contentUnit: row.content_unit as ProductSpecification["contentUnit"],
        packageCount: row.package_count,
        referenceUnit: row.reference_unit as 10 | 100 | 1000,
        standardProductId: row.standard_product_id,
      });
    }
    const standardNames = new Map(publicCatalog.standardNames);
    const standardBrands = new Map(publicCatalog.standardBrands);
    const standardCategories = new Map(publicCatalog.standardCategories);
    const categoryById = new Map(categoryRows.map((row) => [row.id, {
      id: row.id, slug: row.slug, name: row.display_name,
    } satisfies PublicStandardCategory]));
    for (const row of standards) {
      standardNames.set(row.id, row.canonical_name);
      if (row.brand?.trim()) standardBrands.set(row.id, row.brand);
      const category = row.category_id ? categoryById.get(row.category_id) : undefined;
      if (category) standardCategories.set(row.id, category);
    }
    const coupangByStandard = new Map(publicCatalog.coupangByStandard);
    for (const row of prices) {
      if (!row.standard_product_id) continue;
      const existing = coupangByStandard.get(row.standard_product_id);
      if (!existing || row.observed_at > existing.observedAt) {
        coupangByStandard.set(row.standard_product_id, {
          listedPriceKrw: row.listed_price_krw, quantity: row.quantity,
          maxBundleQuantity: row.max_bundle_quantity, maxBundleListedPriceKrw: row.max_bundle_listed_price_krw,
          contentAmount: row.content_amount, contentUnit: row.content_unit as ProductSpecification["contentUnit"] | null,
          productUrl: row.product_url, observedAt: row.observed_at,
        } satisfies PublicCoupangPrice);
      }
    }
    return {
      publicCatalog,
      catalog: { ...publicCatalog, exactStandardMappings, catalogSpecs, standardNames, standardBrands, standardCategories, coupangByStandard },
    };
  }
}
