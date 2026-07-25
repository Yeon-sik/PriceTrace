"use client";

import { useMemo } from "react";
import type { ProductObservationListing } from "@/domain/product-browser";
import type { Receipt } from "@/domain/types";
import { formatKrw } from "@/domain/settlement";
import styles from "./page.module.css";

type Market = {
  name: string;
  address: string | null;
  phone: string | null;
  receipts: Receipt[];
  observations: ProductObservationListing[];
};

type MarketBrowserProps = {
  receipts: Receipt[];
  observations: ProductObservationListing[];
  selectedStore: string | null;
  onSelectStore: (store: string | null) => void;
};

export function MarketBrowser({ receipts, observations, selectedStore, onSelectStore }: MarketBrowserProps) {
  const markets = useMemo(() => {
    const receiptsByStore = new Map<string, Receipt[]>();
    const observationsByStore = new Map<string, ProductObservationListing[]>();

    for (const receipt of receipts) {
      receiptsByStore.set(receipt.storeLabel, [...(receiptsByStore.get(receipt.storeLabel) ?? []), receipt]);
    }
    for (const observation of observations) {
      observationsByStore.set(observation.storeLabel, [...(observationsByStore.get(observation.storeLabel) ?? []), observation]);
    }

    const storeNames = new Set([...receiptsByStore.keys(), ...observationsByStore.keys()]);
    return [...storeNames].map((name): Market => {
      const storeReceipts = receiptsByStore.get(name) ?? [];
      return {
        name,
        address: storeReceipts.find((receipt) => receipt.storeAddress)?.storeAddress ?? null,
        phone: storeReceipts.find((receipt) => receipt.storePhone)?.storePhone ?? null,
        receipts: storeReceipts,
        observations: observationsByStore.get(name) ?? [],
      };
    }).sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
  }, [observations, receipts]);

  const market = markets.find((entry) => entry.name === selectedStore) ?? null;

  if (!market) {
    return <section className={styles.browser}>
      <div className={styles.browserHead}>
        <div>
          <p className={styles.kicker}>MARKETS</p>
          <h1>마트 목록</h1>
          <p>공개 환경에서는 비식별 판매 채널별 관측만 표시하고, private 환경에서는 로컬 영수증의 매장 기록을 표시합니다.</p>
        </div>
      </div>
      <div className={styles.marketList}>
        {markets.map((entry) => {
          const products = new Set(entry.observations.map((observation) => `${observation.item.sourceProductCode}:${observation.item.productName}`));
          const publicOnly = entry.receipts.length === 0;
          return <button key={entry.name} className={styles.marketCard} onClick={() => onSelectStore(entry.name)}>
            <strong>{entry.name}</strong>
            <small>{publicOnly ? `관측 ${entry.observations.length}건` : `영수증 ${entry.receipts.length}건`} · 상품 {products.size}개</small>
            <span>{publicOnly ? "판매처 상세 비공개" : entry.address ?? "주소 정보 없음"}</span>
            <span>{publicOnly ? "월 단위 공개 데이터" : entry.phone ?? "연락처 정보 없음"}</span>
          </button>;
        })}
      </div>
    </section>;
  }

  const publicOnly = market.receipts.length === 0;
  const receiptHistory = [...market.receipts].sort((left, right) => right.purchasedAt.localeCompare(left.purchasedAt));
  const marketObservations = [...market.observations].sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.item.productName.localeCompare(right.item.productName, "ko-KR"));

  return <section className={styles.browser}>
    <div className={styles.browserHead}>
      <div>
        <p className={styles.kicker}>MARKET PRODUCTS</p>
        <h1>{market.name}</h1>
        <p>{publicOnly ? "개인 구매 내역을 제외한 월 단위 상품 관측 기록입니다." : "같은 마트의 영수증은 날짜별 원본 기록을 유지합니다."}</p>
      </div>
      <button className={styles.outlineButton} onClick={() => onSelectStore(null)}>마트 목록</button>
    </div>

    <section className={styles.marketInfo}>
      <strong>판매 채널: {market.name}</strong>
      <span>{publicOnly ? "매장 상세: 공개 데이터에서 제외" : `마트 주소: ${market.address ?? "정보 없음"}`}</span>
      <span>{publicOnly ? "관측 정밀도: 월" : `마트 연락처: ${market.phone ?? "정보 없음"}`}</span>
    </section>

    {publicOnly ? <section className={styles.marketReceiptHistory} aria-labelledby="market-observation-history-title">
      <h2 id="market-observation-history-title">공개 관측 요약</h2>
      <div>
        {[...new Set(marketObservations.map((observation) => observation.observedAt))].map((month) => {
          const monthly = marketObservations.filter((observation) => observation.observedAt === month);
          return <article key={month}>
            <span><strong>{month}</strong><small>{monthly.length}건 관측</small></span>
            <b>{new Set(monthly.map((observation) => `${observation.item.sourceProductCode}:${observation.item.productName}`)).size}개 상품</b>
          </article>;
        })}
      </div>
    </section> : <section className={styles.marketReceiptHistory} aria-labelledby="market-receipt-history-title">
      <h2 id="market-receipt-history-title">영수증 기록</h2>
      <div>
        {receiptHistory.map((receipt) => <article key={receipt.id}>
          <span><strong>{receipt.purchasedAt}</strong><small>{receipt.items.length}개 품목</small></span>
          <b>{formatKrw(receipt.totalPriceKrw)}</b>
        </article>)}
      </div>
    </section>}

    <div className={styles.marketItemList}>
      {marketObservations.map((observation) => <article key={observation.id}>
        <div>
          <strong>{observation.item.productName}</strong>
          <small>상품 코드 {observation.item.sourceProductCode || "없음"} · {publicOnly ? "관측 월" : "영수증 일자"} {observation.observedAt}</small>
        </div>
        <b>{formatKrw(observation.item.unitPriceKrw)}</b>
      </article>)}
    </div>
  </section>;
}
