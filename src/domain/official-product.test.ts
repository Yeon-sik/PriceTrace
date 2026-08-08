import { describe, expect, it } from "vitest";
import { discoverOfficialProduct, findFrozenReceiptCandidate, mergeOfficialProductCandidates, officialProductCandidateKey, resolveExactStandardProductMapping, resolveMartTaggedStandardProductMapping, resolveOfficialProductCandidates, resolveStandardProductMapping } from "./official-product";
import {
  isExcludedFromStandardProductConnectionQueue,
  standardProductConnectionQueueExclusions,
} from "./standard-product-connection-queue-exclusions";

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
  it("keeps an older frozen receipt row addressable for approval", () => {
    const candidates = [
      {
        sourceProductCode: "P-1",
        productName: "상품",
        storeLabel: "매장 A",
        catalogNamespace: "shared-catalog",
        receiptId: "receipt-new",
        receiptItemId: "item-new",
      },
      {
        sourceProductCode: "P-1",
        productName: "상품",
        storeLabel: "매장 A",
        catalogNamespace: "shared-catalog",
        receiptId: "receipt-old",
        receiptItemId: "item-old",
      },
    ];

    expect(findFrozenReceiptCandidate(candidates, {
      receiptId: "receipt-old",
      receiptItemId: "item-old",
      sourceCatalogNamespace: "shared-catalog",
      sourceLabel: "매장 A",
      sourceProductCode: "P-1",
      sourceNameRaw: "상품",
    })?.receiptItemId).toBe("item-old");
  });

  it("uses a reviewed catalog namespace only while the public receipt channel remains unknown", () => {
    const candidate = {
      sourceProductCode: "P-1",
      productName: "상품",
      storeLabel: "매장 A",
      catalogNamespace: null,
      receiptId: "receipt-1",
      receiptItemId: "item-1",
    };
    const frozenReceipt = {
      receiptId: "receipt-1",
      receiptItemId: "item-1",
      sourceCatalogNamespace: "shared-catalog",
      sourceLabel: "매장 A",
      sourceProductCode: "P-1",
      sourceNameRaw: "상품",
    };

    expect(findFrozenReceiptCandidate([candidate], frozenReceipt)).toBe(candidate);
    expect(findFrozenReceiptCandidate([
      { ...candidate, catalogNamespace: "different-catalog" },
    ], frozenReceipt)).toBeUndefined();
  });

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

  it("resolves one stable UI identity for the same PX item observed at two sellers", () => {
    const resolved = resolveOfficialProductCandidates([
      { sourceProductCode: "240312", productName: "닥터지 로얄 블랙스네일 크림 기획", storeLabel: "국군복지단 바다마을마트", martTag: "PX", catalogNamespace: "korean-military-px" },
      { sourceProductCode: "240312", productName: "닥터지 로얄 블랙스네일 크림 기획", storeLabel: "와마트 일산점", martTag: "PX", catalogNamespace: "korean-military-px" },
    ], [{
      sourceLabel: "국군복지단 바다마을마트",
      sourceProductCode: "240312",
      product: "drg-50ml",
    }]);

    expect(resolved).toHaveLength(1);
    expect(resolved[0].product).toBe("drg-50ml");
    expect(resolved[0].candidate.storeLabels).toEqual(["국군복지단 바다마을마트", "와마트 일산점"]);
    expect(new Set(resolved.map(({ candidate }) => officialProductCandidateKey(candidate))).size).toBe(resolved.length);
  });
});

describe("standard product connection queue exclusions", () => {
  it("excludes every explicitly recorded duplicate source identity", () => {
    for (const exclusion of standardProductConnectionQueueExclusions) {
      expect(isExcludedFromStandardProductConnectionQueue({
        sourceProductCode: exclusion.sourceProductCode,
        productName: exclusion.sourceNameRaw,
        storeLabel: exclusion.sourceLabel,
        catalogNamespace: "korean-military-px",
      })).toBe(true);
    }
  });

  it("matches an exact excluded seller inside a merged candidate", () => {
    expect(isExcludedFromStandardProductConnectionQueue({
      sourceProductCode: "260207",
      productName: "쉬림프 스파이시 투움바 파스타",
      storeLabel: "다른 PX 판매처",
      storeLabels: ["다른 PX 판매처", "와마트 일산점"],
      catalogNamespace: "korean-military-px",
    })).toBe(true);
  });

  it("does not generalize an exclusion by product name or code alone", () => {
    expect(isExcludedFromStandardProductConnectionQueue({
      sourceProductCode: "260150",
      productName: "더단백 크런치바 초코",
      storeLabel: "다른 판매처",
      catalogNamespace: null,
    })).toBe(false);
    expect(isExcludedFromStandardProductConnectionQueue({
      sourceProductCode: "다른 코드",
      productName: "더단백 크런치바 초코",
      storeLabel: "와마트 일산점",
      catalogNamespace: null,
    })).toBe(false);
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

  it("keeps another shared-catalog seller visible until its exact mapping is approved", () => {
    const sharedCandidate = { ...candidate, storeLabel: "매장 B", catalogNamespace: "shared-catalog" };
    const mappings = [{ sourceLabel: "매장 A", sourceProductCode: "00123", product: "햇반" }];
    expect(resolveStandardProductMapping(sharedCandidate, mappings)).toBe("햇반");
    expect(resolveExactStandardProductMapping(sharedCandidate, mappings)).toBeUndefined();
  });

  it("reuses one verified target across PX sellers when name and code match", () => {
    const mappings = [{ sourceLabel: "와마트 일산점", sourceProductCode: "250428", martTag: "PX", productName: "베리베리스트로베리큐브", product: "berry" }];
    expect(resolveMartTaggedStandardProductMapping({
      sourceProductCode: "250428",
      productName: "베리베리 스트로베리 큐브",
      storeLabel: "국군복지단 바다마을마트",
      martTag: "PX",
      catalogNamespace: null,
    }, mappings)).toBe("berry");
  });

  it("does not cross-link a different tag, name text, code, or ambiguous target", () => {
    const mapping = { sourceLabel: "PX A", sourceProductCode: "250428", martTag: "PX", productName: "베리베리스트로베리큐브", product: "berry" };
    const candidate = { sourceProductCode: "250428", productName: "베리베리스트로베리큐브", storeLabel: "PX B", martTag: "PX", catalogNamespace: null };
    expect(resolveMartTaggedStandardProductMapping({ ...candidate, martTag: "일반마트" }, [mapping])).toBeUndefined();
    expect(resolveMartTaggedStandardProductMapping({ ...candidate, productName: "베리베리스트로베리 큐브!" }, [mapping])).toBeUndefined();
    expect(resolveMartTaggedStandardProductMapping({ ...candidate, sourceProductCode: "999999" }, [mapping])).toBeUndefined();
    expect(resolveMartTaggedStandardProductMapping({ ...candidate, sourceProductCode: "" }, [
      mapping,
      { ...mapping, sourceLabel: "PX C", sourceProductCode: "999999", product: "other" },
    ])).toBeUndefined();
  });

  it("allows a missing code only when tag and exact name identify one target", () => {
    const mappings = [{ sourceLabel: "PX A", sourceProductCode: "250428", martTag: "PX", productName: "베리베리스트로베리큐브", product: "berry" }];
    expect(resolveMartTaggedStandardProductMapping({
      sourceProductCode: "",
      productName: "베리베리 스트로베리 큐브",
      storeLabel: "PX B",
      martTag: "PX",
      catalogNamespace: null,
    }, mappings)).toBe("berry");
  });
});
