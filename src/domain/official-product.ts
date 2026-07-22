export type OfficialProductCandidate = {
  sourceProductCode: string;
  productName: string;
  storeLabel: string;
  /** Explicit shared catalog only. Null means this seller owns the code namespace. */
  catalogNamespace: string | null;
  storeLabels?: string[];
};

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
