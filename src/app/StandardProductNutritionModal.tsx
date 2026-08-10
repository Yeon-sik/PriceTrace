"use client";

import { useEffect, useRef } from "react";
import type { NutritionFood } from "@/domain/product-nutrition-link";
import { useStandardProductNutrition } from "@/features/product-nutrition/use-standard-product-nutrition";
import styles from "./page.module.css";

function formatAmount(value: number | null, unit: string) {
  return value === null ? "-" : `${value.toLocaleString("ko-KR")}${unit}`;
}

function formatSourceType(sourceType: string) {
  if (sourceType === "manufacturer_label") return "제조사 영양성분표";
  if (sourceType === "pricetrace_manual") return "PriceTrace 상품에서 직접 등록";
  if (sourceType === "manual") return "직접 입력";
  return sourceType;
}

function formatSourceReference(sourceReference: string) {
  return sourceReference.startsWith("catalogProductId:")
    ? "PriceTrace 승인 상품 연결"
    : sourceReference;
}

function NutritionFacts({ food }: { food: NutritionFood }) {
  const rows = [
    ["나트륨", formatAmount(food.sodiumMg, "mg")],
    ["탄수화물", formatAmount(food.carbsGrams, "g")],
    ["당류", formatAmount(food.sugarsGrams, "g")],
    ["식이섬유", formatAmount(food.fiberGrams, "g")],
    ["지방", formatAmount(food.fatGrams, "g")],
    ["트랜스지방", formatAmount(food.transFatGrams, "g")],
    ["포화지방", formatAmount(food.saturatedFatGrams, "g")],
    ["콜레스테롤", formatAmount(food.cholesterolMg, "mg")],
    ["단백질", formatAmount(food.proteinGrams, "g")],
  ] as const;

  return <article className={styles.nutritionFacts} aria-label={`${food.name} 영양성분표`}>
    <header className={styles.nutritionFactsHeader}>
      <span>영양정보</span>
      <h3>{food.name}</h3>
      <strong>{food.basisAmount.toLocaleString("ko-KR")}{food.basisUnit} 기준</strong>
    </header>
    <div className={styles.nutritionCalories}>
      <span>열량</span>
      <strong>{formatAmount(food.caloriesKcal, "kcal")}</strong>
    </div>
    <dl className={styles.nutritionFactsRows}>
      {rows.map(([label, value]) => <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>)}
    </dl>
    <footer className={styles.nutritionFactsSource}>
      <span>출처 {formatSourceType(food.sourceType)}</span>
      {food.sourceReference && <small>{formatSourceReference(food.sourceReference)}</small>}
    </footer>
  </article>;
}

export function StandardProductNutritionModal({
  standardName,
  catalogProductIds,
  onClose,
}: {
  standardName: string;
  catalogProductIds: readonly string[];
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { foods, loading, error, warning, retry } = useStandardProductNutrition(catalogProductIds);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [onClose]);

  return <div
    className={`${styles.modalBackdrop} ${styles.nutritionModalBackdrop}`}
    role="presentation"
    onMouseDown={(event) => event.target === event.currentTarget && onClose()}
  >
    <section
      className={styles.nutritionModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="standard-nutrition-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
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
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        className={styles.closeButton}
        onClick={onClose}
        aria-label="영양 정보 닫기"
      >×</button>
      <p className={styles.kicker}>NUTRITION FACTS</p>
      <h2 id="standard-nutrition-title">단위 무게 당 영양 정보</h2>
      <p className={styles.nutritionProductName}>{standardName}</p>

      <div className={styles.nutritionModalContent} aria-live="polite" aria-busy={loading}>
        {loading && <p className={styles.nutritionModalStatus} role="status">영양 정보를 불러오는 중입니다.</p>}
        {!loading && error && <div className={styles.nutritionModalError} role="alert">
          <strong>{error}</strong>
          <button type="button" onClick={retry}>다시 시도</button>
        </div>}
        {!loading && !error && !warning && foods.length === 0 && <div className={styles.nutritionEmpty} role="status">
          <strong>내용없음</strong>
          <span>공개된 영양 정보가 아직 없습니다.</span>
        </div>}
        {foods.length > 0 && <>
          {foods.length > 1 && <p className={styles.nutritionResultSummary}>공개된 영양 정보 {foods.length.toLocaleString("ko-KR")}개를 함께 표시합니다.</p>}
          <div className={styles.nutritionFactsList}>
            {foods.map((food) => <NutritionFacts key={food.id} food={food} />)}
          </div>
        </>}
        {warning && <p className={styles.nutritionModalWarning} role="status">{warning}</p>}
      </div>
    </section>
  </div>;
}
