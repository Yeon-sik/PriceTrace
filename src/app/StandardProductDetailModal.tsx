"use client";

import { useEffect, useMemo, useState } from "react";
import { summarizeSellerPrices } from "@/domain/seller-price-insights";
import { formatKrw } from "@/domain/settlement";
import { PriceTrendModal } from "./PriceTrendModal";
import { CoupangComparisonMessage } from "./CoupangComparisonMessage";
import type { StandardProductGroup, StandardProductItem } from "./ProductBrowser";
import styles from "./page.module.css";

export function StandardProductDetailModal({ standard, onClose, onOpenStore }: { standard: StandardProductGroup; onClose: () => void; onOpenStore: (store: string) => void }) {
  const [trendItem, setTrendItem] = useState<StandardProductItem | null>(null);
  const sellerOffers = useMemo(() => summarizeSellerPrices(standard.items.map((item) => ({
    sellerKey: item.sellerKey,
    sellerLabel: item.storeLabel,
    observedAt: item.latest.observedAt,
    priceKrw: item.unitPriceKrw,
    confidence: item.latest.item.confidence,
    source: item.latest.source ?? "receipt",
  }))), [standard.items]);
  const lowestItem = useMemo(() => [...standard.items].sort((left, right) => left.unitPriceKrw - right.unitPriceKrw || right.latest.observedAt.localeCompare(left.latest.observedAt))[0] ?? null, [standard.items]);

  useEffect(() => {
    if (trendItem) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", close); };
  }, [onClose, trendItem]);

  if (trendItem) return <PriceTrendModal group={trendItem} onClose={onClose} onBack={() => setTrendItem(null)} onOpenStore={onOpenStore} />;

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`${styles.authModal} ${styles.trendModal}`} role="dialog" aria-modal="true" aria-labelledby="standard-detail-title">
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label="표준 상품 상세 닫기">×</button>
      <h2 id="standard-detail-title">{standard.name}</h2>
      <p className={styles.storeInfo}>판매처 {standard.sellerCount}곳 · 하위 상품 {standard.items.length}개</p>
      <div className={styles.coupangPriceSection}>{standard.coupangPrice
        ? <><span>쿠팡 가격 비교</span><div className={styles.coupangOfferGrid}>
          <article><small>필수 판매 가격 · {standard.coupangPrice.requiredOffer.quantity}개</small><strong>총 {formatKrw(standard.coupangPrice.requiredOffer.listedPriceKrw)}</strong><b>개당 {formatKrw(standard.coupangPrice.requiredOffer.pricePerItemKrw)}</b>{standard.coupangPrice.requiredOffer.unitPriceKrw !== null && standard.coupangPrice.requiredOffer.referenceLabel ? <em>{standard.coupangPrice.requiredOffer.referenceLabel} {formatKrw(standard.coupangPrice.requiredOffer.unitPriceKrw)}</em> : <em>기준 용량 미입력</em>}</article>
          {standard.coupangPrice.maxBundleOffer
            ? <article><small>최대 묶음 · {standard.coupangPrice.maxBundleOffer.quantity}개</small><strong>총 {formatKrw(standard.coupangPrice.maxBundleOffer.listedPriceKrw)}</strong><b>개당 {formatKrw(standard.coupangPrice.maxBundleOffer.pricePerItemKrw)}</b>{standard.coupangPrice.maxBundleOffer.unitPriceKrw !== null && standard.coupangPrice.maxBundleOffer.referenceLabel && <em>{standard.coupangPrice.maxBundleOffer.referenceLabel} {formatKrw(standard.coupangPrice.maxBundleOffer.unitPriceKrw)}</em>}</article>
            : <article><small>최대 묶음</small><b>등록된 묶음 가격이 없습니다.</b></article>}
        </div>{standard.coupangPrice.maxBundleOffer && standard.coupangPrice.bundleSavingsKrw !== null && <p className={standard.coupangPrice.bundleSavingsKrw > 0 ? styles.bundleSavings : standard.coupangPrice.bundleSavingsKrw < 0 ? styles.bundleLoss : styles.bundleSame}>{standard.coupangPrice.bundleSavingsKrw > 0 ? `필수 판매 가격 기준 ${standard.coupangPrice.maxBundleOffer.quantity}개 환산액보다 ${formatKrw(standard.coupangPrice.bundleSavingsKrw)} 절약` : standard.coupangPrice.bundleSavingsKrw < 0 ? `필수 판매 가격 기준 ${standard.coupangPrice.maxBundleOffer.quantity}개 환산액보다 ${formatKrw(Math.abs(standard.coupangPrice.bundleSavingsKrw))} 더 비싸요` : `필수 판매 가격 기준 ${standard.coupangPrice.maxBundleOffer.quantity}개 환산액과 총가격이 같아요`}{standard.coupangPrice.bundleUnitSavingsKrw !== null && standard.coupangPrice.bundleUnitSavingsKrw > 0 && standard.coupangPrice.requiredOffer.referenceLabel ? ` · ${standard.coupangPrice.requiredOffer.referenceLabel} ${formatKrw(standard.coupangPrice.bundleUnitSavingsKrw)} 절약` : ""}</p>}<small>{standard.coupangPrice.contentAmount !== null && standard.coupangPrice.contentUnit !== null ? `개당 ${standard.coupangPrice.contentAmount}${standard.coupangPrice.contentUnit === "each" ? "개" : standard.coupangPrice.contentUnit} · ` : ""}{standard.coupangPrice.observedAt.slice(0, 10)} 관측</small><a href={standard.coupangPrice.productUrl} target="_blank" rel="noreferrer">쿠팡에서 보기</a></>
        : <><span>쿠팡가</span><small>아직 등록된 쿠팡 가격이 없습니다.</small></>}
        {standard.coupangComparison && <CoupangComparisonMessage unitPriceLabel={standard.unitPriceLabel} comparison={standard.coupangComparison} />}
        {standard.coupangPrice && (!standard.coupangPrice.requiredOffer.referenceLabel || standard.coupangPrice.requiredOffer.referenceLabel !== standard.unitPriceLabel) && <p className={styles.comparisonCaution}>판매처와 쿠팡 필수 판매 가격의 기준 단위가 같을 때만 자동 우열 비교합니다.</p>}
      </div>
      {sellerOffers.length > 0 && <section className={styles.standardSellerComparison} aria-labelledby="standard-seller-comparison-title">
        <div className={styles.sectionHeading}>
          <div><h3 id="standard-seller-comparison-title">판매처별 최근 단위가격</h3></div>
        </div>
        <div className={styles.cheapestSellerCallout}>
          <span>기록상 최저 판매처</span>
          <strong>{sellerOffers[0].sellerLabel}</strong>
          <b>{standard.unitPriceLabel} {formatKrw(sellerOffers[0].latestPriceKrw)}</b>
          {lowestItem && <small>판매가 {formatKrw(lowestItem.latestPriceKrw)} · {lowestItem.packageLabel}</small>}
          <small>{sellerOffers[0].latestObservedAt} 관측</small>
        </div>
      </section>}
      <div className={styles.standardDetailList}>{standard.items.map((item) => <div className={styles.standardDetailRow} key={item.id}>
        <div><strong>{item.officialProduct?.officialName ?? item.productName}</strong><small>{item.storeLabel} · {item.packageLabel} · {item.unitPriceLabel} {formatKrw(item.unitPriceKrw)}</small></div>
        <strong className={styles.standardDetailPrice}>{formatKrw(item.latestPriceKrw)}</strong>
        <button type="button" className={styles.standardDetailButton} aria-label={`${item.productName} 가격 이력 보기`} onClick={() => setTrendItem(item)}>›</button>
      </div>)}</div>
      {standard.priceHistory.length > 0 && <div className={styles.priceHistorySection}>
        <h3>시기별 기록상 최저 단위가</h3>
        <div className={styles.priceHistoryList}>{standard.priceHistory.map((point) => <div key={point.date}><span>{point.date}</span><div className={styles.priceHistoryPrices}><strong>{point.unitPriceLabel} {formatKrw(point.unitPriceKrw)}</strong><small>실제 가격 {formatKrw(point.actualPriceKrw)}</small></div><small>{point.storeLabel}</small></div>)}</div>
      </div>}
    </section>
  </div>;
}
