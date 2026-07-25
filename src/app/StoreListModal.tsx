"use client";

import { useEffect } from "react";
import styles from "./page.module.css";

export function StoreListModal({ title, rows, onClose, onOpenStore }: { title: string; rows: { storeLabel: string; observedAt: string }[]; onClose: () => void; onOpenStore: (store: string) => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", close); };
  }, [onClose]);

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`${styles.authModal} ${styles.cartModal}`} role="dialog" aria-modal="true" aria-labelledby="store-list-title">
      <button type="button" className={styles.closeButton} onClick={onClose} aria-label="판매처 정보 닫기">×</button>
      <p className={styles.kicker}>SELLER INFO</p>
      <h2 id="store-list-title">{title}</h2>
      <div className={styles.storeDetailList}>{rows.map((row, index) => <div key={`${row.storeLabel}:${row.observedAt}:${index}`}><button type="button" className={styles.textButton} onClick={() => onOpenStore(row.storeLabel)}>{row.storeLabel}</button><span>{row.observedAt}</span></div>)}</div>
    </section>
  </div>;
}
