"use client";

import { useEffect } from "react";
import type { ProductGroup } from "@/domain/product-browser";
import styles from "./page.module.css";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [onClose]);
}

export function CartQuantityModal({ group, value, error, onChange, onClose, onConfirm }: { group: ProductGroup; value: string; error: string; onChange: (value: string) => void; onClose: () => void; onConfirm: () => void }) {
  useEscape(onClose);
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.cartModal}`} role="dialog" aria-modal="true" aria-labelledby="cart-quantity-title"><button type="button" className={styles.closeButton} onClick={onClose} aria-label="장바구니 담기 창 닫기">×</button><p className={styles.kicker}>ADD TO CART</p><h2 id="cart-quantity-title">몇 개 담을까요?</h2><p><b>{group.productName}</b><br /><small>{group.storeLabel} · 최근 관측가</small></p><label className={styles.cartQuantityLabel} htmlFor="cart-quantity">추가할 수량<input id="cart-quantity" type="number" inputMode="numeric" min="1" step="1" value={value} onChange={(event) => onChange(event.target.value)} autoFocus /></label>{error && <p className={styles.cartModalError} role="alert">{error}</p>}<button type="button" className={styles.submitButton} onClick={onConfirm}>장바구니에 담기</button></section></div>;
}

export function CartNoticeModal({ productName, quantity, onClose, onGoCart }: { productName: string; quantity: number; onClose: () => void; onGoCart: () => void }) {
  useEscape(onClose);
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.cartModal}`} role="dialog" aria-modal="true" aria-labelledby="cart-notice-title"><button type="button" className={styles.closeButton} onClick={onClose} aria-label="알림 닫기">×</button><p className={styles.kicker}>ADDED TO CART</p><h2 id="cart-notice-title">장바구니에 담겼습니다</h2><p>{productName} {quantity}개를 담았습니다.</p><div className={styles.cartNoticeActions}><button type="button" className={styles.secondaryButton} onClick={onClose}>계속 둘러보기</button><button type="button" className={styles.submitButton} onClick={onGoCart} autoFocus>장바구니 바로가기</button></div></section></div>;
}
