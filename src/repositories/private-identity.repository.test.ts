import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { PrivateIdentityRepository } from "./private-identity.repository";

const storeId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const storeProductId = "33333333-3333-4333-8333-333333333333";
const catalogProductId = "44444444-4444-4444-8444-444444444444";
const menuId = "55555555-5555-4555-8555-555555555555";

function payload(selector: { type: "store" | "store_product" | "restaurant_menu" | "catalog_product"; id: string }) {
  return {
    schemaVersion: "private-identity-read.v1",
    namespace: "pricetrace",
    selector,
    stores: [],
    products: [],
    storeProducts: [],
    catalogProducts: [],
    restaurantMenus: [],
    receipts: [],
    priceObservations: [],
  };
}

describe("PrivateIdentityRepository", () => {
  it.each([
    [{ type: "store", id: storeId }, { p_store_id: storeId, p_store_product_id: null, p_restaurant_menu_id: null, p_catalog_product_id: null }],
    [{ type: "store_product", id: storeProductId }, { p_store_id: null, p_store_product_id: storeProductId, p_restaurant_menu_id: null, p_catalog_product_id: null }],
    [{ type: "restaurant_menu", id: menuId }, { p_store_id: null, p_store_product_id: null, p_restaurant_menu_id: menuId, p_catalog_product_id: null }],
    [{ type: "catalog_product", id: catalogProductId }, { p_store_id: null, p_store_product_id: null, p_restaurant_menu_id: null, p_catalog_product_id: catalogProductId }],
  ] as const)("uses exactly one server selector for %s", async (selector, args) => {
    const rpc = vi.fn().mockResolvedValue({ data: payload(selector), error: null });
    const repository = new PrivateIdentityRepository({ rpc } as unknown as SupabaseClient);

    const result = await repository.read(selector);

    expect(rpc).toHaveBeenCalledWith("get_authenticated_identity_detail_v1", args);
    expect(result.selector).toEqual(selector);
  });

  it("rejects a response for a different identity instead of showing unrelated private data", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: payload({ type: "store_product", id: productId }),
      error: null,
    });
    const repository = new PrivateIdentityRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.read({ type: "store_product", id: storeProductId })).rejects.toThrow(/요청하지 않은 identity/);
  });

  it("surfaces an authenticated RPC failure", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "로그인이 필요합니다." } });
    const repository = new PrivateIdentityRepository({ rpc } as unknown as SupabaseClient);

    await expect(repository.read({ type: "store", id: storeId })).rejects.toThrow("로그인이 필요합니다.");
  });
});
