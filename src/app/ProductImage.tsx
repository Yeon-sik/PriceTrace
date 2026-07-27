"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { seededOfficialProducts } from "@/domain/official-product";
import type { ProductCategory } from "@/domain/product-browser";
import type { ReceiptItem } from "@/domain/types";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import styles from "./page.module.css";

const repository = new OfficialProductRepository();
const fallbackByCategory: Partial<Record<ProductCategory, string>> = { "신선식품": "🥬", "음료": "🥤", "간식": "🍪", "생활용품": "🧴", "주방용품": "🍳", "식품": "🍚" };

export function ProductImage({ item, category, imageUrl: preferredImageUrl }: { item: ReceiptItem; category: ProductCategory; imageUrl?: string }) {
  const [imageUrl, setImageUrl] = useState<string | undefined>(preferredImageUrl ?? seededOfficialProducts[item.sourceProductCode]?.imageUrl);
  const [isExpanded, setIsExpanded] = useState(false);
  const dialogTitleId = useId();
  const zoomTriggerRef = useRef<HTMLButtonElement>(null);
  const closeExpanded = useCallback(() => {
    setIsExpanded(false);
    window.requestAnimationFrame(() => zoomTriggerRef.current?.focus());
  }, []);
  useEffect(() => { setImageUrl(preferredImageUrl ?? repository.loadAll()[item.sourceProductCode]?.imageUrl ?? seededOfficialProducts[item.sourceProductCode]?.imageUrl); }, [item.sourceProductCode, preferredImageUrl]);
  useEffect(() => {
    if (!isExpanded) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeExpanded();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeExpanded, isExpanded]);

  if (!imageUrl) return <span aria-hidden="true">{fallbackByCategory[category] ?? "📦"}</span>;

  const imageAlt = `${item.productName} 제품 사진`;
  return <>
      <img className={styles.productImage} src={imageUrl} alt={imageAlt} loading="lazy" decoding="async" onError={() => { setImageUrl(undefined); setIsExpanded(false); }} />
      <button ref={zoomTriggerRef} type="button" className={styles.imageZoomButton} aria-label={`${item.productName} 이미지 확대 보기`} onClick={() => setIsExpanded(true)}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="10.5" cy="10.5" r="5.75" />
          <path d="m15 15 4.25 4.25M10.5 7.75v5.5M7.75 10.5h5.5" />
        </svg>
      </button>
      {isExpanded && createPortal(
        <div className={styles.imageZoomBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeExpanded()}>
          <section className={styles.imageZoomDialog} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
            <h2 className={styles.srOnly} id={dialogTitleId}>{item.productName} 이미지 확대 보기</h2>
            <button type="button" className={styles.imageZoomCloseButton} aria-label="확대 이미지 닫기" onClick={closeExpanded} autoFocus>×</button>
            <img src={imageUrl} alt={imageAlt} />
          </section>
        </div>,
        document.body,
      )}
    </>;
}
