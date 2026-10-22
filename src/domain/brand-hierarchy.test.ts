import { describe, expect, it } from "vitest";
import { brandAncestry, brandDescendantIds, brandParentCandidates, groupBrandHierarchy, type Brand } from "./brand-hierarchy";
import { findSimilarBrandNames, prepareBrandRegistration } from "./brand";

const brand = (id: string, parentBrandId: string | null = null, canonicalName = id): Brand => ({
  id, parentBrandId, canonicalName, parentCanonicalName: null, logoUrl: null, officialSiteUrl: null,
});

describe("brand hierarchy", () => {
  it("preserves existing brand registration and similarity helpers", () => {
    const rows = [{ canonical_name: "더단백" }, { canonical_name: "다른 브랜드" }];
    expect(findSimilarBrandNames(rows, "더단백")[0]).toBe(rows[0]);
    expect(findSimilarBrandNames(rows, "더단백", 0)).toEqual([]);
    expect(prepareBrandRegistration({ canonicalName: " 더단백 ", officialSourceUrl: "https://example.invalid/product" }).value)
      .toMatchObject({ canonicalName: "더단백", officialSourceLabel: "example.invalid" });
  });
  const brands = [brand("root"), brand("child", "root"), brand("leaf", "child"), brand("deep", "leaf"), brand("other"), brand("orphan", "unknown")];
  it("groups true roots, children and missing parents separately", () => {
    const grouped = groupBrandHierarchy(brands);
    expect(grouped.roots.map((row) => row.id)).toEqual(["other", "root"]);
    expect(grouped.children.get("root")?.map((row) => row.id)).toEqual(["child"]);
    expect(grouped.missingParents.map((row) => row.id)).toEqual(["orphan"]);
  });
  it("traverses arbitrary depth and computes root-first breadcrumbs", () => {
    expect(brandAncestry(brands, "deep").path.map((row) => row.id)).toEqual(["root", "child", "leaf", "deep"]);
    expect([...brandDescendantIds(brands, "root")]).toEqual(["child", "leaf", "deep"]);
    expect(brandAncestry(brands, "orphan")).toMatchObject({ missingParentId: "unknown", cycle: false });
    expect(brandAncestry(brands, "missing").path).toEqual([]);
  });
  it("orders deterministically even when names tie", () => {
    const rows = [brand("b", null, "동명"), brand("a", null, "동명")];
    expect(groupBrandHierarchy(rows).roots.map((row) => row.id)).toEqual(["a", "b"]);
    expect(groupBrandHierarchy([...rows].reverse()).roots.map((row) => row.id)).toEqual(["a", "b"]);
  });
  it("excludes the current identity and all descendants from parent choices", () => {
    expect(brandParentCandidates(brands, "child").map((row) => row.id)).toEqual(["orphan", "other", "root"]);
  });
  it("terminates defensive reads of corrupt cyclic input", () => {
    const cycle = [brand("a", "b"), brand("b", "a")];
    expect(brandAncestry(cycle, "a").cycle).toBe(true);
    expect([...brandDescendantIds(cycle, "a")]).toEqual(["b"]);
  });
});
