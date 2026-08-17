"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { formatKrw } from "@/domain/settlement";
import type {
  AdminUnverifiedProductSaleResult,
  AdminUnverifiedRetailCatalogOption,
} from "@/domain/admin-unverified-registration";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminUnverifiedRegistrationRepository } from "@/repositories/admin-unverified-registration.repository";
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

function nullable(value: string) {
  return value.trim() || null;
}

export function AdminUnverifiedRegistrationPanel() {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(
    () => client ? new AdminUnverifiedRegistrationRepository(client) : null,
    [client],
  );
  const [catalog, setCatalog] = useState<AdminUnverifiedRetailCatalogOption[]>([]);
  const [productForm, setProductForm] = useState<ProductForm>(initialProductForm);
  const [loading, setLoading] = useState(Boolean(client));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [productResult, setProductResult] = useState<AdminUnverifiedProductSaleResult | null>(null);
  const [productResultPriceKrw, setProductResultPriceKrw] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!client || !repository) return;
    setLoading(true);
    setError("");
    try {
      setCatalog(await repository.loadRetailCatalog());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "미인증 등록 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [client, repository]);

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

  if (!client || !repository) {
    return <section className={styles.unverifiedRegistrationPanel}><div className={styles.restaurantEmpty} role="status"><strong>Supabase 관리자 연결이 필요합니다.</strong><span>관리자 로그인과 Supabase 설정을 확인하세요.</span></div></section>;
  }

  const selectedProduct = catalog.find((item) => item.id === productForm.catalogProductId);
  return <section className={styles.unverifiedRegistrationPanel} aria-labelledby="unverified-registration-title">
    <div className={styles.adminSectionHead}>
      <div><p className={styles.kicker}>ADMIN MANUAL PRODUCT DATA</p><h2 id="unverified-registration-title">영수증 없는 상품 직접 등록 <span className={styles.unverifiedBadge}>미인증</span></h2><p>관리자만 등록할 수 있습니다. 영수증·구매 증거가 없는 상품 판매 정보는 저장 시점부터 미인증으로 표시되며, 별도 검증 전에는 공개 검증 관측에 포함되지 않습니다.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || saving}>자료 새로고침</button>
    </div>
    <div className={styles.unverifiedBoundaryNotice}><strong>미인증 경계</strong><span>상품 가격 사실을 입력할 수 있지만, 서버가 영수증 FK chain을 만들거나 검증 상태로 바꾸지 않습니다.</span></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.restaurantAdminSuccess} role="status">{message}</p>}

    <form className={styles.unverifiedForm} onSubmit={submitProduct}>
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
    </form>

  </section>;
}
