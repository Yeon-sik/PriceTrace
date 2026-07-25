"use client";

import { useEffect, useState } from "react";
import { formatKrw } from "@/domain/settlement";
import styles from "./page.module.css";

export type AdminCatalogVariant = { id: string; canonicalName: string; specLabel: string; listingReferenceUrl: string | null };
export type AdminCoupangPrice = { unitPriceKrw: number; listedPriceKrw: number; quantity: number; productUrl: string };

export function AdminStandardCatalogModal({ name, variants, coupangPrice, onClose, onSubmitCoupangPrice }: {
  name: string;
  variants: AdminCatalogVariant[];
  coupangPrice: AdminCoupangPrice | null;
  onClose: () => void;
  onSubmitCoupangPrice: (productUrl: string, listedPriceKrw: number, quantity: number) => Promise<{ ok: boolean; message: string }>;
}) {
  const [productUrl, setProductUrl] = useState("");
  const [listedPriceKrw, setListedPriceKrw] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", close); };
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const price = Number(listedPriceKrw);
    const count = Number(quantity);
    if (!/^https?:\/\//.test(productUrl) || !Number.isInteger(price) || price < 0 || !Number.isInteger(count) || count < 1) { setMessage("쿠팡 링크, 판매 가격, 판매 개수를 올바르게 입력하세요."); return; }
    setSaving(true);
    const result = await onSubmitCoupangPrice(productUrl.trim(), price, count);
    setSaving(false);
    setMessage(result.message);
    if (result.ok) { setProductUrl(""); setListedPriceKrw(""); setQuantity("1"); }
  }

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`${styles.authModal} ${styles.trendModal}`} role="dialog" aria-modal="true" aria-labelledby="admin-standard-title">
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label="표준 상품 상세 닫기">×</button>
      <p className={styles.kicker}>STANDARD PRODUCT</p>
      <h2 id="admin-standard-title">{name}</h2>
      <p className={styles.storeInfo}>하위 상품 {variants.length}개</p>
      <div className={styles.coupangPriceSection}>
        {coupangPrice ? <><span>현재 쿠팡가</span><strong>개당 {formatKrw(coupangPrice.unitPriceKrw)}</strong><small>{formatKrw(coupangPrice.listedPriceKrw)} · {coupangPrice.quantity}개</small><a href={coupangPrice.productUrl} target="_blank" rel="noreferrer">쿠팡에서 보기</a></> : <><span>현재 쿠팡가</span><small>아직 등록된 쿠팡 가격이 없습니다.</small></>}
        <p className={styles.muted}>쿠팡가는 특정 하위 상품(규격)이 아니라 이 표준 상품 전체를 대표하는 가격입니다.</p>
        <form className={styles.inline} onSubmit={submit}>
          <label>쿠팡 링크<input type="url" required placeholder="https://" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} /></label>
          <label>판매 가격<input inputMode="numeric" required value={listedPriceKrw} onChange={(event) => setListedPriceKrw(event.target.value)} /></label>
          <label>판매 개수<input type="number" min="1" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          <button type="submit" disabled={saving}>쿠팡가 등록</button>
        </form>
        {message && <p role="status" className={styles.muted}>{message}</p>}
      </div>
      <div className={styles.standardDetailList}>{variants.map((variant) => <div className={styles.standardDetailRow} key={variant.id}>
        <div><strong>{variant.canonicalName}</strong><small>{variant.specLabel}</small></div>
        <span />
        {variant.listingReferenceUrl ? <a className={styles.standardDetailButton} href={variant.listingReferenceUrl} target="_blank" rel="noreferrer" aria-label={`${variant.canonicalName} 확인 URL`}>↗</a> : <span />}
      </div>)}</div>
    </section>
  </div>;
}
