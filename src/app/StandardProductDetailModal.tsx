"use client";

import { useEffect, useState } from "react";
import { formatKrw } from "@/domain/settlement";
import { PriceTrendModal } from "./PriceTrendModal";
import type { StandardProductGroup, StandardProductItem } from "./ProductBrowser";
import styles from "./page.module.css";

export function StandardProductDetailModal({ standard, onClose, onOpenStore }: { standard: StandardProductGroup; onClose: () => void; onOpenStore: (store: string) => void }) {
  const [trendItem, setTrendItem] = useState<StandardProductItem | null>(null);

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
      <p className={styles.kicker}>STANDARD PRODUCT</p>
      <h2 id="standard-detail-title">{standard.name}</h2>
      <p className={styles.storeInfo}>판매처 {standard.sellerCount}곳 · 하위 상품 {standard.items.length}개</p>
      <div className={styles.coupangPriceSection}>{standard.coupangPrice
        ? <><span>쿠팡가</span><strong>개당 {formatKrw(standard.coupangPrice.unitPriceKrw)}</strong><small>{formatKrw(standard.coupangPrice.listedPriceKrw)} · {standard.coupangPrice.quantity}개</small><a href={standard.coupangPrice.productUrl} target="_blank" rel="noreferrer">쿠팡에서 보기</a></>
        : <><span>쿠팡가</span><small>아직 등록된 쿠팡 가격이 없습니다.</small></>}
        {standard.cheapestVsCoupang && <p className={styles.cheaperThanCoupang}>쿠팡보다 <b>{standard.cheapestVsCoupang.storeLabel}</b>이(가) <b>{formatKrw(standard.cheapestVsCoupang.differenceKrw)}</b> 더 저렴해요</p>}</div>
      <div className={styles.standardDetailList}>{standard.items.map((item) => <div className={styles.standardDetailRow} key={item.id}>
        <div><strong>{item.officialProduct?.officialName ?? item.productName}</strong><small>{item.storeLabel} · {item.packageLabel} · {item.unitPriceLabel} {formatKrw(item.unitPriceKrw)}</small></div>
        <strong className={styles.standardDetailPrice}>{formatKrw(item.latestPriceKrw)}</strong>
        <button type="button" className={styles.standardDetailButton} aria-label={`${item.productName} 가격 이력 보기`} onClick={() => setTrendItem(item)}>›</button>
      </div>)}</div>
      {standard.priceHistory.length > 0 && <div className={styles.priceHistorySection}>
        <h3>시기별 최저가</h3>
        <div className={styles.priceHistoryList}>{standard.priceHistory.map((point) => <div key={point.date}><span>{point.date}</span><div className={styles.priceHistoryPrices}><strong>{point.unitPriceLabel} {formatKrw(point.unitPriceKrw)}</strong><small>실제 가격 {formatKrw(point.actualPriceKrw)}</small></div><small>{point.storeLabel}</small></div>)}</div>
      </div>}
    </section>
  </div>;
}
