"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { discoverOfficialProduct, mergeOfficialProductCandidates, officialProductCandidateKey, officialSearchUrl, type OfficialProductCandidate, type OfficialProductRecord, type OfficialSearchResult } from "@/domain/official-product";
import { OfficialProductDiscoveryRepository } from "@/repositories/official-product-discovery.repository";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import styles from "./page.module.css";

const repository = new OfficialProductRepository();
const discoveryRepository = new OfficialProductDiscoveryRepository();
type CandidateState = { candidate: OfficialProductCandidate; record?: OfficialProductRecord; reason: string };
const sellers = (candidate: OfficialProductCandidate) => candidate.storeLabels?.length ? candidate.storeLabels : [candidate.storeLabel];

export function OfficialProductWorkspace({ candidates, onSelect, revision }: { candidates: OfficialProductCandidate[]; onSelect: (candidate: OfficialProductCandidate) => void; revision: number }) {
  const [manual, setManual] = useState<Record<string, OfficialProductRecord>>({});
  const [searches, setSearches] = useState<Record<string, OfficialSearchResult[]>>({});
  const [searchMessages, setSearchMessages] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState<string | null>(null);
  useEffect(() => setManual(repository.loadAll()), [revision]);
  const states = useMemo<CandidateState[]>(() => mergeOfficialProductCandidates(candidates).map((candidate) => {
    const manualRecord = manual[officialProductCandidateKey(candidate)];
    if (manualRecord) return { candidate, record: manualRecord, reason: "사용자가 확인한 공식 상품 연결입니다." };
    const discovered = discoverOfficialProduct(candidate);
    return discovered.status === "matched" ? { candidate, record: discovered.record, reason: discovered.reason } : { candidate, reason: discovered.reason };
  }), [manual, candidates]);
  const matched = states.filter((state) => state.record);
  const unmatched = states.filter((state) => !state.record);

  async function search(candidate: OfficialProductCandidate) {
    const key = officialProductCandidateKey(candidate);
    setSearching(key); setSearchMessages((current) => ({ ...current, [key]: "공식 후보를 찾는 중입니다." }));
    const response = await discoveryRepository.search(candidate);
    if (response.status === "unavailable") setSearchMessages((current) => ({ ...current, [key]: response.message }));
    else { setSearches((current) => ({ ...current, [key]: response.results })); setSearchMessages((current) => ({ ...current, [key]: response.results.length ? "검색 결과를 확인한 뒤 연결하세요." : "공식 후보를 찾지 못했습니다. 수동 검색을 사용하세요." })); }
    setSearching(null);
  }

  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>OFFICIAL PRODUCT DISCOVERY</p><h1>공식 상품 연결</h1><p>같은 카탈로그에서 코드와 상품명이 모두 일치한 후보만 묶습니다. 묶인 판매처는 모두 표시합니다.</p></div></div>
    <div className={styles.officialSummary}><span><b>{matched.length}</b>개 연결됨</span><span><b>{unmatched.length}</b>개 검색 필요</span></div>
    <section className={styles.officialSection}><h2>연결된 공식 상품</h2>{matched.length ? <div className={styles.officialGrid}>{matched.map((state) => <OfficialCard key={officialProductCandidateKey(state.candidate)} candidate={state.candidate} record={state.record!} reason={state.reason} onSelect={onSelect} />)}</div> : <p>검증된 공식 상품 연결이 없습니다.</p>}</section>
    <section className={styles.officialSection}><h2>공식 상품 검색 대기열</h2><p className={styles.manualHint}>서로 다른 유통망은 코드가 같아도 자동으로 합치지 않습니다.</p><div className={styles.manualQueue}>{unmatched.map((state) => {
      const key = officialProductCandidateKey(state.candidate);
      return <article key={key}><div><strong>{state.candidate.productName}</strong><small>판매처 {sellers(state.candidate).join(", ")} · 코드 {state.candidate.sourceProductCode}</small><small>{state.reason}</small>{searchMessages[key] && <small className={styles.discoveryMessage}>{searchMessages[key]}</small>}{searches[key]?.map((result) => <div className={styles.discoveryResult} key={result.officialUrl}><b>{result.officialName}</b><small>{result.sourceName}</small>{result.description && <p>{result.description}</p>}<a href={result.officialUrl} target="_blank" rel="noreferrer">후보 열기</a><button onClick={() => onSelect({ ...state.candidate, productName: result.officialName })}>이 후보 연결</button></div>)}</div><div className={styles.queueActions}><button onClick={() => void search(state.candidate)} disabled={searching === key}>{searching === key ? "검색 중" : "자동 검색"}</button><a href={officialSearchUrl(state.candidate)} target="_blank" rel="noreferrer">수동 검색</a><button onClick={() => onSelect(state.candidate)}>직접 연결</button></div></article>;
    })}</div></section>
  </section>;
}

export function OfficialProductModal({ candidate, onClose, onSaved }: { candidate: OfficialProductCandidate; onClose: () => void; onSaved: () => void }) {
  const [officialName, setOfficialName] = useState(""); const [officialUrl, setOfficialUrl] = useState(""); const [sourceName, setSourceName] = useState(""); const [imageUrl, setImageUrl] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { const discovered = discoverOfficialProduct(candidate); const record = repository.loadAll()[officialProductCandidateKey(candidate)] ?? (discovered.status === "matched" ? discovered.record : undefined); setOfficialName(record?.officialName ?? candidate.productName); setOfficialUrl(record?.officialUrl ?? ""); setSourceName(record?.sourceName ?? ""); setImageUrl(record?.imageUrl ?? ""); }, [candidate]);
  function save(event: React.FormEvent) { event.preventDefault(); try { const next: OfficialProductRecord = { officialName, officialUrl, sourceName, imageUrl: imageUrl || undefined, matchMethod: "manual", confidence: 1, matchedBy: "manual", updatedAt: new Date().toISOString() }; repository.save(officialProductCandidateKey(candidate), next); onSaved(); setMessage("공식 상품 연결을 이 브라우저에 저장했습니다."); } catch (error) { setMessage(error instanceof Error ? error.message : "공식 상품 정보를 저장하지 못했습니다."); } }
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.officialModal}`} role="dialog" aria-modal="true" aria-labelledby="official-title"><button className={styles.closeButton} onClick={onClose} aria-label="공식 상품 창 닫기">×</button><p className={styles.kicker}>OFFICIAL PRODUCT</p><h2 id="official-title">{candidate.productName}</h2><p className={styles.productCode}>판매처 {sellers(candidate).join(", ")} · 코드 {candidate.sourceProductCode}</p><a className={styles.officialSearch} href={officialSearchUrl(candidate)} target="_blank" rel="noreferrer">공식 상품 수동 검색</a><form className={styles.manualForm} onSubmit={save}><h3>확인한 공식 상품 연결</h3><label>공식 상품명<input required value={officialName} onChange={(event) => setOfficialName(event.target.value)} /></label><label>공식 상품 URL<input required type="url" placeholder="https://" value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} /></label><label>출처명<input required placeholder="제조사 공식몰" value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></label><label>상품 이미지 URL <small>선택 · 제조사 또는 공식몰 이미지만 사용</small><input type="url" placeholder="https://" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} /></label><button type="submit">공식 상품 연결 저장</button></form>{message && <p className={styles.authMessage} role="status">{message}</p>}</section></div>;
}

function OfficialCard({ candidate, record, reason, onSelect }: CandidateState & { record: OfficialProductRecord; onSelect: (candidate: OfficialProductCandidate) => void }) { return <article><div className={styles.officialThumb}>{record.imageUrl ? <img src={record.imageUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : "공식"}</div><div><span>{record.matchMethod === "manual" ? "사용자 확인" : `자동 연결 · ${(record.confidence ?? 1) * 100}%`}</span><h3>{record.officialName}</h3><p>{candidate.productName}</p><small>판매처 {sellers(candidate).join(", ")}</small><small>{reason}</small><a href={record.officialUrl} target="_blank" rel="noreferrer">공식 정보 열기</a><button onClick={() => onSelect(candidate)}>연결 수정</button></div></article>; }
