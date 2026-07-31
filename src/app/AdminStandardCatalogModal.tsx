"use client";

import { useEffect, useState } from "react";
import { parseOptionalCoupangBundle, parseRequiredCoupangPrice, type ResolvedCoupangPrice } from "@/domain/coupang-price";
import { formatKrw } from "@/domain/settlement";
import styles from "./page.module.css";

export type AdminCatalogVariant = {
  id: string;
  canonicalName: string;
  specLabel: string;
  isPlaceholder: boolean;
  contentAmount: number | null;
  contentUnit: "g" | "ml" | "each" | null;
  listingReferenceUrl: string | null;
};
export type AdminCoupangPrice = ResolvedCoupangPrice;

export function AdminStandardCatalogModal({ name, variants, coupangPrices, onClose, onSubmitCoupangPrice }: {
  name: string;
  variants: AdminCatalogVariant[];
  coupangPrices: ReadonlyMap<string, AdminCoupangPrice>;
  onClose: () => void;
  onSubmitCoupangPrice: (catalogProductId: string, productUrl: string, listedPriceKrw: number, quantity: number, contentAmount: number, contentUnit: "g" | "ml" | "each", maxBundleQuantity: number | null, maxBundleListedPriceKrw: number | null) => Promise<{ ok: boolean; message: string }>;
}) {
  const [catalogProductId, setCatalogProductId] = useState(variants[0]?.id ?? "");
  const [productUrl, setProductUrl] = useState("");
  const [listedPriceKrw, setListedPriceKrw] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [contentAmount, setContentAmount] = useState("");
  const [contentUnit, setContentUnit] = useState<"g" | "ml" | "each">("g");
  const [maxBundleQuantity, setMaxBundleQuantity] = useState("");
  const [maxBundleListedPriceKrw, setMaxBundleListedPriceKrw] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedVariant = variants.find((variant) => variant.id === catalogProductId) ?? null;
  const coupangPrice = catalogProductId ? coupangPrices.get(catalogProductId) ?? null : null;

  useEffect(() => {
    if (!variants.some((variant) => variant.id === catalogProductId)) {
      setCatalogProductId(variants[0]?.id ?? "");
    }
  }, [catalogProductId, variants]);

  useEffect(() => {
    if (!coupangPrice) {
      setProductUrl("");
      setListedPriceKrw("");
      setQuantity("1");
      setContentAmount(selectedVariant?.contentAmount === null || selectedVariant?.contentAmount === undefined ? "" : String(selectedVariant.contentAmount));
      setContentUnit(selectedVariant?.contentUnit ?? "g");
      setMaxBundleQuantity("");
      setMaxBundleListedPriceKrw("");
      return;
    }
    setProductUrl(coupangPrice.productUrl);
    setListedPriceKrw(String(coupangPrice.requiredOffer.listedPriceKrw));
    setQuantity(String(coupangPrice.requiredOffer.quantity));
    setContentAmount(coupangPrice.contentAmount === null ? "" : String(coupangPrice.contentAmount));
    if (coupangPrice.contentUnit) setContentUnit(coupangPrice.contentUnit);
    setMaxBundleQuantity(coupangPrice.maxBundleQuantity === null ? "" : String(coupangPrice.maxBundleQuantity));
    setMaxBundleListedPriceKrw(coupangPrice.maxBundleListedPriceKrw === null ? "" : String(coupangPrice.maxBundleListedPriceKrw));
  }, [coupangPrice, selectedVariant]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", close); };
  }, [onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!catalogProductId) { setMessage("쿠팡가를 연결할 판매 규격을 선택하세요."); return; }
    const amount = Number(contentAmount);
    if (!/^https?:\/\//.test(productUrl) || !Number.isFinite(amount) || amount <= 0) { setMessage("쿠팡 링크와 개당 내용량을 올바르게 입력하세요."); return; }
    const requiredPrice = parseRequiredCoupangPrice(listedPriceKrw, quantity);
    if (!requiredPrice.value) { setMessage(requiredPrice.error); return; }
    const bundle = parseOptionalCoupangBundle(maxBundleQuantity, maxBundleListedPriceKrw);
    if (!bundle.value) { setMessage(bundle.error); return; }
    setSaving(true);
    const result = await onSubmitCoupangPrice(catalogProductId, productUrl.trim(), requiredPrice.value.listedPriceKrw, requiredPrice.value.quantity, amount, contentUnit, bundle.value.maxBundleQuantity, bundle.value.maxBundleListedPriceKrw);
    setSaving(false);
    setMessage(result.message);
  }

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`${styles.authModal} ${styles.trendModal}`} role="dialog" aria-modal="true" aria-labelledby="admin-standard-title">
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label="표준 상품 상세 닫기">×</button>
      <p className={styles.kicker}>STANDARD PRODUCT</p>
      <h2 id="admin-standard-title">{name}</h2>
      <p className={styles.storeInfo}>하위 상품 {variants.length}개</p>
      <div className={styles.coupangPriceSection}>
        <label>쿠팡가 연결 규격<select value={catalogProductId} onChange={(event) => { setCatalogProductId(event.target.value); setMessage(""); }} required><option value="">판매 규격을 선택하세요</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.canonicalName} · {variant.specLabel}</option>)}</select></label>
        {coupangPrice ? <><span>현재 쿠팡가</span>{coupangPrice.requiredOffer.referenceLabel && coupangPrice.requiredOffer.unitPriceKrw !== null ? <strong>필수 판매 · {coupangPrice.requiredOffer.referenceLabel} {formatKrw(coupangPrice.requiredOffer.unitPriceKrw)}</strong> : <strong>필수 판매 기준 용량 미입력</strong>}<small>{coupangPrice.requiredOffer.quantity}개 총 {formatKrw(coupangPrice.requiredOffer.listedPriceKrw)} · 개당 {formatKrw(coupangPrice.requiredOffer.pricePerItemKrw)}{coupangPrice.contentAmount !== null && coupangPrice.contentUnit !== null ? ` · 개당 ${coupangPrice.contentAmount}${coupangPrice.contentUnit === "each" ? "개" : coupangPrice.contentUnit}` : ""}</small>{coupangPrice.maxBundleOffer && <small>최대 {coupangPrice.maxBundleOffer.quantity}개 · 총 {formatKrw(coupangPrice.maxBundleOffer.listedPriceKrw)} · 개당 {formatKrw(coupangPrice.maxBundleOffer.pricePerItemKrw)}</small>}<a href={coupangPrice.productUrl} target="_blank" rel="noreferrer">쿠팡에서 보기</a></> : <><span>현재 쿠팡가</span><small>아직 등록된 쿠팡 가격이 없습니다.</small></>}
        <p className={styles.muted}>선택한 판매 규격에만 쿠팡 가격을 연결합니다. 최대 묶음 가격은 선택 사항입니다.</p>
        <form className={styles.inline} onSubmit={submit}>
          <label>쿠팡 링크<input type="url" required placeholder="https://" value={productUrl} onChange={(event) => setProductUrl(event.target.value)} /></label>
          <label>필수 판매 가격<input inputMode="numeric" required value={listedPriceKrw} onChange={(event) => setListedPriceKrw(event.target.value)} /></label>
          <label>필수 판매 개수<input type="number" min="1" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          <label>개당 내용량<input inputMode="decimal" required placeholder="예: 210" value={contentAmount} onChange={(event) => setContentAmount(event.target.value)} /></label>
          <label>내용 단위<select value={contentUnit} onChange={(event) => setContentUnit(event.target.value as "g" | "ml" | "each")}><option value="g">g</option><option value="ml">ml</option><option value="each">개</option></select></label>
          <fieldset className={styles.coupangBundleFields}><legend>최대 묶음 가격 (선택)</legend><p>기존 값이 자동 입력됩니다. 현재 묶음 구매가 불가능하면 두 값을 모두 비우세요.</p><div><label>최대 묶음 개수<input type="number" min="2" step="1" placeholder="예: 20" value={maxBundleQuantity} onChange={(event) => setMaxBundleQuantity(event.target.value)} /></label><label>묶음 총가격<input inputMode="numeric" placeholder="예: 21250" value={maxBundleListedPriceKrw} onChange={(event) => setMaxBundleListedPriceKrw(event.target.value)} /></label></div></fieldset>
          <button type="submit" disabled={saving}>쿠팡가 등록</button>
        </form>
        {message && <p role="status" className={styles.muted}>{message}</p>}
      </div>
      <div className={styles.standardDetailList}>{variants.map((variant) => <div className={styles.standardDetailRow} key={variant.id}>
        <div><strong>{variant.canonicalName}</strong><small>{variant.specLabel}</small>{variant.isPlaceholder && <span className={styles.specificationBadge}>단위가격 계산 제외</span>}</div>
        <span />
        {variant.listingReferenceUrl ? <a className={styles.standardDetailButton} href={variant.listingReferenceUrl} target="_blank" rel="noreferrer" aria-label={`${variant.canonicalName} 확인 URL`}>↗</a> : <span />}
      </div>)}</div>
    </section>
  </div>;
}
