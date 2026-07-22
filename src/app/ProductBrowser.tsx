"use client";

import { useEffect, useMemo, useState } from "react";
import { filterAndSortProductGroups, mergeOfficialProductGroups, PRODUCT_CATEGORIES, type MartType, type ProductCategory, type ProductGroup, type ProductSort } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import { officialProductCandidateKey, seededOfficialProducts, type OfficialProductRecord } from "@/domain/official-product";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import { ProductImage } from "./ProductImage";
import styles from "./page.module.css";

const officialProductRepository = new OfficialProductRepository();

export function ProductBrowser({ groups, query, setQuery, category, setCategory, martType, setMartType, selectedStore, setSelectedStore, sort, setSort, onAdd, onTrend }: {
  groups: ProductGroup[]; query: string; setQuery: (value: string) => void; category: ProductCategory; setCategory: (value: ProductCategory) => void; martType: MartType; setMartType: (value: MartType) => void; selectedStore: string; setSelectedStore: (value: string) => void; sort: ProductSort; setSort: (value: ProductSort) => void; onAdd: (group: ProductGroup) => void; onTrend: (group: ProductGroup) => void;
}) {
  const [officialProducts, setOfficialProducts] = useState<Record<string, OfficialProductRecord>>(seededOfficialProducts);
  useEffect(() => setOfficialProducts({ ...seededOfficialProducts, ...officialProductRepository.loadAll() }), []);
  const catalogGroups = useMemo(() => groups.map((group) => {
    const key = officialProductCandidateKey(group);
    return officialProducts[key] ? { ...group, officialProduct: officialProducts[key] } : group;
  }), [groups, officialProducts]);
  const stores = useMemo(() => [...new Set(catalogGroups.filter((group) => martType === "all" || group.martType === martType).map((group) => group.storeLabel))].sort(), [catalogGroups, martType]);
  const visibleGroups = useMemo(() => mergeOfficialProductGroups(filterAndSortProductGroups(catalogGroups, { query, category, martType, storeLabel: selectedStore, sort })), [catalogGroups, query, category, martType, selectedStore, sort]);
  const linkedCount = catalogGroups.filter((group) => group.officialProduct).length;

  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>PRODUCT CATALOG</p><h1>상품 목록</h1><p>공식 연결 전 상품도 표시합니다. 연결 전 가격 이력은 같은 매장의 동일 영수증 상품명만, 공식 연결 후에는 검증된 같은 공식 상품의 판매처별 관측을 비교합니다.</p></div><label className={styles.search}><span aria-hidden="true">⌕</span><span className={styles.srOnly}>상품 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명, 판매처 코드, 판매 마트 검색" /></label></div>
    <div className={styles.marketControls}><div className={styles.segmented} aria-label="판매처 유형">{([ ["all", "전체"], ["regular", "일반 마트"], ["px", "PX (군마트)"] ] as const).map(([value, label]) => <button key={value} aria-pressed={martType === value} className={martType === value ? styles.selectedSegment : ""} onClick={() => { setMartType(value); setSelectedStore("all"); }}>{label}</button>)}</div><label className={styles.storeSelect}>판매 마트<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><option value="all">전체 마트</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label><label className={styles.sortSelect}>정렬<select value={sort} onChange={(event) => setSort(event.target.value as ProductSort)}><option value="recent">최근 관측일</option><option value="lowest">최저 관측가</option><option value="name">상품명</option><option value="observations">관측 많은 순</option></select></label></div>
    <div className={styles.filters} aria-label="상품 카테고리">{PRODUCT_CATEGORIES.map((item) => <button aria-pressed={category === item} className={category === item ? styles.filterActive : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className={styles.resultBar}><p>{visibleGroups.length}개 상품 · 공식 연결 {linkedCount}개 · {catalogGroups.reduce((sum, group) => sum + group.observations.length, 0)}개 관측 기록</p>{(query || category !== "전체" || martType !== "all" || selectedStore !== "all") && <button onClick={() => { setQuery(""); setCategory("전체"); setMartType("all"); setSelectedStore("all"); }}>필터 초기화</button>}</div>
    <div className={styles.productGrid} aria-live="polite">{visibleGroups.map((group) => <article className={styles.productCard} key={group.id}><div className={styles.productVisual}><ProductImage item={group.latest.item} category={group.category} /></div><div className={styles.productInfo}><span>{group.officialProduct ? "공식 상품" : group.sharedCatalogProduct ? "공통 카탈로그 상품" : "판매처 상품"} · {group.category}</span><h2>{group.officialProduct?.officialName ?? group.productName}</h2>{group.officialProduct && group.officialProduct.officialName !== group.productName && <p>영수증 표기: {group.productName}</p>}<p className={styles.storeInfo}>판매 마트 <b>{group.storeLabel}</b> <em>{group.martType === "px" ? "PX" : "일반"}</em></p><p>최근 관측일 · {group.latest.observedAt} · {group.observations.length}회</p><div className={styles.priceBlock}><small>최근 관측가</small><strong>{formatKrw(group.latestPriceKrw)}</strong>{group.observations.length > 1 && <small>최저 {formatKrw(group.minimumPriceKrw)}</small>}</div><div className={styles.productActions}><button className={styles.trendButton} aria-label={`${group.productName} 가격 이력 보기`} onClick={() => onTrend(group)}>가격 이력</button><button aria-label={`${group.productName} 장바구니에 담기`} onClick={() => onAdd(group)}>+ 담기</button></div></div></article>)}</div>
    {visibleGroups.length === 0 && <div className={styles.noResult}><strong>조건에 맞는 상품이 없습니다.</strong><p>검색어 또는 필터를 바꿔 보세요.</p></div>}
  </section>;
}
