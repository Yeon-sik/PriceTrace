"use client";

/* Remote brand logos are external URLs; preserve their source without a Next image proxy. */
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { type Brand, type BrandMatch } from "@/domain/brand-hierarchy";
import { useBrandHall } from "@/features/brand-hall/use-brand-hall";
import styles from "./BrandHall.module.css";

function BrandLogo({ brand }: { brand: Brand }) {
  return brand.logoUrl ? <img className={styles.logo} src={brand.logoUrl} alt={`${brand.canonicalName} 로고`} loading="lazy" referrerPolicy="no-referrer" /> : null;
}

export function BrandHall({ selectedBrandId, onSelect }: {
  selectedBrandId: string | null; onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const state = useBrandHall(query, selectedBrandId);
  const { selected, ancestry, children, directProducts } = state;
  function brandLink(brand: BrandMatch) {
    return <button className={styles.brandLink} onClick={() => onSelect(brand.id)}>
      <BrandLogo brand={brand} /><span><strong>{brand.canonicalName}</strong>
        {brand.parentBrandId && <small>상위 브랜드: {brand.parentCanonicalName ?? "공개 정보 없음"}</small>}
        {brand.matchKind === "alias" && <small>검색된 별칭: {brand.matchedName}</small>}
      </span>
    </button>;
  }

  return <section className={styles.hall} aria-labelledby="brand-hall-title">
    <header className={styles.header}><div><h1 id="brand-hall-title">브랜드관</h1>
      <p>브랜드의 관계와 직접 연결된 공개 상품을 확인하세요.</p></div>
      {selectedBrandId && <button className={styles.secondary} onClick={() => onSelect(null)}>전체 브랜드</button>}
    </header>
    {state.loading ? <p role="status">브랜드관을 불러오는 중입니다.</p>
      : state.error ? <div role="alert"><p>{state.error}</p><button onClick={state.retry}>다시 시도</button></div>
        : selectedBrandId ? !selected ? <div><p>공개 목록에서 이 브랜드를 찾을 수 없습니다.</p><button onClick={() => onSelect(null)}>전체 브랜드 보기</button></div>
          : <div className={styles.detail}>
            <nav aria-label="브랜드 경로" className={styles.breadcrumb}>
              {ancestry?.missingParentId && <span>상위 브랜드 공개 정보 없음</span>}
              {ancestry?.path.map((brand) => <button key={brand.id} onClick={() => onSelect(brand.id)} aria-current={brand.id === selected.id ? "page" : undefined}>{brand.canonicalName}</button>)}
            </nav>
            <div className={styles.brandHeading}><BrandLogo brand={selected} /><div><h2>{selected.canonicalName}</h2>
              {selected.officialSiteUrl && <a href={selected.officialSiteUrl} target="_blank" rel="noreferrer">공식 사이트 열기</a>}</div></div>
            <section aria-labelledby="brand-children-title"><h3 id="brand-children-title">하위 브랜드</h3>
              {children.length ? <ul className={styles.brandList}>{children.map((brand) => <li key={brand.id}>{brandLink(brand)}</li>)}</ul>
                : <p className={styles.muted}>등록된 하위 브랜드가 없습니다.</p>}
            </section>
            <section aria-labelledby="brand-products-title"><h3 id="brand-products-title">직접 연결 상품 <span>{directProducts.length}</span></h3>
              <p className={styles.muted}>이 브랜드에 직접 연결된 공개 판매 규격입니다. 하위 브랜드의 상품은 해당 브랜드에서 확인하세요.</p>
              {directProducts.length ? <ul className={styles.productList}>{directProducts.map((product) => <li key={product.id}>
                <button className={styles.productLink} aria-expanded={openProductId === product.id}
                  aria-controls={`brand-product-${product.id}`} onClick={() => setOpenProductId(openProductId === product.id ? null : product.id)}><strong>{product.name}</strong>
                  <span>{product.contentAmount}{product.contentUnit === "each" ? "개" : product.contentUnit} × {product.packageCount} · {product.categoryName ?? "분류 정보 없음"}</span></button>
                {openProductId === product.id && <div id={`brand-product-${product.id}`} className={styles.productDetail} role="region" aria-label="공개 상품 정보">
                  <h4>{product.name}</h4>
                  <p>검증된 공개 카탈로그의 판매 규격입니다.</p>
                  <dl><dt>브랜드</dt><dd>{product.brandName ?? "브랜드명 공개 정보 없음"}</dd>
                    <dt>판매 규격</dt><dd>{product.contentAmount}{product.contentUnit === "each" ? "개" : product.contentUnit} × {product.packageCount}</dd>
                    <dt>분류</dt><dd>{product.categoryName ?? "분류 정보 없음"}</dd>
                    <dt>판매 규격 ID</dt><dd>{product.id}</dd>
                    <dt>표준 상품 ID</dt><dd>{product.standardProductId}</dd></dl>
                </div>}
              </li>)}</ul> : <p>직접 연결된 공개 상품이 없습니다.</p>}
            </section>
          </div>
          : <>
            <label className={styles.search}><span>브랜드 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="브랜드명 또는 별칭" autoComplete="off" /></label>
            {query.trim() ? <section aria-label="브랜드 검색 결과" aria-busy={state.searching}>
              {state.searching ? <p role="status">브랜드를 검색하는 중입니다.</p> : state.searchError ? <div role="alert"><p>{state.searchError}</p><button onClick={state.retry}>다시 시도</button></div>
                : state.matches.length ? <ul className={styles.brandList}>{state.matches.map((brand) => <li key={brand.id}>{brandLink(brand)}</li>)}</ul>
                  : <p role="status">검색 결과가 없습니다.</p>}
            </section> : <>
              <h2 className={styles.sectionTitle}>전체 브랜드</h2>
              {state.brands.length === 0 && <p>아직 공개된 브랜드가 없습니다.</p>}
              <ul className={styles.brandList}>{state.hierarchy.roots.map((brand) => <li key={brand.id}>
                {brandLink(brand)}
                {(state.hierarchy.children.get(brand.id)?.length ?? 0) > 0 && <ul className={styles.children} aria-label={`${brand.canonicalName} 하위 브랜드`}>
                  {state.hierarchy.children.get(brand.id)!.map((child) => <li key={child.id}><button onClick={() => onSelect(child.id)}>{child.canonicalName}</button></li>)}
                </ul>}
              </li>)}</ul>
              {state.hierarchy.missingParents.length > 0 && <section><h2 className={styles.sectionTitle}>상위 브랜드 공개 정보가 없는 브랜드</h2>
                <ul className={styles.brandList}>{state.hierarchy.missingParents.map((brand) => <li key={brand.id}>{brandLink(brand)}</li>)}</ul></section>}
            </>}
          </>}
  </section>;
}
