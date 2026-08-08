"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { discoverOfficialProduct, officialProductCandidateKey, officialSearchUrl, resolveExactStandardProductMapping, resolveOfficialProductCandidates, type OfficialProductCandidate, type StandardProductMapping } from "@/domain/official-product";
import { isExcludedFromStandardProductConnectionQueue } from "@/domain/standard-product-connection-queue-exclusions";
import {
  buildPxStandardProductQueueEntries,
  groupPxStandardProductQueueEntries,
  isPxStandardProductCandidate,
  type PxStandardProductQueueEntry,
  type PxStandardProductQueueGroup,
  type StandardProductQueueReason,
} from "@/domain/standard-product-connection-queue";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import {
  STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY,
  StandardProductLinkProposalQueueRepository,
  type StandardProductLinkProposalQueueItem,
} from "@/repositories/standard-product-link-proposal-queue.repository";
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
  inferOfficialPackageCount,
  resolveCatalogSpecification,
  type CatalogContentUnit,
  type CatalogSpecificationStatus,
} from "@/domain/catalog-specification";
import { parseOptionalCoupangBundle, parseRequiredCoupangPrice } from "@/domain/coupang-price";
import { prepareBrandRegistration } from "@/domain/brand";
import {
  assertReviewedProposalMatchesExecutionTarget,
  buildLinkOnlyRegistrationIdentity,
  buildReviewedLinkProposalExecutionIdentity,
  buildStrictRegistrationIdentity,
  findExpectedCatalogProductId,
  findWhitespaceEquivalentStandardProduct,
  parseReviewedLinkProposalForLiveCandidate,
  parseReviewedLinkProposalEnvelope,
  rebuildReviewedLinkProposalForAdminTarget,
  receiptAndOfficialNamesMatch,
  type ReviewedLinkProposal,
} from "@/domain/standard-product-registration";
import {
  apparelSizes,
  type ApparelSizeLabel,
} from "@/domain/apparel-size";
import { availableProductCategories, categoryForProduct, type ProductCategory } from "@/domain/product-browser";
import type { PurchaseType } from "@/domain/types";
import { CatalogExplorerPanel, type CatalogExplorerSelectionRequest } from "./CatalogExplorerPanel";
import styles from "./page.module.css";

type Brand = { id: string; canonical_name: string };
type StandardProduct = { id: string; canonical_name: string; brand_id: string | null; brand: string | null; product_reference_url: string | null; purchase_type: PurchaseType };
type Variant = { id: string; standard_product_id: string; canonical_name: string; specification: string | null; attributes: Record<string, unknown>; specification_status: CatalogSpecificationStatus; content_amount: number | null; content_unit: CatalogContentUnit | null; package_count: number; reference_unit: number; listing_reference_url: string | null };
type PendingLinkProposal = {
  targetFingerprint: string;
  receiptSummary: string;
  officialSummary: string;
  targetSummary: string;
  coupangSummary: string;
  imageSummary: string;
  effectSummary: string;
  approvalStatement: string;
};
const legacyRepository = new OfficialProductRepository();
const proposalQueueRepository = new StandardProductLinkProposalQueueRepository();
const sellers = (candidate: OfficialProductCandidate) => candidate.storeLabels?.length ? candidate.storeLabels : [candidate.storeLabel];

const queueReasonLabels: Partial<Record<StandardProductQueueReason, string>> = {
  approval_pending: "승인 대기 중",
  same_code_mapping_available: "동일 PX 코드 연결 있음",
  same_code_mapping_ambiguous: "동일 코드 연결 충돌",
  source_name_conflict: "같은 코드·다른 원문",
  reviewed_display_name: "검토 표시명",
  low_confidence_source: "OCR 재확인",
  official_exact_candidate: "공식명 정확 일치",
  official_name_candidate: "공식명 후보",
  manual_research_required: "추가 조사 필요",
};

export type StandardProductApprovalRequest = {
  candidate: OfficialProductCandidate;
  proposal: ReviewedLinkProposal;
  onClose: () => void;
  onApproved: () => void;
  onAlreadyRegistered: () => void;
};

export function StandardProductWorkspace({ candidates, approvalRequest, onOpenApprovalQueue }: { candidates: OfficialProductCandidate[]; approvalRequest?: StandardProductApprovalRequest; onOpenApprovalQueue?: () => void }) {
  const client = getSupabaseBrowserClient();
  const loadGeneration = useRef(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
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
  const [catalogSelection, setCatalogSelection] = useState<CatalogExplorerSelectionRequest>();
  const [refreshing, setRefreshing] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [proposalQueueItems, setProposalQueueItems] = useState<StandardProductLinkProposalQueueItem[]>([]);

  const load = useCallback(async () => {
    if (!client) return;
    const requestGeneration = ++loadGeneration.current;
    setRefreshing(true);
    try {
      const [{ data: brandData, error: brandError }, { data: standardData, error: standardError }, { data: imageData, error: imageError }, { data: variantData, error: variantError }, { data: mappingData, error: mappingError }] = await Promise.all([
        client.from("brands").select("id,canonical_name").eq("status", "active").order("canonical_name"),
        client.from("standard_products").select("id,canonical_name,brand_id,brand,product_reference_url,purchase_type").eq("status", "active").order("canonical_name"),
        client.from("standard_product_images").select("standard_product_id,source_type,image_url,storage_path,mime_type,file_size_bytes,width,height"),
        client.from("catalog_products").select("id,standard_product_id,canonical_name,specification,attributes,specification_status,content_amount,content_unit,package_count,reference_unit,listing_reference_url").eq("status", "active"),
        client.from("source_product_mappings").select("source_label,source_product_code,catalog_product_id").eq("review_status", "verified"),
      ]);
      if (requestGeneration !== loadGeneration.current) return;
      if (brandError || standardError || imageError || variantError || mappingError) {
        setMessage(brandError?.message ?? standardError?.message ?? imageError?.message ?? variantError?.message ?? mappingError?.message ?? "표준 상품을 불러오지 못했습니다.");
        return;
      }
      const byId = new Map((variantData ?? []).map((variant) => [variant.id, variant as Variant]));
      setBrands((brandData ?? []) as Brand[]);
      setStandards((standardData ?? []) as StandardProduct[]);
      setStandardImages(new Map((imageData ?? []).map((image) => [image.standard_product_id, image as StandardProductImageRecord])));
      setVariants((variantData ?? []) as Variant[]);
      setVariantMappings((mappingData ?? []).flatMap((mapping) => {
        const variant = byId.get(mapping.catalog_product_id);
        return variant ? [{ sourceLabel: mapping.source_label, sourceProductCode: mapping.source_product_code, product: variant }] : [];
      }));
      setLegacy(legacyRepository.loadAll());
      setCatalogReady(true);
      setMessage("");
    } catch (reason) {
      if (requestGeneration === loadGeneration.current) {
        setMessage(reason instanceof Error ? reason.message : "표준 상품을 불러오지 못했습니다.");
      }
    } finally {
      if (requestGeneration === loadGeneration.current) setRefreshing(false);
    }
  }, [client]);

  useEffect(() => { if (client) void client.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, [client]);
  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);
  useEffect(() => {
    const refreshOnFocus = () => { void load(); };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);
  useEffect(() => {
    if (!client) return;
    const channel = client
      .channel("standard-product-workspace-mappings")
      .on("postgres_changes", { event: "*", schema: "public", table: "source_product_mappings" }, () => { void load(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, load]);
  useEffect(() => {
    const refreshProposalQueue = () => setProposalQueueItems(proposalQueueRepository.load());
    const refreshOnStorage = (event: StorageEvent) => {
      if (event.key === STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY) {
        refreshProposalQueue();
      }
    };
    refreshProposalQueue();
    window.addEventListener("focus", refreshProposalQueue);
    window.addEventListener("storage", refreshOnStorage);
    return () => {
      window.removeEventListener("focus", refreshProposalQueue);
      window.removeEventListener("storage", refreshOnStorage);
    };
  }, []);

  const standardById = useMemo(() => new Map(standards.map((standard) => [standard.id, standard])), [standards]);
  const pxCandidates = useMemo(
    () => candidates.filter(isPxStandardProductCandidate),
    [candidates],
  );
  const resolvedCandidates = useMemo(() => resolveOfficialProductCandidates(pxCandidates, variantMappings), [pxCandidates, variantMappings]);
  const states = useMemo(() => resolvedCandidates.map(({ candidate, product: variant }) => {
    const browserRecord = legacy[officialProductCandidateKey(candidate)];
    const discovered = discoverOfficialProduct(candidate);
    return { candidate, variant, standard: variant ? standardById.get(variant.standard_product_id) : undefined, legacy: browserRecord ?? (discovered.status === "matched" ? discovered.record : undefined), fromBrowserStorage: Boolean(browserRecord) };
  }), [resolvedCandidates, standardById, legacy]);
  const linked = states.filter((state) => state.variant && state.standard);
  const excluded = states.filter((state) => (
    !state.variant && isExcludedFromStandardProductConnectionQueue(state.candidate)
  ));
  const unlinked = states.filter((state) => !state.variant && !isExcludedFromStandardProductConnectionQueue(state.candidate));
  const pendingReceipts = useMemo(
    () => proposalQueueItems.map((item) => item.proposal.receipt),
    [proposalQueueItems],
  );
  const queueEntries = useMemo(() => buildPxStandardProductQueueEntries(
    unlinked.map((state) => state.candidate),
    variantMappings,
    pendingReceipts,
    pxCandidates,
  ), [pendingReceipts, pxCandidates, unlinked, variantMappings]);
  const stateByCandidateKey = useMemo(() => new Map(states.map((state) => [
    officialProductCandidateKey(state.candidate),
    state,
  ])), [states]);
  const matchesSearch = useCallback((entry: PxStandardProductQueueEntry<Variant>) => {
    const query = searchQuery.trim().toLocaleLowerCase("ko-KR");
    if (!query) return true;
    const candidate = entry.candidate;
    const mappedTargets = entry.sameCodeMappedProducts.map((variant) => {
      const standard = standardById.get(variant.standard_product_id);
      return `${standard?.brand ?? ""} ${standard?.canonical_name ?? ""} ${variant.canonical_name}`;
    }).join(" ");
    return `${candidate.reviewedProductName ?? ""} ${candidate.officialSourceNameRaw ?? ""} ${candidate.productName} ${candidate.sourceProductCode} ${sellers(candidate).join(" ")} ${mappedTargets}`.toLocaleLowerCase("ko-KR").includes(query);
  }, [searchQuery, standardById]);
  const visibleQueueEntries = queueEntries.filter(matchesSearch);
  const pendingQueueEntries = visibleQueueEntries.filter((entry) => entry.pendingApproval);
  const actionableQueueEntries = visibleQueueEntries.filter((entry) => !entry.pendingApproval);
  const mappingReviewEntries = actionableQueueEntries.filter((entry) => entry.reasons.some((reason) => (
    reason === "same_code_mapping_available" || reason === "same_code_mapping_ambiguous"
  )));
  const officialReviewEntries = actionableQueueEntries.filter((entry) => (
    !mappingReviewEntries.includes(entry) && Boolean(entry.candidate.officialSourceProductCode)
  ));
  const researchEntries = actionableQueueEntries.filter((entry) => (
    !mappingReviewEntries.includes(entry) && !officialReviewEntries.includes(entry)
  ));
  const pendingQueueGroups = groupPxStandardProductQueueEntries(pendingQueueEntries);
  const mappingReviewGroups = groupPxStandardProductQueueEntries(mappingReviewEntries);
  const officialReviewGroups = groupPxStandardProductQueueEntries(officialReviewEntries);
  const researchGroups = groupPxStandardProductQueueEntries(researchEntries);
  const actionableGroupCount = groupPxStandardProductQueueEntries(
    queueEntries.filter((entry) => !entry.pendingApproval),
  ).length;
  const variantsByStandard = useMemo(() => {
    const grouped = new Map<string, Variant[]>();
    for (const variant of variants) grouped.set(variant.standard_product_id, [...(grouped.get(variant.standard_product_id) ?? []), variant]);
    return grouped;
  }, [variants]);
  const visibleStandards = useMemo(() => standards
    .filter((standard) => {
      const query = searchQuery.trim().toLocaleLowerCase("ko-KR");
      const variantText = (variantsByStandard.get(standard.id) ?? []).map((variant) => `${variant.canonical_name} ${variant.content_amount ?? ""}${variant.content_unit ?? ""}`).join(" ");
      return !query || `${standard.brand ?? ""} ${standard.canonical_name} ${variantText}`.toLocaleLowerCase("ko-KR").includes(query);
    }), [standards, variantsByStandard, searchQuery]);
  const standardCategories = useMemo(() => availableProductCategories(visibleStandards.map((standard) => standard.canonical_name)), [visibleStandards]);
  const standardsForSelectedCategory = useMemo(() => selectedStandardCategory === "전체" ? visibleStandards : selectedStandardCategory ? visibleStandards.filter((standard) => categoryForProduct(standard.canonical_name) === selectedStandardCategory) : [], [selectedStandardCategory, visibleStandards]);
  const selectedState = selected ? states.find((state) => officialProductCandidateKey(state.candidate) === officialProductCandidateKey(selected)) : undefined;
  const openStandardInCatalog = (standard: StandardProduct) => {
    setCatalogSelection((current) => ({
      standardProductId: standard.id,
      purchaseType: standard.purchase_type,
      requestId: (current?.requestId ?? 0) + 1,
    }));
    setLowerTab("specification");
  };
  const renderQueueGroups = (
    title: string,
    description: string,
    groups: PxStandardProductQueueGroup<Variant>[],
  ) => {
    if (groups.length === 0) return null;
    return <section className={styles.pxQueueBucket} aria-label={title}>
      <div className={styles.pxQueueBucketHead}>
        <h3>{title} <span>{groups.length}건</span></h3>
        <p>{description}</p>
      </div>
      <div className={styles.manualQueue}>{groups.map((group) => {
        const displayNames = new Set(group.entries.map(({ candidate }) => (
          candidate.reviewedProductName
            ?? candidate.officialSourceNameRaw
            ?? candidate.productName
        )));
        const groupName = displayNames.size === 1
          ? [...displayNames][0]
          : "같은 PX 코드의 이름 표현 충돌";
        return <article className={styles.pxQueueGroup} key={group.key}>
          <header className={styles.pxQueueGroupHead}>
            <div>
              <strong>{groupName}</strong>
              <small>PX 공용 코드 {group.sourceProductCode || "없음"} · 검토할 원본 표현 {group.entries.length}개</small>
            </div>
          </header>
          <div className={styles.pxQueueSourceList}>{group.entries.map((entry) => {
            const candidate = entry.candidate;
            const state = stateByCandidateKey.get(officialProductCandidateKey(candidate));
            const legacyRecord = state?.legacy;
            const displayName = candidate.reviewedProductName
              ?? candidate.officialSourceNameRaw
              ?? legacyRecord?.officialName
              ?? candidate.productName;
            const mappedVariant = entry.sameCodeMappedProducts.length === 1
              ? entry.sameCodeMappedProducts[0]
              : undefined;
            const mappedStandard = mappedVariant
              ? standardById.get(mappedVariant.standard_product_id)
              : undefined;
            const actionLabel = entry.pendingApproval
              ? "승인 대기열 보기"
              : entry.sameCodeMappedProducts.length > 0
                ? "기존 연결 검토"
                : candidate.officialSourceProductCode
                  ? "공식 후보 검토"
                  : "상품 조사 시작";
            return <div className={styles.pxQueueSourceRow} key={officialProductCandidateKey(candidate)}>
              <div className={styles.pxQueueSourceInfo}>
                <strong>{displayName}</strong>
                {displayName !== candidate.productName && <small>영수증 원문: {candidate.productName}</small>}
                <small>판매처 {sellers(candidate).join(", ")} · 영수증 코드 {candidate.sourceProductCode}</small>
                {mappedVariant && <small className={styles.pxQueueMappedTarget}>기존 연결 후보: {mappedStandard?.brand ? `${mappedStandard.brand} · ` : ""}{mappedStandard?.canonical_name ?? "표준 상품"} / {mappedVariant.canonical_name}</small>}
                {entry.sameCodeMappedProducts.length > 1 && <small className={styles.pxQueueWarning}>같은 코드가 여러 판매 규격에 연결되어 자동 재사용할 수 없습니다.</small>}
                <div className={styles.pxQueueBadges}>{entry.reasons.map((reason) => <span key={reason}>{queueReasonLabels[reason]}</span>)}</div>
                {candidate.reviewedProductName && <small className={styles.pxQueueProvenance}>검토 표시명은 탐색용이며 영수증 원문이나 상품 연결 근거를 덮어쓰지 않습니다.</small>}
              </div>
              <div className={styles.queueActions}>
                <a href={legacyRecord?.officialUrl ?? officialSearchUrl(candidate)} target="_blank" rel="noreferrer">상품 정보 찾기</a>
                <button type="button" onClick={() => entry.pendingApproval ? onOpenApprovalQueue?.() : setSelected(candidate)} disabled={entry.pendingApproval && !onOpenApprovalQueue}>{actionLabel}</button>
              </div>
            </div>;
          })}</div>
        </article>;
      })}</div>
    </section>;
  };

  if (!client || !userId) return null;
  if (approvalRequest) {
    if (!catalogReady) {
      return <section className={styles.approvalDialogLoading} role="status">
        {message || "표준 상품 정보를 불러오는 중입니다."}
      </section>;
    }
    const exactVariant = resolveExactStandardProductMapping(
      approvalRequest.candidate,
      variantMappings,
    );
    const exactStandard = exactVariant
      ? standardById.get(exactVariant.standard_product_id)
      : undefined;
    if (exactVariant && exactStandard) {
      return <div className={styles.modalBackdrop} role="presentation">
        <section className={`${styles.authModal} ${styles.officialModal} ${styles.alreadyRegisteredApproval}`} role="dialog" aria-modal="true" aria-labelledby="already-registered-title">
          <button className={styles.closeButton} onClick={approvalRequest.onClose} aria-label="이미 등록된 제안 닫기">×</button>
          <p className={styles.kicker}>STANDARD PRODUCT</p>
          <h2 id="already-registered-title">이미 등록된 영수증 판매 기록</h2>
          <p>판매처와 상품 코드가 모두 일치하는 검증된 매핑이 있습니다. 이 제안으로 다시 등록하지 않습니다.</p>
          <dl>
            <div><dt>영수증 식별자</dt><dd>{approvalRequest.candidate.storeLabel} · {approvalRequest.candidate.sourceProductCode}</dd></div>
            <div><dt>표준 상품</dt><dd>{exactStandard.brand ? `${exactStandard.brand} · ` : ""}{exactStandard.canonical_name}</dd></div>
            <div><dt>판매 규격</dt><dd>{exactVariant.canonical_name}</dd></div>
          </dl>
          <div className={styles.alreadyRegisteredActions}>
            <button type="button" className={styles.secondaryButton} onClick={approvalRequest.onClose}>닫기</button>
            <button type="button" onClick={approvalRequest.onAlreadyRegistered}>등록 완료 제안 정리</button>
          </div>
        </section>
      </div>;
    }
    return <StandardProductConnectionModal
      candidate={approvalRequest.candidate}
      legacy={states.find((state) => (
        officialProductCandidateKey(state.candidate)
        === officialProductCandidateKey(approvalRequest.candidate)
      ))?.legacy}
      brands={brands}
      standards={standards}
      variants={variants}
      standardImages={standardImages}
      approvalProposal={approvalRequest.proposal}
      onClose={approvalRequest.onClose}
      onApproved={approvalRequest.onApproved}
      onSaved={() => {}}
    />;
  }
  if (!catalogReady) {
    return <section className={styles.browser} aria-busy={refreshing}>
      <div className={styles.browserHead}><div><p className={styles.kicker}>STANDARD PRODUCT MAPPING</p><h1>표준 상품 연결</h1><p>표준 상품은 햇반 같은 상품군입니다. 영수증 품목은 실제 판매 규격(예: 210g × 3)으로 등록해 표준 상품 아래에 보관합니다.</p></div></div>
      {message && <p className={styles.error} role="alert">{message}</p>}
      <div className={styles.mappingToolbar}><button type="button" className={styles.secondaryButton} disabled={refreshing} onClick={() => void load()}>{refreshing ? "표준 상품 정보 불러오는 중" : "다시 불러오기"}</button></div>
      <p className={styles.emptyState} role="status">{refreshing ? "등록된 규격과 PX 판매처 연결을 확인하고 있습니다." : "표준 상품 정보를 불러오지 못했습니다. 다시 불러오기를 눌러 주세요."}</p>
    </section>;
  }
  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>STANDARD PRODUCT MAPPING</p><h1>표준 상품 연결</h1><p>표준 상품은 햇반 같은 상품군입니다. 영수증 품목은 실제 판매 규격(예: 210g × 3)으로 등록해 표준 상품 아래에 보관합니다.</p></div></div>
    {message && <p className={styles.error} role="alert">{message}</p>}
    <div className={styles.mappingToolbar}><label className={styles.mappingSearch}><span className={styles.srOnly}>표준 상품 연결 검색</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="상품명, 브랜드, 판매처, 상품 코드로 검색" /></label><button type="button" className={styles.secondaryButton} disabled={refreshing} onClick={() => void load()}>{refreshing ? "새로고침 중" : "새로고침"}</button></div>
    <div className={styles.officialSummary}><span><b>{variants.length}</b>개 판매 규격 등록</span><span><b>{variants.filter((variant) => variant.specification_status === "placeholder").length}</b>개 규격 확인 필요</span><span><b>{linked.length}</b>개 PX 기록 연결됨</span><span><b>{excluded.length}</b>개 검증 중복 제외</span><span><b>{queueEntries.filter((entry) => entry.pendingApproval).length}</b>개 승인 대기</span><span><b>{actionableGroupCount}</b>개 PX 연결 작업</span></div>
    <section className={styles.officialSection}><h2>등록된 표준 상품</h2><p className={styles.manualHint}>대표 이미지는 파일 업로드 또는 HTTPS 이미지 링크로 등록할 수 있습니다. 파일은 최적화 후 Supabase Storage에 저장됩니다.</p>{visibleStandards.length ? <><div className={styles.standardCategoryButtons} aria-label="표준 상품 카테고리"><button type="button" aria-pressed={selectedStandardCategory === "전체"} className={selectedStandardCategory === "전체" ? styles.selectedCatalogProduct : ""} onClick={() => setSelectedStandardCategory("전체")}>전체</button>{standardCategories.map((category) => <button type="button" key={category} aria-pressed={selectedStandardCategory === category} className={selectedStandardCategory === category ? styles.selectedCatalogProduct : ""} onClick={() => setSelectedStandardCategory(category)}>{category}</button>)}<button type="button" onClick={() => setSelectedStandardCategory(null)}>선택 해제</button></div>{selectedStandardCategory ? <div className={styles.officialGrid}>{standardsForSelectedCategory.map((standard) => {
      const image = standardImages.get(standard.id);
      const registeredVariants = variantsByStandard.get(standard.id) ?? [];
      const pendingCount = registeredVariants.filter((variant) => variant.specification_status === "placeholder").length;
      return <article className={styles.registeredStandardCard} key={standard.id}><button type="button" className={styles.registeredStandardProduct} aria-label={`${standard.canonical_name} 규격·판매처 코드 관리`} onClick={() => openStandardInCatalog(standard)}><span className={styles.officialThumb}><ProductImagePreview imageUrl={image?.image_url} productName={standard.canonical_name} /></span><span className={styles.registeredStandardInfo}><span>표준 상품</span><strong>{standard.canonical_name}</strong><small>브랜드 {standard.brand ?? "미지정"}</small><small>판매 규격 {registeredVariants.length}개 · {image ? image.source_type === "upload" ? "Supabase 저장 이미지" : "외부 이미지 링크" : "대표 이미지 없음"}</small>{pendingCount > 0 && <span className={styles.specificationBadge}>규격 확인 필요 {pendingCount}개</span>}<span className={styles.registeredStandardHint}>규격·판매처 코드 관리 →</span></span></button><button type="button" className={styles.registeredStandardImageButton} onClick={() => setImageTarget(standard)}>{image ? "대표 이미지 변경" : "대표 이미지 추가"}</button></article>;
    })}</div> : <p className={styles.muted}>카테고리를 선택하면 해당 표준 상품만 표시됩니다.</p>}</> : <p>검색 조건에 맞는 표준 상품이 없습니다.</p>}</section>
    <div className={styles.standardWorkspaceTabs} role="tablist" aria-label="표준 상품 관리 영역"><button type="button" role="tab" aria-selected={lowerTab === "connection"} className={lowerTab === "connection" ? styles.standardWorkspaceTabActive : ""} onClick={() => { setLowerTab("connection"); void load(); }}>연결 대기 상품</button><button type="button" role="tab" aria-selected={lowerTab === "specification"} className={lowerTab === "specification" ? styles.standardWorkspaceTabActive : ""} onClick={() => setLowerTab("specification")}>규격·판매처 코드 관리</button></div>
    {lowerTab === "connection" ? <section className={styles.officialSection}><h2>PX 표준 상품 연결 대기열</h2><p className={styles.manualHint}>PX 공용 코드별로 묶되 영수증 원문은 각각 보존합니다. 공식명 후보와 검토 표시명은 조사 우선순위일 뿐 자동 연결 근거가 아니며, 승인 대기 항목은 이 탭의 연결 작업 수에서 제외됩니다.</p>{visibleQueueEntries.length === 0 ? <p className={styles.emptyState}>검색 조건에 맞는 PX 연결 작업이 없습니다.</p> : <div className={styles.pxQueueBuckets}>{renderQueueGroups("승인 대기", "검증된 제안서가 현재 브라우저의 연결 승인 탭에 있어 중복 조사하지 않습니다.", pendingQueueGroups)}{renderQueueGroups("기존 연결 재사용 검토", "같은 PX 영수증 코드에 검증된 판매 규격 연결이 있습니다. 이름·규격 충돌을 확인한 뒤 해당 판매처 연결만 별도로 승인합니다.", mappingReviewGroups)}{renderQueueGroups("공식 PX 후보 확인", "공식 카탈로그에서 정확 일치 또는 오타·축약 후보를 찾았습니다. 공식 규격과 브랜드 근거를 확인해야 합니다.", officialReviewGroups)}{renderQueueGroups("추가 조사 필요", "공식 후보가 아직 하나로 좁혀지지 않아 상품별 증거 조사가 필요합니다.", researchGroups)}</div>}</section> : <CatalogExplorerPanel selectionRequest={catalogSelection} />}
    {selected && <StandardProductConnectionModal candidate={selected} legacy={selectedState?.legacy} brands={brands} standards={standards} variants={variants} standardImages={standardImages} onClose={() => setSelected(null)} onSaved={(notice) => { void load().then(() => notice && setMessage(notice)); }} />}
    {imageTarget && <StandardProductImageModal standard={imageTarget} existing={standardImages.get(imageTarget.id)} userId={userId} onClose={() => setImageTarget(null)} onSaved={() => { setImageTarget(null); void load(); }} />}
  </section>;
}

function StandardProductConnectionModal({ candidate, legacy, brands, standards, variants, standardImages, approvalProposal, onClose, onSaved, onApproved }: { candidate: OfficialProductCandidate; legacy?: { officialName: string; officialUrl: string; imageUrl?: string }; brands: Brand[]; standards: StandardProduct[]; variants: Variant[]; standardImages: Map<string, StandardProductImageRecord>; approvalProposal?: ReviewedLinkProposal; onClose: () => void; onSaved: (notice?: string) => void; onApproved?: () => void }) {
  const client = getSupabaseBrowserClient();
  const approvalTarget = approvalProposal?.executionTarget;
  const isLinkOnlyApproval = approvalTarget?.executionMode === "link_only_v1";
  const approvalApparelSize = approvalTarget?.normalizedIdentity.apparelSize ?? null;
  const initialListingName = candidate.officialSourceNameRaw ?? legacy?.officialName ?? candidate.productName;
  const [standardProductId, setStandardProductId] = useState(approvalTarget?.decision.standardProductId ?? "");
  const [standardName, setStandardName] = useState(approvalTarget?.normalizedIdentity.productFamilyName ?? initialListingName);
  const [brandName, setBrandName] = useState(approvalTarget?.brandEvidence.canonicalName ?? "");
  const [receiptBrandName, setReceiptBrandName] = useState(approvalTarget?.brandEvidence.receiptObservedName ?? "");
  const [officialBrandName, setOfficialBrandName] = useState(approvalTarget?.brandEvidence.officialObservedName ?? "");
  const [listingName, setListingName] = useState(approvalTarget?.normalizedIdentity.variantName ?? candidate.productName);
  const [productUrl, setProductUrl] = useState(approvalTarget?.brandEvidence.productReferenceUrl ?? legacy?.officialUrl ?? "");
  const [contentAmount, setContentAmount] = useState(approvalTarget?.normalizedIdentity.contentAmount.toString() ?? "");
  const [contentUnit, setContentUnit] = useState<"g" | "ml" | "each">(approvalTarget?.normalizedIdentity.contentUnit ?? "g");
  const [packageCount, setPackageCount] = useState(() => approvalTarget?.normalizedIdentity.packageCount.toString() ?? inferOfficialPackageCount(initialListingName).toString());
  const [referenceUnit, setReferenceUnit] = useState<ReferenceUnit>(approvalTarget?.normalizedIdentity.referenceUnit ?? 100);
  const [usesPlaceholderSpecification, setUsesPlaceholderSpecification] = useState(false);
  const [apparelSizeLabel, setApparelSizeLabel] = useState<ApparelSizeLabel>(
    approvalApparelSize?.label ?? "S(90)",
  );
  const [coupangProductUrl, setCoupangProductUrl] = useState(approvalTarget?.coupangOffer?.productUrl ?? "");
  const [coupangListedPriceKrw, setCoupangListedPriceKrw] = useState(approvalTarget?.coupangOffer?.listedPriceKrw.toString() ?? "");
  const [coupangQuantity, setCoupangQuantity] = useState(approvalTarget?.coupangOffer?.quantity.toString() ?? "1");
  const [coupangContentAmount, setCoupangContentAmount] = useState(approvalTarget?.coupangOffer?.contentAmount.toString() ?? "");
  const [coupangMaxBundleQuantity, setCoupangMaxBundleQuantity] = useState(approvalTarget?.coupangOffer?.maxBundleQuantity?.toString() ?? "");
  const [coupangMaxBundleListedPriceKrw, setCoupangMaxBundleListedPriceKrw] = useState(approvalTarget?.coupangOffer?.maxBundleListedPriceKrw?.toString() ?? "");
  const [reviewedProposalJson, setReviewedProposalJson] = useState(() => approvalProposal ? JSON.stringify(approvalProposal) : "");
  const [mappingSaved, setMappingSaved] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<PendingLinkProposal | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedStandard = standards.find((standard) => standard.id === standardProductId);
  const whitespaceEquivalentStandard = standardProductId
    ? undefined
    : findWhitespaceEquivalentStandardProduct(standards, standardName);
  const reusedListingName = candidate.officialSourceNameRaw ?? legacy?.officialName ?? candidate.productName;
  const reusedProductUrl = legacy?.officialUrl ?? selectedStandard?.product_reference_url ?? approvalTarget?.brandEvidence.productReferenceUrl ?? "";
  const approvalFormEdited = Boolean(approvalTarget && (
    standardProductId !== (approvalTarget.decision.standardProductId ?? "")
    || (!standardProductId && standardName.trim() !== approvalTarget.normalizedIdentity.productFamilyName)
    || brandName.trim() !== approvalTarget.brandEvidence.canonicalName
    || (receiptBrandName.trim() || null) !== approvalTarget.brandEvidence.receiptObservedName
    || officialBrandName.trim() !== approvalTarget.brandEvidence.officialObservedName
    || listingName.trim() !== approvalTarget.normalizedIdentity.variantName
    || (!standardProductId && productUrl.trim() !== approvalTarget.brandEvidence.productReferenceUrl)
    || contentAmount.trim() !== approvalTarget.normalizedIdentity.contentAmount.toString()
    || contentUnit !== approvalTarget.normalizedIdentity.contentUnit
    || packageCount.trim() !== approvalTarget.normalizedIdentity.packageCount.toString()
    || referenceUnit !== approvalTarget.normalizedIdentity.referenceUnit
    || apparelSizeLabel !== (approvalTarget.normalizedIdentity.apparelSize?.label ?? apparelSizeLabel)
    || (!isLinkOnlyApproval && (
      coupangProductUrl.trim() !== approvalTarget.coupangOffer?.productUrl
      || coupangListedPriceKrw.trim() !== approvalTarget.coupangOffer?.listedPriceKrw.toString()
      || coupangQuantity.trim() !== approvalTarget.coupangOffer?.quantity.toString()
      || coupangContentAmount.trim() !== approvalTarget.coupangOffer?.contentAmount.toString()
      || coupangMaxBundleQuantity.trim() !== (approvalTarget.coupangOffer?.maxBundleQuantity?.toString() ?? "")
      || coupangMaxBundleListedPriceKrw.trim() !== (approvalTarget.coupangOffer?.maxBundleListedPriceKrw?.toString() ?? "")
    ))
  ));

  async function saveMapping(event: React.FormEvent) {
    event.preventDefault();
    if (mappingSaved) return;
    if (
      !candidate.receiptId
      || !candidate.receiptItemId
      || !candidate.receiptRevision
      || !candidate.receiptObservedAt
      || candidate.receiptUnitPriceKrw === undefined
      || candidate.receiptQuantity === undefined
      || candidate.receiptTotalPriceKrw === undefined
      || !candidate.catalogNamespace
      || !candidate.officialChannelId
      || !candidate.officialSourceProductCodeNamespace
      || !candidate.officialSourceProductCode
      || !candidate.officialSnapshotId
      || !candidate.officialSnapshotHash
      || !candidate.officialSourceNameRaw
      || !candidate.officialSpecificationTextRaw
      || !candidate.officialSourceRefs?.length
      || !candidate.officialImageUrl
      || !candidate.officialImageContentHash
      || !candidate.officialImageMediaType
      || !candidate.officialImageByteLength
    ) {
      setMessage("영수증 revision 또는 공식 카탈로그 스냅샷이 없어 연결할 수 없습니다.");
      return;
    }
    let reviewedProposalEnvelope;
    try {
      reviewedProposalEnvelope = parseReviewedLinkProposalEnvelope(reviewedProposalJson);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "검토된 LinkProposal을 확인하세요.");
      return;
    }
    const caseId = reviewedProposalEnvelope.caseId;
    const executionMode = reviewedProposalEnvelope.executionTarget.executionMode ?? "strict_v6";
    const isLinkOnly = executionMode === "link_only_v1";
    const isApparelLink = Boolean(
      reviewedProposalEnvelope.executionTarget.normalizedIdentity.apparelSize,
    );
    const selectedApparelSize = isApparelLink
      ? apparelSizes.find((size) => size.label === apparelSizeLabel) ?? null
      : null;
    const requiresOfficialPrice = Boolean(reviewedProposalEnvelope.officialListing.officialPrice);
    if (
      requiresOfficialPrice
      && (
        candidate.officialPriceAmountKrw === undefined
        || !candidate.officialPriceSourceText
        || !candidate.officialPriceObservedAt
      )
    ) {
      setMessage("검토된 포함 관계를 다시 확인할 공식 판매가가 없습니다.");
      return;
    }
    const resolvedListingName = approvalProposal
      ? listingName.trim()
      : reviewedProposalEnvelope.decision.proposedVariantName ?? reusedListingName;
    const resolvedProductUrl = selectedStandard ? reusedProductUrl : productUrl.trim();
    if (!client || !resolvedListingName || !/^https?:\/\//.test(resolvedProductUrl)) { setMessage("상품명과 확인 URL을 확인하세요."); return; }
    if (
      !receiptAndOfficialNamesMatch(candidate.productName, candidate.officialSourceNameRaw)
      && reviewedProposalEnvelope.sameChannelNameRule.outcome
        !== "apply_verified_name_equivalence"
    ) {
      setMessage("영수증명과 공식 상품명이 다르며 검증된 이름 동등성 근거가 없습니다.");
      return;
    }
    const brandRegistration = prepareBrandRegistration({
      canonicalName: brandName,
      receiptObservedName: receiptBrandName,
      officialObservedName: officialBrandName,
      officialSourceUrl: resolvedProductUrl,
    });
    if (!brandRegistration.value) { setMessage(brandRegistration.error); return; }
    if (!brandRegistration.value.canonicalName || !brandRegistration.value.officialObservedName) {
      setMessage("공식 브랜드 원문과 적용할 표준 브랜드를 모두 입력하세요.");
      return;
    }
    const specificationStatus: CatalogSpecificationStatus = usesPlaceholderSpecification ? "placeholder" : "verified";
    const parsedContentAmount = Number(contentAmount);
    const parsedPackageCount = Number(packageCount);
    const parsedCoupangContentAmount = Number(coupangContentAmount);
    if (!usesPlaceholderSpecification && (!Number.isFinite(parsedContentAmount) || parsedContentAmount <= 0 || !Number.isInteger(parsedPackageCount) || parsedPackageCount <= 0)) { setMessage("내용량과 묶음 수를 올바르게 입력하세요."); return; }
    if (isApparelLink && !selectedApparelSize) { setMessage("지원하는 의류 사이즈를 선택하세요."); return; }
    if (!isLinkOnly && (!/^https?:\/\//.test(coupangProductUrl.trim()) || !Number.isFinite(parsedCoupangContentAmount) || parsedCoupangContentAmount <= 0)) { setMessage("쿠팡 링크와 개당 내용량을 올바르게 입력하세요."); return; }
    const parsedCoupangRequiredPrice = isLinkOnly
      ? null
      : parseRequiredCoupangPrice(coupangListedPriceKrw, coupangQuantity);
    if (!isLinkOnly && !parsedCoupangRequiredPrice?.value) { setMessage(parsedCoupangRequiredPrice?.error ?? "쿠팡 가격을 확인하세요."); return; }
    const parsedCoupangBundle = isLinkOnly
      ? null
      : parseOptionalCoupangBundle(coupangMaxBundleQuantity, coupangMaxBundleListedPriceKrw);
    if (!isLinkOnly && !parsedCoupangBundle?.value) { setMessage(parsedCoupangBundle?.error ?? "쿠팡 묶음 가격을 확인하세요."); return; }
      const specification = resolveCatalogSpecification(specificationStatus, { contentAmount: parsedContentAmount, contentUnit, packageCount: parsedPackageCount, referenceUnit });
      const reviewedTargetIdentity = reviewedProposalEnvelope.executionTarget.normalizedIdentity;
      const expectedAttributes = reviewedTargetIdentity.apparelSize
        ? { apparelSize: reviewedTargetIdentity.apparelSize }
        : reviewedTargetIdentity.kitComponents
          ? { kitComponents: reviewedTargetIdentity.kitComponents }
          : reviewedTargetIdentity.wiperBladeFitment
            ? { wiperBladeFitment: reviewedTargetIdentity.wiperBladeFitment }
            : {};
      const expectedSpecification = selectedApparelSize
        ? `${selectedApparelSize.kr}호`
        : candidate.officialSpecificationTextRaw;
      setSaving(true); setMessage("");
    try {
      if (!standardProductId && !standardName.trim()) throw new Error("새 표준 상품명을 입력하세요.");
      if (standardProductId && !selectedStandard) throw new Error("제안된 기존 표준 상품을 현재 카탈로그에서 찾을 수 없습니다.");
      const resolvedStandardName = selectedStandard?.canonical_name ?? standardName.trim();
      const existingRepresentativeImage = selectedStandard
        ? standardImages.get(selectedStandard.id)
        : undefined;
      if (
        existingRepresentativeImage
        && (
          existingRepresentativeImage.source_type !== "external_url"
          || existingRepresentativeImage.image_url !== candidate.officialImageUrl
        )
      ) {
        throw new Error("기존 대표 이미지가 공식 이미지와 달라 자동으로 덮어쓸 수 없습니다.");
      }
      const expectedCatalogProductId = selectedStandard
        ? findExpectedCatalogProductId(
            variants.flatMap((variant) => (
              variant.content_amount !== null && variant.content_unit !== null
                ? [{
                    id: variant.id,
                    standardProductId: variant.standard_product_id,
                    canonicalName: variant.canonical_name,
                    specification: variant.specification ?? "",
                    attributes: variant.attributes,
                    specificationStatus: variant.specification_status,
                    contentAmount: variant.content_amount,
                    contentUnit: variant.content_unit,
                    packageCount: variant.package_count,
                    referenceUnit: variant.reference_unit,
                  }]
                : []
            )),
            {
              standardProductId: selectedStandard.id,
              canonicalName: resolvedListingName,
              specification: expectedSpecification,
              attributes: expectedAttributes,
              specificationStatus,
              contentAmount: specification.contentAmount,
              contentUnit: specification.contentUnit,
              packageCount: specification.packageCount,
              referenceUnit: specification.referenceUnit,
            },
          )
        : null;
      const currentReceiptInput = {
        receiptId: candidate.receiptId,
        receiptItemId: candidate.receiptItemId,
        receiptRevision: candidate.receiptRevision,
        sourceCatalogNamespace: candidate.catalogNamespace,
        sourceLabel: candidate.storeLabel,
        sourceProductCode: candidate.sourceProductCode,
        sourceNameRaw: candidate.productName,
        observedAt: candidate.receiptObservedAt,
        unitPriceKrw: candidate.receiptUnitPriceKrw,
        quantity: candidate.receiptQuantity,
      };
      const currentOfficialListingInput = {
        channelId: candidate.officialChannelId,
        sourceProductCodeNamespace: candidate.officialSourceProductCodeNamespace,
        sourceProductCode: candidate.officialSourceProductCode,
        snapshotId: candidate.officialSnapshotId,
        snapshotHash: candidate.officialSnapshotHash,
        sourceNameRaw: candidate.officialSourceNameRaw,
        specificationTextRaw: candidate.officialSpecificationTextRaw,
        ...(requiresOfficialPrice ? {
          officialPrice: {
            amountKrw: candidate.officialPriceAmountKrw!,
            sourceText: candidate.officialPriceSourceText!,
            observedAt: candidate.officialPriceObservedAt!,
          },
        } : {}),
        sourceRefs: candidate.officialSourceRefs,
        image: {
          url: candidate.officialImageUrl,
          contentHash: candidate.officialImageContentHash,
          mediaType: candidate.officialImageMediaType,
          byteLength: candidate.officialImageByteLength,
        },
      };
      const reviewedProposal = await parseReviewedLinkProposalForLiveCandidate(reviewedProposalJson, {
        receipt: currentReceiptInput,
        officialListing: currentOfficialListingInput,
      });
      const approvedCatalogNamespace = reviewedProposal.receipt.sourceCatalogNamespace;
      if (!approvedCatalogNamespace) {
        throw new Error("승인된 영수증 카탈로그 채널이 없습니다.");
      }
      const receiptInput = {
        ...reviewedProposal.receipt,
        sourceCatalogNamespace: approvedCatalogNamespace,
      };
      const officialListingInput = reviewedProposal.officialListing;
      const commonIdentityInput = {
        caseId,
        receipt: receiptInput,
        officialListing: officialListingInput,
        assessment: {
          decision: {
            confidence: reviewedProposal.decision.confidence,
            matchedFields: reviewedProposal.decision.matchedFields,
            conflictingFields: reviewedProposal.decision.conflictingFields,
            missingFields: reviewedProposal.decision.missingFields,
          },
          evidence: reviewedProposal.evidence,
          review: reviewedProposal.review,
        },
        verifiedNameEquivalence:
          reviewedProposal.sameChannelNameRule.verifiedEquivalence ?? null,
        userSelectedOfficialVariant:
          reviewedProposal.executionTarget.userSelectedOfficialVariant ?? null,
      };
      const commonTarget = {
        standardProductId: selectedStandard?.id ?? null,
        catalogProductId: expectedCatalogProductId,
        standardName: resolvedStandardName,
        listingName: resolvedListingName,
        brandName: brandRegistration.value.canonicalName ?? "",
        receiptBrandName: brandRegistration.value.receiptObservedName,
        officialBrandName: brandRegistration.value.officialObservedName ?? "",
        officialBrandSourceLabel: brandRegistration.value.officialSourceLabel ?? "",
        productReferenceUrl: resolvedProductUrl,
        specificationStatus,
        contentAmount: specification.contentAmount,
        contentUnit: specification.contentUnit,
        packageCount: specification.packageCount,
        referenceUnit: specification.referenceUnit,
        representativeImageAction: existingRepresentativeImage ? "reuse_exact" as const : "create" as const,
        representativeImageExpectedCurrent: existingRepresentativeImage
          ? { sourceType: "external_url" as const, imageUrl: existingRepresentativeImage.image_url }
          : null,
      };
      const identity = isLinkOnly
        ? await buildLinkOnlyRegistrationIdentity({
            ...commonIdentityInput,
            target: {
              ...commonTarget,
              apparelSize: selectedApparelSize,
              kitComponents: reviewedProposal.executionTarget.normalizedIdentity.kitComponents
                ?? null,
              wiperBladeFitment: reviewedProposal.executionTarget.normalizedIdentity.wiperBladeFitment
                ?? null,
            },
          })
        : await buildStrictRegistrationIdentity({
            ...commonIdentityInput,
            target: {
              ...commonTarget,
              coupangProductUrl: coupangProductUrl.trim(),
              coupangListedPriceKrw: parsedCoupangRequiredPrice!.value!.listedPriceKrw,
              coupangQuantity: parsedCoupangRequiredPrice!.value!.quantity,
              coupangContentAmount: parsedCoupangContentAmount,
              coupangContentUnit: specification.contentUnit,
              coupangMaxBundleQuantity: parsedCoupangBundle!.value!.maxBundleQuantity,
              coupangMaxBundleListedPriceKrw:
                parsedCoupangBundle!.value!.maxBundleListedPriceKrw,
            },
          });
      const executionProposal = approvalProposal && approvalFormEdited
        ? rebuildReviewedLinkProposalForAdminTarget(reviewedProposal, identity)
        : reviewedProposal;
      const executionIdentity = approvalProposal
        ? await buildReviewedLinkProposalExecutionIdentity(executionProposal)
        : { ...identity, executionTarget: executionProposal.executionTarget };
      assertReviewedProposalMatchesExecutionTarget(
        executionProposal,
        executionIdentity.targetCanonicalJson,
      );
      if (!approvalProposal && pendingProposal?.targetFingerprint !== identity.targetFingerprint) {
        setPendingProposal({
          targetFingerprint: identity.targetFingerprint,
          receiptSummary: `${candidate.productName}, ${candidate.receiptId}, ${candidate.receiptObservedAt.slice(0, 10)}, 코드 ${candidate.sourceProductCode}`,
          officialSummary: `${resolvedListingName}, ${brandRegistration.value.canonicalName}, ${specification.contentAmount}${specification.contentUnit} × ${specification.packageCount}, 공식코드 ${candidate.officialSourceProductCode}`,
          targetSummary: `${brandRegistration.value.canonicalName} · ${resolvedStandardName} → ${resolvedListingName}`,
          coupangSummary: isLinkOnly
            ? "없음 (공식·영수증 연결만)"
            : `${parsedCoupangRequiredPrice!.value!.listedPriceKrw.toLocaleString("ko-KR")}원 / ${parsedCoupangRequiredPrice!.value!.quantity}개`,
          imageSummary: `${existingRepresentativeImage ? "정확 재사용" : "신규 등록"} · ${candidate.officialImageUrl}`,
          effectSummary: isLinkOnly
            ? "표준 상품군, 정확 규격, 공식 링크, 영수증 매핑, 공식 대표 이미지"
            : "표준 상품군, 정확 규격, 공식 링크, 영수증 매핑, 쿠팡 옵션, 공식 대표 이미지",
          approvalStatement: identity.approvalStatement,
        });
        setMessage("아래 제안서를 확인한 뒤 한 번 더 눌러 승인하세요. 아직 저장하지 않았습니다.");
        return;
      }
      const commonRpcArgs = {
        p_idempotency_key: executionIdentity.idempotencyKey,
        p_case_id: executionIdentity.caseId,
        p_input_fingerprint: executionIdentity.inputFingerprint,
        p_target_fingerprint: executionIdentity.targetFingerprint,
        p_input_canonical_json: executionIdentity.inputCanonicalJson,
        p_target_canonical_json: executionIdentity.targetCanonicalJson,
        p_approval_statement: executionIdentity.approvalStatement,
        p_receipt_id: receiptInput.receiptId,
        p_receipt_item_id: receiptInput.receiptItemId,
        p_receipt_observed_at: receiptInput.observedAt,
        p_standard_product_id: executionIdentity.executionTarget.decision.standardProductId,
        p_catalog_product_id: executionIdentity.executionTarget.decision.catalogProductId,
        p_standard_name: executionIdentity.executionTarget.normalizedIdentity.productFamilyName,
        p_brand_name: executionIdentity.executionTarget.brandEvidence.canonicalName,
        p_receipt_brand_name: executionIdentity.executionTarget.brandEvidence.receiptObservedName,
        p_official_brand_name: executionIdentity.executionTarget.brandEvidence.officialObservedName,
        p_official_brand_source_label: executionIdentity.executionTarget.brandEvidence.officialSourceLabel,
        p_product_reference_url: executionIdentity.executionTarget.brandEvidence.productReferenceUrl,
        p_listing_name: executionIdentity.executionTarget.normalizedIdentity.variantName,
        p_receipt_product_name: receiptInput.sourceNameRaw,
        p_specification_status: executionIdentity.executionTarget.normalizedIdentity.specificationStatus,
        p_content_amount: executionIdentity.executionTarget.normalizedIdentity.contentAmount,
        p_content_unit: executionIdentity.executionTarget.normalizedIdentity.contentUnit,
        p_package_count: executionIdentity.executionTarget.normalizedIdentity.packageCount,
        p_reference_unit: executionIdentity.executionTarget.normalizedIdentity.referenceUnit,
        p_source_product_code: receiptInput.sourceProductCode,
        p_source_labels: [receiptInput.sourceLabel],
      };
      const { data, error } = isLinkOnly
        ? await client.rpc("approve_and_register_standard_product_link_only_v1", {
            ...commonRpcArgs,
            p_specification: selectedApparelSize
              ? `${selectedApparelSize.kr}호`
              : officialListingInput.specificationTextRaw,
            p_apparel_size: selectedApparelSize,
          })
        : await client.rpc("approve_and_register_standard_product_link_strict_v6", {
            ...commonRpcArgs,
            p_coupang_product_url: executionIdentity.executionTarget.coupangOffer!.productUrl,
            p_coupang_listed_price_krw:
              executionIdentity.executionTarget.coupangOffer!.listedPriceKrw,
            p_coupang_quantity: executionIdentity.executionTarget.coupangOffer!.quantity,
            p_coupang_content_amount:
              executionIdentity.executionTarget.coupangOffer!.contentAmount,
            p_coupang_content_unit: executionIdentity.executionTarget.coupangOffer!.contentUnit,
            p_coupang_max_bundle_quantity:
              executionIdentity.executionTarget.coupangOffer!.maxBundleQuantity,
            p_coupang_max_bundle_listed_price_krw:
              executionIdentity.executionTarget.coupangOffer!.maxBundleListedPriceKrw,
          });
      const saved = data?.[0];
      if (error || !saved) throw new Error(error?.message ?? "표준 상품을 저장하지 못했습니다.");
      const savedStandardId = saved.standard_product_id;
      const notice = saved.replayed
        ? "동일한 승인 대상이 이미 등록되어 기존 결과를 확인했습니다."
        : isLinkOnly
          ? "표준 상품, 판매 규격, 공식 링크와 대표 이미지를 안전하게 등록했습니다."
          : "표준 상품, 판매 규격, 쿠팡 가격, 공식 대표 이미지를 안전하게 등록했습니다.";
      setStandardProductId(savedStandardId);
      setMappingSaved(true);
      setPendingProposal(null);
      setMessage(notice);
      onSaved(notice);
      onApproved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "표준 상품을 연결하지 못했습니다.");
    } finally { setSaving(false); }
  }

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className={`${styles.authModal} ${styles.officialModal} ${styles.standardConnectionModal}`} role="dialog" aria-modal="true" aria-labelledby="standard-product-title">
      <button className={styles.closeButton} onClick={onClose} disabled={saving} aria-label="표준 상품 연결 닫기">×</button>
      <p className={styles.kicker}>STANDARD PRODUCT</p><h2 id="standard-product-title">{approvalProposal ? "표준 상품 연결 승인" : "표준 상품과 판매 규격 연결"}</h2><p className={styles.productCode}>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</p>
      {approvalProposal && <p className={styles.approvalModalHint}>GPT 제안 내용을 확인하고 그대로 승인하거나, 적용할 상품 정보만 수정한 뒤 승인하세요. 영수증·공식 상품 근거는 수정되지 않습니다.</p>}
      <div className={styles.standardConnectionModalGrid}>
        <div className={styles.standardConnectionPane}>
          <h3>표준 상품·판매 규격 연결</h3>
          <form className={styles.manualForm} onSubmit={saveMapping}>
            <label>기존 표준 상품<select value={standardProductId} onChange={(event) => { const nextStandard = standards.find((standard) => standard.id === event.target.value); setStandardProductId(event.target.value); setBrandName(nextStandard?.brand ?? ""); setMappingSaved(false); setMessage(""); }}><option value="">새 표준 상품 만들기</option>{standards.map((standard) => <option key={standard.id} value={standard.id}>{standard.brand ? `${standard.brand} · ` : ""}{standard.canonical_name}</option>)}</select></label>
            {whitespaceEquivalentStandard && <p className={styles.standardNameCollision} role="alert">같은 이름의 표준 상품 <b>{whitespaceEquivalentStandard.canonical_name}</b>이 이미 있습니다. 새로 만들지 말고 위 목록에서 해당 표준 상품을 직접 선택하세요.</p>}
            {selectedStandard ? <><section className={styles.reusedProductInfo} aria-label="사용할 표준 상품 정보"><span>표준 상품 <b>{selectedStandard.canonical_name}</b></span><span>브랜드 <b>{selectedStandard.brand ?? "미지정"}</b></span><span>하위 상품명 <b>{approvalProposal ? listingName : reusedListingName}</b></span>{reusedProductUrl ? <a href={reusedProductUrl} target="_blank" rel="noreferrer">기존 상품 URL 확인</a> : <strong>기존 URL이 없어 연결할 수 없습니다.</strong>}</section>{approvalProposal && <label>적용할 판매 규격명<input required value={listingName} onChange={(event) => setListingName(event.target.value)} /><small>공식 카탈로그 원문: {candidate.officialSourceNameRaw}</small></label>}</> : <><label>새 표준 상품명<input required value={standardName} onChange={(event) => setStandardName(event.target.value)} placeholder="예: 햇반" /></label><label>{approvalProposal ? "적용할 판매 규격명" : "공식 판매 규격명"}<input required value={approvalProposal ? listingName : candidate.officialSourceNameRaw ?? listingName} onChange={(event) => setListingName(event.target.value)} readOnly={!approvalProposal && Boolean(candidate.officialSourceNameRaw)} placeholder="공식 카탈로그 원문" /><small>{approvalProposal ? `공식 카탈로그 원문: ${candidate.officialSourceNameRaw}` : "공식 스냅샷 원문은 수정하지 않습니다."}</small></label><label>상품 확인 URL<input required type="url" placeholder="https://" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} /></label></>}
            <section className={styles.reusedProductInfo} aria-label="공식 대표 이미지"><span>공식 대표 이미지 <b>표준 상품군에 적용</b></span>{candidate.officialImageUrl ? <a href={candidate.officialImageUrl} target="_blank" rel="noreferrer">공식 이미지 링크 확인</a> : <strong>공식 이미지 근거가 없어 연결할 수 없습니다.</strong>}</section>
            <label>표준 브랜드<input list="standard-brand-options" value={brandName} onChange={(event) => setBrandName(event.target.value)} placeholder="예: Baskin Robbins" /><small>상품명과 분리해 표준 상품군에 지정하며, 하위 판매 규격이 이 값을 상속합니다.</small></label>
            <datalist id="standard-brand-options">{brands.map((brand) => <option key={brand.id} value={brand.canonical_name} />)}</datalist>
            <label>영수증 브랜드 표기<input value={receiptBrandName} onChange={(event) => setReceiptBrandName(event.target.value)} placeholder="영수증에서 직접 확인한 경우만 입력" /><small>판매처와 상품 코드는 브랜드 근거 출처로 함께 보존됩니다.</small></label>
            <label>공식몰 브랜드 표기<input value={officialBrandName} onChange={(event) => setOfficialBrandName(event.target.value)} placeholder="공식 페이지에서 직접 확인한 경우만 입력" /><small>공식 카탈로그의 업체명은 브랜드로 자동 사용하지 않습니다. 확인 URL의 도메인과 브랜드 원문을 별도 근거로 보존합니다.</small></label>
            {!approvalProposal && <label>검토된 LinkProposal v3<textarea required rows={7} value={reviewedProposalJson} onChange={(event) => { setReviewedProposalJson(event.target.value); setPendingProposal(null); }} placeholder="독립 검토 후 생성·검증된 pricetrace-link-proposal.v3 JSON을 붙여넣으세요." /><small>내용은 이 화면의 메모리에만 유지됩니다. 공식 대표 이미지와 원본 입력 지문, 검토 대상 지문, 현재 적용값이 모두 일치해야 승인 단계가 열립니다.</small></label>}
            {!approvalProposal && <label className={styles.placeholderToggle}><input type="checkbox" checked={usesPlaceholderSpecification} onChange={(event) => setUsesPlaceholderSpecification(event.target.checked)} /><span><b>규격 확인 전 임시값 사용</b><small>임시 규격은 공개 단위가격 계산에서 제외됩니다.</small></span></label>}
            {approvalApparelSize ? <label>의류 사이즈<select value={apparelSizeLabel} onChange={(event) => setApparelSizeLabel(event.target.value as ApparelSizeLabel)}>{apparelSizes.map((size) => <option key={size.label} value={size.label}>{size.label}</option>)}</select><small>공식 숫자 규격은 보존하고 판매수량 1개와 분리해 저장합니다.</small></label> : !usesPlaceholderSpecification && <><label>개당 내용량<input required inputMode="decimal" placeholder="예: 210" value={contentAmount} onChange={(event) => setContentAmount(event.target.value)} /></label><label>내용 단위<select value={contentUnit} onChange={(event) => setContentUnit(event.target.value as "g" | "ml" | "each")}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label><label>묶음 수<input required type="number" min="1" step="1" value={packageCount} onChange={(event) => setPackageCount(event.target.value)} /><small>공식 상품명에 수량 표기가 없으면 1개로 등록합니다.</small></label><label>단위 가격 기준<select value={referenceUnit} onChange={(event) => setReferenceUnit(Number(event.target.value) as ReferenceUnit)} disabled={contentUnit === "each"}><option value="10">{referenceLabel(contentUnit, 10)}</option><option value="100">{referenceLabel(contentUnit, 100)}</option><option value="1000">{referenceLabel(contentUnit, 1000)}</option></select></label></>}
            {pendingProposal && <section className={styles.reusedProductInfo} aria-label="연결 제안서">
              <strong>연결 제안서</strong>
              <span>영수증 기록 : {pendingProposal.receiptSummary}</span>
              <span>공식 상품 기록 : {pendingProposal.officialSummary}</span>
              <span>적용 상품 : {pendingProposal.targetSummary}</span>
              <span>쿠팡가 : {pendingProposal.coupangSummary}</span>
              <span>대표 이미지 : {pendingProposal.imageSummary}</span>
              <span>연결 작업 : {pendingProposal.effectSummary}</span>
              <span>승인 대상 : {pendingProposal.targetFingerprint}</span>
              <small>승인 문구 : {pendingProposal.approvalStatement}</small>
              <small>입력값을 바꾸면 이 승인은 자동 무효화됩니다.</small>
            </section>}
            <button type="submit" disabled={saving || mappingSaved || Boolean(whitespaceEquivalentStandard) || Boolean(selectedStandard && !reusedProductUrl)}>{mappingSaved ? "등록 완료" : saving ? (approvalProposal ? "승인 및 등록 중..." : "검증 중...") : approvalProposal ? (approvalFormEdited ? "수정 후 승인" : "연결 승인") : pendingProposal ? "이 제안 승인하고 등록" : "연결 제안서 만들기"}</button>
          </form>
        </div>
        {isLinkOnlyApproval ? <aside className={styles.coupangModalPane} aria-label="쿠팡 가격 없음"><h3>쿠팡 가격</h3><p className={styles.muted}>이 제안은 공식 채널과 영수증 상품만 연결합니다.</p><strong>쿠팡가 없음</strong></aside> : <CoupangPriceFields productUrl={coupangProductUrl} onProductUrlChange={setCoupangProductUrl} listedPriceKrw={coupangListedPriceKrw} onListedPriceKrwChange={setCoupangListedPriceKrw} quantity={coupangQuantity} onQuantityChange={setCoupangQuantity} contentAmount={coupangContentAmount} onContentAmountChange={setCoupangContentAmount} contentUnit={usesPlaceholderSpecification ? "each" : contentUnit} maxBundleQuantity={coupangMaxBundleQuantity} onMaxBundleQuantityChange={setCoupangMaxBundleQuantity} maxBundleListedPriceKrw={coupangMaxBundleListedPriceKrw} onMaxBundleListedPriceKrwChange={setCoupangMaxBundleListedPriceKrw} />}
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
