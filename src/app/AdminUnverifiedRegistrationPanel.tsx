"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { RestaurantMenuReadEntry } from "@/domain/restaurant-menu";
import { formatKrw } from "@/domain/settlement";
import type {
  AdminUnverifiedProductSaleResult,
  AdminUnverifiedRestaurantMenuResult,
  AdminUnverifiedRetailCatalogOption,
} from "@/domain/admin-unverified-registration";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminUnverifiedRegistrationRepository } from "@/repositories/admin-unverified-registration.repository";
import { RestaurantMenuRepository } from "@/repositories/restaurant-menu.repository";
import styles from "./page.module.css";

type ProductForm = {
  catalogProductId: string;
  standardName: string;
  brandName: string;
  listingName: string;
  specification: string;
  contentAmount: string;
  contentUnit: "g" | "ml" | "each";
  packageCount: string;
  referenceUnit: "10" | "100" | "1000";
  listingReferenceUrl: string;
  sellerName: string;
  sourceProductCode: string;
  productUrl: string;
  listedPriceKrw: string;
  shippingFeeKrw: string;
  minimumOrderQuantity: string;
  observedAt: string;
};

type RestaurantForm = {
  restaurantId: string;
  restaurantName: string;
  restaurantLegalName: string;
  cuisineType: string;
  restaurantOfficialSiteUrl: string;
  sourceLocationCode: string;
  locationLabel: string;
  locationOfficialUrl: string;
  restaurantMenuId: string;
  menuName: string;
  menuCategoryLabel: string;
  servingLabel: string;
  menuOfficialUrl: string;
  unitPriceKrw: string;
  quantity: string;
  observedOn: string;
  sourceUrl: string;
  note: string;
};

function newIdempotencyKey(prefix: string) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${id}`;
}

function localDateTimeValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDateValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function initialProductForm(): ProductForm {
  return {
    catalogProductId: "",
    standardName: "",
    brandName: "",
    listingName: "",
    specification: "",
    contentAmount: "",
    contentUnit: "g",
    packageCount: "1",
    referenceUnit: "100",
    listingReferenceUrl: "",
    sellerName: "",
    sourceProductCode: "",
    productUrl: "",
    listedPriceKrw: "",
    shippingFeeKrw: "0",
    minimumOrderQuantity: "1",
    observedAt: localDateTimeValue(),
  };
}

function initialRestaurantForm(): RestaurantForm {
  return {
    restaurantId: "",
    restaurantName: "",
    restaurantLegalName: "",
    cuisineType: "",
    restaurantOfficialSiteUrl: "",
    sourceLocationCode: "",
    locationLabel: "",
    locationOfficialUrl: "",
    restaurantMenuId: "",
    menuName: "",
    menuCategoryLabel: "",
    servingLabel: "1인분",
    menuOfficialUrl: "",
    unitPriceKrw: "",
    quantity: "1",
    observedOn: localDateValue(),
    sourceUrl: "",
    note: "",
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

function selectedRestaurantMenu(entries: RestaurantMenuReadEntry[], restaurantId: string, menuId: string) {
  return entries.find((entry) => entry.restaurant.id === restaurantId)?.menus.find((menu) => menu.id === menuId) ?? null;
}

export function AdminUnverifiedRegistrationPanel() {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(
    () => client ? new AdminUnverifiedRegistrationRepository(client) : null,
    [client],
  );
  const restaurantRepository = useMemo(
    () => client ? new RestaurantMenuRepository(client) : null,
    [client],
  );
  const [mode, setMode] = useState<"product" | "restaurant">("product");
  const [catalog, setCatalog] = useState<AdminUnverifiedRetailCatalogOption[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantMenuReadEntry[]>([]);
  const [productForm, setProductForm] = useState<ProductForm>(initialProductForm);
  const [restaurantForm, setRestaurantForm] = useState<RestaurantForm>(initialRestaurantForm);
  const [loading, setLoading] = useState(Boolean(client));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [productResult, setProductResult] = useState<AdminUnverifiedProductSaleResult | null>(null);
  const [productResultPriceKrw, setProductResultPriceKrw] = useState<number | null>(null);
  const [restaurantResult, setRestaurantResult] = useState<AdminUnverifiedRestaurantMenuResult | null>(null);

  const load = useCallback(async () => {
    if (!client || !repository) return;
    setLoading(true);
    setError("");
    try {
      setCatalog(await repository.loadRetailCatalog());
      if (restaurantRepository) {
        const payload = await restaurantRepository.read({ limit: 200 });
        setRestaurants(payload.restaurants);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "미인증 등록 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [client, repository, restaurantRepository]);

  useEffect(() => { void load(); }, [load]);

  function selectCatalog(catalogProductId: string) {
    const selected = catalog.find((item) => item.id === catalogProductId);
    setProductForm((current) => ({
      ...current,
      catalogProductId,
      standardName: selected?.standard_name ?? "",
      brandName: selected?.brand ?? "",
      listingName: selected?.canonical_name ?? "",
      specification: selected?.specification ?? "",
      contentAmount: selected?.content_amount === null || selected?.content_amount === undefined ? "" : String(selected.content_amount),
      contentUnit: selected?.content_unit ?? "g",
      packageCount: selected?.package_count ? String(selected.package_count) : "1",
      referenceUnit: selected?.reference_unit ? String(selected.reference_unit) as ProductForm["referenceUnit"] : "100",
      listingReferenceUrl: selected?.listing_reference_url ?? "",
    }));
    setError("");
    setMessage("");
    setProductResult(null);
    setProductResultPriceKrw(null);
  }

  function selectRestaurant(restaurantId: string) {
    const selected = restaurants.find((entry) => entry.restaurant.id === restaurantId);
    setRestaurantForm((current) => ({
      ...current,
      restaurantId,
      restaurantName: selected?.restaurant.brand ?? "",
      restaurantLegalName: selected?.restaurant.legalName ?? "",
      cuisineType: selected?.restaurant.cuisineType ?? "",
      restaurantOfficialSiteUrl: selected?.restaurant.officialSiteUrl ?? "",
      restaurantMenuId: "",
      menuName: "",
      menuCategoryLabel: "",
      servingLabel: "1인분",
      menuOfficialUrl: "",
    }));
    setError("");
    setMessage("");
    setRestaurantResult(null);
  }

  function selectMenu(restaurantMenuId: string) {
    const menu = selectedRestaurantMenu(restaurants, restaurantForm.restaurantId, restaurantMenuId);
    setRestaurantForm((current) => ({
      ...current,
      restaurantMenuId,
      menuName: menu?.name ?? "",
      menuCategoryLabel: menu?.categoryLabel ?? "",
      servingLabel: menu?.servingLabel ?? "1인분",
      menuOfficialUrl: menu?.officialUrl ?? "",
    }));
    setError("");
    setMessage("");
    setRestaurantResult(null);
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository) return;
    setSaving(true);
    setError("");
    setMessage("");
    setProductResult(null);
    try {
      const listedPriceKrw = Number(productForm.listedPriceKrw);
      const result = await repository.registerProductSale({
        idempotencyKey: newIdempotencyKey("admin-unverified-product"),
        catalogProductId: nullable(productForm.catalogProductId),
        standardName: productForm.standardName,
        brandName: nullable(productForm.brandName),
        listingName: productForm.listingName,
        specification: nullable(productForm.specification),
        contentAmount: productForm.contentAmount.trim() ? Number(productForm.contentAmount) : null,
        contentUnit: productForm.contentUnit,
        packageCount: productForm.packageCount.trim() ? Number(productForm.packageCount) : null,
        referenceUnit: Number(productForm.referenceUnit) as 10 | 100 | 1000,
        listingReferenceUrl: nullable(productForm.listingReferenceUrl),
        sellerName: productForm.sellerName,
        sourceProductCode: nullable(productForm.sourceProductCode),
        productUrl: productForm.productUrl,
        listedPriceKrw,
        shippingFeeKrw: Number(productForm.shippingFeeKrw),
        minimumOrderQuantity: Number(productForm.minimumOrderQuantity),
        observedAt: new Date(productForm.observedAt).toISOString(),
      });
      setProductResult(result);
      setProductResultPriceKrw(listedPriceKrw);
      setMessage("상품 판매 정보를 미인증으로 등록했습니다. 별도 검증 전에는 공개 상품 관측으로 승격되지 않습니다.");
      setProductForm(initialProductForm());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "미인증 상품 판매 정보 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function submitRestaurant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository) return;
    setSaving(true);
    setError("");
    setMessage("");
    setRestaurantResult(null);
    try {
      const result = await repository.registerRestaurantMenu({
        idempotencyKey: newIdempotencyKey("admin-unverified-restaurant-menu"),
        restaurantId: nullable(restaurantForm.restaurantId),
        restaurantName: restaurantForm.restaurantName,
        restaurantLegalName: nullable(restaurantForm.restaurantLegalName),
        cuisineType: nullable(restaurantForm.cuisineType),
        restaurantOfficialSiteUrl: nullable(restaurantForm.restaurantOfficialSiteUrl),
        sourceNamespace: "admin-manual",
        sourceLocationCode: restaurantForm.sourceLocationCode,
        locationLabel: nullable(restaurantForm.locationLabel),
        locationOfficialUrl: nullable(restaurantForm.locationOfficialUrl),
        restaurantMenuId: nullable(restaurantForm.restaurantMenuId),
        menuName: restaurantForm.menuName,
        menuCategoryLabel: nullable(restaurantForm.menuCategoryLabel),
        servingLabel: restaurantForm.servingLabel,
        menuOfficialUrl: nullable(restaurantForm.menuOfficialUrl),
        unitPriceKrw: Number(restaurantForm.unitPriceKrw),
        quantity: Number(restaurantForm.quantity),
        observedOn: restaurantForm.observedOn,
        sourceUrl: nullable(restaurantForm.sourceUrl),
        note: nullable(restaurantForm.note),
      });
      setRestaurantResult(result);
      setMessage("음식점 메뉴와 가격을 미인증으로 등록했습니다. 영수증 검증 전에는 공개 메뉴 기록으로 승격되지 않습니다.");
      setRestaurantForm(initialRestaurantForm());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "미인증 음식점 메뉴 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!client || !repository) {
    return <section className={styles.unverifiedRegistrationPanel}><div className={styles.restaurantEmpty} role="status"><strong>Supabase 관리자 연결이 필요합니다.</strong><span>관리자 로그인과 Supabase 설정을 확인하세요.</span></div></section>;
  }

  const selectedProduct = catalog.find((item) => item.id === productForm.catalogProductId);
  const selectedRestaurant = restaurants.find((entry) => entry.restaurant.id === restaurantForm.restaurantId);

  return <section className={styles.unverifiedRegistrationPanel} aria-labelledby="unverified-registration-title">
    <div className={styles.adminSectionHead}>
      <div><p className={styles.kicker}>ADMIN MANUAL DATA</p><h2 id="unverified-registration-title">영수증 없는 직접 등록 <span className={styles.unverifiedBadge}>미인증</span></h2><p>관리자만 등록할 수 있습니다. 영수증·구매 증거가 없는 상품 판매 정보와 음식점 메뉴는 저장 시점부터 미인증으로 표시되며, 별도 검증 전에는 공개 검증 관측에 포함되지 않습니다.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || saving}>자료 새로고침</button>
    </div>
    <div className={styles.unverifiedBoundaryNotice}><strong>미인증 경계</strong><span>가격·메뉴 사실을 입력할 수 있지만, 서버가 영수증 FK chain을 만들거나 검증 상태로 바꾸지 않습니다.</span></div>
    <div className={styles.unverifiedModeTabs} role="tablist" aria-label="미인증 직접 등록 유형">
      <button type="button" role="tab" aria-selected={mode === "product"} onClick={() => setMode("product")}>상품 판매 정보</button>
      <button type="button" role="tab" aria-selected={mode === "restaurant"} onClick={() => setMode("restaurant")}>음식점 메뉴</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.restaurantAdminSuccess} role="status">{message}</p>}

    {mode === "product" && <form className={styles.unverifiedForm} onSubmit={submitProduct}>
      <fieldset>
        <legend>상품 identity</legend>
        <label className={styles.unverifiedWide}>기존 정확 판매 규격<select value={productForm.catalogProductId} onChange={(event) => selectCatalog(event.target.value)}><option value="">새 미인증 상품 만들기</option>{catalog.map((item) => <option key={item.id} value={item.id}>{item.standard_name} · {item.canonical_name} · {item.specification ?? "규격 미입력"} [{item.verification_status === "unverified" ? "미인증" : "검증"}]</option>)}</select></label>
        <label>표준 상품명<input required={!selectedProduct} readOnly={Boolean(selectedProduct)} value={productForm.standardName} onChange={(event) => setProductForm({ ...productForm, standardName: event.target.value })} placeholder="예: 햇반" /></label>
        <label>브랜드<input value={productForm.brandName} readOnly={Boolean(selectedProduct)} onChange={(event) => setProductForm({ ...productForm, brandName: event.target.value })} /></label>
        <label>판매 규격명<input required={!selectedProduct} readOnly={Boolean(selectedProduct)} value={productForm.listingName} onChange={(event) => setProductForm({ ...productForm, listingName: event.target.value })} placeholder="예: 햇반 210g 12개" /></label>
        <label>규격 표기<input readOnly={Boolean(selectedProduct)} value={productForm.specification} onChange={(event) => setProductForm({ ...productForm, specification: event.target.value })} placeholder="예: 210g × 12" /></label>
        <label>개당 내용량<input required={!selectedProduct} inputMode="decimal" readOnly={Boolean(selectedProduct)} value={productForm.contentAmount} onChange={(event) => setProductForm({ ...productForm, contentAmount: event.target.value })} /></label>
        <label>내용 단위<select disabled={Boolean(selectedProduct)} value={productForm.contentUnit} onChange={(event) => setProductForm({ ...productForm, contentUnit: event.target.value as ProductForm["contentUnit"] })}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label>
        <label>묶음 수<input required={!selectedProduct} type="number" min="1" step="1" readOnly={Boolean(selectedProduct)} value={productForm.packageCount} onChange={(event) => setProductForm({ ...productForm, packageCount: event.target.value })} /></label>
        <label>단위 가격 기준<select disabled={Boolean(selectedProduct)} value={productForm.referenceUnit} onChange={(event) => setProductForm({ ...productForm, referenceUnit: event.target.value as ProductForm["referenceUnit"] })}><option value="10">10 단위당</option><option value="100">100 단위당</option><option value="1000">1,000 단위당</option></select></label>
        <label className={styles.unverifiedWide}>상품 확인 URL<input required={!selectedProduct} type="url" placeholder="https://" readOnly={Boolean(selectedProduct)} value={productForm.listingReferenceUrl} onChange={(event) => setProductForm({ ...productForm, listingReferenceUrl: event.target.value })} /></label>
      </fieldset>
      <fieldset>
        <legend>판매 정보 · 영수증 없음</legend>
        <label>판매처<input required value={productForm.sellerName} onChange={(event) => setProductForm({ ...productForm, sellerName: event.target.value })} /></label>
        <label>판매처 상품 코드<input value={productForm.sourceProductCode} onChange={(event) => setProductForm({ ...productForm, sourceProductCode: event.target.value })} /></label>
        <label>판매 상품 URL<input required type="url" placeholder="https://" value={productForm.productUrl} onChange={(event) => setProductForm({ ...productForm, productUrl: event.target.value })} /></label>
        <label>판매가<input required inputMode="numeric" value={productForm.listedPriceKrw} onChange={(event) => setProductForm({ ...productForm, listedPriceKrw: event.target.value })} /></label>
        <label>배송비<input required inputMode="numeric" value={productForm.shippingFeeKrw} onChange={(event) => setProductForm({ ...productForm, shippingFeeKrw: event.target.value })} /></label>
        <label>최소 구매 수량<input required type="number" min="1" step="1" value={productForm.minimumOrderQuantity} onChange={(event) => setProductForm({ ...productForm, minimumOrderQuantity: event.target.value })} /></label>
        <label>관측 시점<input required type="datetime-local" value={productForm.observedAt} onChange={(event) => setProductForm({ ...productForm, observedAt: event.target.value })} /></label>
      </fieldset>
      {productResult && <dl className={styles.unverifiedResult}><div><dt>상태</dt><dd><span className={styles.unverifiedBadge}>미인증</span></dd></div><div><dt>정확 판매 규격</dt><dd><code>{productResult.catalogProductId}</code></dd></div><div><dt>가격 관측</dt><dd><code>{productResult.marketPriceObservationId}</code></dd></div><div><dt>판매가</dt><dd>{formatKrw(productResultPriceKrw ?? 0)}</dd></div></dl>}
      <div className={styles.unverifiedSubmit}><p>이 등록은 영수증을 요구하지 않지만, DB는 항상 `unverified`로 기록합니다.</p><button type="submit" disabled={saving}>{saving ? "미인증 등록 중…" : "상품 판매 정보 미인증 등록"}</button></div>
    </form>}

    {mode === "restaurant" && <form className={styles.unverifiedForm} onSubmit={submitRestaurant}>
      <fieldset>
        <legend>음식점 identity</legend>
        <label className={styles.unverifiedWide}>기존 검증 음식점<select value={restaurantForm.restaurantId} onChange={(event) => selectRestaurant(event.target.value)}><option value="">새 음식점 만들기</option>{restaurants.map((entry) => <option key={entry.restaurant.id} value={entry.restaurant.id}>{entry.restaurant.brand}</option>)}</select></label>
        <label>음식점 Brand<input required value={restaurantForm.restaurantName} readOnly={Boolean(selectedRestaurant)} onChange={(event) => setRestaurantForm({ ...restaurantForm, restaurantName: event.target.value })} /></label>
        <label>법적 상호<input value={restaurantForm.restaurantLegalName} readOnly={Boolean(selectedRestaurant)} onChange={(event) => setRestaurantForm({ ...restaurantForm, restaurantLegalName: event.target.value })} /></label>
        <label>업종<input value={restaurantForm.cuisineType} readOnly={Boolean(selectedRestaurant)} onChange={(event) => setRestaurantForm({ ...restaurantForm, cuisineType: event.target.value })} placeholder="예: 한식" /></label>
        <label>음식점 공식 URL<input type="url" placeholder="https://" value={restaurantForm.restaurantOfficialSiteUrl} readOnly={Boolean(selectedRestaurant)} onChange={(event) => setRestaurantForm({ ...restaurantForm, restaurantOfficialSiteUrl: event.target.value })} /></label>
        <label>source namespace<input readOnly value="admin-manual" /></label>
        <label>지점 source code<input required value={restaurantForm.sourceLocationCode} onChange={(event) => setRestaurantForm({ ...restaurantForm, sourceLocationCode: event.target.value })} placeholder="예: 강남점-2026" /></label>
        <label>지점 표기<input value={restaurantForm.locationLabel} onChange={(event) => setRestaurantForm({ ...restaurantForm, locationLabel: event.target.value })} /></label>
        <label>지점 공식 URL<input type="url" placeholder="https://" value={restaurantForm.locationOfficialUrl} onChange={(event) => setRestaurantForm({ ...restaurantForm, locationOfficialUrl: event.target.value })} /></label>
      </fieldset>
      <fieldset>
        <legend>메뉴·가격 정보 · 영수증 없음</legend>
        <label className={styles.unverifiedWide}>기존 메뉴<select disabled={!selectedRestaurant} value={restaurantForm.restaurantMenuId} onChange={(event) => selectMenu(event.target.value)}><option value="">새 메뉴 만들기</option>{selectedRestaurant?.menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name} · {menu.servingLabel}</option>)}</select></label>
        <label>메뉴명<input required value={restaurantForm.menuName} readOnly={Boolean(restaurantForm.restaurantMenuId)} onChange={(event) => setRestaurantForm({ ...restaurantForm, menuName: event.target.value })} /></label>
        <label>메뉴 분류<input value={restaurantForm.menuCategoryLabel} readOnly={Boolean(restaurantForm.restaurantMenuId)} onChange={(event) => setRestaurantForm({ ...restaurantForm, menuCategoryLabel: event.target.value })} /></label>
        <label>제공 기준<input required value={restaurantForm.servingLabel} readOnly={Boolean(restaurantForm.restaurantMenuId)} onChange={(event) => setRestaurantForm({ ...restaurantForm, servingLabel: event.target.value })} /></label>
        <label>공식 메뉴 URL<input type="url" placeholder="https://" value={restaurantForm.menuOfficialUrl} readOnly={Boolean(restaurantForm.restaurantMenuId)} onChange={(event) => setRestaurantForm({ ...restaurantForm, menuOfficialUrl: event.target.value })} /></label>
        <label>메뉴 가격<input required inputMode="numeric" value={restaurantForm.unitPriceKrw} onChange={(event) => setRestaurantForm({ ...restaurantForm, unitPriceKrw: event.target.value })} /></label>
        <label>수량<input required type="number" min="1" step="1" value={restaurantForm.quantity} onChange={(event) => setRestaurantForm({ ...restaurantForm, quantity: event.target.value })} /></label>
        <label>관측일<input required type="date" value={restaurantForm.observedOn} onChange={(event) => setRestaurantForm({ ...restaurantForm, observedOn: event.target.value })} /></label>
        <label>메뉴 출처 URL<input type="url" placeholder="https://" value={restaurantForm.sourceUrl} onChange={(event) => setRestaurantForm({ ...restaurantForm, sourceUrl: event.target.value })} /></label>
        <label className={styles.unverifiedWide}>메모<textarea rows={3} value={restaurantForm.note} onChange={(event) => setRestaurantForm({ ...restaurantForm, note: event.target.value })} placeholder="영수증이 아닌 가격표·메뉴판 확인 메모" /></label>
      </fieldset>
      {restaurantResult && <dl className={styles.unverifiedResult}><div><dt>상태</dt><dd><span className={styles.unverifiedBadge}>미인증</span></dd></div><div><dt>음식점</dt><dd><code>{restaurantResult.restaurantId}</code></dd></div><div><dt>메뉴</dt><dd><code>{restaurantResult.restaurantMenuId}</code></dd></div><div><dt>가격 관측</dt><dd><code>{restaurantResult.manualObservationId}</code></dd></div></dl>}
      <div className={styles.unverifiedSubmit}><p>영수증 FK chain은 생성하지 않고 수동 출처와 입력 snapshot만 보존합니다.</p><button type="submit" disabled={saving}>{saving ? "미인증 등록 중…" : "음식점 메뉴 미인증 등록"}</button></div>
    </form>}
  </section>;
}
