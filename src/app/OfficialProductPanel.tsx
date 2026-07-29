"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
import { discoverOfficialProduct, mergeOfficialProductCandidates, officialProductCandidateKey, officialSearchUrl, resolveStandardProductMapping, type OfficialProductCandidate, type StandardProductMapping } from "@/domain/official-product";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import {
  normalizeExternalProductImageUrl,
  validateProductImageFile,
  type ProductImageSourceType,
} from "@/domain/standard-product-image";
import {
  StandardProductImageRepository,
  type StandardProductImageDraft,
  type StandardProductImageRecord,
} from "@/repositories/standard-product-image.repository";
import type { ReferenceUnit } from "@/domain/canonical-price";
import {
  resolveCatalogSpecification,
  type CatalogSpecificationStatus,
} from "@/domain/catalog-specification";
import { parseOptionalCoupangBundle, parseRequiredCoupangPrice } from "@/domain/coupang-price";
import { availableProductCategories, categoryForProduct, type ProductCategory } from "@/domain/product-browser";
import { CatalogExplorerPanel } from "./CatalogExplorerPanel";
import styles from "./page.module.css";

type StandardProduct = { id: string; canonical_name: string; brand: string | null; product_reference_url: string | null };
type Variant = { id: string; standard_product_id: string; canonical_name: string; specification_status: CatalogSpecificationStatus; content_amount: number | null; content_unit: string | null; package_count: number; listing_reference_url: string | null };
const legacyRepository = new OfficialProductRepository();
const sellers = (candidate: OfficialProductCandidate) => candidate.storeLabels?.length ? candidate.storeLabels : [candidate.storeLabel];

export function StandardProductWorkspace({ candidates, revision }: { candidates: OfficialProductCandidate[]; revision: number }) {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [standards, setStandards] = useState<StandardProduct[]>([]);
  const [standardImages, setStandardImages] = useState<Map<string, StandardProductImageRecord>>(new Map());
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantMappings, setVariantMappings] = useState<StandardProductMapping<Variant>[]>([]);
  const [legacy, setLegacy] = useState(() => legacyRepository.loadAll());
  const [selected, setSelected] = useState<OfficialProductCandidate | null>(null);
  const [imageTarget, setImageTarget] = useState<StandardProduct | null>(null);
  const [message, setMessage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStandardCategory, setSelectedStandardCategory] = useState<ProductCategory | null>(null);
  const [lowerTab, setLowerTab] = useState<"connection" | "specification">("connection");

  const load = useCallback(async () => {
    if (!client) return;
    const [{ data: standardData, error: standardError }, { data: imageData, error: imageError }, { data: variantData, error: variantError }, { data: mappingData, error: mappingError }] = await Promise.all([
      client.from("standard_products").select("id,canonical_name,brand,product_reference_url").eq("status", "active").order("canonical_name"),
      client.from("standard_product_images").select("standard_product_id,source_type,image_url,storage_path,mime_type,file_size_bytes,width,height"),
      client.from("catalog_products").select("id,standard_product_id,canonical_name,specification_status,content_amount,content_unit,package_count,listing_reference_url").eq("status", "active"),
      client.from("source_product_mappings").select("source_label,source_product_code,catalog_product_id").eq("review_status", "verified"),
    ]);
    if (standardError || imageError || variantError || mappingError) { setMessage(standardError?.message ?? imageError?.message ?? variantError?.message ?? mappingError?.message ?? "표준 상품을 불러오지 못했습니다."); return; }
    const byId = new Map((variantData ?? []).map((variant) => [variant.id, variant as Variant]));
    setStandards((standardData ?? []) as StandardProduct[]);
    setStandardImages(new Map((imageData ?? []).map((image) => [image.standard_product_id, image as StandardProductImageRecord])));
    setVariants((variantData ?? []) as Variant[]);
    setVariantMappings((mappingData ?? []).flatMap((mapping) => {
      const variant = byId.get(mapping.catalog_product_id);
      return variant ? [{ sourceLabel: mapping.source_label, sourceProductCode: mapping.source_product_code, product: variant }] : [];
    }));
    setLegacy(legacyRepository.loadAll());
    setMessage("");
  }, [client]);

  useEffect(() => { if (client) void client.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, [client]);
  useEffect(() => { void load(); }, [load, revision]);

  const standardById = useMemo(() => new Map(standards.map((standard) => [standard.id, standard])), [standards]);
  const states = useMemo(() => mergeOfficialProductCandidates(candidates).map((candidate) => {
    const variant = resolveStandardProductMapping(candidate, variantMappings);
    const browserRecord = legacy[officialProductCandidateKey(candidate)];
    const discovered = discoverOfficialProduct(candidate);
    return { candidate, variant, standard: variant ? standardById.get(variant.standard_product_id) : undefined, legacy: browserRecord ?? (discovered.status === "matched" ? discovered.record : undefined), fromBrowserStorage: Boolean(browserRecord) };
  }), [candidates, variantMappings, standardById, legacy]);
  const linked = states.filter((state) => state.variant && state.standard);
  const unlinked = states.filter((state) => !state.variant);
  const matchesSearch = useCallback((state: (typeof states)[number]) => {
    const query = searchQuery.trim().toLocaleLowerCase("ko-KR");
    if (!query) return true;
    return `${state.candidate.productName} ${state.candidate.sourceProductCode} ${sellers(state.candidate).join(" ")} ${state.standard?.canonical_name ?? ""} ${state.variant?.canonical_name ?? ""}`.toLocaleLowerCase("ko-KR").includes(query);
  }, [searchQuery]);
  const visibleUnlinked = unlinked.filter(matchesSearch);
  const variantsByStandard = useMemo(() => {
    const grouped = new Map<string, Variant[]>();
    for (const variant of variants) grouped.set(variant.standard_product_id, [...(grouped.get(variant.standard_product_id) ?? []), variant]);
    return grouped;
  }, [variants]);
  const visibleStandards = useMemo(() => standards
    .filter((standard) => {
      const query = searchQuery.trim().toLocaleLowerCase("ko-KR");
      const variantText = (variantsByStandard.get(standard.id) ?? []).map((variant) => `${variant.canonical_name} ${variant.content_amount ?? ""}${variant.content_unit ?? ""}`).join(" ");
      return !query || `${standard.canonical_name} ${variantText}`.toLocaleLowerCase("ko-KR").includes(query);
    }), [standards, variantsByStandard, searchQuery]);
  const standardCategories = useMemo(() => availableProductCategories(visibleStandards.map((standard) => standard.canonical_name)), [visibleStandards]);
  const standardsForSelectedCategory = useMemo(() => selectedStandardCategory === "전체" ? visibleStandards : selectedStandardCategory ? visibleStandards.filter((standard) => categoryForProduct(standard.canonical_name) === selectedStandardCategory) : [], [selectedStandardCategory, visibleStandards]);
  const selectedState = selected ? states.find((state) => officialProductCandidateKey(state.candidate) === officialProductCandidateKey(selected)) : undefined;

  if (!client || !userId) return null;
  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>STANDARD PRODUCT MAPPING</p><h1>표준 상품 연결</h1><p>표준 상품은 햇반 같은 상품군입니다. 영수증 품목은 실제 판매 규격(예: 210g × 3)으로 등록해 표준 상품 아래에 보관합니다.</p></div></div>
    {message && <p className={styles.error} role="alert">{message}</p>}
    <label className={styles.mappingSearch}><span className={styles.srOnly}>표준 상품 연결 검색</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="상품명, 판매처, 상품 코드로 검색" /></label>
    <div className={styles.officialSummary}><span><b>{variants.length}</b>개 판매 규격 등록</span><span><b>{variants.filter((variant) => variant.specification_status === "placeholder").length}</b>개 규격 확인 필요</span><span><b>{linked.length}</b>개 영수증 판매 기록 매핑</span><span><b>{unlinked.length}</b>개 연결 필요</span></div>
    <section className={styles.officialSection}><h2>등록된 표준 상품</h2><p className={styles.manualHint}>대표 이미지는 파일 업로드 또는 HTTPS 이미지 링크로 등록할 수 있습니다. 파일은 최적화 후 Supabase Storage에 저장됩니다.</p>{visibleStandards.length ? <><div className={styles.standardCategoryButtons} aria-label="표준 상품 카테고리"><button type="button" aria-pressed={selectedStandardCategory === "전체"} className={selectedStandardCategory === "전체" ? styles.selectedCatalogProduct : ""} onClick={() => setSelectedStandardCategory("전체")}>전체</button>{standardCategories.map((category) => <button type="button" key={category} aria-pressed={selectedStandardCategory === category} className={selectedStandardCategory === category ? styles.selectedCatalogProduct : ""} onClick={() => setSelectedStandardCategory(category)}>{category}</button>)}<button type="button" onClick={() => setSelectedStandardCategory(null)}>선택 해제</button></div>{selectedStandardCategory ? <div className={styles.officialGrid}>{standardsForSelectedCategory.map((standard) => {
      const image = standardImages.get(standard.id);
      const registeredVariants = variantsByStandard.get(standard.id) ?? [];
      const pendingCount = registeredVariants.filter((variant) => variant.specification_status === "placeholder").length;
      return <article key={standard.id}><div className={styles.officialThumb}><ProductImagePreview imageUrl={image?.image_url} productName={standard.canonical_name} /></div><div><span>표준 상품</span><h3>{standard.canonical_name}</h3><small>판매 규격 {registeredVariants.length}개 · {image ? image.source_type === "upload" ? "Supabase 저장 이미지" : "외부 이미지 링크" : "대표 이미지 없음"}</small>{pendingCount > 0 && <strong className={styles.specificationBadge}>규격 확인 필요 {pendingCount}개</strong>}<button type="button" onClick={() => setImageTarget(standard)}>{image ? "대표 이미지 변경" : "대표 이미지 추가"}</button></div></article>;
    })}</div> : <p className={styles.muted}>카테고리를 선택하면 해당 표준 상품만 표시됩니다.</p>}</> : <p>검색 조건에 맞는 표준 상품이 없습니다.</p>}</section>
    <div className={styles.standardWorkspaceTabs} role="tablist" aria-label="표준 상품 관리 영역"><button type="button" role="tab" aria-selected={lowerTab === "connection"} className={lowerTab === "connection" ? styles.standardWorkspaceTabActive : ""} onClick={() => setLowerTab("connection")}>연결 대기 상품</button><button type="button" role="tab" aria-selected={lowerTab === "specification"} className={lowerTab === "specification" ? styles.standardWorkspaceTabActive : ""} onClick={() => setLowerTab("specification")}>규격·판매처 코드 관리</button></div>
    {lowerTab === "connection" ? <section className={styles.officialSection}><h2>표준 상품 연결 대기열</h2><p className={styles.manualHint}>규격을 확인할 수 없으면 임시값으로 연결할 수 있습니다. 임시값은 관리자 검토 전까지 공개 단위가격 계산에서 제외됩니다.</p><div className={styles.manualQueue}>{visibleUnlinked.map(({ candidate, legacy: legacyRecord, fromBrowserStorage }) => <article key={officialProductCandidateKey(candidate)}><div><strong>{legacyRecord?.officialName ?? candidate.productName}</strong><small>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</small>{legacyRecord && <small>{fromBrowserStorage ? "기존 브라우저 저장 연결" : "기존 시드 연결"}을 가져올 수 있습니다.</small>}</div><div className={styles.queueActions}><a href={legacyRecord?.officialUrl ?? officialSearchUrl(candidate)} target="_blank" rel="noreferrer">상품 정보 찾기</a><button onClick={() => setSelected(candidate)}>{legacyRecord ? "표준 상품으로 가져오기" : "표준 상품 연결"}</button></div></article>)}</div></section> : <CatalogExplorerPanel />}
    {selected && <StandardProductConnectionModal candidate={selected} legacy={selectedState?.legacy} standards={standards} userId={userId} onClose={() => setSelected(null)} onSaved={(notice) => { void load().then(() => notice && setMessage(notice)); }} />}
    {imageTarget && <StandardProductImageModal standard={imageTarget} existing={standardImages.get(imageTarget.id)} userId={userId} onClose={() => setImageTarget(null)} onSaved={() => { setImageTarget(null); void load(); }} />}
  </section>;
}

function StandardProductModal({ candidate, legacy, standards, userId, onClose, onSaved }: { candidate: OfficialProductCandidate; legacy?: { officialName: string; officialUrl: string; imageUrl?: string }; standards: StandardProduct[]; userId: string; onClose: () => void; onSaved: (notice?: string) => void }) {
  const client = getSupabaseBrowserClient();
  const [standardProductId, setStandardProductId] = useState("");
  const [standardName, setStandardName] = useState(legacy?.officialName ?? candidate.productName);
  const [listingName, setListingName] = useState(candidate.productName);
  const [productUrl, setProductUrl] = useState(legacy?.officialUrl ?? "");
  const [contentAmount, setContentAmount] = useState("");
  const [contentUnit, setContentUnit] = useState<"g" | "ml" | "each">("g");
  const [packageCount, setPackageCount] = useState("1");
  const [referenceUnit, setReferenceUnit] = useState<ReferenceUnit>(100);
  const [usesPlaceholderSpecification, setUsesPlaceholderSpecification] = useState(false);
  const [imageSourceType, setImageSourceType] = useState<ProductImageSourceType>(legacy?.imageUrl ? "external_url" : "upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageLink, setImageLink] = useState(legacy?.imageUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedStandard = standards.find((standard) => standard.id === standardProductId);
  const reusedListingName = legacy?.officialName ?? candidate.productName;
  const reusedProductUrl = legacy?.officialUrl ?? selectedStandard?.product_reference_url ?? "";
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const resolvedListingName = selectedStandard ? reusedListingName : listingName.trim();
    const resolvedProductUrl = selectedStandard ? reusedProductUrl : productUrl.trim();
    if (!client || !resolvedListingName || !/^https?:\/\//.test(resolvedProductUrl)) { setMessage("상품명과 확인 URL을 확인하세요."); return; }
    const specificationStatus: CatalogSpecificationStatus = usesPlaceholderSpecification ? "placeholder" : "verified";
    const parsedContentAmount = Number(contentAmount);
    const parsedPackageCount = Number(packageCount);
    if (!usesPlaceholderSpecification && (!Number.isFinite(parsedContentAmount) || parsedContentAmount <= 0 || !Number.isInteger(parsedPackageCount) || parsedPackageCount <= 0)) { setMessage("내용량과 묶음 수를 올바르게 입력하세요."); return; }
    const resolvedSpecification = resolveCatalogSpecification(specificationStatus, {
      contentAmount: parsedContentAmount,
      contentUnit,
      packageCount: parsedPackageCount,
      referenceUnit,
    });
    const imageDraft = selectedStandard
      ? { draft: null, error: null }
      : resolveImageDraft(imageSourceType, imageFile, imageLink, true);
    if (imageDraft.error) { setMessage(imageDraft.error); return; }

    setSaving(true);
    setMessage("");
    try {
      let selectedStandardId = standardProductId;
      if (!selectedStandardId) {
        if (!standardName.trim()) throw new Error("새 표준 상품명을 입력하세요.");
        const { data, error } = await client.from("standard_products").insert({ purchase_type: "retail_product", canonical_name: standardName.trim(), product_reference_url: resolvedProductUrl, created_by: userId }).select("id").single();
        if (error || !data) throw new Error(error?.message ?? "표준 상품을 저장하지 못했습니다.");
        selectedStandardId = data.id;
      }
      const { data: variant, error: variantError } = await client.from("catalog_products").insert({ standard_product_id: selectedStandardId, purchase_type: "retail_product", canonical_name: resolvedListingName, specification_status: specificationStatus, content_amount: resolvedSpecification.contentAmount, content_unit: resolvedSpecification.contentUnit, package_count: resolvedSpecification.packageCount, reference_unit: resolvedSpecification.referenceUnit, listing_reference_url: resolvedProductUrl, created_by: userId }).select("id").single();
      if (variantError || !variant) throw new Error(variantError?.message ?? "판매 규격을 저장하지 못했습니다.");
      const reviewedAt = new Date().toISOString();
      const rows = sellers(candidate).map((sourceLabel) => ({ source_label: sourceLabel, source_product_code: candidate.sourceProductCode, catalog_product_id: variant.id, matching_method: "manual", confidence: 1, review_status: "verified", created_by: userId, reviewed_by: userId, reviewed_at: reviewedAt }));
      const { error: mappingError } = await client.from("source_product_mappings").upsert(rows, { onConflict: "source_label,source_product_code" });
      if (mappingError) throw new Error(mappingError.message);

      if (imageDraft.draft) {
        try {
          await new StandardProductImageRepository(client).save(selectedStandardId, userId, imageDraft.draft);
        } catch (error) {
          onSaved(`표준 상품 연결은 저장했지만 대표 이미지 저장에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
          return;
        }
      }
      onSaved(usesPlaceholderSpecification ? "표준 상품을 연결했습니다. 임시 규격은 관리자 검토 전까지 단위가격 계산에서 제외됩니다." : undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "표준 상품을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className={`${styles.authModal} ${styles.officialModal}`} role="dialog" aria-modal="true" aria-labelledby="standard-product-title">
      <button className={styles.closeButton} onClick={onClose} disabled={saving} aria-label="표준 상품 연결 닫기">×</button>
      <p className={styles.kicker}>STANDARD PRODUCT</p>
      <h2 id="standard-product-title">표준 상품과 판매 규격 연결</h2>
      <p className={styles.productCode}>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</p>
      <form className={styles.manualForm} onSubmit={save}>
        <label>기존 표준 상품
          <select value={standardProductId} onChange={(event) => { setStandardProductId(event.target.value); setMessage(""); }}>
            <option value="">새 표준 상품 만들기</option>
            {standards.map((standard) => <option key={standard.id} value={standard.id}>{standard.canonical_name}</option>)}
          </select>
        </label>
        {selectedStandard
          ? <section className={styles.reusedProductInfo} aria-label="재사용할 상품 정보">
              <span>표준 상품 <b>{selectedStandard.canonical_name}</b></span>
              <span>하위 상품명 <b>{reusedListingName}</b></span>
              {reusedProductUrl ? <a href={reusedProductUrl} target="_blank" rel="noreferrer">기존 상품 URL 확인</a> : <strong>기존 URL이 없어 연결할 수 없습니다.</strong>}
            </section>
          : <>
              <label>새 표준 상품명<input required value={standardName} onChange={(event) => setStandardName(event.target.value)} placeholder="예: 햇반" /></label>
              <label>판매 규격명<input required value={listingName} onChange={(event) => setListingName(event.target.value)} placeholder="예: 햇반 210g × 3" /></label>
              <label>상품 확인 URL<input required type="url" placeholder="https://" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} /></label>
              <ProductImageSourceFields sourceType={imageSourceType} onSourceTypeChange={setImageSourceType} file={imageFile} onFileChange={setImageFile} link={imageLink} onLinkChange={setImageLink} required />
            </>}
        <label className={styles.placeholderToggle}>
          <input type="checkbox" checked={usesPlaceholderSpecification} onChange={(event) => { setUsesPlaceholderSpecification(event.target.checked); setMessage(""); }} />
          <span><b>규격 확인 필요 — 임시값 사용</b><small>1개 × 1로 저장하지만 공개 단위가격 계산에서는 제외합니다.</small></span>
        </label>
        {usesPlaceholderSpecification
          ? <p className={styles.placeholderNotice} role="status">관리자 탭의 ‘표준 상품·규격’에서 실제 내용량과 묶음 수를 입력해 확정하세요.</p>
          : <>
              <label>개별 내용량<input required inputMode="decimal" placeholder="예: 210" value={contentAmount} onChange={(event) => setContentAmount(event.target.value)} /></label>
              <label>내용 단위<select value={contentUnit} onChange={(event) => setContentUnit(event.target.value as "g" | "ml" | "each")}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label>
              <label>묶음 수<input required type="number" min="1" step="1" value={packageCount} onChange={(event) => setPackageCount(event.target.value)} /></label>
              <label>단위 가격 기준
                <select value={referenceUnit} onChange={(event) => setReferenceUnit(Number(event.target.value) as ReferenceUnit)} disabled={contentUnit === "each"}>
                  <option value="10">{referenceLabel(contentUnit, 10)}</option>
                  <option value="100">{referenceLabel(contentUnit, 100)}</option>
                  <option value="1000">{referenceLabel(contentUnit, 1000)}</option>
                </select>
                <small>{contentUnit === "each" ? "개 상품은 1개당으로 계산합니다." : "판매처와 쿠팡가를 이 기준으로 환산합니다."}</small>
              </label>
            </>}
        <button type="submit" disabled={saving || Boolean(selectedStandard && !reusedProductUrl)}>{saving ? "저장 중..." : usesPlaceholderSpecification ? "임시 규격으로 연결" : "표준 상품에 판매 규격 등록"}</button>
      </form>
      {message && <p className={styles.authMessage} role="status">{message}</p>}
    </section>
  </div>;
}

function StandardProductConnectionModal({ candidate, legacy, standards, userId, onClose, onSaved }: { candidate: OfficialProductCandidate; legacy?: { officialName: string; officialUrl: string; imageUrl?: string }; standards: StandardProduct[]; userId: string; onClose: () => void; onSaved: (notice?: string) => void }) {
  const client = getSupabaseBrowserClient();
  const [standardProductId, setStandardProductId] = useState("");
  const [standardName, setStandardName] = useState(legacy?.officialName ?? candidate.productName);
  const [listingName, setListingName] = useState(candidate.productName);
  const [productUrl, setProductUrl] = useState(legacy?.officialUrl ?? "");
  const [contentAmount, setContentAmount] = useState("");
  const [contentUnit, setContentUnit] = useState<"g" | "ml" | "each">("g");
  const [packageCount, setPackageCount] = useState("1");
  const [referenceUnit, setReferenceUnit] = useState<ReferenceUnit>(100);
  const [usesPlaceholderSpecification, setUsesPlaceholderSpecification] = useState(false);
  const [imageSourceType, setImageSourceType] = useState<ProductImageSourceType>(legacy?.imageUrl ? "external_url" : "upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageLink, setImageLink] = useState(legacy?.imageUrl ?? "");
  const [coupangProductUrl, setCoupangProductUrl] = useState("");
  const [coupangListedPriceKrw, setCoupangListedPriceKrw] = useState("");
  const [coupangQuantity, setCoupangQuantity] = useState("1");
  const [coupangContentAmount, setCoupangContentAmount] = useState("");
  const [coupangMaxBundleQuantity, setCoupangMaxBundleQuantity] = useState("");
  const [coupangMaxBundleListedPriceKrw, setCoupangMaxBundleListedPriceKrw] = useState("");
  const [mappingSaved, setMappingSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedStandard = standards.find((standard) => standard.id === standardProductId);
  const reusedListingName = legacy?.officialName ?? candidate.productName;
  const reusedProductUrl = legacy?.officialUrl ?? selectedStandard?.product_reference_url ?? "";

  async function saveMapping(event: React.FormEvent) {
    event.preventDefault();
    if (mappingSaved) return;
    const resolvedListingName = selectedStandard ? reusedListingName : listingName.trim();
    const resolvedProductUrl = selectedStandard ? reusedProductUrl : productUrl.trim();
    if (!client || !resolvedListingName || !/^https?:\/\//.test(resolvedProductUrl)) { setMessage("상품명과 확인 URL을 확인하세요."); return; }
    const specificationStatus: CatalogSpecificationStatus = usesPlaceholderSpecification ? "placeholder" : "verified";
    const parsedContentAmount = Number(contentAmount);
    const parsedPackageCount = Number(packageCount);
    const parsedCoupangContentAmount = Number(coupangContentAmount);
    if (!usesPlaceholderSpecification && (!Number.isFinite(parsedContentAmount) || parsedContentAmount <= 0 || !Number.isInteger(parsedPackageCount) || parsedPackageCount <= 0)) { setMessage("내용량과 묶음 수를 올바르게 입력하세요."); return; }
    if (!/^https?:\/\//.test(coupangProductUrl.trim()) || !Number.isFinite(parsedCoupangContentAmount) || parsedCoupangContentAmount <= 0) { setMessage("쿠팡 링크와 개당 내용량을 올바르게 입력하세요."); return; }
    const parsedCoupangRequiredPrice = parseRequiredCoupangPrice(coupangListedPriceKrw, coupangQuantity);
    if (!parsedCoupangRequiredPrice.value) { setMessage(parsedCoupangRequiredPrice.error); return; }
    const parsedCoupangBundle = parseOptionalCoupangBundle(coupangMaxBundleQuantity, coupangMaxBundleListedPriceKrw);
    if (!parsedCoupangBundle.value) { setMessage(parsedCoupangBundle.error); return; }
    const specification = resolveCatalogSpecification(specificationStatus, { contentAmount: parsedContentAmount, contentUnit, packageCount: parsedPackageCount, referenceUnit });
    const imageDraft = selectedStandard ? { draft: null, error: null } : resolveImageDraft(imageSourceType, imageFile, imageLink, true);
    if (imageDraft.error) { setMessage(imageDraft.error); return; }
    setSaving(true); setMessage("");
    try {
      if (!standardProductId && !standardName.trim()) throw new Error("새 표준 상품명을 입력하세요.");
      const { data, error } = await client.rpc("register_standard_product_with_coupang_offer", {
        p_standard_product_id: standardProductId || null,
        p_standard_name: standardName.trim(),
        p_product_reference_url: resolvedProductUrl,
        p_listing_name: resolvedListingName,
        p_specification_status: specificationStatus,
        p_content_amount: specification.contentAmount,
        p_content_unit: specification.contentUnit,
        p_package_count: specification.packageCount,
        p_reference_unit: specification.referenceUnit,
        p_source_product_code: candidate.sourceProductCode,
        p_source_labels: sellers(candidate),
        p_coupang_product_url: coupangProductUrl.trim(),
        p_coupang_listed_price_krw: parsedCoupangRequiredPrice.value.listedPriceKrw,
        p_coupang_quantity: parsedCoupangRequiredPrice.value.quantity,
        p_coupang_content_amount: parsedCoupangContentAmount,
        p_coupang_content_unit: specification.contentUnit,
        p_coupang_max_bundle_quantity: parsedCoupangBundle.value.maxBundleQuantity,
        p_coupang_max_bundle_listed_price_krw: parsedCoupangBundle.value.maxBundleListedPriceKrw,
      });
      const saved = data?.[0];
      if (error || !saved) throw new Error(error?.message ?? "표준 상품을 저장하지 못했습니다.");
      const savedStandardId = saved.standard_product_id;
      let notice = "표준 상품, 판매 규격, 쿠팡 가격을 등록했습니다.";
      if (imageDraft.draft) {
        try { await new StandardProductImageRepository(client).save(savedStandardId, userId, imageDraft.draft); }
        catch (error) { notice = `표준 상품 연결은 저장했지만 대표 이미지 저장에 실패했습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`; }
      }
      setStandardProductId(savedStandardId);
      setMappingSaved(true);
      setMessage(notice);
      onSaved(notice);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "표준 상품을 연결하지 못했습니다.");
    } finally { setSaving(false); }
  }

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className={`${styles.authModal} ${styles.officialModal} ${styles.standardConnectionModal}`} role="dialog" aria-modal="true" aria-labelledby="standard-product-title">
      <button className={styles.closeButton} onClick={onClose} disabled={saving} aria-label="표준 상품 연결 닫기">×</button>
      <p className={styles.kicker}>STANDARD PRODUCT</p><h2 id="standard-product-title">표준 상품과 판매 규격 연결</h2><p className={styles.productCode}>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</p>
      <div className={styles.standardConnectionModalGrid}>
        <div className={styles.standardConnectionPane}>
          <h3>표준 상품·판매 규격 연결</h3>
          <form className={styles.manualForm} onSubmit={saveMapping}>
            <label>기존 표준 상품<select value={standardProductId} onChange={(event) => { setStandardProductId(event.target.value); setMappingSaved(false); setMessage(""); }}><option value="">새 표준 상품 만들기</option>{standards.map((standard) => <option key={standard.id} value={standard.id}>{standard.canonical_name}</option>)}</select></label>
            {selectedStandard ? <section className={styles.reusedProductInfo} aria-label="사용할 표준 상품 정보"><span>표준 상품 <b>{selectedStandard.canonical_name}</b></span><span>하위 상품명 <b>{reusedListingName}</b></span>{reusedProductUrl ? <a href={reusedProductUrl} target="_blank" rel="noreferrer">기존 상품 URL 확인</a> : <strong>기존 URL이 없어 연결할 수 없습니다.</strong>}</section> : <><label>새 표준 상품명<input required value={standardName} onChange={(event) => setStandardName(event.target.value)} placeholder="예: 햇반" /></label><label>판매 규격명<input required value={listingName} onChange={(event) => setListingName(event.target.value)} placeholder="예: 햇반 210g × 3" /></label><label>상품 확인 URL<input required type="url" placeholder="https://" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} /></label><ProductImageSourceFields sourceType={imageSourceType} onSourceTypeChange={setImageSourceType} file={imageFile} onFileChange={setImageFile} link={imageLink} onLinkChange={setImageLink} required /></>}
            <label className={styles.placeholderToggle}><input type="checkbox" checked={usesPlaceholderSpecification} onChange={(event) => setUsesPlaceholderSpecification(event.target.checked)} /><span><b>규격 확인 전 임시값 사용</b><small>임시 규격은 공개 단위가격 계산에서 제외됩니다.</small></span></label>
            {!usesPlaceholderSpecification && <><label>개당 내용량<input required inputMode="decimal" placeholder="예: 210" value={contentAmount} onChange={(event) => setContentAmount(event.target.value)} /></label><label>내용 단위<select value={contentUnit} onChange={(event) => setContentUnit(event.target.value as "g" | "ml" | "each")}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label><label>묶음 수<input required type="number" min="1" step="1" value={packageCount} onChange={(event) => setPackageCount(event.target.value)} /></label><label>단위 가격 기준<select value={referenceUnit} onChange={(event) => setReferenceUnit(Number(event.target.value) as ReferenceUnit)} disabled={contentUnit === "each"}><option value="10">{referenceLabel(contentUnit, 10)}</option><option value="100">{referenceLabel(contentUnit, 100)}</option><option value="1000">{referenceLabel(contentUnit, 1000)}</option></select></label></>}
            <button type="submit" disabled={saving || mappingSaved || Boolean(selectedStandard && !reusedProductUrl)}>{mappingSaved ? "등록 완료" : saving ? "등록 중..." : "표준 상품 등록"}</button>
          </form>
        </div>
        <CoupangPriceFields productUrl={coupangProductUrl} onProductUrlChange={setCoupangProductUrl} listedPriceKrw={coupangListedPriceKrw} onListedPriceKrwChange={setCoupangListedPriceKrw} quantity={coupangQuantity} onQuantityChange={setCoupangQuantity} contentAmount={coupangContentAmount} onContentAmountChange={setCoupangContentAmount} contentUnit={usesPlaceholderSpecification ? "each" : contentUnit} maxBundleQuantity={coupangMaxBundleQuantity} onMaxBundleQuantityChange={setCoupangMaxBundleQuantity} maxBundleListedPriceKrw={coupangMaxBundleListedPriceKrw} onMaxBundleListedPriceKrwChange={setCoupangMaxBundleListedPriceKrw} />
      </div>
      {message && <p className={styles.authMessage} role="status">{message}</p>}
    </section>
  </div>;
}

function CoupangPriceFields({ productUrl, onProductUrlChange, listedPriceKrw, onListedPriceKrwChange, quantity, onQuantityChange, contentAmount, onContentAmountChange, contentUnit, maxBundleQuantity, onMaxBundleQuantityChange, maxBundleListedPriceKrw, onMaxBundleListedPriceKrwChange }: {
  productUrl: string;
  onProductUrlChange: (value: string) => void;
  listedPriceKrw: string;
  onListedPriceKrwChange: (value: string) => void;
  quantity: string;
  onQuantityChange: (value: string) => void;
  contentAmount: string;
  onContentAmountChange: (value: string) => void;
  contentUnit: "g" | "ml" | "each";
  maxBundleQuantity: string;
  onMaxBundleQuantityChange: (value: string) => void;
  maxBundleListedPriceKrw: string;
  onMaxBundleListedPriceKrwChange: (value: string) => void;
}) {
  return <aside className={styles.coupangModalPane} aria-labelledby="coupang-price-title"><h3 id="coupang-price-title">쿠팡 가격</h3><p className={styles.muted}>왼쪽의 판매 규격과 함께 한 번에 등록됩니다.</p><h4 className={styles.coupangPriceSubheading}>필수 판매 가격 (필수)</h4><div className={styles.coupangModalForm}><label>쿠팡 링크<input type="url" placeholder="https://" value={productUrl} onChange={(event) => onProductUrlChange(event.target.value)} /></label><label>판매 가격<input inputMode="numeric" value={listedPriceKrw} onChange={(event) => onListedPriceKrwChange(event.target.value)} /></label><label>판매 개수<input type="number" min="1" step="1" value={quantity} onChange={(event) => onQuantityChange(event.target.value)} /></label><label>개당 내용량<input inputMode="decimal" placeholder="예: 210" value={contentAmount} onChange={(event) => onContentAmountChange(event.target.value)} /></label><label>내용 단위<input value={contentUnit === "each" ? "개" : contentUnit} readOnly /><small>왼쪽 단위 가격 기준을 따릅니다.</small></label><fieldset className={styles.coupangBundleFields}><legend>최대 묶음 가격 (선택)</legend><p>쿠팡에서 선택할 수 있는 가장 많은 묶음의 수량과 총가격을 함께 입력하세요. 같은 링크와 내용량에서 비워 두면 기존 묶음 가격을 유지합니다.</p><div><label>최대 묶음 개수<input type="number" min="2" step="1" placeholder="예: 20" value={maxBundleQuantity} onChange={(event) => onMaxBundleQuantityChange(event.target.value)} /></label><label>묶음 총가격<input inputMode="numeric" placeholder="예: 21250" value={maxBundleListedPriceKrw} onChange={(event) => onMaxBundleListedPriceKrwChange(event.target.value)} /></label></div></fieldset></div></aside>;
}

function StandardProductImageModal({ standard, existing, userId, onClose, onSaved }: {
  standard: StandardProduct;
  existing?: StandardProductImageRecord;
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const client = getSupabaseBrowserClient();
  const [sourceType, setSourceType] = useState<ProductImageSourceType>(existing?.source_type ?? "upload");
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState(existing?.source_type === "external_url" ? existing.image_url : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!client) { setMessage("Supabase 연결을 확인하세요."); return; }
    const resolved = resolveImageDraft(sourceType, file, link, true);
    if (resolved.error || !resolved.draft) { setMessage(resolved.error ?? "대표 이미지를 선택하세요."); return; }
    setSaving(true);
    setMessage("");
    try {
      await new StandardProductImageRepository(client).save(standard.id, userId, resolved.draft);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "대표 이미지를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}><section className={`${styles.authModal} ${styles.officialModal}`} role="dialog" aria-modal="true" aria-labelledby="standard-product-image-title"><button type="button" className={styles.closeButton} onClick={onClose} disabled={saving} aria-label="대표 이미지 등록 닫기">×</button><p className={styles.kicker}>PRODUCT IMAGE</p><h2 id="standard-product-image-title">{standard.canonical_name} 대표 이미지</h2>{existing && <div className={styles.currentImage}><div className={styles.officialThumb}><ProductImagePreview imageUrl={existing.image_url} productName={standard.canonical_name} /></div><p>현재 이미지 · {existing.source_type === "upload" ? "Supabase Storage" : "외부 링크"}</p></div>}<form className={styles.manualForm} onSubmit={save}><ProductImageSourceFields sourceType={sourceType} onSourceTypeChange={setSourceType} file={file} onFileChange={setFile} link={link} onLinkChange={setLink} required /><button type="submit" disabled={saving}>{saving ? "이미지 최적화 및 저장 중..." : existing ? "대표 이미지 변경" : "대표 이미지 저장"}</button></form>{message && <p className={styles.authMessage} role="status">{message}</p>}</section></div>;
}

function ProductImageSourceFields({ sourceType, onSourceTypeChange, file, onFileChange, link, onLinkChange, required }: {
  sourceType: ProductImageSourceType;
  onSourceTypeChange: (value: ProductImageSourceType) => void;
  file: File | null;
  onFileChange: (value: File | null) => void;
  link: string;
  onLinkChange: (value: string) => void;
  required: boolean;
}) {
  const filePreview = useFilePreview(file);
  const previewUrl = sourceType === "upload" ? filePreview : link.trim();
  return <fieldset className={styles.imageSourceFieldset}><legend>대표 이미지{required ? " (필수)" : " (선택)"}</legend><div className={styles.imageSourceModes} role="radiogroup" aria-label="대표 이미지 등록 방식"><label><input type="radio" name="product-image-source" checked={sourceType === "upload"} onChange={() => onSourceTypeChange("upload")} /> 이미지 업로드</label><label><input type="radio" name="product-image-source" checked={sourceType === "external_url"} onChange={() => onSourceTypeChange("external_url")} /> 이미지 링크</label></div>{sourceType === "upload" ? <label>이미지 파일<input type="file" accept="image/jpeg,image/png,image/webp" required={required} onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} /><small>JPG, PNG, WebP · 원본 8MB 이하 · 저장 전 768px WebP로 최적화합니다.</small></label> : <label>HTTPS 이미지 링크<input type="url" inputMode="url" placeholder="https://example.com/product.jpg" required={required} value={link} onChange={(event) => onLinkChange(event.target.value)} /><small>외부 서버가 이미지 표시를 차단하거나 링크를 변경하면 보이지 않을 수 있습니다.</small></label>}{previewUrl && <div className={styles.imageDraftPreview}><ProductImagePreview imageUrl={previewUrl} productName="선택한 대표 이미지" /></div>}</fieldset>;
}

function ProductImagePreview({ imageUrl, productName }: { imageUrl?: string; productName: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);
  return imageUrl && !failed
    ? <img src={imageUrl} alt={`${productName} 대표 이미지`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span className={styles.imageFallback}>이미지 없음</span>;
}

function useFilePreview(file: File | null) {
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    if (!file) { setPreviewUrl(""); return; }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return previewUrl;
}

function resolveImageDraft(sourceType: ProductImageSourceType, file: File | null, link: string, required: boolean): { draft: StandardProductImageDraft | null; error: string | null } {
  if (sourceType === "upload") {
    if (!file) return { draft: null, error: required ? "업로드할 대표 이미지를 선택하세요." : null };
    const error = validateProductImageFile(file);
    return error ? { draft: null, error } : { draft: { sourceType, file }, error: null };
  }
  if (!link.trim()) return { draft: null, error: required ? "대표 이미지 링크를 입력하세요." : null };
  const normalized = normalizeExternalProductImageUrl(link);
  return normalized
    ? { draft: { sourceType, url: normalized }, error: null }
    : { draft: null, error: "HTTPS 이미지 링크를 입력하세요." };
}

function referenceLabel(contentUnit: "g" | "ml" | "each", referenceUnit: ReferenceUnit) {
  if (contentUnit === "each") return "1개당";
  if (referenceUnit === 1000) return contentUnit === "g" ? "1kg당" : "1L당";
  return `${referenceUnit}${contentUnit}당`;
}
