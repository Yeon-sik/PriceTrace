"use client";

import { useEffect, useMemo, useState } from "react";
import { filterAndSortProductGroups, mergeOfficialProductGroups, PRODUCT_CATEGORIES, type MartType, type ProductCategory, type ProductGroup, type ProductSort } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import { officialProductCandidateKey, seededOfficialProducts, type OfficialProductRecord } from "@/domain/official-product";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import { ProductImage } from "./ProductImage";
import { StandardProductCatalog } from "./StandardProductCatalog";
import styles from "./page.module.css";

const officialProductRepository = new OfficialProductRepository();

export function ProductBrowser({ groups, query, setQuery, category, setCategory, martType, setMartType, selectedStore, setSelectedStore, sort, setSort, onAdd, onTrend, onOpenStore }: {
  groups: ProductGroup[]; query: string; setQuery: (value: string) => void; category: ProductCategory; setCategory: (value: ProductCategory) => void; martType: MartType; setMartType: (value: MartType) => void; selectedStore: string; setSelectedStore: (value: string) => void; sort: ProductSort; setSort: (value: ProductSort) => void; onAdd: (group: ProductGroup) => void; onTrend: (group: ProductGroup) => void; onOpenStore: (store: string) => void;
}) {
  const client = getSupabaseBrowserClient();
  const [officialProducts, setOfficialProducts] = useState<Record<string, OfficialProductRecord>>(seededOfficialProducts);
  const [linkedSourceKeys, setLinkedSourceKeys] = useState<Set<string>>(new Set());
  useEffect(() => setOfficialProducts({ ...seededOfficialProducts, ...officialProductRepository.loadAll() }), []);
  useEffect(() => {
    if (!client) return;
    void client.from("source_product_mappings").select("source_label,source_product_code").eq("review_status", "verified").then(({ data, error }) => {
      if (!error) setLinkedSourceKeys(new Set((data ?? []).map((mapping) => `${mapping.source_label}:${mapping.source_product_code}`)));
    });
  }, [client]);

  const catalogGroups = useMemo(() => groups.map((group) => {
    const key = officialProductCandidateKey(group);
    return officialProducts[key] ? { ...group, officialProduct: officialProducts[key] } : group;
  }), [groups, officialProducts]);
  const unlinkedCatalogGroups = useMemo(() => catalogGroups.filter((group) => !linkedSourceKeys.has(`${group.storeLabel}:${group.sourceProductCode}`)), [catalogGroups, linkedSourceKeys]);
  const stores = useMemo(() => [...new Set(unlinkedCatalogGroups.filter((group) => martType === "all" || group.martType === martType).map((group) => group.storeLabel))].sort(), [martType, unlinkedCatalogGroups]);
  const visibleGroups = useMemo(() => mergeOfficialProductGroups(filterAndSortProductGroups(unlinkedCatalogGroups, { query, category, martType, storeLabel: selectedStore, sort })), [category, martType, query, selectedStore, sort, unlinkedCatalogGroups]);

  return <section className={styles.browser}>
    <StandardProductCatalog query={query} sort={sort} />
    <div className={styles.browserHead}><div><p className={styles.kicker}>PRODUCT CATALOG</p><h1>상품 목록</h1><p>표준 상품에 연결된 하위 판매 상품은 통합된 표준 상품 카드에서만 보여 줍니다.</p></div><label className={styles.search}><span aria-hidden="true">⌕</span><span className={styles.srOnly}>상품 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명, 판매처 코드, 판매 마트 검색" /></label></div>
    <div className={styles.marketControls}>
      <div className={styles.segmented} aria-label="판매처 유형">{([ ["all", "전체"], ["regular", "일반 마트"], ["px", "PX (군마트)"] ] as const).map(([value, label]) => <button key={value} aria-pressed={martType === value} className={martType === value ? styles.selectedSegment : ""} onClick={() => { setMartType(value); setSelectedStore("all"); }}>{label}</button>)}</div>
      <label className={styles.storeSelect}>판매 마트<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><option value="all">전체 마트</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
      <label className={styles.sortSelect}>정렬<select value={sort} onChange={(event) => setSort(event.target.value as ProductSort)}><option value="expensive">비싼 물품 순</option><option value="cheap">저렴한 물품 순</option><option value="sellers">판매처 많은 물품 순</option></select></label>
    </div>
    <div className={styles.filters} aria-label="상품 카테고리">{PRODUCT_CATEGORIES.map((item) => <button aria-pressed={category === item} className={category === item ? styles.filterActive : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className={styles.resultBar}><p>미연결 상품 {visibleGroups.length}개 · 표준 상품에 연결된 하위 상품은 위 대표 카드로 통합됩니다.</p>{(query || category !== "전체" || martType !== "all" || selectedStore !== "all") && <button onClick={() => { setQuery(""); setCategory("전체"); setMartType("all"); setSelectedStore("all"); }}>필터 초기화</button>}</div>
    <div className={styles.productGrid} aria-live="polite">{visibleGroups.map((group) => <article className={styles.productCard} key={group.id}><div className={styles.productVisual}><ProductImage item={group.latest.item} category={group.category} /></div><div className={styles.productInfo}><span>{group.officialProduct ? "공식 상품" : group.sharedCatalogProduct ? "공통 카탈로그 상품" : "판매처 상품"} · {group.category}</span><h2>{group.officialProduct?.officialName ?? group.productName}</h2>{group.officialProduct && group.officialProduct.officialName !== group.productName && <p>영수증 표기: {group.productName}</p>}<p className={styles.storeInfo}>판매 마트 <button className={styles.textButton} onClick={() => onOpenStore(group.sourceStoreLabel ?? group.storeLabel)}>{group.sourceStoreLabel ?? group.storeLabel}</button> <em>{group.martType === "px" ? "PX" : "일반"}</em></p><p>최근 관측일 · {group.latest.observedAt} · {group.observations.length}건</p><div className={styles.priceBlock}><small>최근 관측가</small><strong>{formatKrw(group.latestPriceKrw)}</strong>{group.observations.length > 1 && <small>최저 {formatKrw(group.minimumPriceKrw)}</small>}</div><div className={styles.productActions}><button className={styles.trendButton} aria-label={`${group.productName} 가격 이력 보기`} onClick={() => onTrend(group)}>가격 이력</button><button aria-label={`${group.productName} 장바구니에 담기`} onClick={() => onAdd(group)}>+ 담기</button></div></div></article>)}</div>
    {visibleGroups.length === 0 && <div className={styles.noResult}><strong>조건에 맞는 미연결 상품이 없습니다.</strong><p>표준 상품에 연결된 상품은 위 통합 목록에서 확인하세요.</p></div>}
  </section>;
}
