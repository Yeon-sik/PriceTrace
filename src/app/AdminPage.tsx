"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OfficialProductCandidate } from "@/domain/official-product";
import { formatKrw } from "@/domain/settlement";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminReceiptRepository, localReceiptsToAdminRecords, type AdminReceiptRecord } from "@/repositories/admin-receipt.repository";
import { JsonReceiptRepository } from "@/repositories/json-receipt.repository";
import { AdminQualityPanel } from "./AdminQualityPanel";
import { OfficialProductModal, OfficialProductWorkspace } from "./OfficialProductPanel";
import styles from "./page.module.css";

type AdminTab = "receipts" | "catalog" | "quality";
const localReceiptRecords = localReceiptsToAdminRecords(new JsonReceiptRepository().loadAll());

export function AdminPage({ candidates }: { candidates: OfficialProductCandidate[] }) {
  const [tab, setTab] = useState<AdminTab>("receipts");
  const [selectedOfficialItem, setSelectedOfficialItem] = useState<OfficialProductCandidate | null>(null);
  const [officialRevision, setOfficialRevision] = useState(0);
  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>ADMINISTRATION</p><h1>관리자</h1><p>영수증 기록, 상품 연결, 품질 검토를 분리해 관리합니다.</p></div></div>
    <div className={styles.adminTabs} role="tablist" aria-label="관리자 기능">
      <button role="tab" aria-selected={tab === "receipts"} onClick={() => setTab("receipts")}>영수증 기록</button>
      <button role="tab" aria-selected={tab === "catalog"} onClick={() => setTab("catalog")}>공식 상품 연결</button>
      <button role="tab" aria-selected={tab === "quality"} onClick={() => setTab("quality")}>품질 검토</button>
    </div>
    {tab === "receipts" && <AdminReceiptHistory />}
    {tab === "catalog" && <OfficialProductWorkspace candidates={candidates} onSelect={setSelectedOfficialItem} revision={officialRevision} />}
    {tab === "quality" && <AdminQualityPanel />}
    {selectedOfficialItem && <OfficialProductModal candidate={selectedOfficialItem} onClose={() => setSelectedOfficialItem(null)} onSaved={() => setOfficialRevision((revision) => revision + 1)} />}
  </section>;
}

function AdminReceiptHistory() {
  const client = getSupabaseBrowserClient();
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
  const records = useMemo(() => [...databaseRecords, ...localReceiptRecords].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt)), [databaseRecords]);
  const visibleRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records;
    return records.filter((record) => `${record.storeLabel} ${record.transactionNumber} ${record.purchasedAt} ${record.items.map((item) => item.productName).join(" ")}`.toLowerCase().includes(normalized));
  }, [query, records]);

  return <section className={styles.adminReceipts} aria-labelledby="admin-receipts-title">
    <div className={styles.adminSectionHead}><div><h2 id="admin-receipts-title">영수증 기록</h2><p>원격 DB 저장 기록 {databaseRecords.length}건 · 앱에 포함된 로컬 샘플 {localReceiptRecords.length}건을 구분해 최신 구매일 순으로 확인합니다.</p></div><div className={styles.adminReceiptTools}><label><span className={styles.srOnly}>영수증 검색</span><input type="search" placeholder="마트·거래번호·상품 검색" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button onClick={() => void load()} disabled={loading}>새로고침</button></div></div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.emptyState}>영수증 기록을 불러오는 중입니다.</p> : visibleRecords.length === 0 ? <p className={styles.emptyState}>조건에 맞는 영수증 기록이 없습니다.</p> : <div className={styles.receiptList}>{visibleRecords.map((record) => <details key={`${record.source}:${record.id}`}><summary><span><b>{record.storeLabel}</b><small><em className={`${styles.receiptSource} ${record.source === "database" ? styles.databaseSource : styles.localSource}`}>{record.source === "database" ? "원격 DB" : "로컬 샘플"}</em>{record.purchasedAt} · 거래번호 {record.transactionNumber} · {record.items.length}개 품목</small></span><strong>{formatKrw(record.totalPriceKrw)}</strong></summary><div className={styles.adminReceiptItems}>{record.items.map((item) => <p key={item.id}><span>{item.productName} <small>({item.sourceProductCode})</small></span><b>{item.quantity}개 × {formatKrw(item.unitPriceKrw)} = {formatKrw(item.totalPriceKrw)}</b></p>)}</div></details>)}</div>}
  </section>;
}
