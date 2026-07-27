import { describe, expect, it } from "vitest";
import { discoverOfficialProduct, mergeOfficialProductCandidates, resolveStandardProductMapping } from "./official-product";

describe("official product discovery", () => {
  it("matches a verified PX catalog product code", () => {
    const result = discoverOfficialProduct({ sourceProductCode: "210059", productName: "하겐다즈 미니컵 스트로베리", storeLabel: "PX A", catalogNamespace: "korean-military-px" });
    expect(result.status).toBe("matched");
    if (result.status === "matched") expect(result.record.matchedBy).toBe("store_product_code");
  });

  it("does not reuse a PX code for a seller with no shared catalog", () => {
    expect(discoverOfficialProduct({ sourceProductCode: "210059", productName: "동일 코드", storeLabel: "일반 마트", catalogNamespace: null }).status).toBe("unmatched");
  });
});

describe("official product candidates", () => {
  it("merges same catalog, code, and name while preserving sellers", () => {
    expect(mergeOfficialProductCandidates([
      { sourceProductCode: "P-1", productName: "상품", storeLabel: "매장 A", catalogNamespace: "shared-catalog" },
      { sourceProductCode: "P-1", productName: "상품", storeLabel: "매장 B", catalogNamespace: "shared-catalog" },
    ])).toEqual([{ sourceProductCode: "P-1", productName: "상품", storeLabel: "매장 A", catalogNamespace: "shared-catalog", storeLabels: ["매장 A", "매장 B"] }]);
  });

  it("keeps code collisions across catalog boundaries separate", () => {
    expect(mergeOfficialProductCandidates([
      { sourceProductCode: "P-1", productName: "상품", storeLabel: "PX", catalogNamespace: "korean-military-px" },
      { sourceProductCode: "P-1", productName: "상품", storeLabel: "일반 마트", catalogNamespace: null },
    ])).toHaveLength(2);
  });

  it("keeps a mismatched product name out of an automatic shared-code merge", () => {
    expect(mergeOfficialProductCandidates([
      { sourceProductCode: "P-1", productName: "상품 500ml", storeLabel: "PX A", catalogNamespace: "korean-military-px" },
      { sourceProductCode: "P-1", productName: "상품 1L", storeLabel: "PX B", catalogNamespace: "korean-military-px" },
    ])).toHaveLength(2);
  });
});

describe("existing standard product mappings", () => {
  const candidate = { sourceProductCode: "00123", productName: "상품", storeLabel: "판매처 미상", catalogNamespace: null };

  it("keeps an existing mapping when the saved seller label differs only by whitespace or case", () => {
    expect(resolveStandardProductMapping(candidate, [{ sourceLabel: " 판매처 미상 ", sourceProductCode: "00123", product: "햇반" }])).toBe("햇반");
  });

  it("uses a code-only fallback only when the source is unknown and the verified target is unique", () => {
    expect(resolveStandardProductMapping(candidate, [{ sourceLabel: "PX", sourceProductCode: "00123", product: "햇반" }])).toBe("햇반");
    expect(resolveStandardProductMapping(candidate, [
      { sourceLabel: "PX", sourceProductCode: "00123", product: "햇반" },
      { sourceLabel: "마트", sourceProductCode: "00123", product: "다른 상품" },
    ])).toBeUndefined();
  });

  it("does not reuse a seller-owned code from another known seller", () => {
    expect(resolveStandardProductMapping({ ...candidate, storeLabel: "일반 마트" }, [{ sourceLabel: "PX", sourceProductCode: "00123", product: "햇반" }])).toBeUndefined();
  });
});
