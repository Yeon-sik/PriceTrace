import type { Receipt, ReceiptItem } from "./types";

export const PRODUCT_CATEGORIES = ["전체", "식품", "생활용품", "주방용품", "신선식품", "음료", "간식", "미분류"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type MartType = "all" | "regular" | "px";
export type ProductSort = "recent" | "lowest" | "name" | "observations";

export type ProductObservationListing = {
  id: string;
  item: ReceiptItem;
  storeLabel: string;
  observedAt: string;
  martType: Exclude<MartType, "all">;
};

export type ProductGroup = {
  id: string;
  sourceProductCode: string;
  productName: string;
  storeLabel: string;
  martType: Exclude<MartType, "all">;
  category: ProductCategory;
  latest: ProductObservationListing;
  observations: ProductObservationListing[];
  latestPriceKrw: number;
  minimumPriceKrw: number;
};

function martTypeFor(receipt: Receipt): Exclude<MartType, "all"> {
  return /px|군마트/i.test(receipt.storeLabel) || receipt.items.some((item) => /영외/i.test(item.productName)) ? "px" : "regular";
}

export function categoryForProduct(productName: string): ProductCategory {
  const name = productName.toLowerCase();
  if (/샴푸|바디워시|로션|크림|마스크|패드|연고|면도|질레트|쿨토시|런닝|반바지|화장품|세트/.test(name)) return "생활용품";
  if (/커피|우유|주스|음료|에이드|박카스|워터|테이크핏|더위사냥/.test(name)) return "음료";
  if (/과자|초코|초콜릿|팝콘|새우깡|포카칩|아몬드|육포|아이스크림|프리팩|콘|바이트|싸만코|라면|컵누들|도시락/.test(name)) return "간식";
  if (/과일|채소|고기|한돈|닭가슴살|새우|해물|두부|순두부|샤인머스켓|애플망고|고구마/.test(name)) return "신선식품";
  if (/프라이팬|냄비|도마|칼|수세미|주방/.test(name)) return "주방용품";
  if (/쌀|햇반|국수|파스타|소시지|어묵|쌈장|케찹|김|빵|식빵|짜장|우동|탕|불고기|쭈꾸미|골뱅이|양념|폭립/.test(name)) return "식품";
  return "미분류";
}

export function listingsFromReceipts(receipts: Receipt[]): ProductObservationListing[] {
  return receipts.flatMap((receipt) => receipt.items.map((item) => ({
    id: `${receipt.id}:${item.id}`,
    item,
    storeLabel: receipt.storeLabel,
    observedAt: receipt.purchasedAt,
    martType: martTypeFor(receipt),
  })));
}

export function groupProductObservations(listings: ProductObservationListing[]): ProductGroup[] {
  const grouped = new Map<string, ProductObservationListing[]>();
  for (const listing of listings) {
    const id = `${listing.storeLabel}:${listing.item.sourceProductCode}`;
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
      martType: latest.martType,
      category: categoryForProduct(latest.item.productName),
      latest,
      observations: ordered,
      latestPriceKrw: latest.item.unitPriceKrw,
      minimumPriceKrw: Math.min(...ordered.map((observation) => observation.item.unitPriceKrw)),
    };
  });
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
      if (options.sort === "lowest") return a.minimumPriceKrw - b.minimumPriceKrw || a.productName.localeCompare(b.productName);
      if (options.sort === "name") return a.productName.localeCompare(b.productName);
      if (options.sort === "observations") return b.observations.length - a.observations.length || a.productName.localeCompare(b.productName);
      return b.latest.observedAt.localeCompare(a.latest.observedAt) || a.productName.localeCompare(b.productName);
    });
}
