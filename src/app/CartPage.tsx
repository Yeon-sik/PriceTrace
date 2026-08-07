"use client";

import type { CartProduct } from "@/domain/cart";
import { formatKrw } from "@/domain/settlement";
import { ProductImage } from "./ProductImage";
import styles from "./page.module.css";

export function CartPage({ products, lines, onQuantityChange, onRemove, onClear, onBrowse }: { products: CartProduct[]; lines: Record<string, number>; onQuantityChange: (id: string, quantity: number) => void; onRemove: (id: string) => void; onClear: () => void; onBrowse: () => void }) {
  const items = products.filter((product) => lines[product.id] > 0);
  const total = items.reduce((sum, product) => sum + product.priceKrw * lines[product.id], 0);
  const totalQuantity = items.reduce((sum, product) => sum + lines[product.id], 0);
  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>YOUR PICKS</p><h1>장바구니</h1><p>영수증 관측가와 공식 사이트 표시가를 기준으로 예상 금액을 계산합니다.</p></div>{items.length > 0 && <button className={styles.clearCartButton} onClick={() => { if (window.confirm("장바구니의 모든 상품을 삭제할까요?")) onClear(); }}>전체 비우기</button>}</div>
    {items.length === 0 ? <div className={styles.noResult}><strong>장바구니가 비어 있습니다.</strong><p>상품 목록에서 비교할 물건을 담아보세요.</p><button onClick={onBrowse}>상품 담으러 가기 →</button></div> : <div className={styles.cartRows}>{items.map((product) => { const priceLabel = product.priceSource === "official-channel" ? "공식 표시가" : "최근 관측가"; return <article key={product.id}><div className={styles.productVisual}><ProductImage productName={product.productName} sourceProductCode={product.sourceProductCode} category={product.category} imageUrl={product.imageUrl} /></div><div><h2>{product.productName}</h2><p>{product.storeLabel} · {formatKrw(product.priceKrw)} · {priceLabel}</p><button className={styles.removeButton} onClick={() => onRemove(product.id)} aria-label={`${product.productName} 장바구니에서 삭제`}>삭제</button></div><div className={styles.quantity}><button onClick={() => onQuantityChange(product.id, lines[product.id] - 1)} aria-label={`${product.productName} 수량 줄이기`}>−</button><label><span className={styles.srOnly}>{product.productName} 수량</span><input type="number" min="1" step="1" value={lines[product.id]} onChange={(event) => onQuantityChange(product.id, Math.max(1, Number(event.target.value) || 1))} /></label><button onClick={() => onQuantityChange(product.id, lines[product.id] + 1)} aria-label={`${product.productName} 수량 늘리기`}>+</button></div><b>{formatKrw(product.priceKrw * lines[product.id])}</b></article>; })}</div>}
    {items.length > 0 && <aside className={styles.cartSummary} aria-label="장바구니 합계"><span>{items.length}개 상품 · 총 {totalQuantity}개</span><span>예상 합계 <strong>{formatKrw(total)}</strong></span><small>영수증 관측가와 공식 사이트 표시가 기준이며 현재 판매가는 달라질 수 있습니다.</small></aside>}
  </section>;
}
