import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260820120000_expand_catalog_and_restaurant_categories.sql", import.meta.url),
  "utf8",
);

const assignmentStart = migration.indexOf("with assignments(standard_product_id, category_slug)");
const assignmentBlock = migration.slice(
  assignmentStart,
  migration.indexOf("update public.standard_products as standard_product", assignmentStart),
);

describe("expanded catalog taxonomy migration", () => {
  it("adds hierarchical retail leaf categories", () => {
    expect(migration).toContain("('processed-food', 'instant-noodles', '즉석면·떡국', 2)");
    expect(migration).toContain("('beverages', 'protein-drinks', '단백질음료', 2)");
    expect(migration).toContain("('skincare', 'sun-care', '선케어', 2)");
    expect(migration).toContain("on conflict (purchase_type, slug) do update");
  });

  it("maps the complete 2026-08-20 standard-product snapshot exactly once", () => {
    const productIds = [...assignmentBlock.matchAll(/'([a-f0-9-]{36})'::uuid/g)]
      .map((match) => match[1]);
    expect(productIds).toHaveLength(99);
    expect(new Set(productIds).size).toBe(99);
    expect(migration).toContain("catalog_product.category_id is distinct from standard_product.category_id");
  });

  it("categorizes new retail standards and keeps their variants synchronized", () => {
    expect(migration).toContain("create function public.retail_standard_category_slug");
    expect(migration).toContain("create trigger standard_products_require_retail_category");
    expect(migration).toContain("constraint retail_standard_products_require_category");
    expect(migration).toContain("Retail standard products require a retail leaf category.");
    expect(migration).toContain("create trigger catalog_products_inherit_retail_category");
    expect(migration).toContain("create trigger standard_products_propagate_retail_category");
  });

  it("publishes persisted standard-product category identity in the public catalog", () => {
    expect(migration).toContain("create function public.get_public_exact_standard_product_catalog_v4()");
    expect(migration).toContain("standard_category_id uuid");
    expect(migration).toContain("standard_category_slug text");
    expect(migration).toContain("standard_category_name text");
  });

  it("seeds restaurant categories without auto-assigning a restaurant", () => {
    expect(migration).toContain("create table public.restaurant_categories");
    expect(migration).toContain("('korean', '한식', 0, 10)");
    expect(migration).toContain("('korean', 'jokbal-bossam', '족발·보쌈', 15)");
    expect(migration).toContain("add column category_id uuid");
    expect(migration).not.toMatch(/update\s+public\.restaurants\s+set\s+category_id/i);
  });

  it("keeps category reads public and synchronizes only an explicit link", () => {
    expect(migration).toContain("restaurant categories are publicly readable");
    expect(migration).toContain("before insert or update of category_id, cuisine_type");
    expect(migration).toContain("new.category_id is not null");
    expect(migration).toContain("create function public.get_restaurant_directory_v2(");
    expect(migration).toContain("create function public.get_restaurant_detail_v2(");
    expect(migration).toContain("create function public.admin_set_restaurant_category_v1(");
    expect(migration).toContain("as category_node(document)");
    expect(migration).toContain("from public.restaurant_menus as search_menu");
    expect(migration).not.toContain("enriched.document::text ilike");
    expect(migration).toContain("with recursive category_path as");
    expect(migration).toContain("order by path.distance desc");
    expect(migration).toContain("where child.parent_id = category.id");
    expect(migration).toContain("A leaf restaurant category is required.");
  });
});
