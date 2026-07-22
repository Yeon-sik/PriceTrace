"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { seededOfficialProducts } from "@/domain/official-product";
import type { ProductCategory } from "@/domain/product-browser";
import type { ReceiptItem } from "@/domain/types";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import styles from "./page.module.css";

const repository = new OfficialProductRepository();
const fallbackByCategory: Partial<Record<ProductCategory, string>> = { "신선식품": "🥬", "음료": "🥤", "간식": "🍪", "생활용품": "🧴", "주방용품": "🍳", "식품": "🍚" };

export function ProductImage({ item, category }: { item: ReceiptItem; category: ProductCategory }) {
  const [imageUrl, setImageUrl] = useState<string | undefined>(seededOfficialProducts[item.sourceProductCode]?.imageUrl);
  useEffect(() => { setImageUrl(repository.loadAll()[item.sourceProductCode]?.imageUrl ?? seededOfficialProducts[item.sourceProductCode]?.imageUrl); }, [item.sourceProductCode]);
  return imageUrl
    ? <img className={styles.productImage} src={imageUrl} alt={`${item.productName} 제품 사진`} onError={() => setImageUrl(undefined)} />
    : <span aria-hidden="true">{fallbackByCategory[category] ?? "📦"}</span>;
}
