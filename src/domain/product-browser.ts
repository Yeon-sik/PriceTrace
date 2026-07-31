import type { Receipt, ReceiptItem } from "./types";
import type { OfficialProductRecord } from "./official-product";

export const PRODUCT_CATEGORIES = ["전체", "식품", "생활용품", "주방용품", "신선식품", "음료", "간식", "미분류"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type MartType = "all" | "regular" | "px";
export type ProductSort = "expensive" | "cheap" | "sellers";

export type ProductObservationListing = {
  id: string;
  item: ReceiptItem;
  storeLabel: string;
  sellerKey?: string;
  catalogNamespace: string | null;
  observedAt: string;
  martType: Exclude<MartType, "all">;
  source?: "receipt" | "public";
};

export type ProductGroup = {
  id: string;
  sourceProductCode: string;
  productName: string;
  storeLabel: string;
  sellerKey: string;
  catalogNamespace: string | null;
  martType: Exclude<MartType, "all">;
  category: ProductCategory;
  latest: ProductObservationListing;
  observations: ProductObservationListing[];
  latestPriceKrw: number;
  minimumPriceKrw: number;
  officialProduct?: OfficialProductRecord;
  /** Same mart tag, exact whitespace-normalized name, and compatible product code. */
  sharedCatalogProduct?: boolean;
  sourceStoreLabel?: string;
};

export function normalizeReceiptProductName(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeExactReceiptProductName(value: string) {
  return value.replace(/\p{White_Space}+/gu, "");
}

export function normalizeSellerLabel(value: string) {
  return normalizedSellerDisplayLabel(value)
    .toLocaleLowerCase("ko-KR");
}

export function normalizedSellerDisplayLabel(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sellerIdentityKeyForReceipt(receipt: Pick<Receipt, "storeMerchantId" | "storeBusinessRegistrationNumber" | "storeId" | "storeLabel">) {
  const merchantId = normalizedSellerDisplayLabel(receipt.storeMerchantId ?? "").toLocaleLowerCase("ko-KR");
  if (merchantId) return `merchant:${merchantId}`;
  const businessRegistrationNumber = (receipt.storeBusinessRegistrationNumber ?? "").replace(/\D/g, "");
  if (businessRegistrationNumber) return `business:${businessRegistrationNumber}:${normalizeSellerLabel(receipt.storeLabel)}`;
  if (receipt.storeId?.trim()) return `store:${receipt.storeId.trim()}`;
  return `label:${normalizeSellerLabel(receipt.storeLabel)}`;
}

export function sellerIdentityKey(seller: { sellerKey?: string; storeLabel: string }) {
  return seller.sellerKey?.trim() || `label:${normalizeSellerLabel(seller.storeLabel)}`;
}

export function distinctSellerCount(sellers: readonly { sellerKey?: string; storeLabel: string }[]) {
  return new Set(sellers.map(sellerIdentityKey)).size;
}

export function latestSellerRows(
  observations: readonly Pick<ProductObservationListing, "sellerKey" | "storeLabel" | "observedAt">[],
) {
  const latestBySeller = new Map<string, { storeLabel: string; observedAt: string }>();
  for (const observation of observations) {
    const key = sellerIdentityKey(observation);
    const current = latestBySeller.get(key);
    if (!current || observation.observedAt > current.observedAt) {
      latestBySeller.set(key, {
        storeLabel: normalizedSellerDisplayLabel(observation.storeLabel),
        observedAt: observation.observedAt,
      });
    }
  }
  return [...latestBySeller.values()].sort(
    (left, right) =>
      left.storeLabel.localeCompare(right.storeLabel, "ko-KR")
      || right.observedAt.localeCompare(left.observedAt),
  );
}

export function martTypeFor(receipt: Receipt): Exclude<MartType, "all"> {
  if (receipt.retailChannel === "px") return "px";
  if (receipt.retailChannel === "regular") return "regular";
  return /px|군마트|국군복지단|와마트/i.test(receipt.storeLabel) || receipt.items.some((item) => /영외/i.test(item.productName)) ? "px" : "regular";
}

export function martTagFor(store: Pick<ProductGroup, "martType" | "storeLabel">) {
  const compactStoreLabel = normalizedSellerDisplayLabel(store.storeLabel).replace(/\s+/g, "");
  const hasPxLabel = /군마트|국군복지단|와마트/i.test(compactStoreLabel)
    || /(?:^|[^a-z])px(?:$|[^a-z])/i.test(store.storeLabel);
  if (store.martType === "px" || hasPxLabel) return "PX";
  return store.storeLabel.replace(/\s+\S+점$/, "").trim() || "일반 마트";
}

export type CoupangPriceComparison = {
  winner: "seller" | "coupang" | "tie";
  sellerTag: string;
  differenceKrw: number;
};

export function compareCoupangPrice(
  seller: Pick<ProductGroup, "martType" | "storeLabel"> & { unitPriceKrw: number; unitPriceLabel: string },
  coupangPrice: { unitPriceKrw: number | null; referenceLabel: string | null } | null,
): CoupangPriceComparison | null {
  if (!coupangPrice || coupangPrice.unitPriceKrw === null || coupangPrice.referenceLabel !== seller.unitPriceLabel) return null;
  const sellerTag = martTagFor(seller);
  if (seller.unitPriceKrw < coupangPrice.unitPriceKrw) {
    return { winner: "seller", sellerTag, differenceKrw: coupangPrice.unitPriceKrw - seller.unitPriceKrw };
  }
  if (coupangPrice.unitPriceKrw < seller.unitPriceKrw) {
    return { winner: "coupang", sellerTag, differenceKrw: seller.unitPriceKrw - coupangPrice.unitPriceKrw };
  }
  return { winner: "tie", sellerTag, differenceKrw: 0 };
}

export function categoryForProduct(productName: string): ProductCategory {
  const name = productName.normalize("NFKC").toLocaleLowerCase("ko-KR");

  // 범용 명사(크림, 세트, 우유 등)만으로 분류하면 식품과 생활용품이
  // 서로 오염되므로 실제 상품군을 식별할 수 있는 표현만 사용한다.
  if (/샴푸|바디워시|바디 ?바|바디 .* 바|로션|선크림|수분 ?크림|스네일 ?크림|클리어크림|마스크|수딩 ?패드|스팟패드|연고|면도|쉐이빙|질레트|쿨파스|파스(?:$|[ (])|쿨토시|런닝|드로우|반바지|화장품|여행용세트|비트 트리플|재사용봉투|종량제봉투|rainok/.test(name)) return "생활용품";
  if (/프라이팬|후라이팬|냄비|도마|주방 ?가위|식도|과도|수세미|주방|젓가락|수저|밀폐용기|보관용기|찬통|반찬통|텀블러|식기|접시|국자|뒤집개|주걱/.test(name)) return "주방용품";
  if (/테이크핏/.test(name)) return "음료";

  // 아이스크림·스낵·즉석면은 이름에 커피·우유·도시락 등이 포함돼도
  // 기존 상품 목록의 간식 분류를 우선한다.
  if (/순살바|과자|스낵|초코|초콜릿|팝콘|새우깡|포카칩|아몬드|육포|프리팩|prepack|모리팩|샤베트|아이스크림|미니컵|월드콘|더위사냥|모나카|싸만코|수박바|참외콘|요맘때.*콘|체리쥬빌레|뉴욕치즈케이크큐브|스트로베리큐브|글레이즈드|프로틴바|크런치바|단백질바|하이프로틴바|라면|사발면|컵누들|짜왕|카구리|큰컵|팔도 ?도시락/.test(name)) return "간식";

  if (/커피|카누|맥심|박카스|워터|테이크핏|에이드|주스|쥬스|아임리얼|옥수수수염차|프로젝트 ?윌|발렌타인|조니워커|위스키|소주|맥주|와인/.test(name)) return "음료";

  // 조리·가공된 음식은 원재료 단어(새우, 해물, 고기)보다 먼저 판정한다.
  if (/식빵|빵$|우동|국수|칼국수|파스타|투움바|부옴바|짜장|당면|라자냐|브리또|컵피자|피자|누룽지탕|볶음밥|밥알|포크&스크램블|텐동|햇반|떡국|부침|소시지|프랑크|로스트비프|어묵|쌈장|초장|케찹|케첩|솔트|양념|참치|야채사각|도시락김|곱창김|김$|골뱅이|폭립|밀크씨슬|모닝이즈백|그릭콤포트|스노우크랩킹|크림우동/.test(name)) return "식품";

  if (/급냉삼겹|대패 ?삼겹|삼겹살|냉동.*관자|손질바지락|냉동새우살|씨푸드믹스|시금치|표고버섯|순두부|두부|닭가슴살|한돈|샤인머스켓|애플망고|찐고구마|고구마/.test(name)) return "신선식품";

  if (/쌀|불고기|쭈꾸미|주꾸미|탕|해물|새우|고기|치즈|버터|튀김|냉동|즉석|간편식|조리식품|테아닌/.test(name)) return "식품";
  return "미분류";
}

export function availableProductCategories(productNames: Iterable<string>): Exclude<ProductCategory, "전체">[] {
  const present = new Set<ProductCategory>();
  for (const productName of productNames) present.add(categoryForProduct(productName));
  return PRODUCT_CATEGORIES.filter((category): category is Exclude<ProductCategory, "전체"> => category !== "전체" && present.has(category));
}

export function listingsFromReceipts(receipts: Receipt[]): ProductObservationListing[] {
  return receipts.flatMap((receipt) => receipt.items.map((item) => ({
    id: `${receipt.id}:${item.id}`,
    item,
    storeLabel: receipt.storeLabel,
    sellerKey: sellerIdentityKeyForReceipt(receipt),
    catalogNamespace: receipt.catalogNamespace,
    observedAt: receipt.purchasedAt,
    martType: martTypeFor(receipt),
    source: "receipt",
  })));
}

export function groupProductObservations(listings: ProductObservationListing[]): ProductGroup[] {
  const grouped = new Map<string, ProductObservationListing[]>();
  for (const listing of listings) {
    const normalizedName = normalizeReceiptProductName(listing.item.productName);
    const productCode = listing.item.sourceProductCode.trim();
    const id = productCode ? `${listing.storeLabel}:${productCode}:${normalizedName}` : `${listing.storeLabel}:${normalizedName}`;
    grouped.set(id, [...(grouped.get(id) ?? []), listing]);
  }
  return [...grouped.entries()].map(([id, observations]) => {
    const ordered = [...observations].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
    const latest = ordered[0];
    return {
      id,
      sourceProductCode: latest.item.sourceProductCode,
      productName: latest.item.productName,
      storeLabel: latest.storeLabel,
      sellerKey: sellerIdentityKey(latest),
      catalogNamespace: latest.catalogNamespace,
      martType: latest.martType,
      category: categoryForProduct(latest.item.productName),
      latest,
      observations: ordered,
      latestPriceKrw: latest.item.unitPriceKrw,
      minimumPriceKrw: Math.min(...ordered.map((observation) => observation.item.unitPriceKrw)),
    };
  });
}

export function mergeOfficialProductGroups(groups: ProductGroup[]): ProductGroup[] {
  const codesByMartAndName = new Map<string, Set<string>>();
  for (const group of groups) {
    const base = `${martTagFor(group).toLocaleLowerCase("ko-KR")}:${normalizeExactReceiptProductName(group.productName)}`;
    const code = group.sourceProductCode.trim();
    if (code) codesByMartAndName.set(base, new Set([...(codesByMartAndName.get(base) ?? []), code]));
  }

  const merged = new Map<string, ProductGroup>();
  for (const group of groups) {
    const sharedBase = `${martTagFor(group).toLocaleLowerCase("ko-KR")}:${normalizeExactReceiptProductName(group.productName)}`;
    const knownCodes = codesByMartAndName.get(sharedBase) ?? new Set<string>();
    const ownCode = group.sourceProductCode.trim();
    const resolvedCode = ownCode || (knownCodes.size === 1 ? [...knownCodes][0] : "");
    const sharedMartKey = resolvedCode || knownCodes.size === 0
      ? `mart:${sharedBase}:${resolvedCode || "no-code"}`
      : null;
    const key = group.officialProduct
      ? `official:${group.officialProduct.officialUrl}`
      : sharedMartKey ?? `source:${group.id}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, { ...group, sourceStoreLabel: group.storeLabel, sharedCatalogProduct: Boolean(sharedMartKey) }); continue; }
    const observations = [...existing.observations, ...group.observations].sort((left, right) => right.observedAt.localeCompare(left.observedAt));
    const latest = observations[0];
    const sellers = latestSellerRows(observations).map((seller) => seller.storeLabel);
    merged.set(key, { ...existing, id: key, storeLabel: sellers.join(", "), sellerKey: sellerIdentityKey(latest), observations, latest, latestPriceKrw: latest.item.unitPriceKrw, minimumPriceKrw: Math.min(...observations.map((observation) => observation.item.unitPriceKrw)), sharedCatalogProduct: existing.sharedCatalogProduct || Boolean(sharedMartKey) });
  }
  return [...merged.values()];
}

export function filterAndSortProductGroups(groups: ProductGroup[], options: {
  query: string;
  category: ProductCategory;
  martType: MartType;
  storeLabel: string;
  sort: ProductSort;
}) {
  const normalizedQuery = options.query.trim().toLowerCase();
  return groups
    .filter((group) => options.martType === "all" || group.martType === options.martType)
    .filter((group) => options.storeLabel === "all" || group.storeLabel === options.storeLabel)
    .filter((group) => options.category === "전체" || group.category === options.category)
    .filter((group) => !normalizedQuery || `${group.productName} ${group.sourceProductCode} ${group.storeLabel}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => {
      const sellerCount = (group: ProductGroup) => distinctSellerCount(group.observations);
      if (options.sort === "expensive") return b.latestPriceKrw - a.latestPriceKrw || a.productName.localeCompare(b.productName);
      if (options.sort === "sellers") return sellerCount(b) - sellerCount(a) || a.productName.localeCompare(b.productName);
      return a.minimumPriceKrw - b.minimumPriceKrw || a.productName.localeCompare(b.productName);
    });
}
