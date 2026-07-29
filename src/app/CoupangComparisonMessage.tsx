import type { CoupangPriceComparison } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import styles from "./page.module.css";

export function CoupangComparisonMessage({ unitPriceLabel, comparison, compact = false }: {
  unitPriceLabel: string;
  comparison: CoupangPriceComparison;
  compact?: boolean;
}) {
  const Element = compact ? "small" : "p";
  if (comparison.winner === "seller") {
    return <Element className={styles.cheaperThanCoupang}>{unitPriceLabel} 기준 쿠팡보다 {comparison.sellerTag}가 {formatKrw(comparison.differenceKrw)} 저렴해요</Element>;
  }
  if (comparison.winner === "coupang") {
    return <Element className={styles.coupangCheaper}>{unitPriceLabel} 기준 {comparison.sellerTag}보다 쿠팡이 {formatKrw(comparison.differenceKrw)} 저렴해요</Element>;
  }
  return <Element className={styles.sameAsCoupang}>{unitPriceLabel} 기준 쿠팡과 {comparison.sellerTag}의 가격이 같아요</Element>;
}
