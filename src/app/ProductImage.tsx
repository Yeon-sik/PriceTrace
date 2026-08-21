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
const fallbackByCategory: Partial<Record<ProductCategory, string>> = {
  "식품": "🍚",
  "신선식품": "🥬",
  "육류": "🥩",
  "수산물": "🐟",
  "과일": "🍎",
  "채소": "🥬",
  "두부·달걀": "🥚",
  "즉석면·떡국": "🍜",
  "국수·파스타·당면": "🍝",
  "간편식·냉동식품": "🍱",
  "빵·베이커리": "🥖",
  "반찬·김·통조림": "🥫",
  "조미료·소스": "🧂",
  "쌀·가루류": "🌾",
  "육가공·어묵": "🌭",
  "건강기능식품": "💊",
  "음료": "🥤",
  "커피·차": "☕",
  "주스·유산균음료": "🧃",
  "단백질음료": "🥛",
  "건강·에너지음료": "⚡",
  "주류": "🥃",
  "간식": "🍪",
  "스낵·과자": "🍿",
  "아이스크림": "🍨",
  "초콜릿·디저트": "🍫",
  "육포·단백질간식": "🥓",
  "뷰티": "🧴",
  "로션·크림": "🧴",
  "선케어": "☀️",
  "피부관리": "✨",
  "샴푸·헤어케어": "🧴",
  "바디케어": "🧼",
  "면도용품": "🪒",
  "생활용품": "🧼",
  "세탁·청소": "🧺",
  "종이·일회용품": "🧻",
  "건강·위생용품": "🩹",
  "주방용품": "🍳",
  "조리도구": "🍳",
  "식기·보관용기": "🍽️",
  "의류·패션": "👕",
  "의류": "👕",
  "속옷": "🧦",
  "패션잡화": "👜",
  "스포츠·레저": "🏕️",
  "스포츠용품": "🏸",
  "아웃도어·레저": "⛺",
  "자동차용품": "🚗",
  "자동차 관리용품": "🚙",
  "전자제품": "🔌",
  "디지털기기": "📱",
  "생활가전": "🔌",
  "기타": "📦",
  "미분류": "❔",
};

export function ProductImage({
  item,
  productName: providedProductName,
  sourceProductCode: providedSourceProductCode,
  category,
  imageUrl: preferredImageUrl,
}: {
  item?: ReceiptItem;
  productName?: string;
  sourceProductCode?: string;
  category: ProductCategory;
  imageUrl?: string;
}) {
  const productName = item?.productName ?? providedProductName ?? "상품";
  const sourceProductCode = item?.sourceProductCode ?? providedSourceProductCode ?? "";
  const [imageUrl, setImageUrl] = useState<string | undefined>(preferredImageUrl ?? seededOfficialProducts[sourceProductCode]?.imageUrl);
  const [isExpanded, setIsExpanded] = useState(false);
  const dialogTitleId = useId();
  const zoomTriggerRef = useRef<HTMLButtonElement>(null);
  const closeExpanded = useCallback(() => {
    setIsExpanded(false);
    window.requestAnimationFrame(() => zoomTriggerRef.current?.focus());
  }, []);
  useEffect(() => { setImageUrl(preferredImageUrl ?? repository.loadAll()[sourceProductCode]?.imageUrl ?? seededOfficialProducts[sourceProductCode]?.imageUrl); }, [preferredImageUrl, sourceProductCode]);
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

  const imageAlt = `${productName} 제품 사진`;
  return <>
      <img className={styles.productImage} src={imageUrl} alt={imageAlt} loading="lazy" decoding="async" onError={() => { setImageUrl(undefined); setIsExpanded(false); }} />
      <button ref={zoomTriggerRef} type="button" className={styles.imageZoomButton} aria-label={`${productName} 이미지 확대 보기`} onClick={() => setIsExpanded(true)}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="10.5" cy="10.5" r="5.75" />
          <path d="m15 15 4.25 4.25M10.5 7.75v5.5M7.75 10.5h5.5" />
        </svg>
      </button>
      {isExpanded && createPortal(
        <div className={styles.imageZoomBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeExpanded()}>
          <section className={styles.imageZoomDialog} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
            <h2 className={styles.srOnly} id={dialogTitleId}>{productName} 이미지 확대 보기</h2>
            <button type="button" className={styles.imageZoomCloseButton} aria-label="확대 이미지 닫기" onClick={closeExpanded} autoFocus>×</button>
            <img src={imageUrl} alt={imageAlt} />
          </section>
        </div>,
        document.body,
      )}
    </>;
}
