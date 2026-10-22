import { describe, expect, it } from "vitest";
import { PublicStandardCatalogRowSchema } from "./public-standard-catalog";
import { PublicStandardCatalogV5RowSchema, PublicStandardCatalogV5RowsSchema } from "./public-standard-catalog-v5";

import { v5Row } from "./public-standard-catalog-v5.fixture";

describe("public standard catalog v5", () => {
  it("accepts only its own versioned wire shape and preserves category and brand identity", () => {
    const row = v5Row();
    expect(PublicStandardCatalogV5RowSchema.parse(row)).toEqual(row);
    expect(PublicStandardCatalogRowSchema.safeParse(row).success).toBe(false);
    const { brand_id, parent_brand_id, parent_brand_name, ...v4 } = row;
    expect([brand_id, parent_brand_id, parent_brand_name]).toHaveLength(3);
    expect(PublicStandardCatalogRowSchema.parse(v4)).toEqual(v4);
    expect(PublicStandardCatalogV5RowSchema.safeParse(v4).success).toBe(false);
    expect(PublicStandardCatalogV5RowSchema.safeParse({ ...row, invented: true }).success).toBe(false);
  });
  it("retains v4 commercial consistency and source mapping guards", () => {
    expect(PublicStandardCatalogV5RowSchema.safeParse({ ...v5Row(), coupang_quantity: 1 }).success).toBe(false);
    expect(PublicStandardCatalogV5RowSchema.safeParse({ ...v5Row(), standard_category_name: null }).success).toBe(false);
    expect(PublicStandardCatalogV5RowsSchema.safeParse([v5Row(), { ...v5Row(), catalog_product_id: "66666666-6666-4666-8666-666666666666" }]).success).toBe(false);
  });
  it("keeps null identity and parent values without inferring them from display names", () => {
    const row = { ...v5Row(), brand_id: null, parent_brand_id: null, parent_brand_name: null };
    expect(PublicStandardCatalogV5RowSchema.parse(row).brand_id).toBeNull();
  });
});
