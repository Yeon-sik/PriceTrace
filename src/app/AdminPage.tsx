"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OfficialProductCandidate } from "@/domain/official-product";
import type { Receipt } from "@/domain/types";
import { formatKrw } from "@/domain/settlement";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminReceiptRepository, localReceiptsToAdminRecords, type AdminReceiptRecord } from "@/repositories/admin-receipt.repository";
import { AdminQualityPanel } from "./AdminQualityPanel";
import { StandardProductWorkspace } from "./OfficialProductPanel";
import { CatalogExplorerPanel } from "./CatalogExplorerPanel";
import { MarketPricePanel } from "./MarketPricePanel";
import styles from "./page.module.css";

type AdminTab = "receipts" | "official" | "catalog" | "market" | "quality";
export function AdminPage({ candidates, receipts }: { candidates: OfficialProductCandidate[]; receipts: Receipt[] }) {
  const [tab, setTab] = useState<AdminTab>("receipts");
  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>ADMINISTRATION</p><h1>관리자</h1><p>영수증 기록, 상품 연결, 품질 검토를 분리해 관리합니다.</p></div></div>
    <div className={styles.adminTabs} role="tablist" aria-label="관리자 기능">
      <button role="tab" aria-selected={tab === "receipts"} onClick={() => setTab("receipts")}>영수증 기록</button>
      <button role="tab" aria-selected={tab === "official"} onClick={() => setTab("official")}>표준 상품 연결</button>
      <button role="tab" aria-selected={tab === "catalog"} onClick={() => setTab("catalog")}>표준 상품·규격</button>
      <button role="tab" aria-selected={tab === "market"} onClick={() => setTab("market")}>시장가</button>
      <button role="tab" aria-selected={tab === "quality"} onClick={() => setTab("quality")}>품질 검토</button>
    </div>
    {tab === "receipts" && <AdminReceiptHistory receipts={receipts} />}
    {tab === "official" && <StandardProductWorkspace candidates={candidates} revision={0} />}
    {tab === "catalog" && <CatalogExplorerPanel />}
    {tab === "market" && <MarketPricePanel />}
    {tab === "quality" && <AdminQualityPanel />}
  </section>;
}

function AdminReceiptHistory({ receipts }: { receipts: Receipt[] }) {
  const client = getSupabaseBrowserClient();
  const localReceiptRecords = useMemo(() => localReceiptsToAdminRecords(receipts), [receipts]);
  const [databaseRecords, setDatabaseRecords] = useState<AdminReceiptRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!client) { setError("Supabase 연결이 없어 영수증 기록을 불러올 수 없습니다."); setLoading(false); return; }
    setLoading(true); setError("");
    try { setDatabaseRecords(await new AdminReceiptRepository(client).loadAll()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "영수증 기록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  const records = useMemo(() => [...databaseRecords, ...localReceiptRecords].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt)), [databaseRecords, localReceiptRecords]);
  const visibleRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter((record) => `${record.id} ${record.publicReceiptFileName ?? ""} ${record.storeLabel} ${record.transactionNumber} ${record.purchasedAt} ${record.items.map((item) => item.productName).join(" ")}`.toLowerCase().includes(normalized));
  }, [query, records]);

  return <section className={styles.adminReceipts} aria-labelledby="admin-receipts-title">
    <div className={styles.adminSectionHead}><div><h2 id="admin-receipts-title">영수증 기록</h2><p>원격 DB 저장 기록 {databaseRecords.length}건 · 현재 데이터 영수증 {localReceiptRecords.length}건을 최신 구매일 순으로 확인합니다. 공개 영수증은 `YYYY-MM-DD_NNN.json` 파일명과 동일한 키로 추적합니다.</p></div><div className={styles.adminReceiptTools}><label><span className={styles.srOnly}>영수증 검색</span><input type="search" placeholder="영수증 키·파일명·마트·상품 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button onClick={() => void load()} disabled={loading}>새로고침</button></div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.emptyState}>영수증 기록을 불러오는 중입니다.</p> : visibleRecords.length === 0 ? <p className={styles.emptyState}>조건에 맞는 영수증 기록이 없습니다.</p> : <div className={styles.receiptList}>{visibleRecords.map((record) => <details key={`${record.source}:${record.id}`}><summary><span><b>{record.storeLabel}</b><small><em className={`${styles.receiptSource} ${record.source === "database" ? styles.databaseSource : record.source === "public" ? styles.publicSource : styles.localSource}`}>{record.source === "database" ? "원격 DB" : record.source === "public" ? "공개 JSON" : "로컬 영수증"}</em>{record.publicReceiptFileName ? <>영수증 키 {record.id} · 파일 {record.publicReceiptFileName} · </> : null}{record.purchasedAt} · {record.transactionNumber ? `거래번호 ${record.transactionNumber} · ` : ""}{record.items.length}개 품목</small></span><strong>{formatKrw(record.totalPriceKrw)}</strong></summary><div className={styles.adminReceiptItems}>{record.items.map((item) => <p key={item.id}><span>{item.productName} <small>({item.sourceProductCode})</small></span><b>{item.quantity}개 × {formatKrw(item.unitPriceKrw)} = {formatKrw(item.totalPriceKrw)}</b></p>)}</div></details>)}</div>}
  </section>;
}
