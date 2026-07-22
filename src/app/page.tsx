"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { groupProductObservations, listingsFromReceipts, PRODUCT_CATEGORIES, type MartType, type ProductCategory, type ProductGroup, type ProductSort } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { JsonReceiptRepository } from "@/repositories/json-receipt.repository";
import { useCartStore } from "@/stores/cart.store";
import { AdminPage } from "./AdminPage";
import { AuthPanel } from "./AuthPanel";
import { CartNoticeModal, CartQuantityModal } from "./CartModals";
import { CartPage } from "./CartPage";
import { PriceTrendModal } from "./PriceTrendModal";
import { ProductBrowser } from "./ProductBrowser";
import styles from "./page.module.css";

const receipts = new JsonReceiptRepository().loadAll();
const productGroups = groupProductObservations(listingsFromReceipts(receipts));
type Page = "home" | "products" | "cart" | "admin";

export default function Home() {
  const [page, setPage] = useState<Page>("home");
  const [category, setCategory] = useState<ProductCategory>("전체");
  const [query, setQuery] = useState("");
  const [martType, setMartType] = useState<MartType>("all");
  const [selectedStore, setSelectedStore] = useState("all");
  const [sort, setSort] = useState<ProductSort>("recent");
  const [authOpen, setAuthOpen] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);
  const [trendGroup, setTrendGroup] = useState<ProductGroup | null>(null);
  const [cartGroupToAdd, setCartGroupToAdd] = useState<ProductGroup | null>(null);
  const [cartQuantity, setCartQuantity] = useState("1");
  const [cartQuantityError, setCartQuantityError] = useState("");
  const [cartNotice, setCartNotice] = useState<{ productName: string; quantity: number } | null>(null);
  const lines = useCartStore((state) => state.lines);
  const hydrated = useCartStore((state) => state.hydrated);
  const hydrateCart = useCartStore((state) => state.hydrate);
  const addCart = useCartStore((state) => state.add);
  const updateCartQuantity = useCartStore((state) => state.setQuantity);
  const removeCart = useCartStore((state) => state.remove);
  const clearCart = useCartStore((state) => state.clear);
  const { isAdmin, loading: adminLoading } = useAdminAccess(authRevision);
  const handleAuthChange = useCallback(() => setAuthRevision((revision) => revision + 1), []);

  useEffect(() => { if (!hydrated) hydrateCart(); }, [hydrateCart, hydrated]);
  useEffect(() => { if (page === "admin" && !adminLoading && !isAdmin) setPage("home"); }, [adminLoading, isAdmin, page]);

  const cartGroups = useMemo(() => productGroups.filter((group) => lines[group.id] > 0), [lines]);
  const cartTotal = cartGroups.reduce((sum, group) => sum + group.latestPriceKrw * lines[group.id], 0);
  const cartQuantityTotal = cartGroups.reduce((sum, group) => sum + lines[group.id], 0);
  const officialCandidates = useMemo(() => productGroups.map((group) => ({ sourceProductCode: group.sourceProductCode, productName: group.productName, storeLabel: group.storeLabel })), []);

  function openCartModal(group: ProductGroup) {
    setCartGroupToAdd(group);
    setCartQuantity("1");
    setCartQuantityError("");
  }

  function confirmAddToCart() {
    if (!cartGroupToAdd) return;
    const quantity = Number(cartQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setCartQuantityError("1개 이상의 정수를 입력하세요.");
      return;
    }
    addCart(cartGroupToAdd.id, quantity);
    setCartNotice({ productName: cartGroupToAdd.productName, quantity });
    setCartGroupToAdd(null);
  }

  function openProducts(nextCategory: ProductCategory = "전체") {
    setCategory(nextCategory);
    setPage("products");
  }

  return <div className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <button className={styles.logo} onClick={() => setPage("home")} aria-label="가격 추적기 홈">가격 추적기</button>
        <div className={styles.account}>{isAdmin && <button className={styles.adminShortcut} onClick={() => setPage("admin")}>관리자</button>}<AuthPanel onChange={handleAuthChange} onOpen={() => setAuthOpen(true)} /></div>
      </div>
      <nav className={styles.nav} aria-label="주요 메뉴"><div className={styles.navInner}>
        <button className={page === "home" ? styles.navActive : ""} aria-current={page === "home" ? "page" : undefined} onClick={() => setPage("home")}>홈</button>
        <button className={page === "products" ? styles.navActive : ""} aria-current={page === "products" ? "page" : undefined} onClick={() => setPage("products")}>상품 목록</button>
        <button className={page === "cart" ? styles.navActive : ""} aria-current={page === "cart" ? "page" : undefined} onClick={() => setPage("cart")}>장바구니 <span className={styles.navBadge}>{cartQuantityTotal}</span></button>
        {isAdmin && <button className={page === "admin" ? styles.navActive : ""} aria-current={page === "admin" ? "page" : undefined} onClick={() => setPage("admin")}>관리자</button>}
      </div></nav>
    </header>

    <main className={styles.main}>
      {page === "home" && <><section className={styles.hero}><p className={styles.kicker}>PRICE OBSERVATION PLATFORM</p><h1>상품 가격을<br /><span>관측 기록으로 비교하세요.</span></h1><p>판매처와 시점이 명확한 영수증 관측가를 비교하고<br />필요한 상품을 장바구니에 모을 수 있습니다.</p><button onClick={() => openProducts()}>상품 둘러보기 <span>→</span></button></section><section className={styles.homeGrid}><CategoryBox category={category} onSelect={openProducts} /><CartBox count={cartGroups.length} quantity={cartQuantityTotal} total={cartTotal} onOpen={() => setPage("cart")} /></section></>}
      {page === "products" && <ProductBrowser groups={productGroups} query={query} setQuery={setQuery} category={category} setCategory={setCategory} martType={martType} setMartType={setMartType} selectedStore={selectedStore} setSelectedStore={setSelectedStore} sort={sort} setSort={setSort} onAdd={openCartModal} onTrend={setTrendGroup} />}
      {page === "cart" && <CartPage groups={productGroups} lines={lines} onQuantityChange={updateCartQuantity} onRemove={removeCart} onClear={clearCart} onBrowse={() => setPage("products")} />}
      {page === "admin" && isAdmin && <AdminPage candidates={officialCandidates} />}
    </main>

    <footer className={styles.footer}>가격 추적기 <span>영수증 관측가로 투명하게 비교하세요.</span></footer>
    <nav className={styles.mobileNav} aria-label="모바일 주요 메뉴">
      <button className={page === "home" ? styles.mobileNavActive : ""} aria-current={page === "home" ? "page" : undefined} onClick={() => setPage("home")}><span aria-hidden="true">⌂</span>홈</button>
      <button className={page === "products" ? styles.mobileNavActive : ""} aria-current={page === "products" ? "page" : undefined} onClick={() => setPage("products")}><span aria-hidden="true">⌕</span>상품 목록</button>
      <button className={page === "cart" ? styles.mobileNavActive : ""} aria-current={page === "cart" ? "page" : undefined} onClick={() => setPage("cart")}><span aria-hidden="true">🛒</span>장바구니<b>{cartQuantityTotal || ""}</b></button>
    </nav>

    {authOpen && <AuthPanel onChange={handleAuthChange} modal onClose={() => setAuthOpen(false)} />}
    {trendGroup && <PriceTrendModal group={trendGroup} onClose={() => setTrendGroup(null)} />}
    {cartGroupToAdd && <CartQuantityModal group={cartGroupToAdd} value={cartQuantity} error={cartQuantityError} onChange={(value) => { setCartQuantity(value); setCartQuantityError(""); }} onClose={() => setCartGroupToAdd(null)} onConfirm={confirmAddToCart} />}
    {cartNotice && <CartNoticeModal productName={cartNotice.productName} quantity={cartNotice.quantity} onClose={() => setCartNotice(null)} onGoCart={() => { setCartNotice(null); setPage("cart"); }} />}
  </div>;
}

function CategoryBox({ category, onSelect }: { category: ProductCategory; onSelect: (category?: ProductCategory) => void }) {
  const featured = PRODUCT_CATEGORIES.filter((item) => item !== "전체" && item !== "미분류");
  return <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.kicker}>EXPLORE</p><h2>카테고리</h2></div><button className={styles.textButton} onClick={() => onSelect("전체")}>전체 보기 →</button></div><div className={styles.categoryList}>{featured.map((item, index) => <button aria-pressed={category === item} className={category === item ? styles.categoryActive : ""} key={item} onClick={() => onSelect(item)}><span className={`${styles.categoryIcon} ${styles[`icon${index}`]}`} aria-hidden="true">{["🍚", "🧴", "🍳", "🥬", "🥤", "🍪"][index]}</span><span>{item}</span><span className={styles.arrow} aria-hidden="true">›</span></button>)}</div></section>;
}

function CartBox({ count, quantity, total, onOpen }: { count: number; quantity: number; total: number; onOpen: () => void }) {
  return <section className={`${styles.panel} ${styles.cartBox}`}><div className={styles.panelTitle}><div><p className={styles.kicker}>YOUR PICKS</p><h2>장바구니</h2></div><span className={styles.cartBadge}>{quantity}</span></div><div className={styles.cartEmpty}>{count === 0 ? <><div className={styles.cartIllustration} aria-hidden="true">🛒</div><p>아직 담은 상품이 없습니다.</p><small>상품 목록에서 비교할 물건을 담아보세요.</small></> : <><strong>{count}개 상품 · 총 {quantity}개</strong><p>예상 합계 <b>{formatKrw(total)}</b></p></>}</div><button className={styles.outlineButton} onClick={onOpen}>장바구니 보기 <span>→</span></button></section>;
}
