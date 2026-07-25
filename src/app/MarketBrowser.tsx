"use client";

import { useMemo } from "react";
import type { Receipt } from "@/domain/types";
import { formatKrw } from "@/domain/settlement";
import styles from "./page.module.css";

type Market = { name: string; address: string | null; phone: string | null; receipts: Receipt[] };

export function MarketBrowser({ receipts, selectedStore, onSelectStore }: { receipts: Receipt[]; selectedStore: string | null; onSelectStore: (store: string | null) => void }) {
  const markets = useMemo(() => {
    const grouped = new Map<string, Receipt[]>();
    for (const receipt of receipts) grouped.set(receipt.storeLabel, [...(grouped.get(receipt.storeLabel) ?? []), receipt]);
    return [...grouped.entries()].map(([name, storeReceipts]): Market => ({ name, address: storeReceipts.find((receipt) => receipt.storeAddress)?.storeAddress ?? null, phone: storeReceipts.find((receipt) => receipt.storePhone)?.storePhone ?? null, receipts: storeReceipts })).sort((a, b) => a.name.localeCompare(b.name));
  }, [receipts]);
  const market = markets.find((entry) => entry.name === selectedStore) ?? null;

  if (!market) return <section className={styles.browser}><div className={styles.browserHead}><div><p className={styles.kicker}>MARKETS</p><h1>마트 목록</h1><p>영수증에서 추출된 마트를 선택하면 해당 마트에서 관측된 물품만 확인할 수 있습니다.</p></div></div><div className={styles.marketList}>{markets.map((entry) => <button key={entry.name} className={styles.marketCard} onClick={() => onSelectStore(entry.name)}><strong>{entry.name}</strong><small>영수증 {entry.receipts.length}건 · 물품 {entry.receipts.reduce((sum, receipt) => sum + receipt.items.length, 0)}개</small><span>{entry.address ?? "주소 정보 없음"}</span><span>{entry.phone ?? "연락처 정보 없음"}</span></button>)}</div></section>;
  const items = market.receipts.flatMap((receipt) => receipt.items.map((item) => ({ ...item, purchasedAt: receipt.purchasedAt })));
  const receiptHistory = [...market.receipts].sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  return <section className={styles.browser}><div className={styles.browserHead}><div><p className={styles.kicker}>MARKET PRODUCTS</p><h1>{market.name}</h1><p>같은 마트의 영수증은 한곳에 모으되, 날짜별 영수증 기록은 각각 보존합니다.</p></div><button className={styles.outlineButton} onClick={() => onSelectStore(null)}>마트 목록</button></div><section className={styles.marketInfo}><strong>마트 이름: {market.name}</strong><span>마트 주소: {market.address ?? "정보 없음"}</span><span>마트 연락처: {market.phone ?? "정보 없음"}</span></section><section className={styles.marketReceiptHistory} aria-labelledby="market-receipt-history-title"><h2 id="market-receipt-history-title">영수증 기록</h2><div>{receiptHistory.map((receipt) => <article key={receipt.id}><span><strong>{receipt.purchasedAt}</strong><small>{receipt.items.length}개 품목</small></span><b>{formatKrw(receipt.totalPriceKrw)}</b></article>)}</div></section><div className={styles.marketItemList}>{items.map((item) => <article key={item.id}><div><strong>{item.productName}</strong><small>상품 코드 {item.sourceProductCode} · 영수증 일자 {item.purchasedAt}</small></div><b>{formatKrw(item.unitPriceKrw)}</b></article>)}</div></section>;
}
