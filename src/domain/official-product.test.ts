import { describe, expect, it } from "vitest";
import { discoverOfficialProduct, mergeOfficialProductCandidates } from "./official-product";

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
