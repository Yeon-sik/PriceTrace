"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { discoverOfficialProduct, mergeOfficialProductCandidates, officialProductCandidateKey, officialSearchUrl, type OfficialProductCandidate } from "@/domain/official-product";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import styles from "./page.module.css";

type StandardProduct = { id: string; canonical_name: string; brand: string | null };
type Variant = { id: string; standard_product_id: string; canonical_name: string; content_amount: number | null; content_unit: string | null; package_count: number; listing_reference_url: string | null };
const legacyRepository = new OfficialProductRepository();
const sellers = (candidate: OfficialProductCandidate) => candidate.storeLabels?.length ? candidate.storeLabels : [candidate.storeLabel];
const mappingKey = (sourceLabel: string, sourceProductCode: string) => `${sourceLabel}:${sourceProductCode}`;

export function StandardProductWorkspace({ candidates, revision }: { candidates: OfficialProductCandidate[]; revision: number }) {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [standards, setStandards] = useState<StandardProduct[]>([]);
  const [variantBySource, setVariantBySource] = useState<Record<string, Variant>>({});
  const [legacy, setLegacy] = useState(() => legacyRepository.loadAll());
  const [selected, setSelected] = useState<OfficialProductCandidate | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!client) return;
    const [{ data: standardData, error: standardError }, { data: variantData, error: variantError }, { data: mappingData, error: mappingError }] = await Promise.all([
      client.from("standard_products").select("id,canonical_name,brand").eq("status", "active").order("canonical_name"),
      client.from("catalog_products").select("id,standard_product_id,canonical_name,content_amount,content_unit,package_count,listing_reference_url").eq("status", "active"),
      client.from("source_product_mappings").select("source_label,source_product_code,catalog_product_id").eq("review_status", "verified"),
    ]);
    if (standardError || variantError || mappingError) { setMessage(standardError?.message ?? variantError?.message ?? mappingError?.message ?? "표준 상품을 불러오지 못했습니다."); return; }
    const byId = new Map((variantData ?? []).map((variant) => [variant.id, variant as Variant]));
    setStandards((standardData ?? []) as StandardProduct[]);
    setVariantBySource(Object.fromEntries((mappingData ?? []).flatMap((mapping) => {
      const variant = byId.get(mapping.catalog_product_id);
      return variant ? [[mappingKey(mapping.source_label, mapping.source_product_code), variant]] : [];
    })));
    setLegacy(legacyRepository.loadAll());
  }, [client]);

  useEffect(() => { if (client) void client.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, [client]);
  useEffect(() => { void load(); }, [load, revision]);

  const standardById = useMemo(() => new Map(standards.map((standard) => [standard.id, standard])), [standards]);
  const states = useMemo(() => mergeOfficialProductCandidates(candidates).map((candidate) => {
    const variant = sellers(candidate).map((seller) => variantBySource[mappingKey(seller, candidate.sourceProductCode)]).find(Boolean);
    const browserRecord = legacy[officialProductCandidateKey(candidate)];
    const discovered = discoverOfficialProduct(candidate);
    return { candidate, variant, standard: variant ? standardById.get(variant.standard_product_id) : undefined, legacy: browserRecord ?? (discovered.status === "matched" ? discovered.record : undefined), fromBrowserStorage: Boolean(browserRecord) };
  }), [candidates, variantBySource, standardById, legacy]);
  const linked = states.filter((state) => state.variant && state.standard);
  const unlinked = states.filter((state) => !state.variant);

  if (!client || !userId) return null;
  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>STANDARD PRODUCT MAPPING</p><h1>표준 상품 연결</h1><p>표준 상품은 햇반 같은 상품군입니다. 영수증 품목은 실제 판매 규격(예: 210g × 3)으로 등록해 표준 상품 아래에 보관합니다.</p></div></div>
    {message && <p className={styles.error} role="alert">{message}</p>}
    <div className={styles.officialSummary}><span><b>{linked.length}</b>개 판매 기록 연결</span><span><b>{unlinked.length}</b>개 연결 필요</span></div>
    <section className={styles.officialSection}><h2>연결된 표준 상품 기록</h2>{linked.length ? <div className={styles.officialGrid}>{linked.map(({ candidate, standard, variant }) => <article key={officialProductCandidateKey(candidate)}><div><span>표준 상품 · {standard!.canonical_name}</span><h3>{variant!.canonical_name}</h3><p>영수증 표기: {candidate.productName}</p><small>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</small><small>{variant!.content_amount ? `규격 ${variant!.content_amount}${variant!.content_unit} × ${variant!.package_count}` : "규격 미입력"}</small></div></article>)}</div> : <p>아직 연결된 판매 기록이 없습니다.</p>}</section>
    <section className={styles.officialSection}><h2>표준 상품 연결 대기열</h2><p className={styles.manualHint}>기존 연결은 표준 상품과 하위 판매 규격으로 한 번 가져옵니다. 규격을 모르면 연결하지 말고 확인 후 등록하세요.</p><div className={styles.manualQueue}>{unlinked.map(({ candidate, legacy: legacyRecord, fromBrowserStorage }) => <article key={officialProductCandidateKey(candidate)}><div><strong>{legacyRecord?.officialName ?? candidate.productName}</strong><small>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</small>{legacyRecord && <small>{fromBrowserStorage ? "기존 브라우저 저장 연결" : "기존 시드 연결"}을 가져올 수 있습니다.</small>}</div><div className={styles.queueActions}><a href={legacyRecord?.officialUrl ?? officialSearchUrl(candidate)} target="_blank" rel="noreferrer">상품 정보 찾기</a><button onClick={() => setSelected(candidate)}>{legacyRecord ? "표준 상품으로 가져오기" : "표준 상품 연결"}</button></div></article>)}</div></section>
    {selected && <StandardProductModal candidate={selected} legacy={legacy[officialProductCandidateKey(selected)]} standards={standards} userId={userId} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void load(); }} />}
  </section>;
}

function StandardProductModal({ candidate, legacy, standards, userId, onClose, onSaved }: { candidate: OfficialProductCandidate; legacy?: { officialName: string; officialUrl: string }; standards: StandardProduct[]; userId: string; onClose: () => void; onSaved: () => void }) {
  const client = getSupabaseBrowserClient();
  const [standardProductId, setStandardProductId] = useState("");
  const [standardName, setStandardName] = useState(legacy?.officialName ?? candidate.productName);
  const [listingName, setListingName] = useState(candidate.productName);
  const [productUrl, setProductUrl] = useState(legacy?.officialUrl ?? "");
  const [contentAmount, setContentAmount] = useState("");
  const [contentUnit, setContentUnit] = useState<"g" | "ml" | "each">("g");
  const [packageCount, setPackageCount] = useState("1");
  const [message, setMessage] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !listingName.trim() || !/^https?:\/\//.test(productUrl)) return;
    const parsedContentAmount = Number(contentAmount);
    const parsedPackageCount = Number(packageCount);
    if (!Number.isFinite(parsedContentAmount) || parsedContentAmount <= 0 || !Number.isInteger(parsedPackageCount) || parsedPackageCount <= 0) { setMessage("내용량과 묶음 수를 올바르게 입력하세요."); return; }
    let selectedStandardId = standardProductId;
    if (!selectedStandardId) {
      if (!standardName.trim()) { setMessage("새 표준 상품명을 입력하세요."); return; }
      const { data, error } = await client.from("standard_products").insert({ purchase_type: "retail_product", canonical_name: standardName.trim(), product_reference_url: productUrl.trim(), created_by: userId }).select("id").single();
      if (error || !data) { setMessage(error?.message ?? "표준 상품을 저장하지 못했습니다."); return; }
      selectedStandardId = data.id;
    }
    const { data: variant, error: variantError } = await client.from("catalog_products").insert({ standard_product_id: selectedStandardId, purchase_type: "retail_product", canonical_name: listingName.trim(), content_amount: parsedContentAmount, content_unit: contentUnit, package_count: parsedPackageCount, listing_reference_url: productUrl.trim(), created_by: userId }).select("id").single();
    if (variantError || !variant) { setMessage(variantError?.message ?? "판매 규격을 저장하지 못했습니다."); return; }
    const reviewedAt = new Date().toISOString();
    const rows = sellers(candidate).map((sourceLabel) => ({ source_label: sourceLabel, source_product_code: candidate.sourceProductCode, catalog_product_id: variant.id, matching_method: "manual", confidence: 1, review_status: "verified", created_by: userId, reviewed_by: userId, reviewed_at: reviewedAt }));
    const { error: mappingError } = await client.from("source_product_mappings").upsert(rows, { onConflict: "source_label,source_product_code" });
    if (mappingError) { setMessage(mappingError.message); return; }
    onSaved();
  }
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.officialModal}`} role="dialog" aria-modal="true" aria-labelledby="standard-product-title"><button className={styles.closeButton} onClick={onClose} aria-label="표준 상품 연결 닫기">×</button><p className={styles.kicker}>STANDARD PRODUCT</p><h2 id="standard-product-title">표준 상품과 판매 규격 연결</h2><p className={styles.productCode}>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</p><form className={styles.manualForm} onSubmit={save}><label>기존 표준 상품<select value={standardProductId} onChange={(event) => setStandardProductId(event.target.value)}><option value="">새 표준 상품 만들기</option>{standards.map((standard) => <option key={standard.id} value={standard.id}>{standard.canonical_name}</option>)}</select></label>{!standardProductId && <label>새 표준 상품명<input required value={standardName} onChange={(event) => setStandardName(event.target.value)} placeholder="예: 햇반" /></label>}<label>판매 규격명<input required value={listingName} onChange={(event) => setListingName(event.target.value)} placeholder="예: 햇반 210g × 3" /></label><label>상품 확인 URL<input required type="url" placeholder="https://" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} /></label><label>개별 내용량<input required inputMode="decimal" placeholder="예: 210" value={contentAmount} onChange={(event) => setContentAmount(event.target.value)} /></label><label>내용 단위<select value={contentUnit} onChange={(event) => setContentUnit(event.target.value as "g" | "ml" | "each")}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label><label>묶음 수<input required type="number" min="1" step="1" value={packageCount} onChange={(event) => setPackageCount(event.target.value)} /></label><button type="submit">표준 상품에 판매 규격 등록</button></form>{message && <p className={styles.authMessage} role="status">{message}</p>}</section></div>;
}
