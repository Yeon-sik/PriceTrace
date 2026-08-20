import { describe, expect, it } from "vitest";
import {
  catalogCategoryDescendantIds,
  catalogCategoryOptionsForProducts,
  catalogCategoryPathLabel,
  type CatalogCategoryNode,
} from "./catalog-category";

const categories: CatalogCategoryNode[] = [
  { id: "food", purchase_type: "retail_product", parent_id: null, slug: "food", display_name: "식품", depth: 0 },
  { id: "processed", purchase_type: "retail_product", parent_id: "food", slug: "processed-food", display_name: "가공식품", depth: 1 },
  { id: "noodles", purchase_type: "retail_product", parent_id: "processed", slug: "instant-noodles", display_name: "즉석면·떡국", depth: 2 },
  { id: "beauty", purchase_type: "retail_product", parent_id: null, slug: "beauty", display_name: "뷰티", depth: 0 },
];

describe("catalog category tree", () => {
  it("builds a readable root-to-leaf path", () => {
    expect(catalogCategoryPathLabel("noodles", categories)).toBe("식품 › 가공식품 › 즉석면·떡국");
  });

  it("includes every descendant when a parent is selected", () => {
    expect([...catalogCategoryDescendantIds("food", categories)]).toEqual([
      "food", "processed", "noodles",
    ]);
  });

  it("shows only category branches containing visible products", () => {
    expect(catalogCategoryOptionsForProducts(categories, ["noodles", null])).toEqual([
      { id: "food", label: "식품", productCount: 1 },
      { id: "processed", label: "식품 › 가공식품", productCount: 1 },
      { id: "noodles", label: "식품 › 가공식품 › 즉석면·떡국", productCount: 1 },
    ]);
  });
});
