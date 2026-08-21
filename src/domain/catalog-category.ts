export type CatalogCategoryNode = {
  id: string;
  purchase_type: string;
  parent_id: string | null;
  slug: string;
  display_name: string;
  depth: number;
};

function categoryMap(categories: readonly CatalogCategoryNode[]) {
  return new Map(categories.map((category) => [category.id, category]));
}

export function catalogCategoryPath(
  categoryId: string,
  categories: readonly CatalogCategoryNode[],
): CatalogCategoryNode[] {
  const byId = categoryMap(categories);
  const path: CatalogCategoryNode[] = [];
  const visited = new Set<string>();
  let current = byId.get(categoryId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path.reverse();
}

export function catalogCategoryPathLabel(
  categoryId: string,
  categories: readonly CatalogCategoryNode[],
) {
  return catalogCategoryPath(categoryId, categories)
    .map((category) => category.display_name)
    .join(" › ");
}

export function catalogCategoryDescendantIds(
  categoryId: string,
  categories: readonly CatalogCategoryNode[],
) {
  const descendants = new Set([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parent_id && descendants.has(category.parent_id) && !descendants.has(category.id)) {
        descendants.add(category.id);
        changed = true;
      }
    }
  }
  return descendants;
}

export type CatalogCategoryOption = {
  id: string;
  label: string;
  productCount: number;
};

export function catalogCategoryOptionsForProducts(
  categories: readonly CatalogCategoryNode[],
  categoryIds: readonly (string | null)[],
): CatalogCategoryOption[] {
  const assignedIds = categoryIds.filter((id): id is string => Boolean(id));
  return categories
    .map((category) => {
      const descendants = catalogCategoryDescendantIds(category.id, categories);
      return {
        id: category.id,
        label: catalogCategoryPathLabel(category.id, categories),
        productCount: assignedIds.filter((id) => descendants.has(id)).length,
      };
    })
    .filter((option) => option.productCount > 0)
    .sort((left, right) => left.label.localeCompare(right.label, "ko-KR"));
}
