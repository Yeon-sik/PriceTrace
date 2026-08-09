import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ProductReadRepository } from "./product-read.repository";

const revision = `sha256:${"a".repeat(64)}`;
const catalogProductId = "22222222-2222-4222-8222-222222222222";

function payload(id = catalogProductId) {
  return {
    schemaVersion: "product-read.v1",
    namespace: "pricetrace",
    revision,
    products: [{
      revision,
      standardProduct: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "상품군",
        brand: null,
        updatedAt: "2026-08-09T01:00:00+00:00",
      },
      catalogProduct: {
        id,
        name: "정확 규격",
        specificationText: null,
        contentAmount: 100,
        contentUnit: "g",
        packageCount: 1,
        referenceUnit: 100,
        listingReferenceUrl: null,
        updatedAt: "2026-08-09T01:00:00+00:00",
      },
      sellerProducts: [],
      observations: [],
    }],
  };
}

describe("ProductReadRepository", () => {
  it("requests an exact product through the versioned public RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: payload(), error: null });
    const repository = new ProductReadRepository({ rpc } as unknown as SupabaseClient);

    const product = await repository.readExactProduct(catalogProductId);

    expect(rpc).toHaveBeenCalledWith("get_product_read_v1", {
      p_catalog_product_id: catalogProductId,
      p_query: null,
      p_limit: 1,
    });
    expect(product?.catalogProduct.id).toBe(catalogProductId);
  });

  it("rejects an RPC response for a different exact variant", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: payload("55555555-5555-4555-8555-555555555555"),
      error: null,
    });
    const repository = new ProductReadRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.readExactProduct(catalogProductId)).rejects.toThrow(/요청하지 않은 정확 규격/);
  });

  it("surfaces RPC failure without manufacturing a fallback revision", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "function is offline" },
    });
    const repository = new ProductReadRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.readExactProduct(catalogProductId)).rejects.toThrow("function is offline");
  });
});
