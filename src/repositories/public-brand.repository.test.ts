import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { v5Row } from "../domain/public-standard-catalog-v5.fixture";
import { mapBrandProducts, PublicBrandRepository } from "./public-brand.repository";
import { PublicStandardCatalogV5RowsSchema } from "../domain/public-standard-catalog-v5";

const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const brand = (index: number) => ({ brand_id: id(index), canonical_name: `브랜드 ${index}`, parent_brand_id: null,
  parent_canonical_name: null, matched_name: `별칭 ${index}`, match_kind: "alias", logo_url: null, official_site_url: null });
function fixture(fetcher: typeof fetch) {
  return new PublicBrandRepository(createClient("https://brands.example.invalid", "fixture-key", {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
}

describe("public brand repository", () => {
  it("loads every brand page and maps canonical identity independently from the matched alias", async () => {
    const rows = Array.from({ length: 205 }, (_, i) => brand(i));
    const offsets: number[] = [];
    const repository = fixture(vi.fn(async (_input, init) => {
      const args = JSON.parse(String(init?.body)); offsets.push(args.p_offset);
      return new Response(JSON.stringify(rows.slice(args.p_offset, args.p_offset + args.p_limit)));
    }));
    const result = await repository.search("별칭", new AbortController().signal);
    expect(offsets).toEqual([0, 200]);
    expect(result).toHaveLength(205);
    expect(result[0]).toMatchObject({ id: id(0), canonicalName: "브랜드 0", matchedName: "별칭 0", matchKind: "alias" });
  });
  it("fails closed for malformed rows and cancelled late responses", async () => {
    await expect(fixture(async () => new Response(JSON.stringify([{ ...brand(1), logo_url: "javascript:bad" }])))
      .search("", new AbortController().signal)).rejects.toThrow();
    const controller = new AbortController();
    const repository = fixture(async () => { controller.abort(); return new Response(JSON.stringify([brand(1)])); });
    await expect(repository.search("", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("reads v5 only for hierarchy-aware products and deduplicates seller mappings by exact ID", async () => {
    const requests: string[] = [];
    const repository = fixture(async (input) => {
      requests.push(String(input));
      return new Response(JSON.stringify([v5Row(), { ...v5Row(), source_product_code: "other-code" }]), {
        headers: { "content-range": "0-1/2" },
      });
    });
    const products = await repository.loadProducts(new AbortController().signal);
    expect(requests.every((url) => url.includes("get_public_exact_standard_product_catalog_v5"))).toBe(true);
    expect(products).toHaveLength(1);
    expect(products[0].brandId).toBe(v5Row().brand_id);
    expect(() => mapBrandProducts(PublicStandardCatalogV5RowsSchema.parse([v5Row(), { ...v5Row(), source_product_code: "other", brand_name: "conflict" }]))).toThrow("브랜드 정보");
  });
});
