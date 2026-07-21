"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { formatKrw } from "@/domain/settlement";
import type { Receipt, ReceiptItem } from "@/domain/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { seededOfficialProducts, type OfficialProductCandidate } from "@/domain/official-product";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import { JsonReceiptRepository } from "@/repositories/json-receipt.repository";
import { AuthPanel } from "./AuthPanel";
import { OfficialProductModal, OfficialProductWorkspace } from "./OfficialProductPanel";
import styles from "./page.module.css";

const receipts = new JsonReceiptRepository().loadAll();
const officialProductRepository = new OfficialProductRepository();
const latestReceipt = receipts.at(-1);
const categories = ["전체", "식품", "생활용품", "주방용품", "신선식품", "음료", "간식"];
type Page = "home" | "cart" | "prices" | "official";
type MartType = "all" | "regular" | "px";
type ViewMode = "integrated" | "store";
type Listing = { id: string; item: ReceiptItem; storeLabel: string; observedAt: string; martType: Exclude<MartType, "all"> };
type TrendPoint = { storeLabel: string; observedAt: string; unitPriceKrw: number; source: "영수증" | "저장된 관측" };

function categoryFor(item: ReceiptItem) {
  const name = item.productName.toLowerCase();
  if (/음료|커피|우유|주스|물/.test(name)) return "음료";
  if (/과자|초콜릿|빵|라면|간식/.test(name)) return "간식";
  if (/채소|과일|고기|계란|생선/.test(name)) return "신선식품";
  if (/세제|휴지|샴푸|비누|수건/.test(name)) return "생활용품";
  if (/식기|냄비|후라이팬|주방/.test(name)) return "주방용품";
  return "식품";
}

function martTypeFor(receipt: Receipt): Exclude<MartType, "all"> {
  return /px|군마트/i.test(receipt.storeLabel) || receipt.items.some((item) => /영외/i.test(item.productName)) ? "px" : "regular";
}

function productIcon(item: ReceiptItem) {
  return <ProductImage item={item} />;
}

function ProductImage({ item }: { item: ReceiptItem }) {
  const [imageUrl, setImageUrl] = useState<string | undefined>(seededOfficialProducts[item.storeProductCode]?.imageUrl);
  const fallback = categoryFor(item) === "신선식품" ? "🥬" : categoryFor(item) === "음료" ? "🥤" : categoryFor(item) === "간식" ? "🍪" : "📦";
  useEffect(() => { setImageUrl(officialProductRepository.loadAll()[item.storeProductCode]?.imageUrl ?? seededOfficialProducts[item.storeProductCode]?.imageUrl); }, [item.storeProductCode]);
  return imageUrl ? <img className={styles.productImage} src={imageUrl} alt={`${item.productName} 제품 사진`} onError={() => setImageUrl(undefined)} /> : fallback;
}

function localTrend(item: ReceiptItem): TrendPoint[] {
  return receipts.flatMap((receipt) => receipt.items
    .filter((candidate) => candidate.storeProductCode === item.storeProductCode)
    .map((candidate) => ({ storeLabel: receipt.storeLabel, observedAt: receipt.purchasedAt, unitPriceKrw: candidate.unitPriceKrw, source: "영수증" as const })))
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

export default function Home() {
  const [page, setPage] = useState<Page>("home");
  const [category, setCategory] = useState("전체");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [authOpen, setAuthOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("integrated");
  const [martType, setMartType] = useState<MartType>("all");
  const [selectedStore, setSelectedStore] = useState("all");
  const [trendItem, setTrendItem] = useState<Listing | null>(null);
  const [officialItem, setOfficialItem] = useState<OfficialProductCandidate | null>(null);
  const [officialRevision, setOfficialRevision] = useState(0);
  const listings = useMemo<Listing[]>(() => receipts.flatMap((receipt) => receipt.items.map((item) => ({ id: `${receipt.id}:${item.id}`, item, storeLabel: receipt.storeLabel, observedAt: receipt.purchasedAt, martType: martTypeFor(receipt) }))), []);
  const items = useMemo(() => latestReceipt?.items ?? [], []);
  const cartItems = items.filter((item) => cart[item.id]);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.unitPriceKrw * (cart[item.id] ?? 0), 0);

  function addToCart(item: ReceiptItem) {
    setCart((current) => ({ ...current, [item.id]: Math.min(item.purchasedQuantity, (current[item.id] ?? 0) + 1) }));
  }

  return <div className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <button className={styles.logo} onClick={() => setPage("home")} aria-label="가격 추적기 홈">가격 추적기</button>
        <div className={styles.account}><AuthPanel onChange={() => {}} onOpen={() => setAuthOpen(true)} /></div>
      </div>
      <nav className={styles.nav} aria-label="주요 메뉴">
        <div className={styles.navInner}>
          <button className={page === "home" ? styles.navActive : ""} onClick={() => setPage("home")}>홈</button>
          <div className={styles.navDropdown}><button className={page === "prices" ? styles.navActive : ""} onClick={() => setPage("prices")}>가격 추적</button><div className={styles.dropdownMenu}><button onClick={() => { setPage("prices"); setMartType("regular"); }}>일반 마트</button><button onClick={() => { setPage("prices"); setMartType("px"); }}>PX (군마트)</button><button onClick={() => { setPage("prices"); setViewMode("store"); }}>마트별 보기</button><button onClick={() => setPage("official")}>공식 상품 연결</button></div></div>
          <div className={styles.navDropdown}><button onClick={() => setPage("cart")}>장바구니</button><div className={styles.dropdownMenu}><button onClick={() => setPage("cart")}>담은 상품</button><button onClick={() => setPage("prices")}>상품 담기</button></div></div>
          <button className={page === "official" ? styles.navActive : ""} onClick={() => setPage("official")}>공식 상품</button>
          <button onClick={() => setPage("prices")}>상품 목록</button>
        </div>
      </nav>
    </header>
    <main className={styles.main}>
      {page === "home" && <><section className={styles.hero}><p className={styles.kicker}>PRICE OBSERVATION PLATFORM</p><h1>오늘의 가격을<br /><span>한눈에 추적하세요.</span></h1><p>판매처에서 관측된 가격을 카테고리별로 비교하고<br />필요한 상품을 장바구니에 담아 관리할 수 있습니다.</p><button onClick={() => setPage("prices")}>상품 둘러보기 <span>→</span></button></section><section className={styles.homeGrid}><CategoryBox category={category} setCategory={setCategory} setPage={setPage} /><CartBox count={cartItems.length} total={cartTotal} setPage={setPage} /></section></>}
      {page === "prices" && <ProductBrowser key={officialRevision} listings={listings} category={category} setCategory={setCategory} query={query} setQuery={setQuery} addToCart={addToCart} viewMode={viewMode} setViewMode={setViewMode} martType={martType} setMartType={setMartType} selectedStore={selectedStore} setSelectedStore={setSelectedStore} onTrend={setTrendItem} />}
      {page === "official" && <OfficialProductWorkspace candidates={listings.map((listing) => ({ storeProductCode: listing.item.storeProductCode, productName: listing.item.productName, storeLabel: listing.storeLabel }))} onSelect={setOfficialItem} revision={officialRevision} />}
      {page === "cart" && <CartPage items={cartItems} cart={cart} setCart={setCart} total={cartTotal} setPage={setPage} />}
    </main>
    <footer className={styles.footer}>가격 추적기 <span>관측된 데이터로 더 현명하게 비교하세요.</span></footer>
    <nav className={styles.mobileNav} aria-label="모바일 주요 메뉴">
      <button className={page === "home" ? styles.mobileNavActive : ""} onClick={() => setPage("home")}><span>⌂</span>홈</button>
      <button className={page === "prices" ? styles.mobileNavActive : ""} onClick={() => setPage("prices")}><span>⌕</span>가격</button>
      <button className={page === "cart" ? styles.mobileNavActive : ""} onClick={() => setPage("cart")}><span>🛒</span>장바구니</button>
      <button className={page === "official" ? styles.mobileNavActive : ""} onClick={() => setPage("official")}><span>✓</span>공식상품</button>
    </nav>
    {authOpen && <AuthPanel onChange={() => {}} modal onClose={() => setAuthOpen(false)} />}
    {trendItem && <PriceTrendModal listing={trendItem} onClose={() => setTrendItem(null)} />}
    {officialItem && <OfficialProductModal candidate={officialItem} onClose={() => setOfficialItem(null)} onSaved={() => setOfficialRevision((revision) => revision + 1)} />}
  </div>;
}

function CategoryBox({ category, setCategory, setPage }: { category: string; setCategory: (v: string) => void; setPage: (v: Page) => void }) { return <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.kicker}>EXPLORE</p><h2>카테고리</h2></div><button className={styles.textButton} onClick={() => setPage("prices")}>전체 보기 →</button></div><div className={styles.categoryList}>{categories.slice(1).map((item, index) => <button className={category === item ? styles.categoryActive : ""} key={item} onClick={() => { setCategory(item); setPage("prices"); }}><span className={`${styles.categoryIcon} ${styles[`icon${index}`]}`}>{["🍎", "⌂", "♨", "🥬", "☕", "🍪"][index]}</span><span>{item}</span><span className={styles.arrow}>›</span></button>)}</div></section>; }

function CartBox({ count, total, setPage }: { count: number; total: number; setPage: (v: Page) => void }) { return <section className={`${styles.panel} ${styles.cartBox}`}><div className={styles.panelTitle}><div><p className={styles.kicker}>YOUR PICKS</p><h2>장바구니</h2></div><span className={styles.cartBadge}>{count}</span></div><div className={styles.cartEmpty}>{count === 0 ? <><div className={styles.cartIllustration}>🛒</div><p>아직 담은 상품이 없습니다.</p><small>가격 추적에서 상품을 담아보세요.</small></> : <><strong>{count}개 상품</strong><p>예상 합계 <b>{formatKrw(total)}</b></p></>}</div><button className={styles.outlineButton} onClick={() => setPage("cart")}>장바구니 보기 <span>→</span></button></section>; }

function ProductBrowser({ listings, category, setCategory, query, setQuery, addToCart, viewMode, setViewMode, martType, setMartType, selectedStore, setSelectedStore, onTrend }: { listings: Listing[]; category: string; setCategory: (v: string) => void; query: string; setQuery: (v: string) => void; addToCart: (item: ReceiptItem) => void; viewMode: ViewMode; setViewMode: (v: ViewMode) => void; martType: MartType; setMartType: (v: MartType) => void; selectedStore: string; setSelectedStore: (v: string) => void; onTrend: (listing: Listing) => void }) {
  const stores = useMemo(() => [...new Set(listings.filter((listing) => martType === "all" || listing.martType === martType).map((listing) => listing.storeLabel))], [listings, martType]);
  const visibleListings = useMemo(() => listings.filter((listing) => (martType === "all" || listing.martType === martType) && (viewMode === "integrated" || selectedStore === "all" || listing.storeLabel === selectedStore) && (category === "전체" || categoryFor(listing.item) === category) && `${listing.item.productName} ${listing.item.storeProductCode} ${listing.storeLabel}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.observedAt.localeCompare(a.observedAt)), [listings, martType, viewMode, selectedStore, category, query]);
  return <section className={styles.browser}><div className={styles.browserHead}><div><p className={styles.kicker}>PRICE TRACKING</p><h1>상품 목록</h1><p>통합 보기에서는 판매처가 다른 상품도 함께 살펴볼 수 있습니다.</p></div><label className={styles.search}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명·상품코드·판매 마트 검색" /></label></div><div className={styles.marketControls}><div className={styles.segmented} aria-label="상품 보기 방식"><button className={viewMode === "integrated" ? styles.selectedSegment : ""} onClick={() => setViewMode("integrated")}>통합 보기</button><button className={viewMode === "store" ? styles.selectedSegment : ""} onClick={() => setViewMode("store")}>마트별 보기</button></div><div className={styles.segmented} aria-label="판매처 유형"><button className={martType === "all" ? styles.selectedSegment : ""} onClick={() => setMartType("all")}>전체</button><button className={martType === "regular" ? styles.selectedSegment : ""} onClick={() => setMartType("regular")}>일반 마트</button><button className={martType === "px" ? styles.selectedSegment : ""} onClick={() => setMartType("px")}>PX (군마트)</button></div>{viewMode === "store" && <label className={styles.storeSelect}>판매 마트<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><option value="all">전체 마트</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>}</div><div className={styles.filters}>{categories.map((item) => <button className={category === item ? styles.filterActive : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><p className={styles.resultSummary}>{visibleListings.length}개 관측 상품 · {martType === "px" ? "PX(군마트)" : martType === "regular" ? "일반 마트" : "전체 판매처"}</p><div className={styles.productGrid}>{visibleListings.map((listing) => <article className={styles.productCard} key={listing.id}><div className={styles.productVisual}>{productIcon(listing.item)}</div><div className={styles.productInfo}><span>{categoryFor(listing.item)}</span><h3>{listing.item.productName}</h3><p className={styles.storeInfo}>판매 마트 <b>{listing.storeLabel}</b> <em>{listing.martType === "px" ? "PX" : "일반"}</em></p><p>관측일 · {listing.observedAt}</p><strong>{formatKrw(listing.item.unitPriceKrw)}</strong><div className={styles.productActions}><button className={styles.trendButton} onClick={() => onTrend(listing)}>가격 추이</button><button onClick={() => addToCart(listing.item)}>+ 담기</button></div></div></article>)}</div>{visibleListings.length === 0 && <div className={styles.noResult}>조건에 맞는 판매 마트 또는 상품이 없습니다.</div>}</section>;
}

function PriceTrendModal({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const client = getSupabaseBrowserClient(); const [points, setPoints] = useState<TrendPoint[]>(() => localTrend(listing.item)); const [loading, setLoading] = useState(Boolean(client)); const [message, setMessage] = useState("");
  useEffect(() => { let active = true; async function load() { if (!client) { setLoading(false); return; } const { data: user } = await client.auth.getUser(); if (!user.user) { if (active) { setLoading(false); setMessage("로그인하면 저장된 추가 관측가도 함께 확인할 수 있습니다."); } return; } const { data: mapping, error: mappingError } = await client.from("source_product_mappings").select("catalog_product_id").eq("source_label", listing.storeLabel).eq("source_product_code", listing.item.storeProductCode).eq("review_status", "verified").maybeSingle(); if (mappingError || !mapping) { if (active) { setLoading(false); setMessage("현재 상품의 통합 매핑이 없어 이 영수증 관측가만 표시합니다."); } return; } const { data, error } = await client.from("price_observations").select("location_label,observed_at,unit_price_krw").eq("catalog_product_id", mapping.catalog_product_id).order("observed_at", { ascending: true }); if (!active) return; if (error) setMessage("저장된 가격 관측을 불러오지 못했습니다."); else setPoints((current) => mergeTrendPoints(current, (data ?? []).map((row) => ({ storeLabel: row.location_label ?? "판매처 미상", observedAt: row.observed_at, unitPriceKrw: row.unit_price_krw, source: "저장된 관측" as const })))); setLoading(false); } void load(); return () => { active = false; }; }, [client, listing]);
  const lowestPrice = points.length ? Math.min(...points.map((point) => point.unitPriceKrw)) : null; const lowestPoints = lowestPrice === null ? [] : points.filter((point) => point.unitPriceKrw === lowestPrice); const changes = calculateTrendChanges(points); const storeRankings = calculateStoreRankings(points); const lowPeriods = calculateLowPeriods(lowestPoints);
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.trendModal}`} role="dialog" aria-modal="true" aria-labelledby="trend-title"><button className={styles.closeButton} onClick={onClose} aria-label="가격 추이 창 닫기">×</button><p className={styles.kicker}>PRICE HISTORY</p><h2 id="trend-title">{listing.item.productName}</h2><p className={styles.storeInfo}>판매 마트 <b>{listing.storeLabel}</b> · 현재 관측가 {formatKrw(listing.item.unitPriceKrw)}</p><TrendGraph points={points} />{loading && <p className={styles.trendNote}>저장된 관측가를 확인하고 있습니다.</p>}{message && <p className={styles.trendNote}>{message}</p>}<section className={styles.priceAnalysis}><div className={styles.lowestPrice}>{lowestPrice !== null ? <><span>저장된 정보 기준 최저 관측가</span><strong>{lowestPoints.map((point) => point.storeLabel).filter((store, index, values) => values.indexOf(store) === index).join(", ")}</strong><b>{formatKrw(lowestPrice)}</b><small>{lowestPoints.map((point) => point.observedAt).join(", ")} 관측</small></> : <span>비교할 가격 관측 정보가 없습니다.</span>}</div><div className={styles.analysisBlock}><h3>판매처별 저렴한 곳</h3>{storeRankings.length ? <ol className={styles.storeRankings}>{storeRankings.map((ranking, index) => <li key={ranking.storeLabel}><span>{index + 1}</span><b>{ranking.storeLabel}</b><strong>{formatKrw(ranking.lowestPrice)}</strong><small>최저 관측일 {ranking.observedAt}</small></li>)}</ol> : <p>저장된 판매처 관측가가 없습니다.</p>}</div><div className={styles.analysisBlock}><h3>최저가 관측 구간</h3>{lowPeriods.length ? <ul className={styles.lowPeriods}>{lowPeriods.map((period) => <li key={`${period.storeLabel}:${period.from}`}><b>{period.storeLabel}</b><span>{period.from === period.to ? period.from : `${period.from} ~ ${period.to}`}</span><small>{period.count}회 최저가 관측 · 연속 가격을 뜻하지 않습니다.</small></li>)}</ul> : <p>최저가 관측 정보가 없습니다.</p>}</div></section><section className={styles.changeSection}><h3>시점별 가격 변동</h3><p>동일 판매 마트의 직전 관측가 대비입니다.</p><div className={styles.trendTable}><div className={styles.trendTableHeader}><span>관측일</span><span>판매 마트</span><span>관측가</span><span>직전 대비</span></div>{changes.map((point, index) => <div key={`${point.storeLabel}:${point.observedAt}:${index}`}><span>{point.observedAt}</span><b>{point.storeLabel}</b><strong>{formatKrw(point.unitPriceKrw)}</strong><em className={point.differenceKrw === null ? styles.noChange : point.differenceKrw > 0 ? styles.priceUp : point.differenceKrw < 0 ? styles.priceDown : styles.noChange}>{formatPriceChange(point.differenceKrw, point.differencePercent)}</em></div>)}</div></section></section></div>;
}

function calculateTrendChanges(points: TrendPoint[]) { const previousByStore = new Map<string, number>(); return points.map((point) => { const previous = previousByStore.get(point.storeLabel); previousByStore.set(point.storeLabel, point.unitPriceKrw); return { ...point, differenceKrw: previous === undefined ? null : point.unitPriceKrw - previous, differencePercent: previous === undefined || previous === 0 ? null : ((point.unitPriceKrw - previous) / previous) * 100 }; }); }
function calculateStoreRankings(points: TrendPoint[]) { const bestByStore = new Map<string, TrendPoint>(); for (const point of points) { const current = bestByStore.get(point.storeLabel); if (!current || point.unitPriceKrw < current.unitPriceKrw || (point.unitPriceKrw === current.unitPriceKrw && point.observedAt < current.observedAt)) bestByStore.set(point.storeLabel, point); } return [...bestByStore.values()].map((point) => ({ storeLabel: point.storeLabel, lowestPrice: point.unitPriceKrw, observedAt: point.observedAt })).sort((a, b) => a.lowestPrice - b.lowestPrice || a.storeLabel.localeCompare(b.storeLabel)); }
function calculateLowPeriods(points: TrendPoint[]) { const byStore = new Map<string, TrendPoint[]>(); for (const point of points) byStore.set(point.storeLabel, [...(byStore.get(point.storeLabel) ?? []), point]); return [...byStore.entries()].map(([storeLabel, observations]) => ({ storeLabel, from: observations[0].observedAt, to: observations.at(-1)?.observedAt ?? observations[0].observedAt, count: observations.length })); }
function formatPriceChange(amount: number | null, percent: number | null) { if (amount === null) return "첫 관측"; if (amount === 0) return "변동 없음"; const sign = amount > 0 ? "+" : ""; return `${sign}${formatKrw(amount)} (${sign}${percent?.toFixed(1) ?? "0.0"}%)`; }

function mergeTrendPoints(local: TrendPoint[], remote: TrendPoint[]) { const seen = new Set(local.map((point) => `${point.storeLabel}:${point.observedAt}:${point.unitPriceKrw}`)); return [...local, ...remote.filter((point) => !seen.has(`${point.storeLabel}:${point.observedAt}:${point.unitPriceKrw}`))].sort((a, b) => a.observedAt.localeCompare(b.observedAt)); }

function TrendGraph({ points }: { points: TrendPoint[] }) { if (points.length < 2) return <div className={styles.graphEmpty}>가격 변화 그래프를 만들려면 2개 이상의 관측가가 필요합니다.</div>; const prices = points.map((point) => point.unitPriceKrw); const min = Math.min(...prices); const max = Math.max(...prices); const range = Math.max(max - min, 1); const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${12 + (index / (points.length - 1)) * 276} ${92 - ((point.unitPriceKrw - min) / range) * 68}`).join(" "); return <div className={styles.graphWrap}><svg viewBox="0 0 300 110" role="img" aria-label="저장된 가격 관측 변화 그래프"><path className={styles.graphBase} d="M 12 92 H 288" /><path className={styles.graphLine} d={path} />{points.map((point, index) => <circle key={`${point.observedAt}:${index}`} cx={12 + (index / (points.length - 1)) * 276} cy={92 - ((point.unitPriceKrw - min) / range) * 68} r="4" />)}</svg><div><span>{formatKrw(min)}</span><span>{formatKrw(max)}</span></div></div>; }

function CartPage({ items, cart, setCart, total, setPage }: { items: ReceiptItem[]; cart: Record<string, number>; setCart: React.Dispatch<React.SetStateAction<Record<string, number>>>; total: number; setPage: (v: Page) => void }) { return <section className={styles.browser}><div className={styles.browserHead}><div><p className={styles.kicker}>YOUR PICKS</p><h1>장바구니</h1><p>추적하고 싶은 상품을 모아보세요.</p></div></div>{items.length === 0 ? <div className={styles.noResult}>장바구니가 비어 있습니다.<br /><button onClick={() => setPage("prices")}>상품 담으러 가기 →</button></div> : <div className={styles.cartRows}>{items.map((item) => <article key={item.id}><div className={styles.productVisual}>{productIcon(item)}</div><div><h3>{item.productName}</h3><p>{formatKrw(item.unitPriceKrw)} · 영수증 관측가</p></div><div className={styles.quantity}><button onClick={() => setCart((current) => ({ ...current, [item.id]: Math.max(0, (current[item.id] ?? 0) - 1) }))}>−</button><strong>{cart[item.id]}</strong><button onClick={() => setCart((current) => ({ ...current, [item.id]: Math.min(item.purchasedQuantity, (current[item.id] ?? 0) + 1) }))}>+</button></div><b>{formatKrw(item.unitPriceKrw * (cart[item.id] ?? 0))}</b></article>)}</div>}<div className={styles.cartSummary}><span>예상 합계</span><strong>{formatKrw(total)}</strong></div></section>; }
