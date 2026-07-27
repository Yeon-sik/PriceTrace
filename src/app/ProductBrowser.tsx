"use client";

import { useEffect, useMemo, useState } from "react";
import { categoryForProduct, filterAndSortProductGroups, mergeOfficialProductGroups, PRODUCT_CATEGORIES, type MartType, type ProductCategory, type ProductGroup, type ProductSort } from "@/domain/product-browser";
import { buildPublicStandardCatalogIndex, PublicStandardCatalogRowsSchema, type PublicCoupangPrice } from "@/domain/public-standard-catalog";
import { sellerPricePointsFromGroup, summarizeSellerPrices } from "@/domain/seller-price-insights";
import { formatKrw } from "@/domain/settlement";
import { officialProductCandidateKey, seededOfficialProducts, type OfficialProductRecord } from "@/domain/official-product";
import { normalizeMarketPrice, type ProductSpecification } from "@/domain/canonical-price";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import { ProductImage } from "./ProductImage";
import { StandardProductDetailModal } from "./StandardProductDetailModal";
import { StoreListModal } from "./StoreListModal";
import styles from "./page.module.css";

const officialProductRepository = new OfficialProductRepository();

export type StandardProductItem = ProductGroup & { unitPriceLabel: string; unitPriceKrw: number; packageLabel: string; referenceUnit: number };

export type CoupangPrice = {
  unitPriceKrw: number | null;
  referenceLabel: string | null;
  listedPriceKrw: number;
  quantity: number;
  contentAmount: number | null;
  contentUnit: ProductSpecification["contentUnit"] | null;
  productUrl: string;
  observedAt: string;
};

export type PriceHistoryPoint = { date: string; unitPriceKrw: number; unitPriceLabel: string; actualPriceKrw: number; storeLabel: string };

export type StandardProductGroup = {
  id: string;
  name: string;
  category: ProductCategory;
  items: StandardProductItem[];
  lowestUnitPriceKrw: number;
  highestUnitPriceKrw: number;
  unitPriceLabel: string;
  lowestPriceKrw: number;
  lowestSellerLabel: string;
  lowestSellerGroupLabel: string;
  sellerCount: number;
  latestObservedAt: string;
  observationCount: number;
  coupangPrice: CoupangPrice | null;
  cheapestVsCoupang: { storeLabel: string; differenceKrw: number } | null;
  priceHistory: PriceHistoryPoint[];
};

function formatPackageLabel(spec: ProductSpecification) {
  const unitLabel = spec.contentUnit === "each" ? "개" : spec.contentUnit;
  const base = `${spec.contentAmount}${unitLabel}`;
  return spec.packageCount > 1 ? `${base} x ${spec.packageCount}` : base;
}

function StoreInfo({ sellerCount, martTypeLabel, onOpen }: { sellerCount: number; martTypeLabel?: string; onOpen: () => void }) {
  return <p className={styles.storeInfo}>판매처 {sellerCount}곳{martTypeLabel && <em>{martTypeLabel}</em>}<button type="button" className={styles.storeInfoButton} aria-label="판매처 정보 보기" onClick={onOpen}>›</button></p>;
}

function buildCoupangPrice(entry: PublicCoupangPrice, referenceUnit: number): CoupangPrice {
  const specification = entry.contentAmount !== null && entry.contentUnit !== null
    ? { contentAmount: entry.contentAmount, contentUnit: entry.contentUnit, packageCount: entry.quantity, referenceUnit: referenceUnit as 10 | 100 | 1000 }
    : null;
  const normalized = specification
    ? normalizeMarketPrice({ sellerName: "쿠팡", listedPriceKrw: entry.listedPriceKrw, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: entry.observedAt, verificationStatus: "verified" }, specification)
    : null;
  return {
    unitPriceKrw: normalized?.pricePerReferenceUnitKrw ?? null,
    referenceLabel: normalized?.referenceLabel ?? null,
    listedPriceKrw: entry.listedPriceKrw,
    quantity: entry.quantity,
    contentAmount: entry.contentAmount,
    contentUnit: entry.contentUnit,
    productUrl: entry.productUrl,
    observedAt: entry.observedAt,
  };
}

function cheaperThanCoupang(lowest: StandardProductItem, coupangPrice: CoupangPrice | null) {
  if (!coupangPrice || coupangPrice.unitPriceKrw === null || coupangPrice.referenceLabel !== lowest.unitPriceLabel || lowest.unitPriceKrw >= coupangPrice.unitPriceKrw) return null;
  return { storeLabel: lowest.storeLabel, differenceKrw: coupangPrice.unitPriceKrw - lowest.unitPriceKrw };
}

function sellerGroupLabel(group: Pick<ProductGroup, "martType" | "storeLabel">) {
  if (group.martType === "px") return "PX";
  return group.storeLabel.replace(/\s+\S+점$/, "").trim() || "일반 마트";
}

function RecordedPriceBlock({ group }: { group: ProductGroup }) {
  return <div className={styles.listedPrice}><strong>{formatKrw(group.latestPriceKrw)}</strong></div>;
}

export function ProductBrowser({ groups, query, setQuery, category, setCategory, martType, setMartType, selectedStore, setSelectedStore, sort, setSort, authRevision, onAdd, onTrend, onOpenStore }: {
  groups: ProductGroup[]; query: string; setQuery: (value: string) => void; category: ProductCategory; setCategory: (value: ProductCategory) => void; martType: MartType; setMartType: (value: MartType) => void; selectedStore: string; setSelectedStore: (value: string) => void; sort: ProductSort; setSort: (value: ProductSort) => void; authRevision: number; onAdd: (group: ProductGroup) => void; onTrend: (group: ProductGroup) => void; onOpenStore: (store: string) => void;
}) {
  const client = getSupabaseBrowserClient();
  const [officialProducts, setOfficialProducts] = useState<Record<string, OfficialProductRecord>>(seededOfficialProducts);
  const [standardMappings, setStandardMappings] = useState<Map<string, string>>(new Map());
  const [exactStandardMappings, setExactStandardMappings] = useState<Map<string, string>>(new Map());
  const [catalogSpecs, setCatalogSpecs] = useState<Map<string, ProductSpecification & { standardProductId: string }>>(new Map());
  const [standardNames, setStandardNames] = useState<Map<string, string>>(new Map());
  const [coupangByStandard, setCoupangByStandard] = useState<Map<string, PublicCoupangPrice>>(new Map());
  const [catalogNotice, setCatalogNotice] = useState("");
  const [showStandardOnly, setShowStandardOnly] = useState(false);
  const [openStandardId, setOpenStandardId] = useState<string | null>(null);
  const [storeListTarget, setStoreListTarget] = useState<{ title: string; rows: { storeLabel: string; observedAt: string }[] } | null>(null);
  useEffect(() => setOfficialProducts({ ...seededOfficialProducts, ...officialProductRepository.loadAll() }), []);
  useEffect(() => {
    let active = true;
    if (!client) {
      setCatalogNotice("표준 상품 정보를 불러오지 못해 현재는 개별 상품으로 표시합니다.");
      return () => { active = false; };
    }

    const loadStandardCatalog = async () => {
      let publicCatalogReady = false;
      let signedInCatalogReady = false;
      let coupangReady = false;
      let sharedMappings = new Map<string, string>();
      const exactMappings = new Map<string, string>();
      let specs = new Map<string, ProductSpecification & { standardProductId: string }>();
      let names = new Map<string, string>();
      let coupangPrices = new Map<string, PublicCoupangPrice>();

      const publicResult = await client.rpc("get_public_standard_product_catalog");
      if (!publicResult.error) {
        const parsed = PublicStandardCatalogRowsSchema.safeParse(publicResult.data ?? []);
        if (parsed.success) {
          const publicIndex = buildPublicStandardCatalogIndex(parsed.data);
          sharedMappings = publicIndex.standardMappings;
          specs = publicIndex.catalogSpecs;
          names = publicIndex.standardNames;
          coupangPrices = publicIndex.coupangByStandard;
          publicCatalogReady = true;
          coupangReady = true;
        }
      }

      const { data: authData } = await client.auth.getUser();
      if (authData.user) {
        const [mappingResult, catalogResult, standardResult, coupangResult] = await Promise.all([
          client.from("source_product_mappings").select("source_label,source_product_code,catalog_product_id").eq("review_status", "verified"),
          client.from("catalog_products").select("id,standard_product_id,content_amount,content_unit,package_count,reference_unit").eq("status", "active"),
          client.from("standard_products").select("id,canonical_name").eq("status", "active"),
          client.from("standard_product_coupang_prices").select("standard_product_id,listed_price_krw,quantity,content_amount,content_unit,product_url,observed_at").order("observed_at", { ascending: false }),
        ]);
        if (!mappingResult.error) {
          for (const mapping of mappingResult.data ?? []) exactMappings.set(`${mapping.source_label}:${mapping.source_product_code}`, mapping.catalog_product_id as string);
        }
        if (!catalogResult.error) {
          specs = new Map([
            ...specs,
            ...(catalogResult.data ?? [])
              .filter((row) => row.content_amount && row.content_unit)
              .map((row) => [row.id as string, { contentAmount: row.content_amount as number, contentUnit: row.content_unit as ProductSpecification["contentUnit"], packageCount: row.package_count as number, referenceUnit: row.reference_unit as 10 | 100 | 1000, standardProductId: row.standard_product_id as string }] as const),
          ]);
        }
        if (!standardResult.error) {
          names = new Map([...names, ...(standardResult.data ?? []).map((row) => [row.id as string, row.canonical_name as string] as const)]);
        }
        if (!coupangResult.error) {
          const mergedCoupang = new Map(coupangPrices);
          for (const row of coupangResult.data ?? []) {
            const standardProductId = row.standard_product_id as string;
            const existing = mergedCoupang.get(standardProductId);
            if (!existing || (row.observed_at as string) > existing.observedAt) mergedCoupang.set(standardProductId, {
              listedPriceKrw: row.listed_price_krw as number,
              quantity: row.quantity as number,
              contentAmount: row.content_amount as number | null,
              contentUnit: row.content_unit as ProductSpecification["contentUnit"] | null,
              productUrl: row.product_url as string,
              observedAt: row.observed_at as string,
            });
          }
          coupangPrices = mergedCoupang;
          coupangReady = true;
        }
        signedInCatalogReady = !mappingResult.error && !catalogResult.error && !standardResult.error;
      }

      if (!active) return;
      setStandardMappings(sharedMappings);
      setExactStandardMappings(exactMappings);
      setCatalogSpecs(specs);
      setStandardNames(names);
      setCoupangByStandard(coupangPrices);
      setCatalogNotice(
        !publicCatalogReady && !signedInCatalogReady
          ? "표준 상품 정보를 불러오지 못해 현재는 개별 상품으로 표시합니다."
          : !coupangReady
            ? "표준 상품은 표시하지만 쿠팡 가격 정보를 불러오지 못했습니다."
            : "",
      );
    };

    void loadStandardCatalog();
    return () => { active = false; };
  }, [authRevision, client]);

  const { productGroups, standardGroups } = useMemo(() => {
    const standardBuckets = new Map<string, StandardProductItem[]>();
    const historyBuckets = new Map<string, PriceHistoryPoint[]>();
    const regular: ProductGroup[] = [];
    for (const group of groups) {
      const key = officialProductCandidateKey(group);
      const withOfficial = officialProducts[key] ? { ...group, officialProduct: officialProducts[key] } : group;
      const catalogProductId = exactStandardMappings.get(`${group.storeLabel}:${group.sourceProductCode}`)
        ?? (group.catalogNamespace ? standardMappings.get(group.sourceProductCode) : undefined);
      const spec = catalogProductId ? catalogSpecs.get(catalogProductId) : undefined;
      if (!spec) { regular.push(withOfficial); continue; }
      const unitPrice = normalizeMarketPrice({ sellerName: group.storeLabel, listedPriceKrw: group.latestPriceKrw, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: group.latest.observedAt, verificationStatus: "verified" }, spec);
      const item: StandardProductItem = { ...withOfficial, unitPriceLabel: unitPrice.referenceLabel, unitPriceKrw: unitPrice.pricePerReferenceUnitKrw, packageLabel: formatPackageLabel(spec), referenceUnit: spec.referenceUnit ?? 100 };
      standardBuckets.set(spec.standardProductId, [...(standardBuckets.get(spec.standardProductId) ?? []), item]);
      const historyPoints = group.observations.map((observation): PriceHistoryPoint => {
        const normalized = normalizeMarketPrice({ sellerName: group.storeLabel, listedPriceKrw: observation.item.unitPriceKrw, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: observation.observedAt, verificationStatus: "verified" }, spec);
        return { date: observation.observedAt, unitPriceKrw: normalized.pricePerReferenceUnitKrw, unitPriceLabel: normalized.referenceLabel, actualPriceKrw: observation.item.unitPriceKrw, storeLabel: group.storeLabel };
      });
      historyBuckets.set(spec.standardProductId, [...(historyBuckets.get(spec.standardProductId) ?? []), ...historyPoints]);
    }
    const standards: StandardProductGroup[] = [...standardBuckets.entries()].map(([standardProductId, items]) => {
      const ordered = [...items].sort((a, b) => a.unitPriceKrw - b.unitPriceKrw);
      const lowest = ordered[0];
      const name = standardNames.get(standardProductId) ?? lowest.productName;
      const coupangEntry = coupangByStandard.get(standardProductId);
      const coupangPrice = coupangEntry ? buildCoupangPrice(coupangEntry, lowest.referenceUnit) : null;
      const cheapestVsCoupang = cheaperThanCoupang(lowest, coupangPrice);
      const comparableItems = ordered.filter((item) => item.unitPriceLabel === lowest.unitPriceLabel);
      const bestByDate = new Map<string, PriceHistoryPoint>();
      for (const point of historyBuckets.get(standardProductId) ?? []) {
        const existing = bestByDate.get(point.date);
        if (!existing || point.unitPriceKrw < existing.unitPriceKrw) bestByDate.set(point.date, point);
      }
      const priceHistory = [...bestByDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
      return {
        id: `standard:${standardProductId}`,
        name,
        category: categoryForProduct(name),
        items: ordered,
        lowestUnitPriceKrw: lowest.unitPriceKrw,
        highestUnitPriceKrw: Math.max(...comparableItems.map((item) => item.unitPriceKrw)),
        unitPriceLabel: lowest.unitPriceLabel,
        lowestPriceKrw: lowest.latestPriceKrw,
        lowestSellerLabel: lowest.storeLabel,
        lowestSellerGroupLabel: sellerGroupLabel(lowest),
        sellerCount: new Set(items.map((item) => item.storeLabel)).size,
        latestObservedAt: items.reduce((latest, item) => (item.latest.observedAt > latest ? item.latest.observedAt : latest), items[0].latest.observedAt),
        observationCount: items.reduce((sum, item) => sum + item.observations.length, 0),
        coupangPrice,
        cheapestVsCoupang,
        priceHistory,
      };
    });
    return { productGroups: regular, standardGroups: standards };
  }, [groups, officialProducts, standardMappings, exactStandardMappings, catalogSpecs, standardNames, coupangByStandard]);

  const stores = useMemo(() => [...new Set([
    ...productGroups.filter((group) => martType === "all" || group.martType === martType).map((group) => group.storeLabel),
    ...standardGroups.flatMap((standard) => standard.items).filter((item) => martType === "all" || item.martType === martType).map((item) => item.storeLabel),
  ])].sort(), [martType, productGroups, standardGroups]);

  const visibleGroups = useMemo(() => mergeOfficialProductGroups(filterAndSortProductGroups(productGroups, { query, category, martType, storeLabel: selectedStore, sort })), [category, martType, query, selectedStore, sort, productGroups]);

  const visibleStandardGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return standardGroups
      .map((standard) => {
        const items = standard.items.filter((item) => (martType === "all" || item.martType === martType) && (selectedStore === "all" || item.storeLabel === selectedStore));
        if (items.length === 0) return { ...standard, items };
        const lowest = [...items].sort((left, right) => left.unitPriceKrw - right.unitPriceKrw || right.latest.observedAt.localeCompare(left.latest.observedAt))[0];
        const coupangEntry = coupangByStandard.get(standard.id.replace("standard:", ""));
        const coupangPrice = coupangEntry ? buildCoupangPrice(coupangEntry, lowest.referenceUnit) : standard.coupangPrice;
        const cheapestVsCoupang = cheaperThanCoupang(lowest, coupangPrice);
        const comparableItems = items.filter((item) => item.unitPriceLabel === lowest.unitPriceLabel);
        return {
          ...standard,
          items,
          lowestUnitPriceKrw: lowest.unitPriceKrw,
          highestUnitPriceKrw: Math.max(...comparableItems.map((item) => item.unitPriceKrw)),
          unitPriceLabel: lowest.unitPriceLabel,
          lowestPriceKrw: lowest.latestPriceKrw,
          lowestSellerLabel: lowest.storeLabel,
          lowestSellerGroupLabel: sellerGroupLabel(lowest),
          sellerCount: new Set(items.map((item) => item.storeLabel)).size,
          latestObservedAt: items.reduce((latest, item) => item.latest.observedAt > latest ? item.latest.observedAt : latest, items[0].latest.observedAt),
          observationCount: items.reduce((sum, item) => sum + item.observations.length, 0),
          coupangPrice,
          cheapestVsCoupang,
        };
      })
      .filter((standard) => standard.items.length > 0)
      .filter((standard) => category === "전체" || standard.category === category)
      .filter((standard) => !normalizedQuery || `${standard.name} ${standard.items.map((item) => `${item.productName} ${item.sourceProductCode} ${item.storeLabel}`).join(" ")}`.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        if (sort === "expensive") return b.lowestUnitPriceKrw - a.lowestUnitPriceKrw || a.name.localeCompare(b.name);
        if (sort === "sellers") return b.sellerCount - a.sellerCount || a.name.localeCompare(b.name);
        return a.lowestUnitPriceKrw - b.lowestUnitPriceKrw || a.name.localeCompare(b.name);
      });
  }, [standardGroups, coupangByStandard, query, category, martType, selectedStore, sort]);

  const gridEntries = useMemo(() => {
    type Entry = { kind: "standard"; standard: StandardProductGroup } | { kind: "product"; group: ProductGroup };
    const standardEntries: Entry[] = visibleStandardGroups.map((standard) => ({ kind: "standard" as const, standard }));
    const entries: Entry[] = showStandardOnly
      ? standardEntries
      : [...standardEntries, ...visibleGroups.map((group) => ({ kind: "product" as const, group }))];
    const priceOf = (entry: Entry) => {
      if (entry.kind === "standard") return entry.standard.lowestUnitPriceKrw;
      const latestOffers = summarizeSellerPrices(sellerPricePointsFromGroup(entry.group));
      return sort === "expensive"
        ? Math.max(...latestOffers.map((offer) => offer.latestPriceKrw))
        : latestOffers[0]?.latestPriceKrw ?? entry.group.latestPriceKrw;
    };
    const sellersOf = (entry: Entry) => entry.kind === "standard" ? entry.standard.sellerCount : new Set(entry.group.observations.map((observation) => observation.storeLabel)).size;
    const nameOf = (entry: Entry) => entry.kind === "standard" ? entry.standard.name : entry.group.productName;
    return entries.sort((a, b) => {
      if (sort === "sellers") return sellersOf(b) - sellersOf(a) || nameOf(a).localeCompare(nameOf(b));
      if (sort === "expensive") return priceOf(b) - priceOf(a) || nameOf(a).localeCompare(nameOf(b));
      return priceOf(a) - priceOf(b) || nameOf(a).localeCompare(nameOf(b));
    });
  }, [visibleStandardGroups, visibleGroups, showStandardOnly, sort]);

  const openStandard = visibleStandardGroups.find((standard) => standard.id === openStandardId) ?? null;

  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>PRODUCT CATALOG</p><h1>상품 목록</h1><p>표준 상품 : 공식 상품에 연결되어 단위 가격 파악이 가능한 상품</p></div><label className={styles.search}><span aria-hidden="true">⌕</span><span className={styles.srOnly}>상품 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명, 판매처 코드, 판매 마트 검색" /></label></div>
    {catalogNotice && <p className={styles.dataNotice} role="status">{catalogNotice}</p>}
    <div className={styles.marketControls}>
      <div className={styles.segmented} aria-label="판매처 유형">{([ ["all", "전체"], ["regular", "일반 마트"], ["px", "PX (군마트)"] ] as const).map(([value, label]) => <button key={value} aria-pressed={martType === value} className={martType === value ? styles.selectedSegment : ""} onClick={() => { setMartType(value); setSelectedStore("all"); }}>{label}</button>)}</div>
      <div className={styles.segmented} aria-label="상품 유형">
        <button type="button" aria-pressed={!showStandardOnly} className={!showStandardOnly ? styles.selectedSegment : ""} onClick={() => setShowStandardOnly(false)}>전체 상품</button>
        <button type="button" aria-pressed={showStandardOnly} className={showStandardOnly ? styles.selectedSegment : ""} onClick={() => setShowStandardOnly(true)}>표준 상품만 보기</button>
      </div>
      <label className={styles.storeSelect}>판매 마트<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><option value="all">전체 마트</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
      <label className={styles.sortSelect}>정렬<select value={sort} onChange={(event) => setSort(event.target.value as ProductSort)}><option value="expensive">비싼 물품 순</option><option value="cheap">저렴한 물품 순</option><option value="sellers">판매처 많은 물품 순</option></select></label>
    </div>
    <div className={styles.filters} aria-label="상품 카테고리">{PRODUCT_CATEGORIES.map((item) => <button aria-pressed={category === item} className={category === item ? styles.filterActive : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className={styles.resultBar}><p>상품 {gridEntries.length}개</p>{(query || category !== "전체" || martType !== "all" || selectedStore !== "all" || showStandardOnly) && <button onClick={() => { setQuery(""); setCategory("전체"); setMartType("all"); setSelectedStore("all"); setShowStandardOnly(false); }}>필터 초기화</button>}</div>
    <div className={styles.productGrid} aria-live="polite">{gridEntries.map((entry) => entry.kind === "standard"
      ? <article className={styles.productCard} key={entry.standard.id}><div className={styles.productVisual}><ProductImage item={entry.standard.items[0].latest.item} category={entry.standard.category} /></div><div className={styles.productInfo}><h2>{entry.standard.name}</h2><StoreInfo sellerCount={entry.standard.sellerCount} onOpen={() => setStoreListTarget({ title: `${entry.standard.name} 판매처`, rows: entry.standard.items.map((item) => ({ storeLabel: item.storeLabel, observedAt: item.latest.observedAt })) })} /><div className={styles.standardPriceBlock}><strong>{formatKrw(entry.standard.lowestPriceKrw)} ~</strong><small>{entry.standard.unitPriceLabel} {formatKrw(entry.standard.lowestUnitPriceKrw)} ~ {formatKrw(entry.standard.highestUnitPriceKrw)}</small>{entry.standard.cheapestVsCoupang && <small className={styles.cheaperThanCoupang}>{entry.standard.unitPriceLabel} 기준 쿠팡보다 {entry.standard.lowestSellerGroupLabel}가 {formatKrw(entry.standard.cheapestVsCoupang.differenceKrw)} 저렴해요</small>}</div><button aria-label={`${entry.standard.name} 하위 상품 보기`} onClick={() => setOpenStandardId(entry.standard.id)}>판매처 가격 기준 비교 보기 ›</button></div></article>
      : <article className={styles.productCard} key={entry.group.id}><div className={styles.productVisual}><ProductImage item={entry.group.latest.item} category={entry.group.category} /></div><div className={styles.productInfo}><h2>{entry.group.officialProduct?.officialName ?? entry.group.productName}</h2><StoreInfo sellerCount={new Set(entry.group.observations.map((observation) => observation.storeLabel)).size} onOpen={() => setStoreListTarget({ title: `${entry.group.productName} 판매처`, rows: entry.group.observations.map((observation) => ({ storeLabel: observation.storeLabel, observedAt: observation.observedAt })) })} /><RecordedPriceBlock group={entry.group} /><div className={styles.productActions}><button className={styles.trendButton} aria-label={`${entry.group.productName} 가격 이력 보기`} onClick={() => onTrend(entry.group)}>가격 이력</button><button aria-label={`${entry.group.productName} 장바구니에 담기`} onClick={() => onAdd(entry.group)}>+ 담기</button></div></div></article>)}</div>
    {gridEntries.length === 0 && <div className={styles.noResult}><strong>조건에 맞는 상품이 없습니다.</strong></div>}
    {openStandard && <StandardProductDetailModal standard={openStandard} onClose={() => setOpenStandardId(null)} onOpenStore={onOpenStore} />}
    {storeListTarget && <StoreListModal title={storeListTarget.title} rows={storeListTarget.rows} onClose={() => setStoreListTarget(null)} onOpenStore={onOpenStore} />}
  </section>;
}
