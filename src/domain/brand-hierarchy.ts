import { z } from "zod";

export const brandHttpUrlSchema = z.string().url().refine((value) => /^https?:\/\//i.test(value), "http 또는 https 주소를 입력하세요.");
export const PublicBrandRowSchema = z.object({
  brand_id: z.string().uuid(), canonical_name: z.string().min(1),
  parent_brand_id: z.string().uuid().nullable(), parent_canonical_name: z.string().nullable(),
  matched_name: z.string(), match_kind: z.enum(["canonical", "alias"]),
  logo_url: brandHttpUrlSchema.nullable(), official_site_url: brandHttpUrlSchema.nullable(),
}).strict();

export type Brand = {
  id: string; canonicalName: string; parentBrandId: string | null;
  parentCanonicalName: string | null; logoUrl: string | null; officialSiteUrl: string | null;
};
export type BrandMatch = Brand & { matchedName: string; matchKind: "canonical" | "alias" };

export function mapPublicBrand(row: z.infer<typeof PublicBrandRowSchema>): BrandMatch {
  return { id: row.brand_id, canonicalName: row.canonical_name, parentBrandId: row.parent_brand_id,
    parentCanonicalName: row.parent_canonical_name, logoUrl: row.logo_url, officialSiteUrl: row.official_site_url,
    matchedName: row.matched_name, matchKind: row.match_kind };
}

export function compareBrands(a: Brand, b: Brand) {
  return a.canonicalName.localeCompare(b.canonicalName, "ko") || a.id.localeCompare(b.id, "en");
}

export function groupBrandHierarchy<T extends Brand>(brands: readonly T[]) {
  const byId = new Map(brands.map((brand) => [brand.id, brand]));
  const roots: T[] = [];
  const missingParents: T[] = [];
  const children = new Map<string, T[]>();
  for (const brand of brands) {
    if (brand.parentBrandId === null) roots.push(brand);
    else if (!byId.has(brand.parentBrandId)) missingParents.push(brand);
    else children.set(brand.parentBrandId, [...(children.get(brand.parentBrandId) ?? []), brand]);
  }
  roots.sort(compareBrands);
  missingParents.sort(compareBrands);
  for (const group of children.values()) group.sort(compareBrands);
  return { byId, roots, children, missingParents };
}

/** A missing parent stays unknown: it is never silently reclassified as a root. */
export function brandAncestry<T extends Brand>(brands: readonly T[], id: string) {
  const byId = new Map(brands.map((brand) => [brand.id, brand]));
  const path: T[] = [];
  const visited = new Set<string>();
  let current = byId.get(id);
  let missingParentId: string | null = null;
  let cycle = false;
  while (current) {
    if (visited.has(current.id)) { cycle = true; break; }
    visited.add(current.id);
    path.unshift(current);
    if (current.parentBrandId === null) break;
    const parent = byId.get(current.parentBrandId);
    if (!parent) { missingParentId = current.parentBrandId; break; }
    current = parent;
  }
  return { path, missingParentId, cycle };
}

export function brandDescendantIds(brands: readonly Brand[], id: string) {
  const { children } = groupBrandHierarchy(brands);
  const descendants = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const next = pending.pop()!;
    if (descendants.has(next)) continue;
    descendants.add(next);
    pending.push(...(children.get(next) ?? []).map((child) => child.id));
  }
  descendants.delete(id);
  return descendants;
}

export function brandParentCandidates<T extends Brand>(brands: readonly T[], id: string | null) {
  const excluded = id ? brandDescendantIds(brands, id) : new Set<string>();
  if (id) excluded.add(id);
  return brands.filter((brand) => !excluded.has(brand.id)).sort(compareBrands);
}
