export type OfficialProductCandidate = {
  sourceProductCode: string;
  productName: string;
  storeLabel: string;
  /** User-facing channel tag used for tightly scoped cross-seller reuse (for example PX). */
  martTag?: string;
  /** Explicit shared catalog only. Null means this seller owns the code namespace. */
  catalogNamespace: string | null;
  storeLabels?: string[];
  receiptId?: string;
  receiptItemId?: string;
  receiptRevision?: string;
  receiptObservedAt?: string;
  receiptUnitPriceKrw?: number;
  receiptQuantity?: number;
  receiptTotalPriceKrw?: number;
  officialChannelId?: string;
  officialSourceProductCodeNamespace?: string;
  officialSourceProductCode?: string;
  officialSnapshotId?: string;
  officialSnapshotHash?: string;
  officialSourceNameRaw?: string;
  officialVendorNameRaw?: string;
  officialSpecificationTextRaw?: string;
  officialPriceAmountKrw?: number;
  officialPriceSourceText?: string;
  officialPriceObservedAt?: string;
  officialSourceRefs?: string[];
  officialImageUrl?: string;
  officialImageContentHash?: string;
  officialImageMediaType?: string;
  officialImageByteLength?: number;
};

export type StandardProductMapping<T> = {
  sourceLabel: string;
  sourceProductCode: string;
  martTag?: string;
  productName?: string;
  product: T;
};

type FrozenReceiptCandidateIdentity = {
  receiptId: string;
  receiptItemId: string;
  sourceCatalogNamespace: string | null;
  sourceLabel: string;
  sourceProductCode: string;
  sourceNameRaw: string;
};

/**
 * Resolves the exact public receipt row frozen into an approval proposal.
 * Approval candidates intentionally keep every observation instead of only a
 * grouped product's latest row, so an older reviewed receipt remains openable.
 */
export function findFrozenReceiptCandidate<T extends OfficialProductCandidate>(
  candidates: T[],
  receipt: FrozenReceiptCandidateIdentity,
) {
  return candidates.find((candidate) => (
    candidate.receiptId === receipt.receiptId
    && candidate.receiptItemId === receipt.receiptItemId
    && (
      candidate.catalogNamespace === receipt.sourceCatalogNamespace
      || (
        // A reviewed proposal may carry a catalog namespace that the public
        // receipt projection still cannot express. A known, different current
        // namespace remains a hard mismatch.
        candidate.catalogNamespace === null
        && receipt.sourceCatalogNamespace !== null
      )
    )
    && candidate.storeLabel === receipt.sourceLabel
    && candidate.sourceProductCode === receipt.sourceProductCode
    && candidate.productName === receipt.sourceNameRaw
  ));
}

function sourceMappingKey(sourceLabel: string, sourceProductCode: string) {
  return `${sourceLabel.trim().toLocaleLowerCase("ko-KR")}:${sourceProductCode.trim()}`;
}

export function resolveExactStandardProductMapping<T>(
  candidate: OfficialProductCandidate,
  mappings: StandardProductMapping<T>[],
) {
  const exact = new Map(
    mappings.map((mapping) => [
      sourceMappingKey(mapping.sourceLabel, mapping.sourceProductCode),
      mapping.product,
    ]),
  );
  return exact.get(sourceMappingKey(candidate.storeLabel, candidate.sourceProductCode));
}

export function normalizeExactProductName(value: string) {
  return value.replace(/\p{White_Space}+/gu, "");
}

function normalizedMartTag(value: string | undefined) {
  return value?.trim().toLocaleLowerCase("ko-KR") ?? "";
}

/**
 * Reuses an already verified target across seller branches only when the mart
 * tag and whitespace-only-normalized name match. Product codes must also match
 * when both observations provide one. An ambiguous target is never selected.
 */
export function resolveMartTaggedStandardProductMapping<T>(
  candidate: OfficialProductCandidate,
  mappings: StandardProductMapping<T>[],
) {
  const sellerLabels = candidate.storeLabels?.length
    ? candidate.storeLabels
    : [candidate.storeLabel];
  for (const sellerLabel of sellerLabels) {
    const exactCandidate = { ...candidate, storeLabel: sellerLabel };
    const exact = resolveExactStandardProductMapping(exactCandidate, mappings);
    if (exact !== undefined) return exact;
  }

  const candidateMartTag = normalizedMartTag(candidate.martTag);
  const candidateName = normalizeExactProductName(candidate.productName);
  if (!candidateMartTag || !candidateName) return undefined;

  const candidateCode = candidate.sourceProductCode.trim();
  const matchedProducts = new Map<T, T>();
  for (const mapping of mappings) {
    const mappingCode = mapping.sourceProductCode.trim();
    if (
      normalizedMartTag(mapping.martTag) !== candidateMartTag
      || normalizeExactProductName(mapping.productName ?? "") !== candidateName
      || (candidateCode && mappingCode && candidateCode !== mappingCode)
    ) continue;
    matchedProducts.set(mapping.product, mapping.product);
  }
  return matchedProducts.size === 1 ? [...matchedProducts.values()][0] : undefined;
}

/**
 * Seller-owned codes remain seller-scoped. A code-only fallback is allowed
 * only for an explicit shared namespace or unknown seller, and only when every
 * verified mapping for the code identifies one catalog product.
 */
export function resolveStandardProductMapping<T>(candidate: OfficialProductCandidate, mappings: StandardProductMapping<T>[]) {
  const sellerLabels = candidate.storeLabels?.length ? candidate.storeLabels : [candidate.storeLabel];
  const exact = new Map(mappings.map((mapping) => [sourceMappingKey(mapping.sourceLabel, mapping.sourceProductCode), mapping.product]));
  for (const sellerLabel of sellerLabels) {
    const product = exact.get(sourceMappingKey(sellerLabel, candidate.sourceProductCode));
    if (product) return product;
  }
  const canUseUniqueCode = Boolean(candidate.catalogNamespace) || sellerLabels.some((sellerLabel) => sellerLabel.trim() === "판매처 미상");
  if (!canUseUniqueCode) return undefined;
  const matchedProducts = new Map<T, T>();
  for (const mapping of mappings) {
    if (mapping.sourceProductCode.trim() === candidate.sourceProductCode.trim()) matchedProducts.set(mapping.product, mapping.product);
  }
  return matchedProducts.size === 1 ? [...matchedProducts.values()][0] : undefined;
}

export function officialProductCandidateKey(candidate: OfficialProductCandidate) {
  const namespace = candidate.catalogNamespace ?? `merchant:${candidate.storeLabel}`;
  return `${namespace}:${candidate.sourceProductCode}:${normalize(candidate.productName)}`;
}

export function mergeOfficialProductCandidates(candidates: OfficialProductCandidate[]): OfficialProductCandidate[] {
  const grouped = new Map<string, OfficialProductCandidate>();
  for (const candidate of candidates) {
    const key = officialProductCandidateKey(candidate);
    const existing = grouped.get(key);
    const storeLabels = [...new Set([...(existing?.storeLabels ?? (existing ? [existing.storeLabel] : [])), ...(candidate.storeLabels ?? [candidate.storeLabel])])];
    grouped.set(key, existing ? { ...existing, storeLabels } : { ...candidate, storeLabels });
  }
  return [...grouped.values()];
}

/**
 * Builds one UI identity per shared catalog item before resolving verified
 * mappings. This keeps seller observations available through `storeLabels`
 * without rendering duplicate React keys for the same shared item.
 */
export function resolveOfficialProductCandidates<T>(
  candidates: OfficialProductCandidate[],
  mappings: StandardProductMapping<T>[],
) {
  const mergedCandidates = mergeOfficialProductCandidates(candidates);
  const identityAwareMappings = mappings.map((mapping) => {
    const peer = mergedCandidates.find((candidate) => (
      candidate.sourceProductCode.trim() === mapping.sourceProductCode.trim()
      && (candidate.storeLabels?.length ? candidate.storeLabels : [candidate.storeLabel])
        .some((seller) => seller.trim().toLocaleLowerCase("ko-KR") === mapping.sourceLabel.trim().toLocaleLowerCase("ko-KR"))
    ));
    return peer
      ? { ...mapping, martTag: peer.martTag, productName: peer.productName }
      : mapping;
  });

  return mergedCandidates.map((candidate) => ({
    candidate,
    product: resolveMartTaggedStandardProductMapping(candidate, identityAwareMappings),
  }));
}

export type OfficialProductRecord = {
  officialName: string;
  officialUrl: string;
  sourceName: string;
  imageUrl?: string;
  matchMethod: "official_verified" | "auto_matched" | "manual";
  confidence?: number;
  matchedBy?: "store_product_code" | "receipt_name" | "manual";
  updatedAt: string;
};

export type OfficialSearchResult = {
  officialName: string;
  officialUrl: string;
  sourceName: string;
  description?: string;
  imageUrl?: string;
};

export type OfficialDiscovery =
  | { status: "matched"; record: OfficialProductRecord; reason: string }
  | { status: "unmatched"; reason: string };

type OfficialProductSeed = OfficialProductRecord & { aliases: string[] };

function asOfficialRecord(record: OfficialProductSeed): OfficialProductRecord {
  return {
    officialName: record.officialName,
    officialUrl: record.officialUrl,
    sourceName: record.sourceName,
    imageUrl: record.imageUrl,
    matchMethod: record.matchMethod,
    confidence: record.confidence,
    matchedBy: record.matchedBy,
    updatedAt: record.updatedAt,
  };
}

// Seed records are only added after a human has checked the receipt data and the official source together.
const officialProductSeeds: Record<string, OfficialProductSeed> = {
  "210059": {
    officialName: "하겐다즈 스트로베리 미니컵",
    officialUrl: "https://www.haagendazs.co.kr/products/strawberry-minicup",
    sourceName: "하겐다즈 코리아 공식 상품 페이지",
    imageUrl: "https://brandsitesplatform-res.cloudinary.com/image/fetch/w_auto:100,c_scale,q_auto:eco,f_auto,fl_lossy,dpr_auto,e_sharpen:85/https://assets.brandplatform.generalmills.com/-/media/project/gmi/haagendazs/haagendazs-master/bsp/hd/nutrition-images/korea/strawberry-minicup_26974_kp_2_1_8221811.png?w=500&rev=9b4c1a0018984115afb71ee3923cd5a2",
    matchMethod: "official_verified",
    confidence: 1,
    matchedBy: "store_product_code",
    updatedAt: "2026-07-21T00:00:00.000Z",
    aliases: ["하겐다즈 미니컵 스트로베리", "하겐다즈 스트로베리"],
  },
  "200183": {
    officialName: "하겐다즈 벨지안 초콜릿 미니컵 100ml",
    officialUrl: "https://m.haagendazs-store.co.kr/product/detail.html?cate_no=33&display_group=1&product_no=41",
    sourceName: "하겐다즈 공식 스토어",
    matchMethod: "official_verified",
    confidence: 1,
    matchedBy: "store_product_code",
    updatedAt: "2026-07-21T00:00:00.000Z",
    aliases: ["하겐다즈 미니컵 벨지안 초콜릿", "하겐다즈 벨지안 초코"],
  },
  "240309": {
    officialName: "닥터지 모이스처 인 바디 5.0 바디로션 500ml",
    officialUrl: "https://www.dr-g.co.kr/item/4492",
    sourceName: "닥터지 공식몰",
    matchMethod: "official_verified",
    confidence: 1,
    matchedBy: "store_product_code",
    updatedAt: "2026-07-21T00:00:00.000Z",
    aliases: ["닥터지 모이스처 인 바디 5.0", "dr.g 모이스처 인 바디"],
  },
};

export const seededOfficialProducts: Record<string, OfficialProductRecord> = Object.fromEntries(
  Object.entries(officialProductSeeds).map(([code, record]) => [`korean-military-px:${code}`, asOfficialRecord(record)]),
);

function normalize(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^0-9a-z가-힣]+/gi, " ").trim();
}

function tokenOverlap(left: string, right: string) {
  const leftTokens = new Set(normalize(left).split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(normalize(right).split(" ").filter((token) => token.length > 1));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const matches = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return matches / Math.max(leftTokens.size, rightTokens.size);
}

export function discoverOfficialProduct(candidate: OfficialProductCandidate): OfficialDiscovery {
  const exact = candidate.catalogNamespace ? seededOfficialProducts[`${candidate.catalogNamespace}:${candidate.sourceProductCode}`] : undefined;
  if (exact) {
    return {
      status: "matched",
      record: { ...exact, matchMethod: "auto_matched", confidence: 1, matchedBy: "store_product_code" },
      reason: "영수증 판매처 상품 코드가 검증된 공식 상품 코드와 일치합니다.",
    };
  }

  const best = Object.values(officialProductSeeds)
    .map((record) => ({ record, score: Math.max(...[record.officialName, ...record.aliases].map((name) => tokenOverlap(candidate.productName, name))) }))
    .sort((left, right) => right.score - left.score)[0];
  if (best && best.score >= 0.9) {
    return {
      status: "matched",
      record: { ...asOfficialRecord(best.record), matchMethod: "auto_matched", confidence: Number(best.score.toFixed(2)), matchedBy: "receipt_name" },
      reason: "영수증 상품명과 검증된 공식 상품 별칭이 충분히 일치합니다.",
    };
  }

  return { status: "unmatched", reason: "검증된 코드 또는 충분히 일치하는 공식 상품명이 없습니다." };
}

export function officialSearchUrl(candidate: OfficialProductCandidate) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${candidate.productName} ${candidate.sourceProductCode} 공식 상품`)}`;
}
