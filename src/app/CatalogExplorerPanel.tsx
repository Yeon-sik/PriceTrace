"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { summarizeCanonicalPrices, type ReferenceUnit } from "@/domain/canonical-price";
import { resolveCoupangPrice } from "@/domain/coupang-price";
import {
  catalogSpecificationLabel,
  isCatalogSpecificationCalculationEligible,
  resolveCatalogSpecification,
  type CatalogContentUnit,
  type CatalogSpecificationStatus,
} from "@/domain/catalog-specification";
import type { PurchaseType } from "@/domain/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminStandardCatalogModal, type AdminCatalogVariant, type AdminCoupangPrice } from "./AdminStandardCatalogModal";
import styles from "./page.module.css";

type ContentUnit = CatalogContentUnit;
type StandardProduct = { id: string; canonical_name: string; brand_id: string | null; brand: string | null };
type CatalogProduct = { id: string; standard_product_id: string; purchase_type: PurchaseType; canonical_name: string; specification: string | null; specification_status: CatalogSpecificationStatus; content_amount: number | null; content_unit: ContentUnit | null; package_count: number; reference_unit: ReferenceUnit; listing_reference_url: string | null };
type RemoteObservation = { location_label: string | null; unit_price_krw: number; observed_at: string; measurement_unit: string };
type SourceProductMapping = { id: string; source_label: string; source_product_code: string };

export type CatalogExplorerSelectionRequest = {
  standardProductId: string;
  purchaseType: PurchaseType;
  requestId: number;
};

const specLabelFor = (product: CatalogProduct) => catalogSpecificationLabel({
  specificationStatus: product.specification_status,
  specification: product.specification,
  contentAmount: product.content_amount,
  contentUnit: product.content_unit,
  packageCount: product.package_count,
});

function referenceLabelFor(contentUnit: ContentUnit, referenceUnit: ReferenceUnit) {
  if (contentUnit === "each") return "1개당";
  if (referenceUnit === 1000) return contentUnit === "g" ? "1kg당" : "1L당";
  return `${referenceUnit}${contentUnit}당`;
}

function isContentUnit(value: string | null): value is ContentUnit {
  return value === "g" || value === "ml" || value === "each";
}

function buildAdminCoupangPrice(row: { listed_price_krw: number; quantity: number; content_amount: number | null; content_unit: string | null; max_bundle_quantity: number | null; max_bundle_listed_price_krw: number | null; product_url: string; observed_at: string }, referenceUnit: ReferenceUnit | null) : AdminCoupangPrice {
  const contentUnit = isContentUnit(row.content_unit) ? row.content_unit : null;
  return resolveCoupangPrice({
    listedPriceKrw: row.listed_price_krw,
    quantity: row.quantity,
    maxBundleQuantity: row.max_bundle_quantity,
    maxBundleListedPriceKrw: row.max_bundle_listed_price_krw,
    contentAmount: row.content_amount,
    contentUnit,
    productUrl: row.product_url,
    observedAt: row.observed_at,
  }, referenceUnit);
}

export function CatalogExplorerPanel({ selectionRequest }: { selectionRequest?: CatalogExplorerSelectionRequest }) {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [standardProducts, setStandardProducts] = useState<StandardProduct[]>([]);
  const [variants, setVariants] = useState<CatalogProduct[]>([]);
  const [coupangByCatalog, setCoupangByCatalog] = useState<Map<string, AdminCoupangPrice>>(new Map());
  const [selectedStandardId, setSelectedStandardId] = useState("");
  const [showStandardDetail, setShowStandardDetail] = useState(false);
  const [standardName, setStandardName] = useState("");
  const [standardNameSaving, setStandardNameSaving] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [observations, setObservations] = useState<RemoteObservation[]>([]);
  const [sourceMappings, setSourceMappings] = useState<SourceProductMapping[]>([]);
  const [selectedMappingId, setSelectedMappingId] = useState("");
  const [canonicalName, setCanonicalName] = useState("");
  const [specification, setSpecification] = useState("");
  const [contentAmount, setContentAmount] = useState("");
  const [contentUnit, setContentUnit] = useState<ContentUnit>("g");
  const [packageCount, setPackageCount] = useState("1");
  const [referenceUnit, setReferenceUnit] = useState<ReferenceUnit>(100);
  const [usesPlaceholderSpecification, setUsesPlaceholderSpecification] = useState(false);
  const [productReferenceUrl, setProductReferenceUrl] = useState("");
  const [message, setMessage] = useState("");
  const managementPanelRef = useRef<HTMLDivElement>(null);

  const loadCatalog = useCallback(async () => {
    if (!client || !selectionRequest) {
      setStandardProducts([]);
      setVariants([]);
      setCoupangByCatalog(new Map());
      return;
    }
    const [{ data: standardData, error: standardError }, { data: variantData, error: variantError }] = await Promise.all([
      client.from("standard_products").select("id,canonical_name,brand_id,brand").eq("id", selectionRequest.standardProductId).eq("purchase_type", selectionRequest.purchaseType).eq("status", "active"),
      client.from("catalog_products").select("id,standard_product_id,purchase_type,canonical_name,specification,specification_status,content_amount,content_unit,package_count,reference_unit,listing_reference_url").eq("standard_product_id", selectionRequest.standardProductId).eq("purchase_type", selectionRequest.purchaseType).eq("status", "active").order("canonical_name"),
    ]);
    if (standardError || variantError) { setMessage(standardError?.message ?? variantError?.message ?? "표준 상품 관리 정보를 불러오지 못했습니다."); return; }
    setStandardProducts((standardData ?? []) as StandardProduct[]);
    setVariants((variantData ?? []) as CatalogProduct[]);
    const referenceUnitByCatalog = new Map<string, ReferenceUnit>();
    for (const variant of variantData ?? []) {
      if (variant.specification_status === "verified") {
        referenceUnitByCatalog.set(variant.id as string, variant.reference_unit as ReferenceUnit);
      }
    }
    if ((standardData ?? []).length === 0) { setCoupangByCatalog(new Map()); return; }
    const { data: coupangData, error: coupangError } = await client.from("standard_product_coupang_prices").select("catalog_product_id,listed_price_krw,quantity,content_amount,content_unit,max_bundle_quantity,max_bundle_listed_price_krw,product_url,observed_at").eq("standard_product_id", selectionRequest.standardProductId).order("observed_at", { ascending: false });
    if (coupangError) { setMessage(coupangError.message); return; }
    const latestByCatalog = new Map<string, AdminCoupangPrice>();
    for (const row of coupangData ?? []) {
      const catalogProductId = row.catalog_product_id as string | null;
      if (catalogProductId && !latestByCatalog.has(catalogProductId)) {
        latestByCatalog.set(catalogProductId, buildAdminCoupangPrice({
          listed_price_krw: row.listed_price_krw as number,
          quantity: row.quantity as number,
          content_amount: row.content_amount as number | null,
          content_unit: row.content_unit as string | null,
          max_bundle_quantity: row.max_bundle_quantity as number | null,
          max_bundle_listed_price_krw: row.max_bundle_listed_price_krw as number | null,
          product_url: row.product_url as string,
          observed_at: row.observed_at as string,
        }, referenceUnitByCatalog.get(catalogProductId) ?? null));
      }
    }
    setCoupangByCatalog(latestByCatalog);
    setMessage("");
  }, [client, selectionRequest]);

  useEffect(() => {
    if (!client) return;
    void client.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setIsAdmin(data.user?.app_metadata?.role === "admin");
    });
  }, [client]);

  useEffect(() => {
    void loadCatalog();
    setSelectedStandardId(selectionRequest?.standardProductId ?? "");
    setShowStandardDetail(false);
    setSelectedVariantId("");
  }, [loadCatalog, selectionRequest]);

  useEffect(() => {
    if (!selectionRequest || selectedStandardId !== selectionRequest.standardProductId) return;
    managementPanelRef.current?.scrollIntoView({ block: "start" });
  }, [selectedStandardId, selectionRequest, standardProducts]);

  const loadSelectedVariantData = useCallback(async () => {
    if (!client || !selectedVariantId) {
      setObservations([]);
      setSourceMappings([]);
      return;
    }
    const [observationResult, mappingResult] = await Promise.all([
      client.from("price_observations").select("location_label,unit_price_krw,observed_at,measurement_unit").eq("catalog_product_id", selectedVariantId).order("observed_at", { ascending: false }),
      client.from("source_product_mappings").select("id,source_label,source_product_code").eq("catalog_product_id", selectedVariantId).order("source_label").order("source_product_code"),
    ]);
    if (observationResult.error || mappingResult.error) {
      setMessage(observationResult.error?.message ?? mappingResult.error?.message ?? "연결 정보를 불러오지 못했습니다.");
      return;
    }
    setObservations((observationResult.data ?? []) as RemoteObservation[]);
    setSourceMappings((mappingResult.data ?? []) as SourceProductMapping[]);
  }, [client, selectedVariantId]);

  useEffect(() => { void loadSelectedVariantData(); }, [loadSelectedVariantData]);

  const priceSummaries = useMemo(() => summarizeCanonicalPrices(observations.map((observation) => ({
    locationLabel: observation.location_label,
    unitPriceKrw: observation.unit_price_krw,
    observedAt: observation.observed_at,
    measurementUnit: observation.measurement_unit,
  }))), [observations]);
  const selectedStandard = standardProducts.find((product) => product.id === selectedStandardId) ?? null;
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const selectedMapping = sourceMappings.find((mapping) => mapping.id === selectedMappingId) ?? null;
  const variantsForSelectedStandard = useMemo(() => variants.filter((variant) => variant.standard_product_id === selectedStandardId), [variants, selectedStandardId]);
  useEffect(() => {
    setStandardName(selectedStandard?.canonical_name ?? "");
  }, [selectedStandard]);

  useEffect(() => {
    setSelectedMappingId("");
    if (!selectedVariant) return;
    setCanonicalName(selectedVariant.canonical_name);
    setSpecification(selectedVariant.specification ?? "");
    setContentAmount(selectedVariant.content_amount?.toString() ?? "");
    setContentUnit(selectedVariant.content_unit ?? "g");
    setPackageCount(selectedVariant.package_count.toString());
    setReferenceUnit(selectedVariant.reference_unit);
    setUsesPlaceholderSpecification(selectedVariant.specification_status === "placeholder");
    setProductReferenceUrl(selectedVariant.listing_reference_url ?? "");
  }, [selectedVariant]);

  async function updateSelectedStandardName(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !selectedStandard) return;
    const nextName = standardName.trim();
    if (!nextName) {
      setMessage("표준 상품명을 입력하세요.");
      return;
    }
    if (nextName === selectedStandard.canonical_name) {
      setMessage("변경된 표준 상품명이 없습니다.");
      return;
    }

    setStandardNameSaving(true);
    setMessage("");
    try {
      const { data, error } = await client.rpc("admin_manage_standard_catalog", {
        p_action: "update_standard_name",
        p_target_id: selectedStandard.id,
        p_payload: { canonicalName: nextName },
        p_confirmation: `CONFIRM_STANDARD_CATALOG_ACTION:update_standard_name:${selectedStandard.id}`,
      });
      if (error || !data) {
        setMessage(error?.message ?? "표준 상품명을 수정하지 못했습니다.");
        return;
      }
      await loadCatalog();
      setMessage(`표준 상품명을 “${nextName}”으로 수정했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "표준 상품명을 수정하지 못했습니다.");
    } finally {
      setStandardNameSaving(false);
    }
  }

  async function updateSelectedVariant(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !selectedVariant || !canonicalName.trim()) return;
    const specificationStatus: CatalogSpecificationStatus = usesPlaceholderSpecification ? "placeholder" : "verified";
    const parsedContentAmount = Number(contentAmount);
    const parsedPackageCount = Number(packageCount);
    if ((!usesPlaceholderSpecification && (!Number.isFinite(parsedContentAmount) || parsedContentAmount <= 0 || !Number.isInteger(parsedPackageCount) || parsedPackageCount <= 0)) || !productReferenceUrl.trim()) {
      setMessage("규격은 내용량, 단위, 묶음 수, 확인 URL을 함께 입력해야 합니다.");
      return;
    }
    const resolvedSpecification = resolveCatalogSpecification(specificationStatus, {
      contentAmount: parsedContentAmount,
      contentUnit,
      packageCount: parsedPackageCount,
      referenceUnit,
    });
    const { error } = await client.rpc("admin_manage_standard_catalog", {
      p_action: "update_catalog_variant",
      p_target_id: selectedVariant.id,
      p_payload: {
        canonicalName: canonicalName.trim(),
        specification: specification.trim() || null,
        specificationStatus,
        contentAmount: resolvedSpecification.contentAmount,
        contentUnit: resolvedSpecification.contentUnit,
        packageCount: resolvedSpecification.packageCount,
        referenceUnit: resolvedSpecification.referenceUnit,
        listingReferenceUrl: productReferenceUrl.trim(),
      },
      p_confirmation: `CONFIRM_STANDARD_CATALOG_ACTION:update_catalog_variant:${selectedVariant.id}`,
    });
    if (error) setMessage(error.message);
    else {
      setMessage(isCatalogSpecificationCalculationEligible(specificationStatus) ? "선택한 판매 규격을 확정했습니다." : "임시 규격으로 저장했습니다. 공개 단위가격 계산에서는 제외됩니다.");
      await loadCatalog();
    }
  }

  async function deleteSelectedVariant() {
    if (!client || !selectedVariant || typeof window === "undefined") return;
    if (!window.confirm(`“${selectedVariant.canonical_name}” 판매 규격과 연결된 판매처 코드를 삭제할까요? 원본 영수증은 삭제되지 않으며, 연결만 해제됩니다.`)) return;
    const { error } = await client.rpc("admin_manage_standard_catalog", {
      p_action: "delete_catalog_variant",
      p_target_id: selectedVariant.id,
      p_payload: {},
      p_confirmation: `CONFIRM_STANDARD_CATALOG_ACTION:delete_catalog_variant:${selectedVariant.id}`,
    });
    if (error) { setMessage(error.message); return; }
    setSelectedVariantId("");
    setSelectedMappingId("");
    setMessage("판매 규격과 연결된 판매처 코드를 삭제했습니다. 원본 영수증은 유지됩니다.");
    await loadCatalog();
  }

  async function deleteSelectedMapping() {
    if (!client || !selectedMapping || typeof window === "undefined") return;
    if (!window.confirm(`“${selectedMapping.source_label} · ${selectedMapping.source_product_code}” 연결을 삭제할까요? 영수증 원본은 유지됩니다.`)) return;
    const { error } = await client.rpc("admin_manage_standard_catalog", {
      p_action: "delete_source_mapping",
      p_target_id: selectedMapping.id,
      p_payload: {},
      p_confirmation: `CONFIRM_STANDARD_CATALOG_ACTION:delete_source_mapping:${selectedMapping.id}`,
    });
    if (error) { setMessage(error.message); return; }
    setSelectedMappingId("");
    setMessage("판매처 상품번호 연결을 삭제했습니다. 원본 영수증은 유지됩니다.");
    await loadSelectedVariantData();
  }

  async function submitCoupangPrice(catalogProductId: string, productUrl: string, listedPriceKrw: number, quantity: number, contentAmount: number, contentUnit: ContentUnit, maxBundleQuantity: number | null, maxBundleListedPriceKrw: number | null): Promise<{ ok: boolean; message: string }> {
    if (!client || !userId) return { ok: false, message: "로그인이 필요합니다." };
    if (!selectedStandardId) return { ok: false, message: "표준 상품을 먼저 선택하세요." };
    if (!variants.some((variant) => variant.id === catalogProductId && variant.standard_product_id === selectedStandardId)) {
      return { ok: false, message: "선택한 판매 규격이 현재 표준 상품에 속하지 않습니다." };
    }
    const { error } = await client.rpc("admin_manage_standard_catalog", {
      p_action: "record_coupang_price",
      p_target_id: catalogProductId,
      p_payload: {
        productUrl,
        listedPriceKrw,
        quantity,
        contentAmount,
        contentUnit,
        maxBundleQuantity,
        maxBundleListedPriceKrw,
      },
      p_confirmation: `CONFIRM_STANDARD_CATALOG_ACTION:record_coupang_price:${catalogProductId}`,
    });
    if (error) return { ok: false, message: error.message };
    await loadCatalog();
    return { ok: true, message: "선택한 판매 규격에 쿠팡가를 등록했습니다." };
  }

  if (!client || !userId) return null;

  return (
    <section className={styles.section} aria-labelledby="standard-management-title">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="standard-management-title">규격·판매처 코드 관리</h2>
          <p className={styles.muted}>상단의 등록된 표준 상품을 선택하면 해당 상품의 규격과 판매처 코드를 관리할 수 있습니다.</p>
        </div>
      </div>
      {message && <p role="status" className={styles.muted}>{message}</p>}
      {selectedStandard && isAdmin ? <div className={styles.catalogAdmin} ref={managementPanelRef}>
        <h3>{selectedStandard.canonical_name}</h3>
        <p className={styles.muted}>브랜드: <b>{selectedStandard.brand ?? "미지정"}</b> · 하위 판매 규격은 표준 상품군의 브랜드를 상속합니다.</p>
        <form className={styles.inline} onSubmit={updateSelectedStandardName}>
          <label>표준 상품명<input value={standardName} onChange={(event) => setStandardName(event.target.value)} required aria-label="표준 상품명" /></label>
          <button type="submit" disabled={standardNameSaving || !standardName.trim()}>{standardNameSaving ? "상품명 저장 중..." : "표준 상품명 수정"}</button>
        </form>
        <button type="button" className={styles.secondaryButton} onClick={() => setShowStandardDetail(true)}>쿠팡가·상세 보기</button>
        <label>하위 상품 선택 (판매처 매핑 대상)<select value={selectedVariantId} onChange={(event) => setSelectedVariantId(event.target.value)}><option value="">하위 상품을 선택하세요</option>{variantsForSelectedStandard.map((variant) => <option key={variant.id} value={variant.id}>{variant.canonical_name} · {specLabelFor(variant)}</option>)}</select></label>
        {selectedVariant ? <>
          <section>
            <h4>판매처별 관측가</h4>
            {priceSummaries.length === 0 ? <p className={styles.muted}>이 하위 상품에 연결된 가격 관측이 없습니다.</p> : <div className={styles.catalogList}>
              {priceSummaries.map((summary) => <article className={styles.catalogProduct} key={summary.locationLabel}>
                <strong>{summary.locationLabel}</strong>
                <small>최근 {summary.latestKrw.toLocaleString("ko-KR")}원 | 최저 {summary.minimumKrw.toLocaleString("ko-KR")}원 | 최고 {summary.maximumKrw.toLocaleString("ko-KR")}원</small>
                <small>{summary.observationCount}회 관측 | {summary.measurementUnits.join(", ")}</small>
              </article>)}
            </div>}
          </section>
          <form className={styles.inline} onSubmit={updateSelectedVariant}>
            <label>판매 규격명<input value={canonicalName} onChange={(event) => setCanonicalName(event.target.value)} required /></label>
            <label>규격<input value={specification} onChange={(event) => setSpecification(event.target.value)} /></label>
            <label className={styles.placeholderToggle}><input type="checkbox" checked={usesPlaceholderSpecification} onChange={(event) => setUsesPlaceholderSpecification(event.target.checked)} /><span><b>규격 확인 필요 — 임시값 유지</b><small>체크 시 1개 × 1로 저장하고 가격 계산에서 제외합니다.</small></span></label>
            {usesPlaceholderSpecification
              ? <p className={styles.placeholderNotice}>실제 규격을 확인했다면 체크를 해제하고 아래 값을 입력하세요.</p>
              : <>
                  <label>내용량<input inputMode="decimal" value={contentAmount} onChange={(event) => setContentAmount(event.target.value)} placeholder="예: 400" required /></label>
                  <label>내용 단위<select value={contentUnit} onChange={(event) => setContentUnit(event.target.value as ContentUnit)}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label>
                  <label>묶음 수<input type="number" min="1" step="1" value={packageCount} onChange={(event) => setPackageCount(event.target.value)} required /></label>
                  <label>단위 가격 기준<select value={referenceUnit} onChange={(event) => setReferenceUnit(Number(event.target.value) as ReferenceUnit)} disabled={contentUnit === "each"} aria-describedby="reference-unit-help"><option value="10">{referenceLabelFor(contentUnit, 10)}</option><option value="100">{referenceLabelFor(contentUnit, 100)}</option><option value="1000">{referenceLabelFor(contentUnit, 1000)}</option></select><small id="reference-unit-help">{contentUnit === "each" ? "개 상품은 항상 1개당으로 계산합니다." : "판매처와 쿠팡 가격을 이 기준으로 환산합니다."}</small></label>
                </>}
            <label>상품 확인 URL<input type="url" value={productReferenceUrl} onChange={(event) => setProductReferenceUrl(event.target.value)} placeholder="https://" required /></label>
            <button type="submit">{usesPlaceholderSpecification ? "임시 규격 유지" : "판매 규격 확정"}</button>
            <button type="button" className={styles.deleteCatalogButton} onClick={deleteSelectedVariant}>판매 규격 삭제</button>
          </form>
          <div className={styles.mappingManager}>
            <h4>연결된 판매처 코드</h4>
            {sourceMappings.length === 0 ? <p className={styles.muted}>연결된 판매처 코드가 없습니다.</p> : <div className={styles.mappingList}>{sourceMappings.map((mapping) => <button type="button" key={mapping.id} className={`${styles.catalogProduct} ${mapping.id === selectedMappingId ? styles.selectedCatalogProduct : ""}`} aria-pressed={mapping.id === selectedMappingId} onClick={() => setSelectedMappingId(mapping.id)}><strong>{mapping.source_label}</strong><small>{mapping.source_product_code}</small></button>)}</div>}
          </div>
          {selectedMapping ? <section className={styles.inline} aria-label="선택한 판매처 코드">
            <span>판매처 <b>{selectedMapping.source_label}</b></span>
            <span>판매처 상품번호 <b>{selectedMapping.source_product_code}</b></span>
            <small>판매처와 상품번호는 연결 식별자이므로 수정할 수 없습니다. 값이 잘못되었다면 연결을 삭제하고 검증된 새 LinkProposal로 다시 등록하세요.</small>
            <button type="button" className={styles.secondaryButton} onClick={() => setSelectedMappingId("")}>선택 해제</button>
            <button type="button" className={styles.deleteCatalogButton} onClick={deleteSelectedMapping}>연결 삭제</button>
          </section> : <p className={styles.muted}>새 영수증 연결은 표준 상품 연결 탭에서 검증된 LinkProposal을 승인해 등록합니다.</p>}
        </> : <p className={styles.muted}>수정하거나 삭제할 하위 상품을 먼저 선택하세요.</p>}
      </div> : <p className={styles.emptyState}>{selectionRequest ? "선택한 표준 상품의 관리 정보를 불러오는 중입니다." : "상단의 등록된 표준 상품을 선택하세요."}</p>}
      {selectedStandard && (!isAdmin || showStandardDetail) && <AdminStandardCatalogModal
        name={selectedStandard.canonical_name}
        variants={variantsForSelectedStandard.map((variant): AdminCatalogVariant => ({ id: variant.id, canonicalName: variant.canonical_name, specLabel: specLabelFor(variant), isPlaceholder: variant.specification_status === "placeholder", contentAmount: variant.content_amount, contentUnit: variant.content_unit, listingReferenceUrl: variant.listing_reference_url }))}
        coupangPrices={coupangByCatalog}
        onClose={() => {
          setShowStandardDetail(false);
          if (!isAdmin) setSelectedStandardId("");
        }}
        onSubmitCoupangPrice={submitCoupangPrice}
      />}
    </section>
  );
}
