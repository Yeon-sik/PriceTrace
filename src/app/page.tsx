"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cartProductFromGroup, cartProductFromOfficialListing, type CartProduct } from "@/domain/cart";
import { groupProductObservations, martTagFor, PRODUCT_CATEGORIES, type MartType, type ProductCategory, type ProductGroup, type ProductObservationListing, type ProductSort } from "@/domain/product-browser";
import type { OfficialProductCandidate } from "@/domain/official-product";
import { findOfficialListingCandidate } from "@/domain/official-listing-candidate";
import { formatKrw } from "@/domain/settlement";
import { findPxProductNameReview } from "@/domain/px-product-name-review";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { PublicReceiptRepository } from "@/repositories/public-receipt.repository";
import { PublicOfficialChannelCatalogRepository } from "@/repositories/public-official-channel-catalog.repository";
import { PxProductNameReviewRepository } from "@/repositories/px-product-name-review.repository";
import { useCartStore } from "@/stores/cart.store";
import { AdminPage } from "./AdminPage";
import { AuthPanel } from "./AuthPanel";
import { CartNoticeModal, CartQuantityModal } from "./CartModals";
import { CartPage } from "./CartPage";
import { PriceTrendModal } from "./PriceTrendModal";
import { ProductBrowser } from "./ProductBrowser";
import { MarketBrowser } from "./MarketBrowser";
import styles from "./page.module.css";

const publicReceiptData = new PublicReceiptRepository().loadAll();
const publicOfficialCatalog = new PublicOfficialChannelCatalogRepository().loadPxCatalog();
const pxProductNameReviews = new PxProductNameReviewRepository().load(publicOfficialCatalog);
const publicReceiptById = new Map(publicReceiptData.receipts.map((receipt) => [receipt.id, receipt]));
type Page = "home" | "products" | "markets" | "cart" | "admin";

function receiptRevisionFor(observation: ProductObservationListing) {
  const receipt = publicReceiptById.get(observation.item.receiptId);
  return [
    "receipt-v1",
    receipt?.publicReceiptFileName ?? observation.item.receiptId,
    observation.item.id,
    observation.observedAt,
    observation.item.productName,
    observation.item.sourceProductCode,
    observation.item.unitPriceKrw,
    observation.item.quantityValue,
    observation.item.totalPriceKrw,
  ].join(":");
}

function receiptObservationCandidate(
  observation: ProductObservationListing,
): OfficialProductCandidate {
  const candidate: OfficialProductCandidate = {
    sourceProductCode: observation.item.sourceProductCode,
    productName: observation.item.productName,
    storeLabel: observation.storeLabel,
    martTag: martTagFor(observation),
    catalogNamespace: observation.catalogNamespace,
    receiptId: observation.item.receiptId,
    receiptItemId: observation.item.id,
    receiptRevision: receiptRevisionFor(observation),
    receiptObservedAt: observation.observedAt,
    receiptUnitPriceKrw: observation.item.unitPriceKrw,
    receiptQuantity: observation.item.quantityValue,
    receiptTotalPriceKrw: observation.item.totalPriceKrw,
    receiptConfidence: observation.item.confidence,
  };
  const reviewedName = findPxProductNameReview(candidate, pxProductNameReviews);
  return reviewedName ? {
    ...candidate,
    reviewedProductName: reviewedName.reviewedDisplayName,
    reviewedProductNameSourceRefs: reviewedName.sourceRefs,
  } : candidate;
}

export default function Home() {
  const [page, setPage] = useState<Page>("home");
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [category, setCategory] = useState<ProductCategory>("전체");
  const [query, setQuery] = useState("");
  const [martType, setMartType] = useState<MartType>("all");
  const [selectedStore, setSelectedStore] = useState("all");
  const [sort, setSort] = useState<ProductSort>("cheap");
  const [authOpen, setAuthOpen] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);
  const [trendGroup, setTrendGroup] = useState<ProductGroup | null>(null);
  const [cartProductToAdd, setCartProductToAdd] = useState<CartProduct | null>(null);
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

  const receipts = publicReceiptData.receipts;
  const observationListings = publicReceiptData.observations;
  const productGroups = useMemo(() => groupProductObservations(observationListings), [observationListings]);
  const approvalCandidates = useMemo(
    () => observationListings.map(receiptObservationCandidate),
    [observationListings],
  );
  const cartProducts = useMemo(() => [
    ...productGroups.map(cartProductFromGroup),
    ...publicOfficialCatalog.listings.map(cartProductFromOfficialListing),
  ], [productGroups]);

  useEffect(() => { if (!hydrated) hydrateCart(); }, [hydrateCart, hydrated]);
  useEffect(() => { if (page === "admin" && !adminLoading && !isAdmin) setPage("home"); }, [adminLoading, isAdmin, page]);
  const cartGroups = useMemo(() => cartProducts.filter((product) => lines[product.id] > 0), [cartProducts, lines]);
  const cartTotal = cartGroups.reduce((sum, product) => sum + product.priceKrw * lines[product.id], 0);
  const cartQuantityTotal = cartGroups.reduce((sum, product) => sum + lines[product.id], 0);
  const officialCandidates = useMemo(() => productGroups.map((group) => {
    const receiptCandidate = receiptObservationCandidate(group.latest);
    const reviewedName = findPxProductNameReview(receiptCandidate, pxProductNameReviews);
    const reviewedListing = reviewedName
      ? publicOfficialCatalog.listings.find((listing) => (
        listing.sourceProductCodeNamespace
          === reviewedName.officialListing.sourceProductCodeNamespace
        && listing.sourceProductCode
          === reviewedName.officialListing.sourceProductCode
      ))
      : undefined;
    const discovered = group.catalogNamespace === publicOfficialCatalog.channel.id
      ? findOfficialListingCandidate(
        publicOfficialCatalog.listings,
        group.productName,
        group.latest.item.unitPriceKrw,
      )
      : null;
    const officialListing = reviewedListing ?? discovered?.listing;
    return {
      ...receiptCandidate,
      officialDiscoveryMethod: reviewedListing
        ? "reviewed_display_name" as const
        : discovered?.method,
      officialChannelId: officialListing ? publicOfficialCatalog.channel.id : undefined,
      officialSourceProductCodeNamespace: officialListing?.sourceProductCodeNamespace,
      officialSourceProductCode: officialListing?.sourceProductCode,
      officialSnapshotId: officialListing ? publicOfficialCatalog.sourceSnapshot.id : undefined,
      officialSnapshotHash: officialListing ? publicOfficialCatalog.sourceSnapshot.contentHash : undefined,
      officialSourceNameRaw: officialListing?.sourceNameRaw,
      officialVendorNameRaw: officialListing?.vendorNameRaw ?? undefined,
      officialSpecificationTextRaw: officialListing?.specificationTextRaw ?? undefined,
      officialPriceAmountKrw: officialListing?.officialPrice.amountKrw,
      officialPriceSourceText: officialListing?.officialPrice.sourceText,
      officialPriceObservedAt: officialListing?.officialPrice.observedAt,
      officialSourceRefs: officialListing?.sourceRefs,
      officialImageUrl: officialListing?.image?.url,
      officialImageContentHash: officialListing?.image?.contentHash,
      officialImageMediaType: officialListing?.image?.mediaType,
      officialImageByteLength: officialListing?.image?.byteLength,
    };
  }), [productGroups]);

  function openCartModal(product: CartProduct) {
    setCartProductToAdd(product);
    setCartQuantity("1");
    setCartQuantityError("");
  }

  function confirmAddToCart() {
    if (!cartProductToAdd) return;
    const quantity = Number(cartQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setCartQuantityError("1개 이상의 정수를 입력하세요.");
      return;
    }
    addCart(cartProductToAdd.id, quantity);
    setCartNotice({ productName: cartProductToAdd.productName, quantity });
    setCartProductToAdd(null);
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
        <button className={page === "markets" ? styles.navActive : ""} aria-current={page === "markets" ? "page" : undefined} onClick={() => { setSelectedMarket(null); setPage("markets"); }}>판매처 기록</button>
        {isAdmin && <button className={page === "admin" ? styles.navActive : ""} aria-current={page === "admin" ? "page" : undefined} onClick={() => setPage("admin")}>관리자</button>}
      </div></nav>
    </header>

    <main className={styles.main}>
      {page === "home" && <><section className={styles.hero}><p className={styles.kicker}>PRICE OBSERVATION PLATFORM</p><h1>상품 가격을<br /><span>관측 기록으로 비교하세요.</span></h1><p>판매처와 시점이 명확한 영수증 관측가를 비교하고<br />필요한 상품을 장바구니에 모을 수 있습니다.</p><button onClick={() => openProducts()}>상품 둘러보기 <span>→</span></button></section><section className={styles.homeGrid}><CategoryBox category={category} onSelect={openProducts} /><CartBox count={cartGroups.length} quantity={cartQuantityTotal} total={cartTotal} onOpen={() => setPage("cart")} /></section></>}
      {page === "products" && <ProductBrowser groups={productGroups} query={query} setQuery={setQuery} category={category} setCategory={setCategory} martType={martType} setMartType={setMartType} selectedStore={selectedStore} setSelectedStore={setSelectedStore} sort={sort} setSort={setSort} authRevision={authRevision} onAdd={openCartModal} onTrend={setTrendGroup} onOpenStore={(store) => { setSelectedMarket(store); setPage("markets"); }} />}
      {page === "markets" && <MarketBrowser receipts={receipts} observations={observationListings} selectedStore={selectedMarket} onSelectStore={setSelectedMarket} onOpenTrend={setTrendGroup} />}
      {page === "cart" && <CartPage products={cartProducts} lines={lines} onQuantityChange={updateCartQuantity} onRemove={removeCart} onClear={clearCart} onBrowse={() => setPage("products")} />}
      {page === "admin" && isAdmin && <AdminPage candidates={officialCandidates} approvalCandidates={approvalCandidates} receipts={receipts} />}
    </main>

    <footer className={styles.footer}>가격 추적기 <span>영수증 관측가로 투명하게 비교하세요.</span></footer>
    {page !== "cart" && <FloatingCartButton quantity={cartQuantityTotal} total={cartTotal} onOpen={() => setPage("cart")} />}
    <nav className={styles.mobileNav} aria-label="모바일 주요 메뉴">
      <button className={page === "home" ? styles.mobileNavActive : ""} aria-current={page === "home" ? "page" : undefined} onClick={() => setPage("home")}><span aria-hidden="true">⌂</span>홈</button>
      <button className={page === "products" ? styles.mobileNavActive : ""} aria-current={page === "products" ? "page" : undefined} onClick={() => setPage("products")}><span aria-hidden="true">⌕</span>상품 목록</button>
      <button className={page === "cart" ? styles.mobileNavActive : ""} aria-current={page === "cart" ? "page" : undefined} onClick={() => setPage("cart")}><span aria-hidden="true">🛒</span>장바구니<b>{cartQuantityTotal || ""}</b></button>
      <button className={page === "markets" ? styles.mobileNavActive : ""} aria-current={page === "markets" ? "page" : undefined} onClick={() => { setSelectedMarket(null); setPage("markets"); }}><span aria-hidden="true">⌖</span>판매처 기록</button>
    </nav>

    {authOpen && <AuthPanel onChange={handleAuthChange} modal onClose={() => setAuthOpen(false)} />}
    {trendGroup && <PriceTrendModal group={trendGroup} onClose={() => setTrendGroup(null)} onOpenStore={(store) => { setTrendGroup(null); setSelectedMarket(store); setPage("markets"); }} />}
    {cartProductToAdd && <CartQuantityModal product={cartProductToAdd} value={cartQuantity} error={cartQuantityError} onChange={(value) => { setCartQuantity(value); setCartQuantityError(""); }} onClose={() => setCartProductToAdd(null)} onConfirm={confirmAddToCart} />}
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

function FloatingCartButton({ quantity, total, onOpen }: { quantity: number; total: number; onOpen: () => void }) {
  const totalLabel = formatKrw(total);
  const accessibleLabel = quantity > 0
    ? `장바구니 열기, 담긴 아이템 ${quantity}개, 총합 ${totalLabel}`
    : "장바구니 열기, 담긴 아이템 0개";

  return <button type="button" className={styles.floatingCart} onClick={onOpen} aria-label={accessibleLabel}>
    {quantity > 0 && <span className={styles.floatingCartTotal} aria-hidden="true"><small>총합</small><strong>{totalLabel}</strong></span>}
    <span className={styles.floatingCartIcon} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M3 4h2.2l1.9 9.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L20.5 7H6.1M9.5 19a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm8 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
      </svg>
      <span className={styles.floatingCartCount}>{quantity}</span>
    </span>
  </button>;
}
