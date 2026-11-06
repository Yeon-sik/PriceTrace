"use client";

import { useState } from "react";
import { formatKrw } from "@/domain/settlement";
import {
  setCatalogPurchaseLink,
  useCatalogPurchaseContext,
  type CatalogPurchaseContext,
} from "@/features/product-browser/use-catalog-purchase-context";
import styles from "./page.module.css";

function PurchaseFacts({ row }: { row: CatalogPurchaseContext }) {
  return <div className={styles.purchaseLinkFacts}>
    <strong>{row.product_name}</strong>
    <small>{[
      row.ordered_on && `주문 ${row.ordered_on}`,
      row.paid_on && row.paid_on !== row.ordered_on && `결제 ${row.paid_on}`,
      `구매 채널 ${row.platform_name}`,
      row.seller_name ? `판매처 ${row.seller_name}` : "판매처 확인 대기",
      row.quantity && `수량 ${row.quantity}개`,
      row.option_text,
    ].filter(Boolean).join(" · ")}</small>
    <dl>
      {row.unit_price_krw !== null && <div><dt>품목 표시 단가</dt><dd>{formatKrw(row.unit_price_krw)}</dd></div>}
      {row.item_net_price_krw !== null && <div><dt>품목 결제액</dt><dd>{formatKrw(row.item_net_price_krw)}</dd></div>}
      {row.order_total_krw !== null && <div><dt>주문 결제액</dt><dd>{formatKrw(row.order_total_krw)}</dd></div>}
    </dl>
  </div>;
}

export function CatalogPurchaseConnection({
  catalogProductId, authRevision, onChange,
}: { catalogProductId: string; authRevision: number; onChange: () => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selection, setSelection] = useState<string | null>(null);
  const { result: history, retry: reloadHistory } = useCatalogPurchaseContext([catalogProductId], null, authRevision);
  const { result: search, retry: reloadSearch } = useCatalogPurchaseContext(
    searchOpen ? [catalogProductId] : [], query.trim(), authRevision,
  );

  const update = async (row: CatalogPurchaseContext, connected: boolean) => {
    setBusy(true);
    setMessage("");
    try {
      await setCatalogPurchaseLink(catalogProductId, row.purchase_source_line_id, connected);
      setMessage(connected ? "구매 기록을 연결했습니다." : "구매 연결을 해제했습니다.");
      setSelection(null);
      if (connected) {
        setSearchOpen(false);
        setQuery("");
      } else {
        reloadSearch();
      }
      reloadHistory();
      onChange();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "구매 연결을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <section className={styles.standardPriceRecords} aria-label="내 구매 기록">
    <div className={styles.purchaseLinkHeader}>
      <h3>내 구매 기록</h3>
      {history?.status === "ready" && <button type="button" className={styles.standardDetailButton}
        aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); setSelection(null); }}>정보 연결</button>}
    </div>
    {history?.status === "guest" && <p>로그인하면 이 상품에 연결한 구매 기록과 결제액을 볼 수 있습니다.</p>}
    {history?.status === "error" && <button type="button" className={styles.standardDetailButton} onClick={reloadHistory}>구매 기록 다시 불러오기</button>}
    {history?.status === "ready" && history.rows.length === 0 && <p>정보 연결에서 OCR로 보낸 구매 기록을 선택하세요.</p>}
    {history?.rows.map((row) => <article className={styles.purchaseLinkRow} key={row.purchase_source_line_id}>
      <PurchaseFacts row={row} />
      {row.owner_connected && <button type="button" className={styles.standardDetailButton} disabled={busy}
        onClick={() => void update(row, false)}>연결 해제</button>}
    </article>)}
    {searchOpen && history?.status === "ready" && <div className={styles.purchaseLinkSearch}>
      <label>내 OCR 구매 상품 검색<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelection(null); }} /></label>
      {search?.status === "error" && <button type="button" className={styles.standardDetailButton} onClick={reloadSearch}>구매 상품 다시 검색</button>}
      {search?.status === "ready" && search.rows.length === 0 && <p>연결할 구매 기록이 없습니다.</p>}
      {search?.rows.map((row) => <article className={styles.purchaseLinkRow} key={row.purchase_source_line_id}>
        <PurchaseFacts row={row} />
        {selection === row.purchase_source_line_id
          ? <button type="button" className={styles.standardDetailButton} disabled={busy} onClick={() => void update(row, true)}>이 상품으로 연결 확인</button>
          : <button type="button" className={styles.standardDetailButton} disabled={busy} onClick={() => setSelection(row.purchase_source_line_id)}>연결할 구매 선택</button>}
      </article>)}
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
