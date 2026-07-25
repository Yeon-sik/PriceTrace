"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { summarizeCanonicalPrices } from "@/domain/canonical-price";
import { categoryForProduct, PRODUCT_CATEGORIES, type ProductCategory } from "@/domain/product-browser";
import type { PurchaseType } from "@/domain/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminStandardCatalogModal, type AdminCatalogVariant, type AdminCoupangPrice } from "./AdminStandardCatalogModal";
import styles from "./page.module.css";

type Category = { id: string; purchase_type: PurchaseType; parent_id: string | null; display_name: string; depth: number };
type ContentUnit = "g" | "ml" | "each";
type StandardProduct = { id: string; canonical_name: string; brand: string | null; category_id: string | null };
type CatalogProduct = { id: string; standard_product_id: string; purchase_type: PurchaseType; canonical_name: string; brand: string | null; specification: string | null; content_amount: number | null; content_unit: ContentUnit | null; package_count: number; listing_reference_url: string | null; category_id: string | null };
type RemoteObservation = { location_label: string | null; unit_price_krw: number; observed_at: string; measurement_unit: string };

const purchaseTypeLabels: Record<PurchaseType, string> = {
  retail_product: "소매 상품",
  menu_item: "식당 메뉴",
  raw_material: "원자재",
  property: "부동산",
  service: "서비스",
};

function descendantIds(categories: Category[], categoryId: string) {
  const ids = new Set([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parent_id && ids.has(category.parent_id) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

function specLabelFor(product: CatalogProduct) {
  if (!product.content_amount || !product.content_unit) return product.specification ?? "규격 미입력";
  const unitLabel = product.content_unit === "each" ? "개" : product.content_unit;
  const base = `${product.content_amount}${unitLabel}`;
  return product.package_count > 1 ? `${base} x ${product.package_count}` : base;
}

export function CatalogExplorerPanel() {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [purchaseType, setPurchaseType] = useState<PurchaseType>("retail_product");
  const [categories, setCategories] = useState<Category[]>([]);
  const [standardProducts, setStandardProducts] = useState<StandardProduct[]>([]);
  const [variants, setVariants] = useState<CatalogProduct[]>([]);
  const [coupangByStandard, setCoupangByStandard] = useState<Map<string, AdminCoupangPrice>>(new Map());
  const [categoryId, setCategoryId] = useState("");
  const [productCategory, setProductCategory] = useState<ProductCategory>("전체");
  const [selectedStandardId, setSelectedStandardId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [observations, setObservations] = useState<RemoteObservation[]>([]);
  const [canonicalName, setCanonicalName] = useState("");
  const [brand, setBrand] = useState("");
  const [specification, setSpecification] = useState("");
  const [contentAmount, setContentAmount] = useState("");
  const [contentUnit, setContentUnit] = useState<ContentUnit>("g");
  const [packageCount, setPackageCount] = useState("1");
  const [productReferenceUrl, setProductReferenceUrl] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceProductCode, setSourceProductCode] = useState("");
  const [message, setMessage] = useState("");

  const loadCatalog = useCallback(async () => {
    if (!client) return;
    const [{ data: categoryData, error: categoryError }, { data: standardData, error: standardError }, { data: variantData, error: variantError }] = await Promise.all([
      client.from("catalog_categories").select("id,purchase_type,parent_id,display_name,depth").eq("purchase_type", purchaseType).order("depth").order("display_name"),
      client.from("standard_products").select("id,canonical_name,brand,category_id").eq("purchase_type", purchaseType).eq("status", "active").order("canonical_name"),
      client.from("catalog_products").select("id,standard_product_id,purchase_type,canonical_name,brand,specification,content_amount,content_unit,package_count,listing_reference_url,category_id").eq("purchase_type", purchaseType).eq("status", "active").order("canonical_name"),
    ]);
    if (categoryError || standardError || variantError) { setMessage(categoryError?.message ?? standardError?.message ?? variantError?.message ?? "카탈로그를 불러오지 못했습니다."); return; }
    setCategories((categoryData ?? []) as Category[]);
    setStandardProducts((standardData ?? []) as StandardProduct[]);
    setVariants((variantData ?? []) as CatalogProduct[]);
    const standardIds = (standardData ?? []).map((row) => row.id as string);
    if (standardIds.length === 0) { setCoupangByStandard(new Map()); return; }
    const { data: coupangData, error: coupangError } = await client.from("standard_product_coupang_prices").select("standard_product_id,listed_price_krw,quantity,product_url,observed_at").in("standard_product_id", standardIds).order("observed_at", { ascending: false });
    if (coupangError) { setMessage(coupangError.message); return; }
    const latestByStandard = new Map<string, AdminCoupangPrice>();
    for (const row of coupangData ?? []) {
      const standardProductId = row.standard_product_id as string;
      if (!latestByStandard.has(standardProductId)) {
        const listedPriceKrw = row.listed_price_krw as number;
        const quantity = row.quantity as number;
        latestByStandard.set(standardProductId, { unitPriceKrw: Math.round(listedPriceKrw / quantity), listedPriceKrw, quantity, productUrl: row.product_url as string });
      }
    }
    setCoupangByStandard(latestByStandard);
  }, [client, purchaseType]);

  useEffect(() => {
    if (!client) return;
    void client.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setIsAdmin(data.user?.app_metadata?.role === "admin");
    });
  }, [client]);

  useEffect(() => {
    void loadCatalog();
    setCategoryId("");
    setProductCategory("전체");
    setSelectedStandardId("");
    setSelectedVariantId("");
  }, [loadCatalog]);

  useEffect(() => {
    if (!client || !selectedVariantId) {
      setObservations([]);
      return;
    }
    void client.from("price_observations").select("location_label,unit_price_krw,observed_at,measurement_unit").eq("catalog_product_id", selectedVariantId).order("observed_at", { ascending: false }).then(({ data, error }) => {
      if (error) setMessage(error.message);
      else setObservations((data ?? []) as RemoteObservation[]);
    });
  }, [client, selectedVariantId]);

  const visibleStandardProducts = useMemo(() => {
    let scoped = standardProducts;
    if (categoryId) {
      const ids = descendantIds(categories, categoryId);
      scoped = scoped.filter((product) => product.category_id && ids.has(product.category_id));
    }
    if (productCategory !== "전체") scoped = scoped.filter((product) => categoryForProduct(product.canonical_name) === productCategory);
    return scoped;
  }, [categories, categoryId, productCategory, standardProducts]);
  const priceSummaries = useMemo(() => summarizeCanonicalPrices(observations.map((observation) => ({
    locationLabel: observation.location_label,
    unitPriceKrw: observation.unit_price_krw,
    observedAt: observation.observed_at,
    measurementUnit: observation.measurement_unit,
  }))), [observations]);
  const selectedStandard = standardProducts.find((product) => product.id === selectedStandardId) ?? null;
  const variantsForSelectedStandard = useMemo(() => variants.filter((variant) => variant.standard_product_id === selectedStandardId), [variants, selectedStandardId]);
  const coupangPriceForSelectedStandard = coupangByStandard.get(selectedStandardId) ?? null;

  async function createCatalogProduct(event: React.FormEvent) {
    event.preventDefault();
    if (typeof window !== "undefined") {
      setMessage("판매 상품 등록은 표준 상품 연결 화면에서 표준 상품과 판매 규격을 함께 지정해 주세요.");
      return;
    }
    if (!client || !userId || !canonicalName.trim()) return;
    const parsedContentAmount = contentAmount.trim() ? Number(contentAmount) : null;
    const parsedPackageCount = Number(packageCount);
    if ((parsedContentAmount !== null && (!Number.isFinite(parsedContentAmount) || parsedContentAmount <= 0)) || !Number.isInteger(parsedPackageCount) || parsedPackageCount <= 0 || (parsedContentAmount !== null && !productReferenceUrl.trim())) {
      setMessage("규격은 내용량, 단위, 묶음 수, 확인 URL을 함께 입력해야 합니다.");
      return;
    }
    if (!parsedContentAmount || !productReferenceUrl.trim()) { setMessage("판매 규격은 표준 상품 연결 화면에서 등록하세요."); return; }
    const { error } = await client.from("catalog_products").insert({
      standard_product_id: selectedStandardId,
      purchase_type: purchaseType,
      canonical_name: canonicalName.trim(),
      brand: brand.trim() || null,
      specification: specification.trim() || null,
      content_amount: parsedContentAmount,
      content_unit: contentUnit,
      package_count: parsedPackageCount,
      listing_reference_url: productReferenceUrl.trim(),
      created_by: userId,
    });
    if (error) setMessage(error.message);
    else {
      setCanonicalName("");
      setBrand("");
      setSpecification("");
      setContentAmount("");
      setContentUnit("g");
      setPackageCount("1");
      setProductReferenceUrl("");
      setMessage("표준 상품을 등록했습니다.");
      await loadCatalog();
    }
  }

  async function createSourceMapping(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !userId || !selectedVariantId || !sourceLabel.trim() || !sourceProductCode.trim()) return;
    const reviewedAt = new Date().toISOString();
    const { error } = await client.from("source_product_mappings").insert({
      source_label: sourceLabel.trim(),
      source_product_code: sourceProductCode.trim(),
      catalog_product_id: selectedVariantId,
      matching_method: "manual",
      confidence: 1,
      review_status: "verified",
      created_by: userId,
      reviewed_by: userId,
      reviewed_at: reviewedAt,
    });
    if (error) setMessage(error.message);
    else {
      setSourceLabel("");
      setSourceProductCode("");
      setMessage("판매처 상품번호 매핑을 등록했습니다. 이후 동기화되는 관측가부터 표준 상품에 연결됩니다.");
    }
  }

  async function submitCoupangPrice(productUrl: string, listedPriceKrw: number, quantity: number): Promise<{ ok: boolean; message: string }> {
    if (!client || !userId) return { ok: false, message: "로그인이 필요합니다." };
    if (!selectedStandardId) return { ok: false, message: "표준 상품을 먼저 선택하세요." };
    const observedAt = new Date().toISOString();
    const { error } = await client.from("standard_product_coupang_prices").insert({ standard_product_id: selectedStandardId, product_url: productUrl, listed_price_krw: listedPriceKrw, quantity, observed_at: observedAt, created_by: userId });
    if (error) return { ok: false, message: error.message };
    await loadCatalog();
    return { ok: true, message: "쿠팡가를 등록했습니다." };
  }

  if (!client || !userId) return null;

  return (
    <section className={styles.section} aria-labelledby="catalog-title">
      <div className={styles.controls}>
        <div>
          <h2 id="catalog-title">상품 카테고리 탐색</h2>
          <p className={styles.muted}>표준 상품과 카테고리는 영수증 원본 JSON과 분리되어 관리됩니다.</p>
        </div>
        <label>구매 대상 유형
          <select value={purchaseType} onChange={(event) => setPurchaseType(event.target.value as PurchaseType)}>
            {Object.entries(purchaseTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>카테고리
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">전체</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{"-- ".repeat(category.depth)}{category.display_name}</option>)}
          </select>
        </label>
      </div>
      {message && <p role="status" className={styles.muted}>{message}</p>}
      <div className={styles.filters} aria-label="물품 카테고리">{PRODUCT_CATEGORIES.map((item) => <button type="button" aria-pressed={productCategory === item} className={productCategory === item ? styles.filterActive : ""} key={item} onClick={() => setProductCategory(item)}>{item}</button>)}</div>
      <div className={styles.catalogGrid}>
        <div>
          <h3 className={styles.blackHeading}>표준 상품</h3>
          {visibleStandardProducts.length === 0 ? <p>선택한 범위에 등록된 표준 상품이 없습니다.</p> : <div className={styles.catalogList}>
            {visibleStandardProducts.map((product) => <button type="button" className={product.id === selectedStandardId ? styles.selectedCatalogProduct : styles.catalogProduct} key={product.id} onClick={() => setSelectedStandardId(product.id)}>
              <strong>{product.canonical_name}</strong>
              <small>{[product.brand, `하위 상품 ${variants.filter((variant) => variant.standard_product_id === product.id).length}개`].filter(Boolean).join(" | ")}</small>
            </button>)}
          </div>}
        </div>
        <div>
          <h3>판매처별 관측가</h3>
          {!selectedVariantId ? <p>하위 상품을 선택하세요.</p> : priceSummaries.length === 0 ? <p>이 하위 상품에 연결된 가격 관측이 없습니다.</p> : <div className={styles.catalogList}>
            {priceSummaries.map((summary) => <article className={styles.catalogProduct} key={summary.locationLabel}>
              <strong>{summary.locationLabel}</strong>
              <small>최근 {summary.latestKrw.toLocaleString("ko-KR")}원 | 최저 {summary.minimumKrw.toLocaleString("ko-KR")}원 | 최고 {summary.maximumKrw.toLocaleString("ko-KR")}원</small>
              <small>{summary.observationCount}회 관측 | {summary.measurementUnits.join(", ")}</small>
            </article>)}
          </div>}
        </div>
      </div>
      {isAdmin && <div className={styles.catalogAdmin}>
        <h3>관리자 표준 상품·판매처 코드 관리</h3>
        <label>하위 상품 선택 (판매처 매핑 대상)<select value={selectedVariantId} onChange={(event) => setSelectedVariantId(event.target.value)}><option value="">하위 상품을 선택하세요</option>{variantsForSelectedStandard.map((variant) => <option key={variant.id} value={variant.id}>{variant.canonical_name} · {specLabelFor(variant)}</option>)}</select></label>
        <form className={styles.inline} onSubmit={createCatalogProduct}>
          <label>표준 상품명<input value={canonicalName} onChange={(event) => setCanonicalName(event.target.value)} required /></label>
          <label>브랜드<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>
          <label>규격<input value={specification} onChange={(event) => setSpecification(event.target.value)} /></label>
          <label>내용량<input inputMode="decimal" value={contentAmount} onChange={(event) => setContentAmount(event.target.value)} placeholder="예: 400" /></label>
          <label>내용 단위<select value={contentUnit} onChange={(event) => setContentUnit(event.target.value as ContentUnit)}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label>
          <label>묶음 수<input type="number" min="1" step="1" value={packageCount} onChange={(event) => setPackageCount(event.target.value)} /></label>
          <label>상품 확인 URL<input type="url" value={productReferenceUrl} onChange={(event) => setProductReferenceUrl(event.target.value)} placeholder="https://" /></label>
          <button type="submit">표준 상품 등록</button>
        </form>
        <form className={styles.inline} onSubmit={createSourceMapping}>
          <label>판매처<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} required /></label>
          <label>판매처 상품번호<input value={sourceProductCode} onChange={(event) => setSourceProductCode(event.target.value)} required /></label>
          <button type="submit" disabled={!selectedVariantId}>선택 하위 상품에 연결</button>
        </form>
      </div>}
      {selectedStandard && <AdminStandardCatalogModal
        name={selectedStandard.canonical_name}
        variants={variantsForSelectedStandard.map((variant): AdminCatalogVariant => ({ id: variant.id, canonicalName: variant.canonical_name, specLabel: specLabelFor(variant), listingReferenceUrl: variant.listing_reference_url }))}
        coupangPrice={coupangPriceForSelectedStandard}
        onClose={() => setSelectedStandardId("")}
        onSubmitCoupangPrice={submitCoupangPrice}
      />}
    </section>
  );
}
