"use client";

import { useMemo, useState } from "react";
import { cartProductFromGroup, cartProductFromOfficialListing, type CartProduct } from "@/domain/cart";
import { productNameWithoutBrand } from "@/domain/brand";
import {
  distinctSellerCount,
  latestSellerRows,
  PRODUCT_CATEGORY_ROOTS,
  productCategoryRoot,
  productSubcategories,
  type MartType,
  type ProductCategory,
  type ProductGroup,
  type ProductSort,
} from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import {
  filterAndSortOfficialChannelListings,
  partitionOfficialChannelListingsByStandardProduct,
} from "@/domain/public-official-channel-catalog";
import {
  officialListingsAreEligible,
  selectGridEntries,
  selectLinkedStandardSummaries,
  selectProductCatalogGroups,
  selectStoreOptions,
  selectVisibleLinkedStandardSummaries,
  selectVisibleProductGroups,
  selectVisibleStandardGroups,
  type CatalogView,
  type OfficialLinkedStandardSummary,
} from "@/features/product-browser/product-browser.selectors";
import { useProductCatalog } from "@/features/product-browser/use-product-catalog";
import { PublicOfficialChannelCatalogRepository } from "@/repositories/public-official-channel-catalog.repository";
import { CoupangComparisonMessage } from "./CoupangComparisonMessage";
import { ProductImage } from "./ProductImage";
import { PxOfficialProductBrowser } from "./PxOfficialProductBrowser";
import { PrivateIdentityDetail } from "./PrivateIdentityDetail";
import { StandardProductDetailModal } from "./StandardProductDetailModal";
import { StoreListModal } from "./StoreListModal";
import styles from "./page.module.css";

const publicPxCatalog = new PublicOfficialChannelCatalogRepository().loadPxCatalog();

export type { StandardProductGroup, StandardProductItem } from "@/features/product-browser/product-browser.selectors";

function StoreInfo({ sellerCount, martTypeLabel, onOpen }: { sellerCount: number; martTypeLabel?: string; onOpen: () => void }) {
  return <p className={styles.storeInfo}>판매처 {sellerCount}곳{martTypeLabel && <em>{martTypeLabel}</em>}<button type="button" className={styles.storeInfoButton} aria-label="판매처 정보 보기" onClick={onOpen}>›</button></p>;
}

function RecordedPriceBlock({ group }: { group: ProductGroup }) {
  return <div className={styles.listedPrice}><strong>{formatKrw(group.latestPriceKrw)}</strong></div>;
}

function StandardProductName({ brand, name }: { brand: string | null; name: string }) {
  return <div className={styles.standardProductName}>
    {brand && <small>{brand}</small>}
    <h2>{productNameWithoutBrand(name, brand)}</h2>
  </div>;
}

function OfficialLinkedStandardCard({
  standard,
  onOpen,
  onAdd,
}: {
  standard: OfficialLinkedStandardSummary;
  onOpen?: () => void;
  onAdd?: (listing: OfficialLinkedStandardSummary["listings"][number]) => void;
}) {
  const prices = standard.listings.map((listing) => listing.officialPrice.amountKrw);
  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);
  const firstListing = standard.listings[0];
  const lowestListing = standard.listings.reduce((lowest, listing) => (
    listing.officialPrice.amountKrw < lowest.officialPrice.amountKrw ? listing : lowest
  ), firstListing);

  return <article className={`${styles.productCard} ${styles.officialLinkedStandardCard}`}>
    <div className={styles.productVisual} data-testid="product-image-slot">
      <ProductImage
        productName={standard.name}
        sourceProductCode={firstListing.sourceProductCode}
        category={standard.category}
        imageUrl={standard.imageUrl}
      />
      <span className={styles.standardProductBadge}>표준 상품</span>
    </div>
    <div className={`${styles.productInfo} ${styles.officialChannelInfo}`}>
      <span className={styles.officialCategoryBadge}>{standard.category}</span>
      <StandardProductName brand={standard.brand} name={standard.name} />
      <p><b>공식 출처</b> PX 공식 판매상품 {standard.listings.length.toLocaleString("ko-KR")}개 연결</p>
      <div className={styles.officialChannelPrice}>
        <small>PX 공식 사이트 표시가</small>
        <strong>{formatKrw(lowestPrice)}{highestPrice === lowestPrice ? "" : ` ~ ${formatKrw(highestPrice)}`}</strong>
      </div>
      <div className={styles.officialChannelMeta}>
        <details className={styles.officialSourceDetails}>
          <summary>연결 원문 {standard.listings.length.toLocaleString("ko-KR")}개</summary>
          <span>{standard.listings.map((listing) => listing.sourceNameRaw).join(", ")}</span>
        </details>
        <span>특정 지점 판매·재고 확인 아님</span>
      </div>
      {onOpen && <button type="button" aria-label={`${standard.name} 정보 보기`} onClick={onOpen}>정보 보기</button>}
       {onAdd && <div className={styles.productActions}><button type="button" aria-label={`${standard.name} 장바구니에 담기`} onClick={() => onAdd(lowestListing)}>최저 공식가 담기</button></div>}
     </div>
   </article>;
}

export function ProductBrowser({ groups, query, setQuery, category, setCategory, martType, setMartType, selectedStore, setSelectedStore, sort, setSort, authRevision, selectedStoreProductId, selectedCatalogProductId, onClearIdentity, onAdd, onTrend, onOpenStore }: {
  groups: ProductGroup[]; query: string; setQuery: (value: string) => void; category: ProductCategory; setCategory: (value: ProductCategory) => void; martType: MartType; setMartType: (value: MartType) => void; selectedStore: string; setSelectedStore: (value: string) => void; sort: ProductSort; setSort: (value: ProductSort) => void; authRevision: number; selectedStoreProductId: string | null; selectedCatalogProductId: string | null; onClearIdentity: () => void; onAdd: (product: CartProduct) => void; onTrend: (group: ProductGroup) => void; onOpenStore: (store: string) => void;
}) {
  const { linkedByStandardProduct, standaloneListings } = useMemo(
    () => partitionOfficialChannelListingsByStandardProduct(publicPxCatalog.listings),
    [],
  );
  const {
    officialProducts,
    standardMappings,
    exactStandardMappings,
    catalogSpecs,
    standardNames,
    standardBrands,
    standardCategories,
    standardImages,
    coupangByStandard,
    catalogNotice,
  } = useProductCatalog(authRevision);
  const [catalogView, setCatalogView] = useState<CatalogView>("all");
  const [openStandardId, setOpenStandardId] = useState<string | null>(null);
  const [storeListTarget, setStoreListTarget] = useState<{ title: string; rows: { storeLabel: string; observedAt: string }[] } | null>(null);
  const selectedCategoryRoot = productCategoryRoot(category);
  const selectedCategoryChildren = selectedCategoryRoot
    ? productSubcategories(selectedCategoryRoot)
    : [];

  const { productGroups, standardGroups } = useMemo(() => selectProductCatalogGroups({
    groups,
    officialProducts,
    standardMappings,
    exactStandardMappings,
    catalogSpecs,
    standardNames,
    standardCategories,
    standardBrands,
    standardImages,
    coupangByStandard,
    linkedByStandardProduct,
  }), [groups, officialProducts, standardMappings, exactStandardMappings, catalogSpecs, standardNames, standardCategories, standardBrands, standardImages, coupangByStandard, linkedByStandardProduct]);

  const stores = useMemo(
    () => selectStoreOptions({ productGroups, standardGroups, martType }),
    [martType, productGroups, standardGroups],
  );

  const visibleGroups = useMemo(() => selectVisibleProductGroups(productGroups, {
    query,
    category,
    martType,
    selectedStore,
    sort,
  }), [category, martType, query, selectedStore, sort, productGroups]);
  const officialListingsEligible = officialListingsAreEligible(martType, selectedStore);

  const linkedStandardSummaries = useMemo<OfficialLinkedStandardSummary[]>(
    () => selectLinkedStandardSummaries({ linkedByStandardProduct, standardNames, standardCategories, standardBrands, standardImages }),
    [linkedByStandardProduct, standardBrands, standardCategories, standardImages, standardNames],
  );

  const visibleLinkedStandardSummaries = useMemo(() => selectVisibleLinkedStandardSummaries({
    summaries: linkedStandardSummaries,
    eligible: officialListingsEligible,
    query,
    category,
  }), [category, linkedStandardSummaries, officialListingsEligible, query]);

  const visibleStandardGroups = useMemo(() => selectVisibleStandardGroups({
    standardGroups,
    coupangByStandard,
    query,
    category,
    martType,
    officialListingsEligible,
    selectedStore,
    sort,
  }), [standardGroups, coupangByStandard, query, category, martType, officialListingsEligible, selectedStore, sort]);

  const gridEntries = useMemo(() => selectGridEntries({
    visibleStandardGroups,
    visibleProductGroups: visibleGroups,
    visibleLinkedStandardSummaries,
    catalogView,
    sort,
  }), [visibleStandardGroups, visibleGroups, visibleLinkedStandardSummaries, catalogView, sort]);

  const standaloneOfficialListingCount = useMemo(
    () => officialListingsEligible
      ? filterAndSortOfficialChannelListings(standaloneListings, query, "price-asc", category).length
      : 0,
    [category, officialListingsEligible, query, standaloneListings],
  );
  const openStandard = visibleStandardGroups.find((standard) => standard.id === openStandardId)
    ?? standardGroups.find((standard) => standard.id === openStandardId)
    ?? null;
  const nutritionCatalogProductIds = useMemo(() => {
    if (!openStandard) return [];
    const standardProductId = openStandard.id.replace("standard:", "");
    return [...catalogSpecs.entries()]
      .filter(([, specification]) => specification.standardProductId === standardProductId)
      .map(([catalogProductId]) => catalogProductId);
  }, [catalogSpecs, openStandard]);
  const showStandardOnly = catalogView === "standard";
  const showOfficialOnly = catalogView === "official";
  const showStandaloneOfficialListings = catalogView !== "standard"
    && officialListingsEligible
    && standaloneOfficialListingCount > 0;
  const officialProductDisplayCount = standaloneListings.length + linkedByStandardProduct.size;
  const resultCount = gridEntries.length
    + (showStandaloneOfficialListings ? standaloneOfficialListingCount : 0);
  const changeCatalogView = (nextView: CatalogView) => {
    setCatalogView(nextView);
    if (nextView === "official") {
      setMartType("all");
      setSelectedStore("all");
      setSort("cheap");
    }
  };

  if (selectedStoreProductId || selectedCatalogProductId) {
    return <PrivateIdentityDetail
      selector={selectedStoreProductId
        ? { type: "store_product", id: selectedStoreProductId }
        : { type: "catalog_product", id: selectedCatalogProductId as string }}
      onBack={onClearIdentity}
    />;
  }

  return <section className={styles.browser}>
    <div className={styles.browserHead}>
      <div>
        <p className={styles.kicker}>PRODUCT CATALOG</p>
        <h1>상품 목록</h1>
        <p>표준 상품, 유통채널 공식 판매상품, 영수증 가격 관측을 출처별로 구분합니다.</p>
      </div>
      <label className={styles.search}>
        <span aria-hidden="true">⌕</span>
        <span className={styles.srOnly}>상품 검색</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={showOfficialOnly ? "상품명, 업체명, 규격, 상품 코드 검색" : "상품명, 판매처 코드, 판매 마트 검색"}
        />
      </label>
    </div>

    <div className={styles.catalogLayerTabs} role="group" aria-label="상품 데이터 계층">
      <button type="button" aria-pressed={catalogView === "all"} className={catalogView === "all" ? styles.catalogLayerTabActive : ""} onClick={() => changeCatalogView("all")}>전체 상품</button>
      <button type="button" aria-pressed={catalogView === "standard"} className={catalogView === "standard" ? styles.catalogLayerTabActive : ""} onClick={() => changeCatalogView("standard")}>표준 상품만</button>
      <button type="button" aria-pressed={catalogView === "official"} className={catalogView === "official" ? styles.catalogLayerTabActive : ""} onClick={() => changeCatalogView("official")}>공식 상품만 <span>{officialProductDisplayCount.toLocaleString("ko-KR")}</span></button>
    </div>

    {catalogNotice && !showOfficialOnly && <p className={styles.dataNotice} role="status">{catalogNotice}</p>}
    {showOfficialOnly
      ? <p className={styles.officialCatalogScope}>PX 공식 판매상품 전체 · 특정 지점의 판매·재고 정보가 아닙니다.</p>
      : <div className={styles.marketControls}>
          <div className={styles.segmented} role="group" aria-label="판매처 유형">{([ ["all", "전체"], ["regular", "일반 마트"], ["px", "PX (군마트)"] ] as const).map(([value, label]) => <button key={value} aria-pressed={martType === value} className={martType === value ? styles.selectedSegment : ""} onClick={() => { setMartType(value); setSelectedStore("all"); }}>{label}</button>)}</div>
          <label className={styles.storeSelect}>판매 마트<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><option value="all">전체 마트</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
          <label className={styles.sortSelect}>정렬<select value={sort} onChange={(event) => setSort(event.target.value as ProductSort)}><option value="expensive">비싼 물품 순</option><option value="cheap">저렴한 물품 순</option><option value="sellers">판매처 많은 물품 순</option></select></label>
        </div>}
    <div className={styles.filters} aria-label="상품 대분류">{PRODUCT_CATEGORY_ROOTS.map((item) => {
      const active = item === "전체" ? category === "전체" : selectedCategoryRoot === item;
      return <button aria-pressed={active} className={active ? styles.filterActive : ""} key={item} onClick={() => setCategory(item)}>{item}</button>;
    })}</div>
    {selectedCategoryRoot && selectedCategoryChildren.length > 0 && <div className={`${styles.filters} ${styles.subcategoryFilters}`} aria-label={`${selectedCategoryRoot} 세부 카테고리`}>
      <button aria-pressed={category === selectedCategoryRoot} className={category === selectedCategoryRoot ? styles.filterActive : ""} onClick={() => setCategory(selectedCategoryRoot)}>{selectedCategoryRoot} 전체</button>
      {selectedCategoryChildren.map((item) => <button aria-pressed={category === item} className={category === item ? styles.filterActive : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}
    </div>}
    <div className={styles.resultBar}><p>상품 {resultCount.toLocaleString("ko-KR")}개</p>{(query || category !== "전체" || martType !== "all" || selectedStore !== "all" || showStandardOnly || showOfficialOnly) && <button onClick={() => { setQuery(""); setCategory("전체"); setMartType("all"); setSelectedStore("all"); setCatalogView("all"); }}>필터 초기화</button>}</div>

    <div className={styles.productGrid} aria-live="polite">{gridEntries.map((entry) => entry.kind === "official-standard"
      ? <OfficialLinkedStandardCard
          key={entry.standard.id}
          standard={entry.standard}
          onOpen={standardGroups.some((standard) => standard.id === `standard:${entry.standard.standardProductId}`)
            ? () => setOpenStandardId(`standard:${entry.standard.standardProductId}`)
            : undefined}
          onAdd={(listing) => onAdd({
            ...cartProductFromOfficialListing(listing),
            category: entry.standard.category,
          })}
        />
      : entry.kind === "standard"
        ? <article className={styles.productCard} key={entry.standard.id}>
            <div className={styles.productVisual} data-testid="product-image-slot">
              <ProductImage item={entry.standard.items[0].latest.item} category={entry.standard.category} imageUrl={entry.standard.imageUrl} />
              <span className={styles.standardProductBadge}>표준 상품</span>
            </div>
            <div className={styles.productInfo}>
              <StandardProductName brand={entry.standard.brand} name={entry.standard.name} />
              <StoreInfo sellerCount={entry.standard.sellerCount} onOpen={() => setStoreListTarget({ title: `${entry.standard.name} 판매처`, rows: latestSellerRows(entry.standard.items.flatMap((item) => item.observations)) })} />
              <div className={styles.standardPriceBlock}><strong>{formatKrw(entry.standard.lowestPriceKrw)} ~</strong><small>{entry.standard.unitPriceLabel} {formatKrw(entry.standard.lowestUnitPriceKrw)} ~ {formatKrw(entry.standard.highestUnitPriceKrw)}</small>{entry.standard.coupangComparison && <CoupangComparisonMessage compact unitPriceLabel={entry.standard.unitPriceLabel} comparison={entry.standard.coupangComparison} />}</div>
              {entry.standard.officialListings.length > 0 && <div className={styles.standardOfficialSource}>
                <small>PX 공식 판매상품 {entry.standard.officialListings.length.toLocaleString("ko-KR")}개 연결</small>
                <strong>공식 표시가 {formatKrw(Math.min(...entry.standard.officialListings.map((listing) => listing.officialPrice.amountKrw)))} ~</strong>
              </div>}
              <div className={styles.productActions}>
                <button aria-label={`${entry.standard.name} 정보 보기`} onClick={() => setOpenStandardId(entry.standard.id)}>정보 보기</button>
                <button type="button" aria-label={`${entry.standard.name} 장바구니에 담기`} onClick={() => onAdd({
                  ...cartProductFromGroup(entry.standard.items[0]),
                  category: entry.standard.category,
                })}>최저 관측가 담기</button>
              </div>
            </div>
          </article>
        : <article className={styles.productCard} key={entry.group.id}><div className={styles.productVisual} data-testid="product-image-slot"><ProductImage item={entry.group.latest.item} category={entry.group.category} imageUrl={entry.group.officialProduct?.imageUrl} /></div><div className={styles.productInfo}><h2>{entry.group.officialProduct?.officialName ?? entry.group.productName}</h2><StoreInfo sellerCount={distinctSellerCount(entry.group.observations)} onOpen={() => setStoreListTarget({ title: `${entry.group.productName} 판매처`, rows: latestSellerRows(entry.group.observations) })} /><RecordedPriceBlock group={entry.group} /><div className={styles.productActions}><button className={styles.trendButton} aria-label={`${entry.group.productName} 가격 이력 보기`} onClick={() => onTrend(entry.group)}>가격 이력</button><button aria-label={`${entry.group.productName} 장바구니에 담기`} onClick={() => onAdd(cartProductFromGroup(entry.group))}>+ 담기</button></div></div></article>)}</div>
    {gridEntries.length === 0 && !showStandaloneOfficialListings && !(showOfficialOnly && !officialListingsEligible) && <div className={styles.noResult}><strong>조건에 맞는 상품이 없습니다.</strong></div>}

    {showStandaloneOfficialListings && <PxOfficialProductBrowser catalog={publicPxCatalog} listings={standaloneListings} query={query} category={category} onAdd={(listing) => onAdd(cartProductFromOfficialListing(listing))} />}
    {showOfficialOnly && !officialListingsEligible && <div className={styles.noResult}><strong>{selectedStore !== "all" ? "공식 상품은 특정 지점의 판매·재고로 확인할 수 없습니다." : "일반 마트 조건에 해당하는 공식 상품 컬렉션이 없습니다."}</strong><p>판매처 유형을 전체 또는 PX로 선택하고, 판매 마트는 전체 마트로 두세요.</p></div>}

    {openStandard && <StandardProductDetailModal standard={openStandard} nutritionCatalogProductIds={nutritionCatalogProductIds} onClose={() => setOpenStandardId(null)} onOpenStore={onOpenStore} />}
    {storeListTarget && !showOfficialOnly && <StoreListModal title={storeListTarget.title} rows={storeListTarget.rows} onClose={() => setStoreListTarget(null)} onOpenStore={onOpenStore} />}
  </section>;
}
