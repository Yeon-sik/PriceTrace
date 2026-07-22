"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { discoverOfficialProduct, mergeOfficialProductCandidates, officialProductCandidateKey, officialSearchUrl, type OfficialProductCandidate } from "@/domain/official-product";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import styles from "./page.module.css";

type CatalogProduct = { id: string; canonical_name: string; product_reference_url: string | null; specification: string | null; content_amount: number | null; content_unit: string | null; package_count: number };
const legacyRepository = new OfficialProductRepository();
const sellers = (candidate: OfficialProductCandidate) => candidate.storeLabels?.length ? candidate.storeLabels : [candidate.storeLabel];
const mappingKey = (sourceLabel: string, sourceProductCode: string) => `${sourceLabel}:${sourceProductCode}`;

export function StandardProductWorkspace({ candidates, revision }: { candidates: OfficialProductCandidate[]; revision: number }) {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [catalogBySource, setCatalogBySource] = useState<Record<string, CatalogProduct>>({});
  const [legacy, setLegacy] = useState(() => legacyRepository.loadAll());
  const [selected, setSelected] = useState<OfficialProductCandidate | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!client) return;
    const [{ data: productData, error: productError }, { data: mappingData, error: mappingError }] = await Promise.all([
      client.from("catalog_products").select("id,canonical_name,product_reference_url,specification,content_amount,content_unit,package_count").eq("status", "active"),
      client.from("source_product_mappings").select("source_label,source_product_code,catalog_product_id").eq("review_status", "verified"),
    ]);
    if (productError || mappingError) { setMessage(productError?.message ?? mappingError?.message ?? "표준 상품을 불러오지 못했습니다."); return; }
    const byId = new Map((productData ?? []).map((product) => [product.id, product as CatalogProduct]));
    setCatalogBySource(Object.fromEntries((mappingData ?? []).flatMap((mapping) => {
      const product = byId.get(mapping.catalog_product_id);
      return product ? [[mappingKey(mapping.source_label, mapping.source_product_code), product]] : [];
    })));
    setLegacy(legacyRepository.loadAll());
  }, [client]);

  useEffect(() => { if (client) void client.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, [client]);
  useEffect(() => { void load(); }, [load, revision]);

  const states = useMemo(() => mergeOfficialProductCandidates(candidates).map((candidate) => {
    const mapped = sellers(candidate).map((seller) => catalogBySource[mappingKey(seller, candidate.sourceProductCode)]).find(Boolean);
    const browserRecord = legacy[officialProductCandidateKey(candidate)];
    const discovered = discoverOfficialProduct(candidate);
    const legacyRecord = browserRecord ?? (discovered.status === "matched" ? discovered.record : undefined);
    return { candidate, mapped, legacy: legacyRecord, fromBrowserStorage: Boolean(browserRecord) };
  }), [candidates, catalogBySource, legacy]);
  const linked = states.filter((state) => state.mapped);
  const unlinked = states.filter((state) => !state.mapped);

  if (!client || !userId) return null;
  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>STANDARD PRODUCT MAPPING</p><h1>표준 상품 연결</h1><p>영수증 판매처 상품을 하나의 표준 상품에 연결합니다. 표준 상품의 규격과 판매처 관측가가 이후 단위가격 비교의 기준이 됩니다.</p></div></div>
    {message && <p className={styles.error} role="alert">{message}</p>}
    <div className={styles.officialSummary}><span><b>{linked.length}</b>개 표준 상품 연결</span><span><b>{unlinked.length}</b>개 연결 필요</span></div>
    <section className={styles.officialSection}><h2>연결된 표준 상품</h2>{linked.length ? <div className={styles.officialGrid}>{linked.map(({ candidate, mapped }) => <article key={officialProductCandidateKey(candidate)}><div><span>검증된 표준 상품</span><h3>{mapped!.canonical_name}</h3><p>영수증 표기: {candidate.productName}</p><small>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</small><small>{mapped!.content_amount ? `규격 ${mapped!.content_amount}${mapped!.content_unit} × ${mapped!.package_count}` : "규격 미입력"}</small>{mapped!.product_reference_url && <a href={mapped!.product_reference_url} target="_blank" rel="noreferrer">상품 확인 출처</a>}</div></article>)}</div> : <p>아직 연결된 표준 상품이 없습니다.</p>}</section>
    <section className={styles.officialSection}><h2>표준 상품 연결 대기열</h2><p className={styles.manualHint}>기존 브라우저 저장 연결과 기존 시드 연결은 DB 표준 상품과 별개였습니다. 아래에서 한 번 가져오면 이후 표준 상품 목록과 시장가에 함께 나타납니다.</p><div className={styles.manualQueue}>{unlinked.map(({ candidate, legacy: legacyRecord, fromBrowserStorage }) => <article key={officialProductCandidateKey(candidate)}><div><strong>{legacyRecord?.officialName ?? candidate.productName}</strong><small>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</small>{legacyRecord && <small>{fromBrowserStorage ? "기존 브라우저 저장 연결" : "기존 시드 연결"}을 표준 상품으로 가져올 수 있습니다.</small>}</div><div className={styles.queueActions}><a href={legacyRecord?.officialUrl ?? officialSearchUrl(candidate)} target="_blank" rel="noreferrer">상품 정보 찾기</a><button onClick={() => setSelected(candidate)}>{legacyRecord ? "표준 상품으로 가져오기" : "표준 상품 연결"}</button></div></article>)}</div></section>
    {selected && <StandardProductModal candidate={selected} legacy={legacy[officialProductCandidateKey(selected)]} userId={userId} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void load(); }} />}
  </section>;
}

function StandardProductModal({ candidate, legacy, userId, onClose, onSaved }: { candidate: OfficialProductCandidate; legacy?: { officialName: string; officialUrl: string }; userId: string; onClose: () => void; onSaved: () => void }) {
  const client = getSupabaseBrowserClient();
  const [canonicalName, setCanonicalName] = useState(legacy?.officialName ?? candidate.productName);
  const [productUrl, setProductUrl] = useState(legacy?.officialUrl ?? "");
  const [contentAmount, setContentAmount] = useState("");
  const [contentUnit, setContentUnit] = useState<"g" | "ml" | "each">("g");
  const [packageCount, setPackageCount] = useState("1");
  const [message, setMessage] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !canonicalName.trim() || !/^https?:\/\//.test(productUrl)) return;
    const parsedContentAmount = contentAmount.trim() ? Number(contentAmount) : null;
    const parsedPackageCount = Number(packageCount);
    if ((parsedContentAmount !== null && (!Number.isFinite(parsedContentAmount) || parsedContentAmount <= 0)) || !Number.isInteger(parsedPackageCount) || parsedPackageCount <= 0) { setMessage("내용량과 묶음 수를 올바르게 입력하세요."); return; }
    const { data: product, error: productError } = await client.from("catalog_products").insert({ purchase_type: "retail_product", canonical_name: canonicalName.trim(), product_reference_url: productUrl.trim(), content_amount: parsedContentAmount, content_unit: parsedContentAmount === null ? null : contentUnit, package_count: parsedPackageCount, created_by: userId }).select("id").single();
    if (productError || !product) { setMessage(productError?.message ?? "표준 상품을 저장하지 못했습니다."); return; }
    const reviewedAt = new Date().toISOString();
    const rows = sellers(candidate).map((sourceLabel) => ({ source_label: sourceLabel, source_product_code: candidate.sourceProductCode, catalog_product_id: product.id, matching_method: "manual", confidence: 1, review_status: "verified", created_by: userId, reviewed_by: userId, reviewed_at: reviewedAt }));
    const { error: mappingError } = await client.from("source_product_mappings").upsert(rows, { onConflict: "source_label,source_product_code" });
    if (mappingError) { setMessage(mappingError.message); return; }
    onSaved();
  }
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.officialModal}`} role="dialog" aria-modal="true" aria-labelledby="standard-product-title"><button className={styles.closeButton} onClick={onClose} aria-label="표준 상품 연결 닫기">×</button><p className={styles.kicker}>STANDARD PRODUCT</p><h2 id="standard-product-title">표준 상품 연결</h2><p className={styles.productCode}>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</p><form className={styles.manualForm} onSubmit={save}><label>표준 상품명<input required value={canonicalName} onChange={(event) => setCanonicalName(event.target.value)} /></label><label>상품 확인 URL<input required type="url" placeholder="https://" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} /></label><label>내용량 <small>비워두면 단위가격 비교에서 제외됩니다.</small><input inputMode="decimal" placeholder="예: 400" value={contentAmount} onChange={(event) => setContentAmount(event.target.value)} /></label><label>내용 단위<select value={contentUnit} onChange={(event) => setContentUnit(event.target.value as "g" | "ml" | "each")}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label><label>묶음 수<input type="number" min="1" step="1" value={packageCount} onChange={(event) => setPackageCount(event.target.value)} /></label><button type="submit">표준 상품으로 연결</button></form>{message && <p className={styles.authMessage} role="status">{message}</p>}</section></div>;
}
