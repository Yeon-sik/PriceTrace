import type { Receipt, ReceiptItem } from "./types";
import type { OfficialProductRecord } from "./official-product";

export const PRODUCT_CATEGORY_GROUPS = [
  {
    category: "식품",
    children: [
      "신선식품", "육류", "수산물", "과일", "채소", "두부·달걀",
      "즉석면·떡국", "국수·파스타·당면", "간편식·냉동식품", "빵·베이커리",
      "반찬·김·통조림", "조미료·소스", "쌀·가루류", "육가공·어묵", "건강기능식품",
    ],
  },
  {
    category: "음료",
    children: ["커피·차", "주스·유산균음료", "단백질음료", "건강·에너지음료", "주류"],
  },
  {
    category: "간식",
    children: ["스낵·과자", "아이스크림", "초콜릿·디저트", "육포·단백질간식"],
  },
  {
    category: "뷰티",
    children: ["로션·크림", "선케어", "피부관리", "샴푸·헤어케어", "바디케어", "면도용품"],
  },
  {
    category: "생활용품",
    children: ["세탁·청소", "종이·일회용품", "건강·위생용품"],
  },
  { category: "주방용품", children: ["조리도구", "식기·보관용기"] },
  { category: "의류·패션", children: ["의류", "속옷", "패션잡화"] },
  { category: "스포츠·레저", children: ["스포츠용품", "아웃도어·레저"] },
  { category: "자동차용품", children: ["자동차 관리용품"] },
  { category: "전자제품", children: ["디지털기기", "생활가전"] },
  { category: "기타", children: [] },
  { category: "미분류", children: [] },
] as const;

export const PRODUCT_CATEGORY_ROOTS = [
  "전체", ...PRODUCT_CATEGORY_GROUPS.map((group) => group.category),
] as const;

export const PRODUCT_CATEGORIES = [
  "전체",
  ...PRODUCT_CATEGORY_GROUPS.flatMap((group) => [group.category, ...group.children]),
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductCategoryRoot = Exclude<(typeof PRODUCT_CATEGORY_ROOTS)[number], "전체">;
export type MartType = "all" | "regular" | "px";
export type ProductSort = "expensive" | "cheap" | "sellers";

const CATALOG_CATEGORY_DISPLAY_ALIASES: Readonly<Record<string, ProductCategory>> = {
  "가공식품": "식품",
  "축산·수산": "신선식품",
  "간식·디저트": "간식",
  "건강식품": "식품",
  "스킨케어": "뷰티",
  "헤어·바디": "뷰티",
  "면도·그루밍": "뷰티",
};

export function productCategoryFromCatalogDisplayName(displayName: string): ProductCategory {
  const direct = (PRODUCT_CATEGORIES as readonly string[]).includes(displayName)
    ? displayName as ProductCategory
    : null;
  return direct ?? CATALOG_CATEGORY_DISPLAY_ALIASES[displayName] ?? "미분류";
}

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

export function productCategoryRoot(category: ProductCategory): ProductCategoryRoot | null {
  if (category === "전체") return null;
  const group = PRODUCT_CATEGORY_GROUPS.find((candidate) => (
    candidate.category === category
    || (candidate.children as readonly string[]).includes(category)
  ));
  return group?.category ?? null;
}

export function productSubcategories(category: ProductCategoryRoot): readonly ProductCategory[] {
  return PRODUCT_CATEGORY_GROUPS.find((group) => group.category === category)?.children ?? [];
}

export function productCategoryMatches(filter: ProductCategory, productCategory: ProductCategory) {
  if (filter === "전체" || filter === productCategory) return true;
  if (filter === "신선식품" && [
    "육류", "수산물", "과일", "채소", "두부·달걀",
  ].includes(productCategory)) return true;
  return productCategoryRoot(filter) === filter && productCategoryRoot(productCategory) === filter;
}

export function categoryForProduct(productName: string): ProductCategory {
  const name = productName.normalize("NFKC").toLocaleLowerCase("ko-KR");

  // Non-food rules come first so generic words such as 크림, 세트, 우유 do
  // not leak beauty and household products into food categories.
  if (/세탁세제|세탁 ?세제|비트 트리플|섬유유연제|표백제|청소포|세정제/.test(name)) return "세탁·청소";
  if (/종량제 ?봉투|재사용 ?봉투|키친타월|화장지|티슈|일회용/.test(name)) return "종이·일회용품";
  if (/마스크팩|시트 ?마스크|앰플 ?마스크|겔 ?마스크|진정 ?마스크|수딩 ?패드|스팟패드|클리어크림|연고/.test(name)) return "피부관리";
  if (/쿨파스|파스(?:$|[ (])|밴드|보건용 ?마스크|미세먼지.*마스크|kf ?\d+ ?마스크|위생|소독/.test(name)) return "건강·위생용품";
  if (/프라이팬|후라이팬|냄비|도마|주방 ?가위|식도|과도|수세미|국자|뒤집개|주걱/.test(name)) return "조리도구";
  if (/젓가락|수저|밀폐용기|보관용기|찬통|반찬통|텀블러|식기|접시/.test(name)) return "식기·보관용기";
  if (/런닝|드로우|팬티|브라/.test(name)) return "속옷";
  if (/반바지|긴바지|티셔츠|셔츠|재킷|자켓|의류/.test(name)) return "의류";
  if (/라켓|리스트 ?랩|보호대|덤벨|운동용품/.test(name)) return "스포츠용품";
  if (/쿨토시|캠핑|등산|아웃도어/.test(name)) return "아웃도어·레저";
  if (/rainok|와이퍼|카샴푸|자동차/.test(name)) return "자동차 관리용품";
  if (/이어폰|충전기|보조배터리|스마트워치|태블릿/.test(name)) return "디지털기기";
  if (/전기포트|선풍기|청소기|가습기/.test(name)) return "생활가전";
  if (/면도날|면도기|쉐이빙|질레트/.test(name)) return "면도용품";
  if (/샴푸|트리트먼트|컨디셔너|헤어/.test(name)) return "샴푸·헤어케어";
  if (/바디워시|바디 ?바|바디 .* 바|바디로션/.test(name)) return "바디케어";
  if (/선크림|선스틱|선로션|자외선/.test(name)) return "선케어";
  if (/로션|수분 ?크림|스네일 ?크림|보습 ?크림/.test(name)) return "로션·크림";

  // Exact dessert forms precede the ice-cream brand rule. Baskin-Robbins
  // chocolate balls and cubes are shelf-stable snacks, not ice cream.
  if (/테이크핏|더단백.*(?:워터|드링크)|프로틴 ?드링크|단백질 ?음료/.test(name)) return "단백질음료";
  if (/크리스피크림|도넛|글레이즈드/.test(name)) return "빵·베이커리";
  if (/초코볼|초콜릿볼|치즈케이크 ?큐브|스트로베리 ?큐브|베리베리.*큐브/.test(name)) return "초콜릿·디저트";
  if (/프리팩|prepack|모리팩|샤베트|아이스크림|미니컵|월드콘|더위사냥|모나카|싸만코|수박바|참외콘|요맘때|배스킨라빈스|베스킨라빈스|나뚜루/.test(name)) return "아이스크림";
  if (/육포|프로틴바|크런치바|단백질바|하이프로틴바|순살바/.test(name)) return "육포·단백질간식";
  if (/새우깡|포카칩|팝콘|감자칩|스낵|과자/.test(name)) return "스낵·과자";
  if (/초코|초콜릿|도넛|글레이즈드|케이크|쿠키|캔디|젤리/.test(name)) return "초콜릿·디저트";

  if (/발렌타인|조니워커|위스키|소주|맥주|와인|막걸리/.test(name)) return "주류";
  if (/아임리얼|주스|쥬스|에이드|프로젝트 ?윌|요구르트|유산균 ?음료/.test(name)) return "주스·유산균음료";
  if (/박카스|모닝이즈백|에너지 ?드링크|자양강장/.test(name)) return "건강·에너지음료";
  if (/커피|카누|맥심|옥수수수염차|녹차|홍차|보리차|티백/.test(name)) return "커피·차";

  // Prepared meals take precedence over ingredient words such as 새우, 해물,
  // 고기, and over generic noodle terms when the product is a complete meal.
  if (/볶음밥|황금밥알|햇반|컵피자|라자냐|폭립|곰탕|누룽지탕|투움바|부옴바|citydeli|용두동.*쭈꾸미|크림우동|즉석 해물 칼국수/.test(name)) return "간편식·냉동식품";
  if (/정어리튀김/.test(name)) return "육가공·어묵";
  if (/급냉삼겹|대패 ?삼겹|삼겹살|한돈|소고기|한우|목살/.test(name)) return "육류";
  if (/냉동.*관자|키조개|손질바지락|냉동새우살|씨푸드믹스|생선|수산/.test(name)) return "수산물";
  if (/샤인머스켓|애플망고|사과|배(?:$|[ (])|딸기|바나나/.test(name)) return "과일";
  if (/시금치|표고버섯|찐고구마|고구마/.test(name)) return "채소";
  if (/순두부|두부|달걀|계란/.test(name)) return "두부·달걀";

  if (/라면|사발면|컵누들|짜왕|카구리|큰컵|팔도 ?도시락|진짜장|생생우동|세이면|멸치맛쌀국수|고추짜장면|햅쌀 ?떡국|불닭볶음면|간짬뽕|야키소바/.test(name)) return "즉석면·떡국";
  if (/링귀니|스파게티|파스타면|옛날당면|국수면|건면/.test(name)) return "국수·파스타·당면";
  if (/식빵|빵$|베이커리/.test(name)) return "빵·베이커리";
  if (/도시락김|곱창김|김$|골뱅이|참치|통조림/.test(name)) return "반찬·김·통조림";
  if (/쌈장|초장|케찹|케첩|솔트|양념|소스|후추|된장/.test(name)) return "조미료·소스";
  if (/부침가루|튀김가루|밀가루|쌀가루/.test(name)) return "쌀·가루류";
  if (/닭가슴살|소시지|프랑크|로스트비프|어묵|정어리튀김/.test(name)) return "육가공·어묵";
  if (/밀크씨슬|테아닌|비타민|오메가|유산균|영양제/.test(name)) return "건강기능식품";

  if (/쌀|불고기|탕|해물|새우|고기|치즈|버터|튀김|냉동|즉석|간편식|조리식품/.test(name)) return "식품";
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
    .filter((group) => productCategoryMatches(options.category, group.category))
    .filter((group) => !normalizedQuery || `${group.productName} ${group.sourceProductCode} ${group.storeLabel}`.toLowerCase().includes(normalizedQuery))
    .sort((a, b) => {
      const sellerCount = (group: ProductGroup) => distinctSellerCount(group.observations);
      if (options.sort === "expensive") return b.latestPriceKrw - a.latestPriceKrw || a.productName.localeCompare(b.productName);
      if (options.sort === "sellers") return sellerCount(b) - sellerCount(a) || a.productName.localeCompare(b.productName);
      return a.minimumPriceKrw - b.minimumPriceKrw || a.productName.localeCompare(b.productName);
    });
}
