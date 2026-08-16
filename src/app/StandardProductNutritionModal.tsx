"use client";

import { useRef, useState, type RefObject } from "react";
import type { NutritionFood } from "@/domain/product-nutrition-link";
import {
  NUTRITION_DISPLAY_UNITS,
  NUTRITION_DISPLAY_AMOUNT,
  nutritionValueAtAmount,
  type NutritionDisplayUnit,
} from "@/domain/nutrition-normalization";
import { useStandardProductNutrition } from "@/features/product-nutrition/use-standard-product-nutrition";
import { trapDialogFocus, useDialogLifecycle } from "@/hooks/use-dialog-lifecycle";
import styles from "./page.module.css";

function formatAmount(value: number | null, unit: string) {
  return value === null
    ? "-"
    : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
}

function formatBasis(food: NutritionFood) {
  return `${food.basisAmount.toLocaleString("ko-KR")}${food.basisUnit}`;
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

const nutritionRows = (food: NutritionFood) => [
  ["열량", food.caloriesKcal, "kcal"],
  ["나트륨", food.sodiumMg, "mg"],
  ["탄수화물", food.carbsGrams, "g"],
  ["당류", food.sugarsGrams, "g"],
  ["식이섬유", food.fiberGrams, "g"],
  ["지방", food.fatGrams, "g"],
  ["트랜스지방", food.transFatGrams, "g"],
  ["포화지방", food.saturatedFatGrams, "g"],
  ["콜레스테롤", food.cholesterolMg, "mg"],
  ["단백질", food.proteinGrams, "g"],
] as const;

function displayUnitLabel(unit: NutritionDisplayUnit) {
  return `${NUTRITION_DISPLAY_AMOUNT}${unit}`;
}

function NutritionFacts({ food }: { food: NutritionFood }) {
  return <article className={styles.nutritionFacts} aria-label={`${food.name} 영양성분표`}>
    <header className={styles.nutritionFactsHeader}>
      <span>영양정보</span>
      <h3>{food.name}</h3>
      <div className={styles.nutritionFactsBasis}>
        <strong>기준 단위당 영양성분</strong>
        <small>{formatBasis(food)} 기록을 {NUTRITION_DISPLAY_AMOUNT}단위 기준으로 환산</small>
      </div>
    </header>
    <section className={styles.nutritionTableSection} aria-label="기준 단위당 영양성분">
      <h4>기준 단위당 영양성분</h4>
      <div className={styles.nutritionTableWrap}>
        <table className={styles.nutritionTable}>
          <thead><tr><th scope="col">영양성분</th>{NUTRITION_DISPLAY_UNITS.map((unit) => <th key={unit} scope="col">{displayUnitLabel(unit)}</th>)}</tr></thead>
          <tbody>{nutritionRows(food).map(([label, value, unit]) => <tr key={label}>
            <th scope="row">{label}</th>
            {NUTRITION_DISPLAY_UNITS.map((targetUnit) => <td key={targetUnit}>{formatAmount(nutritionValueAtAmount(food, value, targetUnit), unit)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <footer className={styles.nutritionFactsSource}>
      <span>출처 {formatSourceType(food.sourceType)}</span>
      {food.sourceReference && <small>{formatSourceReference(food.sourceReference)}</small>}
    </footer>
  </article>;
}

function NutritionRecords({
  foods,
  selectedFoodId,
  onSelect,
}: {
  foods: readonly NutritionFood[];
  selectedFoodId: string;
  onSelect: (foodId: string) => void;
}) {
  return <details className={styles.nutritionRecords}>
    <summary>기록된 값 보기 <small>{foods.length.toLocaleString("ko-KR")}건</small></summary>
    <ul className={styles.nutritionRecordList}>
      {foods.map((food) => <li key={food.id} className={food.id === selectedFoodId ? styles.nutritionRecordSelected : undefined}>
        <button
          type="button"
          aria-pressed={food.id === selectedFoodId}
          onClick={() => onSelect(food.id)}
        >
          <strong>{food.name} · {formatBasis(food)}</strong>
          <small>{food.id === selectedFoodId ? "현재 기준표에 표시 중" : "이 기록으로 기준표 보기"}</small>
        </button>
        <dl>
          {nutritionRows(food).map(([label, value, unit]) => <div key={label}>
            <dt>{label}</dt>
            <dd>{formatAmount(value, unit)}</dd>
          </div>)}
        </dl>
      </li>)}
    </ul>
  </details>;
}

export function StandardProductNutritionModal({
  title = "기준 단위당 영양 정보",
  standardName,
  catalogProductIds,
  onClose,
  restoreFocusRef,
}: {
  title?: string;
  standardName: string;
  catalogProductIds: readonly string[];
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [selectedFoodId, setSelectedFoodId] = useState("");
  const { foods, loading, error, warning, retry } = useStandardProductNutrition(catalogProductIds);
  const selectedFood = foods.find((food) => food.id === selectedFoodId) ?? foods[0] ?? null;
  useDialogLifecycle({ onClose, initialFocusRef: closeButtonRef, restoreFocusRef });

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
      onKeyDown={trapDialogFocus}
    >
      <button
        ref={closeButtonRef}
        autoFocus
        type="button"
        className={styles.closeButton}
        onClick={onClose}
        aria-label="영양 정보 닫기"
      >×</button>
      <p className={styles.kicker}>NUTRITION FACTS</p>
      <h2 id="standard-nutrition-title">{title}</h2>
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
          <NutritionRecords foods={foods} selectedFoodId={selectedFood?.id ?? ""} onSelect={setSelectedFoodId} />
          {selectedFood && <NutritionFacts food={selectedFood} />}
        </>}
        {warning && <p className={styles.nutritionModalWarning} role="status">{warning}</p>}
      </div>
    </section>
  </div>;
}
