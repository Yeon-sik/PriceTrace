"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { CartProduct } from "@/domain/cart";
import { formatKrw } from "@/domain/settlement";
import styles from "./page.module.css";

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function useDialogLifecycle(onClose: () => void, initialFocusRef: RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    initialFocusRef.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
      previousFocus?.focus();
    };
  }, [initialFocusRef]);
}

export function CartQuantityModal({ product, value, error, onChange, onClose, onConfirm }: { product: CartProduct; value: string; error: string; onChange: (value: string) => void; onClose: () => void; onConfirm: () => void }) {
  const quantityInputRef = useRef<HTMLInputElement>(null);
  useDialogLifecycle(onClose, quantityInputRef);
  const priceLabel = product.priceSource === "official-channel" ? "공식 표시가" : "최근 관측가";
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.cartModal}`} role="dialog" aria-modal="true" aria-labelledby="cart-quantity-title" onKeyDown={trapDialogFocus}><button type="button" className={styles.closeButton} onClick={onClose} aria-label="장바구니 담기 창 닫기">×</button><p className={styles.kicker}>ADD TO CART</p><h2 id="cart-quantity-title">몇 개 담을까요?</h2><p><b>{product.productName}</b><br /><small>{product.storeLabel} · {priceLabel} {formatKrw(product.priceKrw)} · {product.priceObservedAt.slice(0, 10)} 관측</small></p><label className={styles.cartQuantityLabel} htmlFor="cart-quantity">추가할 수량<input ref={quantityInputRef} id="cart-quantity" type="number" inputMode="numeric" min="1" step="1" value={value} onChange={(event) => onChange(event.target.value)} /></label>{error && <p className={styles.cartModalError} role="alert">{error}</p>}<button type="button" className={styles.submitButton} onClick={onConfirm}>장바구니에 담기</button></section></div>;
}

export function CartNoticeModal({ productName, quantity, onClose, onGoCart }: { productName: string; quantity: number; onClose: () => void; onGoCart: () => void }) {
  const goCartButtonRef = useRef<HTMLButtonElement>(null);
  useDialogLifecycle(onClose, goCartButtonRef);
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.cartModal}`} role="dialog" aria-modal="true" aria-labelledby="cart-notice-title" onKeyDown={trapDialogFocus}><button type="button" className={styles.closeButton} onClick={onClose} aria-label="알림 닫기">×</button><p className={styles.kicker}>ADDED TO CART</p><h2 id="cart-notice-title">장바구니에 담겼습니다</h2><p>{productName} {quantity}개를 담았습니다.</p><div className={styles.cartNoticeActions}><button type="button" className={styles.secondaryButton} onClick={onClose}>계속 둘러보기</button><button ref={goCartButtonRef} type="button" className={styles.submitButton} onClick={onGoCart}>장바구니 바로가기</button></div></section></div>;
}
