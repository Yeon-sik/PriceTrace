import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { fetchCatalogPages, PRODUCT_CATALOG_PAGE_SIZE, ProductCatalogRepository } from "./product-catalog.repository";

const signal = () => new AbortController().signal;
const id = (index: number, prefix = 10000000) => `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;

function publicRow(index: number) {
  return {
    source_label: "판매처", source_product_code: `code-${String(index).padStart(6, "0")}`,
    catalog_product_id: id(index), standard_product_id: id(index, 20000000), standard_name: "동명 상품",
    content_amount: 100, content_unit: "g", package_count: 1, reference_unit: 100,
    coupang_listed_price_krw: null, coupang_quantity: null, coupang_content_amount: null,
    coupang_content_unit: null, coupang_product_url: null, coupang_observed_at: null,
  };
}

type TestRow = Record<string, unknown>;
function fixture({ rows = [] as TestRow[], tables = {} as Record<string, TestRow[]>, missing = [] as string[], cap = PRODUCT_CATALOG_PAGE_SIZE } = {}) {
  const requests: URL[] = [];
  let fail: ((url: URL) => boolean) | null = null;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.push(url);
    expect(request.headers.get("prefer")).toContain("count=exact");
    const resource = url.pathname.split("/").at(-1)!;
    if (missing.includes(resource)) return new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function" }), { status: 404 });
    if (fail?.(url)) return new Response(JSON.stringify({ code: "offline", message: "middle page failed" }), { status: 503 });
    const data = [...(resource.startsWith("get_public_") ? rows : (tables[resource] ?? []))];
    const order = (url.searchParams.get("order") ?? "").split(",").map((term) => term.split("."));
    data.sort((left, right) => {
      for (const [column, direction] of order) {
        const a = String(left[column] ?? "");
        const b = String(right[column] ?? "");
        if (a !== b) return (a < b ? -1 : 1) * (direction === "desc" ? -1 : 1);
      }
      return 0;
    });
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(PRODUCT_CATALOG_PAGE_SIZE);
    const page = data.slice(offset, offset + Math.min(cap, limit));
    return new Response(JSON.stringify(page), { headers: {
      "content-type": "application/json", "content-range": page.length ? `${offset}-${offset + page.length - 1}/${data.length}` : `*/${data.length}`,
    } });
  });
  const client = createClient("https://catalog.example.invalid", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher },
  });
  return { repository: new ProductCatalogRepository(client), requests, setFailure(predicate: typeof fail) { fail = predicate; } };
}

describe("catalog pagination", () => {
  it("stays within the project's configured API row cap", () => {
    const config = readFileSync("supabase/config.toml", "utf8");
    const maximum = Number(config.match(/^max_rows\s*=\s*(\d+)/m)?.[1]);
    expect(PRODUCT_CATALOG_PAGE_SIZE).toBeLessThanOrEqual(maximum);
  });

  it.each([0, PRODUCT_CATALOG_PAGE_SIZE - 1, PRODUCT_CATALOG_PAGE_SIZE + 5, PRODUCT_CATALOG_PAGE_SIZE * 2])(
    "fetches %i rows, including an empty terminal page for exact multiples without a count",
    async (count) => {
      const rows = Array.from({ length: count }, (_, index) => ({ id: String(index) }));
      const fetchPage = vi.fn((from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }));
      expect(await fetchCatalogPages(fetchPage, (row) => row.id, signal())).toEqual(rows);
      expect(fetchPage).toHaveBeenCalledTimes(Math.floor(count / PRODUCT_CATALOG_PAGE_SIZE) + 1);
      if (count % PRODUCT_CATALOG_PAGE_SIZE === 0) {
        expect(fetchPage).toHaveBeenLastCalledWith(count, count + PRODUCT_CATALOG_PAGE_SIZE - 1);
      }
    },
  );

  it("uses the exact count and actual response size when the target cap is lower", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => ({ id: String(index) }));
    const fetchPage = vi.fn((from: number) => Promise.resolve({ data: rows.slice(from, from + 100), error: null, count: rows.length }));
    expect(await fetchCatalogPages(fetchPage, (row) => row.id, signal())).toEqual(rows);
    expect(fetchPage.mock.calls.map(([from]) => from)).toEqual([0, 100, 200]);
  });

  it("deduplicates identical identities without moving the raw page boundary", async () => {
    const first = Array.from({ length: PRODUCT_CATALOG_PAGE_SIZE }, (_, index) => ({ id: String(index) }));
    const fetchPage = vi.fn((from: number) => Promise.resolve({ data: from === 0 ? first : [first.at(-1)!, { id: "new" }], error: null }));
    expect(await fetchCatalogPages(fetchPage, (row) => row.id, signal())).toEqual([...first, { id: "new" }]);
    expect(fetchPage).toHaveBeenLastCalledWith(PRODUCT_CATALOG_PAGE_SIZE, PRODUCT_CATALOG_PAGE_SIZE * 2 - 1);
  });

  it("rejects conflicting duplicate identities and repeated nonterminal pages", async () => {
    await expect(fetchCatalogPages(() => Promise.resolve({ data: [{ id: "1", name: "a" }, { id: "1", name: "b" }], error: null }), (row) => row.id, signal())).rejects.toThrow("같은 상품 identity");
    const page = Array.from({ length: PRODUCT_CATALOG_PAGE_SIZE }, (_, index) => ({ id: String(index) }));
    await expect(fetchCatalogPages(() => Promise.resolve({ data: page, error: null }), (row) => row.id, signal())).rejects.toThrow("반복");
    await expect(fetchCatalogPages(() => Promise.resolve({ data: page, error: null, count: page.length * 2 }), (row) => row.id, signal())).rejects.toThrow("누락");
  });

  it("rejects an empty page before the counted end and count changes", async () => {
    await expect(fetchCatalogPages(() => Promise.resolve({ data: [], error: null, count: 1 }), (row: { id: string }) => row.id, signal())).rejects.toThrow("누락");
    let page = 0;
    await expect(fetchCatalogPages(() => Promise.resolve({ data: [{ id: String(page++) }], error: null, count: page === 1 ? 3 : 4 }), (row) => row.id, signal())).rejects.toThrow("변경");
  });

  it("rejects a cancelled response even if the transport ignores abort", async () => {
    const controller = new AbortController();
    let finish!: (value: { data: { id: string }[]; error: null }) => void;
    const fetchPage = vi.fn(() => new Promise<{ data: { id: string }[]; error: null }>((resolve) => { finish = resolve; }));
    const pending = fetchCatalogPages(fetchPage, (row) => row.id, controller.signal);
    controller.abort();
    finish({ data: [{ id: "stale" }], error: null });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchPage).toHaveBeenCalledOnce();
  });
});

describe("ProductCatalogRepository", () => {
  it("loads the entire public RPC and images with deterministic identity ordering", async () => {
    const rows = Array.from({ length: PRODUCT_CATALOG_PAGE_SIZE + 3 }, (_, index) => publicRow(index));
    const images = rows.map((row) => ({ standard_product_id: row.standard_product_id, image_url: `https://images.example.invalid/${row.standard_product_id}` }));
    const { repository, requests } = fixture({ rows, tables: { standard_product_images: images } });
    const result = await repository.load(null, signal());
    expect(result.catalog.exactStandardMappings.size).toBe(rows.length);
    expect(result.catalog.standardImages.size).toBe(rows.length);
    expect(result.catalog).toBe(result.publicCatalog);
    const publicRequests = requests.filter((url) => url.pathname.includes("/rpc/"));
    expect(publicRequests.map((url) => Number(url.searchParams.get("offset")))).toEqual([0, PRODUCT_CATALOG_PAGE_SIZE]);
    expect(publicRequests.every((url) => url.searchParams.get("order") === "source_label.asc,source_product_code.asc,catalog_product_id.asc")).toBe(true);
    expect(requests.every((url) => url.pathname.includes("/rpc/") || url.pathname.endsWith("/standard_product_images"))).toBe(true);
    expect(requests.filter((url) => url.pathname.endsWith("/standard_product_images")).every((url) => url.searchParams.get("order") === "standard_product_id.asc")).toBe(true);
  });

  it("paginates all signed-in tables and keeps newest prices under timestamp ties", async () => {
    const count = PRODUCT_CATALOG_PAGE_SIZE + 1;
    const indexes = Array.from({ length: count }, (_, index) => index);
    const tables = {
      source_product_mappings: indexes.map((i) => ({ id: id(i), source_label: "판매처", source_product_code: String(i), catalog_product_id: id(i) })),
      catalog_products: indexes.map((i) => ({ id: id(i), standard_product_id: id(i, 20000000), content_amount: 100, content_unit: "g", package_count: 1, reference_unit: 100 })),
      standard_products: indexes.map((i) => ({ id: id(i, 20000000), canonical_name: "동명 상품", brand: "brand", category_id: id(i, 30000000) })),
      catalog_categories: indexes.map((i) => ({ id: id(i, 30000000), slug: String(i), display_name: "카테고리" })),
      standard_product_coupang_prices: indexes.map((i) => ({ id: id(i), standard_product_id: id(i, 20000000), listed_price_krw: i,
        quantity: 1, content_amount: 100, content_unit: "g", max_bundle_quantity: null, max_bundle_listed_price_krw: null,
        product_url: "https://prices.example.invalid/1", observed_at: "2026-10-01T00:00:00Z", created_at: "2026-10-02T00:00:00Z" })),
    };
    tables.standard_product_coupang_prices.push({ ...tables.standard_product_coupang_prices[0], id: id(99999), listed_price_krw: 999 });
    const { repository, requests } = fixture({ tables });
    const { catalog, publicCatalog } = await repository.load("owner", signal());
    expect(catalog.exactStandardMappings.size).toBe(count);
    expect(catalog.catalogSpecs.size).toBe(count);
    expect(catalog.standardNames.size).toBe(count);
    expect(catalog.standardCategories.size).toBe(count);
    expect(catalog.coupangByStandard.size).toBe(count);
    expect(catalog.coupangByStandard.get(id(0, 20000000))?.listedPriceKrw).toBe(999);
    expect(publicCatalog.standardNames.size).toBe(0);
    for (const table of Object.keys(tables)) {
      const calls = requests.filter((url) => url.pathname.endsWith(`/${table}`));
      expect(calls.map((url) => Number(url.searchParams.get("offset")))).toEqual([0, PRODUCT_CATALOG_PAGE_SIZE]);
      expect(calls.every((url) => url.searchParams.get("order") === (table.endsWith("prices") ? "observed_at.desc,created_at.desc,id.desc" : "id.asc"))).toBe(true);
    }
    const mappingQuery = requests.find((url) => url.pathname.endsWith("/source_product_mappings"))!;
    expect(mappingQuery.searchParams.get("review_status")).toBe("eq.verified");
    const productQuery = requests.find((url) => url.pathname.endsWith("/catalog_products"))!;
    expect(productQuery.searchParams.get("specification_status")).toBe("eq.verified");
    expect(productQuery.searchParams.get("status")).toBe("eq.active");
  });

  it("restarts after a middle-page failure and never returns the partial result or a legacy fallback", async () => {
    const rows = Array.from({ length: PRODUCT_CATALOG_PAGE_SIZE + 2 }, (_, index) => publicRow(index));
    const f = fixture({ rows });
    f.setFailure((url) => url.pathname.includes("/rpc/") && Number(url.searchParams.get("offset")) > 0);
    await expect(f.repository.load(null, signal())).rejects.toThrow("middle page failed");
    expect(f.requests.filter((url) => url.pathname.includes("/rpc/")).every((url) => url.pathname.endsWith("_v4"))).toBe(true);
    f.setFailure(null);
    const result = await f.repository.load(null, signal());
    expect(result.catalog.exactStandardMappings.size).toBe(rows.length);
    expect(f.requests.filter((url) => url.pathname.includes("/rpc/")).map((url) => Number(url.searchParams.get("offset")))).toEqual([0, PRODUCT_CATALOG_PAGE_SIZE, 0, PRODUCT_CATALOG_PAGE_SIZE]);
  });

  it("rejects a source identity conflict across pages instead of merging sellers by name or code", async () => {
    const rows = Array.from({ length: PRODUCT_CATALOG_PAGE_SIZE }, (_, index) => publicRow(index));
    rows.push({ ...rows[0], catalog_product_id: id(99999) });
    await expect(fixture({ rows, cap: 1 }).repository.load(null, signal())).rejects.toThrow();
    const { catalog } = await fixture({ rows: [publicRow(0), { ...publicRow(0), source_label: "다른 판매처", catalog_product_id: id(99999) }] }).repository.load(null, signal());
    expect(catalog.exactStandardMappings.size).toBe(2);
  });

  it("keeps the pre-RPC table fallback authenticated and propagates missing public RPCs for anon", async () => {
    const missing = ["get_public_exact_standard_product_catalog_v4", "get_public_exact_standard_product_catalog_v3", "get_public_exact_standard_product_catalog_v2", "get_public_exact_standard_product_catalog", "get_public_standard_product_catalog"];
    const tables = { standard_products: [{ id: id(1), canonical_name: "기존 상품", brand: null, category_id: null }] };
    const f = fixture({ missing, tables });
    await expect(f.repository.load(null, signal())).rejects.toThrow("Could not find the function");
    expect(f.requests.some((url) => url.pathname.endsWith("/standard_products"))).toBe(false);
    const { catalog, publicCatalog } = await f.repository.load("owner", signal());
    expect(catalog.standardNames.get(id(1))).toBe("기존 상품");
    expect(publicCatalog.standardNames.size).toBe(0);
  });

  it.each(["get_public_exact_standard_product_catalog_v3", "get_public_exact_standard_product_catalog_v2", "get_public_exact_standard_product_catalog", "get_public_standard_product_catalog"])(
    "keeps the paginated %s fallback readable", async (selectedRpc) => {
      const versions = ["get_public_exact_standard_product_catalog_v4", "get_public_exact_standard_product_catalog_v3", "get_public_exact_standard_product_catalog_v2", "get_public_exact_standard_product_catalog", "get_public_standard_product_catalog"];
      const rows: TestRow[] = Array.from({ length: PRODUCT_CATALOG_PAGE_SIZE + 1 }, (_, index) => publicRow(index));
      if (selectedRpc === versions.at(-1)) rows.forEach((row) => { delete row.source_label; });
      const f = fixture({ rows, missing: versions.slice(0, versions.indexOf(selectedRpc)) });
      const { catalog } = await f.repository.load(null, signal());
      expect(catalog.catalogSpecs.size).toBe(rows.length);
      const selected = f.requests.filter((url) => url.pathname.endsWith(`/${selectedRpc}`));
      expect(selected).toHaveLength(2);
      expect(selected[0].searchParams.get("order")?.includes("source_label")).toBe(selectedRpc !== versions.at(-1));
    },
  );
});
