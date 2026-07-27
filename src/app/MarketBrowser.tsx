"use client";

import { useEffect, useMemo, useState } from "react";
import { groupProductObservations, type ProductGroup, type ProductObservationListing } from "@/domain/product-browser";
import { sellerPricePointsFromGroup, summarizeSellerPrices, type SellerPriceSummary } from "@/domain/seller-price-insights";
import type { Receipt } from "@/domain/types";
import { formatKrw } from "@/domain/settlement";
import styles from "./page.module.css";

type Market = {
  id: string | null;
  name: string;
  businessKind: string | null;
  merchantId: string | null;
  businessRegistrationNumber: string | null;
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
  onOpenTrend: (group: ProductGroup) => void;
};

type MarketProductInsight = {
  group: ProductGroup;
  summary: SellerPriceSummary;
};

export function MarketBrowser({ receipts, observations, selectedStore, onSelectStore, onOpenTrend }: MarketBrowserProps) {
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
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
        id: storeReceipts.find((receipt) => receipt.storeId)?.storeId ?? null,
        name,
        businessKind: storeReceipts.find((receipt) => receipt.storeBusinessKind)?.storeBusinessKind ?? null,
        merchantId: storeReceipts.find((receipt) => receipt.storeMerchantId)?.storeMerchantId ?? null,
        businessRegistrationNumber: storeReceipts.find((receipt) => receipt.storeBusinessRegistrationNumber)?.storeBusinessRegistrationNumber ?? null,
        address: storeReceipts.find((receipt) => receipt.storeAddress)?.storeAddress ?? null,
        phone: storeReceipts.find((receipt) => receipt.storePhone)?.storePhone ?? null,
        receipts: storeReceipts,
        observations: observationsByStore.get(name) ?? [],
      };
    }).sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
  }, [observations, receipts]);

  useEffect(() => {
    setQuery("");
    setChangedOnly(false);
  }, [selectedStore]);

  const market = markets.find((entry) => entry.name === selectedStore) ?? null;

  if (!market) {
    return <section className={styles.browser}>
      <div className={styles.browserHead}>
        <div>
          <p className={styles.kicker}>MARKETS</p>
          <h1>판매처 기록</h1>
          <p>검증된 공개 영수증을 기준으로 판매처 정보, 영수증 기록, 상품 가격 이력을 함께 확인합니다.</p>
        </div>
      </div>
      <div className={styles.marketList}>
        {markets.map((entry) => {
          const groups = groupProductObservations(entry.observations);
          const trackedCount = groups.filter((group) => summarizeSellerPrices(sellerPricePointsFromGroup(group))[0]?.snapshotCount > 1).length;
          const verifiedPublic = entry.receipts.some((receipt) => receipt.source === "public");
          const latestObservedAt = entry.observations.reduce((latest, observation) => observation.observedAt > latest ? observation.observedAt : latest, "");
          return <button key={entry.name} className={styles.marketCard} onClick={() => onSelectStore(entry.name)}>
            <span className={styles.marketCardEyebrow}>{verifiedPublic ? "검증 공개 영수증" : "로컬 영수증"}</span>
            <strong>{entry.name}</strong>
            <small>영수증 {entry.receipts.length}건 · 상품 {groups.length}개 · 변동 추적 {trackedCount}개</small>
            <span>{entry.address ?? "주소 정보 없음"}</span>
            <span>최근 관측 {latestObservedAt || "정보 없음"} · {entry.phone ?? "연락처 정보 없음"}</span>
          </button>;
        })}
      </div>
    </section>;
  }

  const observationOnly = market.receipts.length === 0;
  const verifiedPublic = market.receipts.some((receipt) => receipt.source === "public");
  const receiptHistory = [...market.receipts].sort((left, right) => right.purchasedAt.localeCompare(left.purchasedAt));
  const marketObservations = [...market.observations].sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.item.productName.localeCompare(right.item.productName, "ko-KR"));
  const productInsights = groupProductObservations(market.observations)
    .map((group): MarketProductInsight | null => {
      const summary = summarizeSellerPrices(sellerPricePointsFromGroup(group))[0];
      return summary ? { group, summary } : null;
    })
    .filter((entry): entry is MarketProductInsight => entry !== null)
    .sort((left, right) =>
      Number(right.summary.changeKrw !== null) - Number(left.summary.changeKrw !== null)
      || right.summary.latestObservedAt.localeCompare(left.summary.latestObservedAt)
      || left.group.productName.localeCompare(right.group.productName, "ko-KR"));
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  const visibleInsights = productInsights.filter(({ group, summary }) =>
    (!changedOnly || summary.snapshotCount > 1)
    && (!normalizedQuery || `${group.productName} ${group.sourceProductCode}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery)));
  const trackedCount = productInsights.filter(({ summary }) => summary.snapshotCount > 1).length;
  const changedCount = productInsights.filter(({ summary }) => summary.changeKrw !== null && summary.changeKrw !== 0).length;
  const latestObservedAt = marketObservations[0]?.observedAt ?? null;

  return <section className={styles.browser}>
    <div className={styles.browserHead}>
      <div>
        <p className={styles.kicker}>MARKET PRICE HISTORY</p>
        <h1>{market.name}</h1>
        <p>{verifiedPublic ? "검증된 공개 영수증과 연결된 판매처 정보 및 상품 가격 기록입니다." : "같은 판매처의 영수증 기록을 날짜별로 유지하고 상품 가격 변화를 계산합니다."}</p>
      </div>
      <button className={styles.outlineButton} onClick={() => onSelectStore(null)}>판매처 목록</button>
    </div>

    <section className={styles.marketInsightStats} aria-label="판매처 가격 기록 요약">
      <div><span>기록 상품</span><strong>{productInsights.length}개</strong></div>
      <div><span>2회 이상 추적</span><strong>{trackedCount}개</strong></div>
      <div><span>직전 대비 변동</span><strong>{changedCount}개</strong></div>
      <div><span>최근 관측</span><strong>{latestObservedAt ?? "-"}</strong></div>
    </section>

    <section className={styles.marketInfo}>
      <strong>{verifiedPublic ? "검증 공개 판매처" : "판매처"}: {market.name}</strong>
      <span>마트 주소: {market.address ?? "정보 없음"}</span>
      <span>마트 연락처: {market.phone ?? "정보 없음"}</span>
      <span>사업자등록번호: {market.businessRegistrationNumber ?? "정보 없음"}</span>
      <span>업종: {formatBusinessKind(market.businessKind)}</span>
      <span>공개 판매처 ID: {market.id ?? "정보 없음"}</span>
      {market.merchantId && <span>판매처 표기 ID: {market.merchantId}</span>}
      <small>표시 가격은 영수증·공개 기록의 관측가이며 실시간 판매가는 아닙니다.</small>
    </section>

    {observationOnly ? <section className={styles.marketReceiptHistory} aria-labelledby="market-observation-history-title">
      <h2 id="market-observation-history-title">공개 관측 요약</h2>
      <div>
        {[...new Set(marketObservations.map((observation) => observation.observedAt))].map((month) => {
          const monthly = marketObservations.filter((observation) => observation.observedAt === month);
          return <article key={month}>
            <span><strong>{month}</strong><small>{monthly.length}건 관측</small></span>
            <b>{groupProductObservations(monthly).length}개 상품</b>
          </article>;
        })}
      </div>
    </section> : <section className={styles.marketReceiptHistory} aria-labelledby="market-receipt-history-title">
      <h2 id="market-receipt-history-title">영수증 기록</h2>
      <div>
        {receiptHistory.map((receipt) => <article key={receipt.id}>
          <span><strong>{receipt.purchasedAt}</strong><small>공개 ID {receipt.id} · {receipt.items.length}개 품목</small></span>
          <b>{formatKrw(receipt.totalPriceKrw)}</b>
        </article>)}
      </div>
    </section>}

    <section className={styles.marketProductHistory} aria-labelledby="market-product-history-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>PRODUCT CHANGES</p><h2 id="market-product-history-title">상품별 가격 변동</h2></div>
        <small>같은 판매처·상품 코드·상품명 기준</small>
      </div>
      <div className={styles.marketHistoryControls}>
        <label className={styles.search}><span aria-hidden="true">⌕</span><span className={styles.srOnly}>판매처 상품 검색</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명 또는 상품 코드 검색" /></label>
        <button type="button" className={changedOnly ? styles.filterToggleActive : ""} aria-pressed={changedOnly} onClick={() => setChangedOnly((current) => !current)}>2회 이상 추적만</button>
      </div>
      <p className={styles.marketHistoryResult}>상품 {visibleInsights.length}개 · 직전 대비 가격은 동일 판매처의 이전 기록과 비교합니다.</p>
      <div className={styles.marketItemList} aria-live="polite">
        {visibleInsights.map(({ group, summary }) => <article key={group.id}>
          <div>
            <strong>{group.productName}</strong>
            <small>상품 코드 {group.sourceProductCode || "없음"} · 최근 {summary.latestObservedAt} · 관측 {summary.observationCount}건</small>
            <small>{formatConfidenceCoverage(summary.highConfidenceRatio)} · 범위 {formatKrw(summary.minimumPriceKrw)}~{formatKrw(summary.maximumPriceKrw)}</small>
          </div>
          <div className={styles.marketPriceChange}>
            <b>{formatKrw(summary.latestPriceKrw)}</b>
            <em className={summary.changeKrw === null || summary.changeKrw === 0 ? styles.noChange : summary.changeKrw > 0 ? styles.priceUp : styles.priceDown}>{formatMarketChange(summary)}</em>
          </div>
          <button type="button" className={styles.marketTrendButton} onClick={() => onOpenTrend(group)} aria-label={`${group.productName} 가격 변동 이력 보기`}>이력 보기</button>
        </article>)}
        {visibleInsights.length === 0 && <div className={styles.marketHistoryEmpty}>조건에 맞는 상품 기록이 없습니다.</div>}
      </div>
    </section>
  </section>;
}

function formatMarketChange(summary: SellerPriceSummary) {
  if (summary.changeKrw === null) return "첫 관측";
  if (summary.changeKrw === 0) return "직전과 동일";
  const sign = summary.changeKrw > 0 ? "+" : "";
  return `직전 대비 ${sign}${formatKrw(summary.changeKrw)} (${sign}${summary.changePercent?.toFixed(1) ?? "0.0"}%)`;
}

function formatConfidenceCoverage(ratio: number | null) {
  return ratio === null ? "신뢰도 미분류" : `고신뢰 관측 ${Math.round(ratio * 100)}%`;
}

function formatBusinessKind(value: string | null) {
  const labels: Record<string, string> = {
    retail: "소매",
    food_service: "음식점",
    transport: "교통",
    accommodation: "숙박",
    healthcare: "의료",
    professional_service: "전문 서비스",
    utility: "공공요금",
    government: "정부·공공기관",
    financial: "금융",
    marketplace: "마켓플레이스",
    other: "기타",
    unknown: "정보 없음",
  };
  return labels[value ?? "unknown"] ?? value ?? "정보 없음";
}
