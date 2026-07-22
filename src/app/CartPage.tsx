"use client";

import type { ProductGroup } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import { ProductImage } from "./ProductImage";
import styles from "./page.module.css";

export function CartPage({ groups, lines, onQuantityChange, onRemove, onClear, onBrowse }: { groups: ProductGroup[]; lines: Record<string, number>; onQuantityChange: (id: string, quantity: number) => void; onRemove: (id: string) => void; onClear: () => void; onBrowse: () => void }) {
  const items = groups.filter((group) => lines[group.id] > 0);
  const total = items.reduce((sum, group) => sum + group.latestPriceKrw * lines[group.id], 0);
  const totalQuantity = items.reduce((sum, group) => sum + lines[group.id], 0);
  return <section className={styles.browser}>
    <div className={styles.browserHead}><div><p className={styles.kicker}>YOUR PICKS</p><h1>장바구니</h1><p>최근 영수증 관측가를 기준으로 예상 금액을 계산합니다.</p></div>{items.length > 0 && <button className={styles.clearCartButton} onClick={() => { if (window.confirm("장바구니의 모든 상품을 삭제할까요?")) onClear(); }}>전체 비우기</button>}</div>
    {items.length === 0 ? <div className={styles.noResult}><strong>장바구니가 비어 있습니다.</strong><p>상품 목록에서 비교할 물건을 담아보세요.</p><button onClick={onBrowse}>상품 담으러 가기 →</button></div> : <div className={styles.cartRows}>{items.map((group) => <article key={group.id}><div className={styles.productVisual}><ProductImage item={group.latest.item} category={group.category} /></div><div><h2>{group.productName}</h2><p>{group.storeLabel} · {formatKrw(group.latestPriceKrw)} · 최근 관측가</p><button className={styles.removeButton} onClick={() => onRemove(group.id)} aria-label={`${group.productName} 장바구니에서 삭제`}>삭제</button></div><div className={styles.quantity}><button onClick={() => onQuantityChange(group.id, lines[group.id] - 1)} aria-label={`${group.productName} 수량 줄이기`}>−</button><label><span className={styles.srOnly}>{group.productName} 수량</span><input type="number" min="1" step="1" value={lines[group.id]} onChange={(event) => onQuantityChange(group.id, Math.max(1, Number(event.target.value) || 1))} /></label><button onClick={() => onQuantityChange(group.id, lines[group.id] + 1)} aria-label={`${group.productName} 수량 늘리기`}>+</button></div><b>{formatKrw(group.latestPriceKrw * lines[group.id])}</b></article>)}</div>}
    {items.length > 0 && <aside className={styles.cartSummary} aria-label="장바구니 합계"><span>{items.length}개 상품 · 총 {totalQuantity}개</span><span>예상 합계 <strong>{formatKrw(total)}</strong></span><small>영수증 관측가 기준이며 현재 판매가는 달라질 수 있습니다.</small></aside>}
  </section>;
}
