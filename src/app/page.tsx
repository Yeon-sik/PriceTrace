"use client";

import dynamic from "next/dynamic";
import { Icon } from "@/components/Icon";
import { ObservationHome } from "@/features/observation-instrument/ObservationHome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildAppNavigationUrl, readAppNavigationUrl, type AppPage } from "@/domain/app-navigation";
import { cartProductFromGroup, cartProductFromOfficialListing, summarizeCart, type CartProduct } from "@/domain/cart";
import { groupProductObservations, martTagFor, type MartType, type ProductCategory, type ProductGroup, type ProductObservationListing, type ProductSort } from "@/domain/product-browser";
import type { OfficialProductCandidate } from "@/domain/official-product";
import { findOfficialListingCandidate } from "@/domain/official-listing-candidate";
import { formatKrw } from "@/domain/settlement";
import { findPxProductNameReview } from "@/domain/px-product-name-review";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { PublicReceiptRepository } from "@/repositories/public-receipt.repository";
import { PublicOfficialChannelCatalogRepository } from "@/repositories/public-official-channel-catalog.repository";
import { PxProductNameReviewRepository } from "@/repositories/px-product-name-review.repository";
import { useCartStore } from "@/stores/cart.store";
import { AuthPanel } from "./AuthPanel";
import { CartNoticeModal, CartQuantityModal } from "./CartModals";
import { CartPage } from "./CartPage";
import { PriceTrendModal } from "./PriceTrendModal";
import { ProductBrowser } from "./ProductBrowser";
import { MarketBrowser } from "./MarketBrowser";
import { RestaurantBrowser } from "./RestaurantBrowser";
import styles from "./page.module.css";

const AdminPage = dynamic(() => import("./AdminPage").then((module) => module.AdminPage), {
  loading: () => <p role="status">관리자 화면을 불러오는 중입니다.</p>,
});

const publicReceiptData = new PublicReceiptRepository().loadAll();
const publicOfficialCatalog = new PublicOfficialChannelCatalogRepository().loadPxCatalog();
const pxProductNameReviews = new PxProductNameReviewRepository().load(publicOfficialCatalog);
const publicReceiptById = new Map(publicReceiptData.receipts.map((receipt) => [receipt.id, receipt]));

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
  const [page, setPage] = useState<AppPage>("home");
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [selectedRestaurant, setSelectedRestaurant] = useState<string | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [selectedStoreProductId, setSelectedStoreProductId] = useState<string | null>(null);
  const [selectedRestaurantMenuId, setSelectedRestaurantMenuId] = useState<string | null>(null);
  const [selectedCatalogProductId, setSelectedCatalogProductId] = useState<string | null>(null);
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
  const navigate = useCallback((
    nextPage: AppPage,
    options: {
      selectedMarket?: string | null;
      selectedRestaurant?: string | null;
      selectedStoreId?: string | null;
      selectedStoreProductId?: string | null;
      selectedRestaurantMenuId?: string | null;
      selectedCatalogProductId?: string | null;
      replace?: boolean;
    } = {},
  ) => {
    const nextMarket = nextPage === "markets" ? options.selectedMarket ?? null : null;
    const nextRestaurant = nextPage === "restaurants"
      ? options.selectedRestaurant ?? null
      : null;
    const nextStoreId = nextPage === "markets" ? options.selectedStoreId ?? null : null;
    const nextStoreProductId = nextPage === "products" ? options.selectedStoreProductId ?? null : null;
    const nextRestaurantMenuId = nextPage === "restaurants" ? options.selectedRestaurantMenuId ?? null : null;
    const nextCatalogProductId = nextPage === "products" ? options.selectedCatalogProductId ?? null : null;
    setPage(nextPage);
    setSelectedMarket(nextMarket);
    setSelectedRestaurant(nextRestaurant);
    setSelectedStoreId(nextStoreId);
    setSelectedStoreProductId(nextStoreProductId);
    setSelectedRestaurantMenuId(nextRestaurantMenuId);
    setSelectedCatalogProductId(nextCatalogProductId);
    if (typeof window === "undefined") return;

    const nextUrl = buildAppNavigationUrl(window.location.href, {
      page: nextPage,
      selectedMarket: nextMarket,
      selectedRestaurant: nextRestaurant,
      selectedStoreId: nextStoreId,
      selectedStoreProductId: nextStoreProductId,
      selectedRestaurantMenuId: nextRestaurantMenuId,
      selectedCatalogProductId: nextCatalogProductId,
    });
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl) return;

    window.history[options.replace ? "replaceState" : "pushState"](
      { priceTracePage: nextPage },
      "",
      nextUrl,
    );
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

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
  useEffect(() => {
    const syncFromUrl = (closeTransientUi: boolean) => {
      const navigation = readAppNavigationUrl(window.location.href);
      setPage(navigation.page);
      setSelectedMarket(navigation.selectedMarket);
      setSelectedRestaurant(navigation.selectedRestaurant);
      setSelectedStoreId(navigation.selectedStoreId);
      setSelectedStoreProductId(navigation.selectedStoreProductId);
      setSelectedRestaurantMenuId(navigation.selectedRestaurantMenuId);
      setSelectedCatalogProductId(navigation.selectedCatalogProductId);
      if (closeTransientUi) {
        setAuthOpen(false);
        setTrendGroup(null);
        setCartProductToAdd(null);
        setCartNotice(null);
      }

      const canonicalUrl = buildAppNavigationUrl(window.location.href, navigation);
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (canonicalUrl !== currentUrl) {
        window.history.replaceState({ priceTracePage: navigation.page }, "", canonicalUrl);
      }
    };
    const handlePopState = () => syncFromUrl(true);
    syncFromUrl(false);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  useEffect(() => {
    if (page === "admin" && !adminLoading && !isAdmin) {
      navigate("home", { replace: true });
    }
  }, [adminLoading, isAdmin, navigate, page]);
  const cartSummary = useMemo(() => summarizeCart(cartProducts, lines), [cartProducts, lines]);
  const cartGroups = cartSummary.items;
  const cartTotal = cartSummary.totalKrw;
  const cartQuantityTotal = cartSummary.totalQuantity;
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
    navigate("products");
  }

  return <div className={styles.shell}>
    <a className={styles.skipLink} href="#main-content">본문으로 건너뛰기</a>
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <button className={styles.logo} onClick={() => navigate("home")} aria-label="가격 추적기 홈"><span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>PriceTrace<span className={styles.brandPeriod}>.</span></button>
      <nav className={styles.nav} aria-label="주요 메뉴"><div className={styles.navInner}>
        <button className={page === "home" ? styles.navActive : ""} aria-current={page === "home" ? "page" : undefined} onClick={() => navigate("home")}>홈</button>
        <button className={page === "restaurants" ? styles.navActive : ""} aria-current={page === "restaurants" ? "page" : undefined} onClick={() => navigate("restaurants")}>음식점</button>
        <button className={page === "products" ? styles.navActive : ""} aria-current={page === "products" ? "page" : undefined} onClick={() => navigate("products")}>상품 목록</button>
        <button className={page === "cart" ? styles.navActive : ""} aria-current={page === "cart" ? "page" : undefined} onClick={() => navigate("cart")}>장바구니 <span className={styles.navBadge}>{cartQuantityTotal}</span></button>
        <button className={page === "markets" ? styles.navActive : ""} aria-current={page === "markets" ? "page" : undefined} onClick={() => navigate("markets")}>판매처 기록</button>
        {isAdmin && <button className={page === "admin" ? styles.navActive : ""} aria-current={page === "admin" ? "page" : undefined} onClick={() => navigate("admin")}>관리자</button>}
      </div></nav>
        <div className={styles.account}>{isAdmin && <button className={styles.adminShortcut} onClick={() => navigate("admin")}>관리자</button>}<AuthPanel onChange={handleAuthChange} onOpen={() => setAuthOpen(true)} /></div>
      </div>
    </header>

    <main className={styles.main} id="main-content" tabIndex={-1}>
      {page === "home" && <ObservationHome groups={productGroups} receiptCount={receipts.length} cart={{ count: cartGroups.length, quantity: cartQuantityTotal, total: cartTotal }} onProducts={() => openProducts()} onRestaurants={() => navigate("restaurants")} onMarkets={() => navigate("markets")} onCart={() => navigate("cart")} onTrend={setTrendGroup} />}
      {page === "restaurants" && <RestaurantBrowser selectedRestaurant={selectedRestaurant} selectedRestaurantMenuId={selectedRestaurantMenuId} onSelectRestaurant={(restaurantId) => navigate("restaurants", { selectedRestaurant: restaurantId, replace: restaurantId === null })} onClearMenuIdentity={() => navigate("restaurants", { replace: true })} />}
      {page === "products" && <ProductBrowser groups={productGroups} query={query} setQuery={setQuery} category={category} setCategory={setCategory} martType={martType} setMartType={setMartType} selectedStore={selectedStore} setSelectedStore={setSelectedStore} sort={sort} setSort={setSort} authRevision={authRevision} selectedStoreProductId={selectedStoreProductId} selectedCatalogProductId={selectedCatalogProductId} onClearIdentity={() => navigate("products", { replace: true })} onAdd={openCartModal} onTrend={setTrendGroup} onOpenStore={(store) => navigate("markets", { selectedMarket: store })} />}
      {page === "markets" && <MarketBrowser receipts={receipts} observations={observationListings} selectedStore={selectedMarket} selectedStoreId={selectedStoreId} onSelectStore={(store) => navigate("markets", { selectedMarket: store, replace: true })} onSelectStoreId={() => navigate("markets", { replace: true })} onOpenTrend={setTrendGroup} />}
      {page === "cart" && <CartPage products={cartProducts} lines={lines} onQuantityChange={updateCartQuantity} onRemove={removeCart} onClear={clearCart} onBrowse={() => navigate("products")} />}
      {page === "admin" && isAdmin && <AdminPage candidates={officialCandidates} approvalCandidates={approvalCandidates} receipts={receipts} />}
    </main>

    <footer className={styles.footer}><strong>PriceTrace.</strong><span>출처가 있는 가격, 근거가 있는 비교.</span><a href="https://www.figma.com/community/file/1166831539721848736" target="_blank" rel="noreferrer">Icons by 480 Design · CC BY 4.0</a></footer>
    {page !== "cart" && <FloatingCartButton quantity={cartQuantityTotal} total={cartTotal} onOpen={() => navigate("cart")} />}
    <nav className={styles.mobileNav} aria-label="모바일 주요 메뉴">
      <button className={page === "home" ? styles.mobileNavActive : ""} aria-current={page === "home" ? "page" : undefined} onClick={() => navigate("home")}><Icon name="home" size={22} />홈</button>
      <button className={page === "restaurants" ? styles.mobileNavActive : ""} aria-current={page === "restaurants" ? "page" : undefined} onClick={() => navigate("restaurants")}><Icon name="restaurant" size={22} />음식점</button>
      <button className={page === "products" ? styles.mobileNavActive : ""} aria-current={page === "products" ? "page" : undefined} onClick={() => navigate("products")}><Icon name="product" size={22} />상품 목록</button>
      <button className={page === "cart" ? styles.mobileNavActive : ""} aria-current={page === "cart" ? "page" : undefined} onClick={() => navigate("cart")}><Icon name="cart" size={22} />장바구니<b>{cartQuantityTotal || ""}</b></button>
      <button className={page === "markets" ? styles.mobileNavActive : ""} aria-current={page === "markets" ? "page" : undefined} onClick={() => navigate("markets")}><Icon name="store" size={22} />판매처 기록</button>
    </nav>

    {authOpen && <AuthPanel onChange={handleAuthChange} modal onClose={() => setAuthOpen(false)} />}
    {trendGroup && <PriceTrendModal group={trendGroup} onClose={() => setTrendGroup(null)} onOpenStore={(store) => { setTrendGroup(null); navigate("markets", { selectedMarket: store }); }} />}
    {cartProductToAdd && <CartQuantityModal product={cartProductToAdd} value={cartQuantity} error={cartQuantityError} onChange={(value) => { setCartQuantity(value); setCartQuantityError(""); }} onClose={() => setCartProductToAdd(null)} onConfirm={confirmAddToCart} />}
    {cartNotice && <CartNoticeModal productName={cartNotice.productName} quantity={cartNotice.quantity} onClose={() => setCartNotice(null)} onGoCart={() => { setCartNotice(null); navigate("cart"); }} />}
  </div>;
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
