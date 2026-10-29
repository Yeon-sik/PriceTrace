import { describe, expect, it } from "vitest";
import { authenticatedProductListings } from "./authenticated-product-observation.repository";
import { groupProductObservations } from "../domain/product-browser";

const owner = "11111111-1111-4111-8111-111111111111";
const storeProduct = "22222222-2222-4222-8222-222222222222";
function row() {
  return {
    id: "33333333-3333-4333-8333-333333333333", user_id: owner,
    receipt_item_id: "source-item", observed_at: "2026-10-09", unit_price_krw: 9900, quantity: 1,
    catalog_product_id: null, verification_status: "verified",
    store_products: { id: storeProduct, user_id: owner, store_id: "44444444-4444-4444-8444-444444444444", store_product_code: null,
      products: { id: "55555555-5555-4555-8555-555555555555", user_id: owner, name: "달콤 한돈 불고기 600g", purchase_type: "retail_product" },
      stores: { id: "44444444-4444-4444-8444-444444444444", user_id: owner, name: "GS THE FRESH" } },
    receipt_items: { receipt_id: "66666666-6666-4666-8666-666666666666", total_price_krw: 9900 },
  };
}
describe("authenticated OCR products", () => {
  it("uses only owner-confirmed store connections without changing source product or price identity", () => {
    const source = row();
    const target = "99999999-9999-4999-8999-999999999999";
    const binding = { user_id: owner, source_id: source.store_products.store_id, target_id: target, target_name: "기존 가게" };
    const [original] = authenticatedProductListings([source], owner);
    const [connected] = authenticatedProductListings([source], owner, [binding]);
    expect(connected).toEqual({ ...original, storeLabel: "기존 가게", sellerKey: `store:${target}` });
    expect(authenticatedProductListings([source], owner, [{ ...binding, user_id: target }])).toEqual([original]);
    expect(source.store_products.stores.name).toBe("GS THE FRESH");
  });
  it("shows a verified purchased product before standard/catalog mapping", () => {
    const listings = authenticatedProductListings([row()], owner);
    expect(listings).toHaveLength(1);
    expect(listings[0].catalogProductId).toBeNull();
    expect(listings[0].item.sourceProductCode).toBe("");
    expect(groupProductObservations(listings)[0].id).toBe(`store-product:${storeProduct}`);
  });
  it("does not expose another owner's nested product or merge distinct exact products by name", () => {
    const wrong = row(); wrong.store_products.products.user_id = "77777777-7777-4777-8777-777777777777";
    expect(authenticatedProductListings([wrong], owner)).toEqual([]);
    const other = row(); other.store_products.id = "88888888-8888-4888-8888-888888888888";
    expect(groupProductObservations(authenticatedProductListings([row(), other], owner))).toHaveLength(2);
  });
});
