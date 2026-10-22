import type { AdminBrand } from "../../repositories/admin-brand.repository";

export function filterAdminBrands(brands: readonly AdminBrand[], query: string) {
  const normalized = query.trim().toLocaleLowerCase("ko");
  if (!normalized) return brands;
  return brands.filter((brand) => [brand.canonicalName, brand.parentCanonicalName ?? "", ...brand.aliases.map((alias) => alias.name)]
    .some((name) => name.toLocaleLowerCase("ko").includes(normalized)));
}
