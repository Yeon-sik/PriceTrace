"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  nutritionFoodFromReadRow,
  productNutritionLinkIdentityKey,
  type NutritionFood,
} from "../../domain/product-nutrition-link";
import type { StandardProductItem } from "../product-browser/product-browser.selectors";
import { useProductNutritionLink } from "./use-product-nutrition-link";
import styles from "../../app/page.module.css";

function formatNutrient(value: number | null, unit: string) {
  return value === null ? "미입력" : `${value.toLocaleString("ko-KR")}${unit}`;
}

function NutritionSummary({ food }: { food: NutritionFood }) {
  return <>
    <small>{food.basisAmount.toLocaleString("ko-KR")}{food.basisUnit} 기준 · {food.sourceType}</small>
    <span>{formatNutrient(food.caloriesKcal, "kcal")}</span>
    <small>
      단백질 {formatNutrient(food.proteinGrams, "g")} · 탄수화물 {formatNutrient(food.carbsGrams, "g")} · 지방 {formatNutrient(food.fatGrams, "g")}
    </small>
    <small>
      나트륨 {formatNutrient(food.sodiumMg, "mg")} · 당류 {formatNutrient(food.sugarsGrams, "g")} · 포화지방 {formatNutrient(food.saturatedFatGrams, "g")}
    </small>
  </>;
}

export function ProductNutritionPanel({
  standardName,
  item,
}: {
  standardName: string;
  item: StandardProductItem;
}) {
  const [query, setQuery] = useState(standardName);
  const {
    nutritionConfigured,
    product,
    productError,
    linkState,
    linkError,
    foods,
    searchError,
    loading,
    searching,
    submittingIdentityKey,
    actionMessage,
    actionError,
    search,
    proposeLink,
    proposeUnlink,
  } = useProductNutritionLink({
    catalogProductId: item.catalogProductId,
    candidateName: standardName,
  });

  useEffect(() => { setQuery(standardName); }, [item.catalogProductId, standardName]);

  const approvedIdentityKeys = useMemo(
    () => new Set(linkState?.approvedLinks.map((link) => productNutritionLinkIdentityKey(link.identity)) ?? []),
    [linkState],
  );
  const pendingLinkIdentityKeys = useMemo(
    () => new Set(linkState?.pendingProposals
      .filter((proposal) => proposal.action === "link")
      .map((proposal) => productNutritionLinkIdentityKey(proposal.identity)) ?? []),
    [linkState],
  );
  const pendingUnlinkIdentityKeys = useMemo(
    () => new Set(linkState?.pendingProposals
      .filter((proposal) => proposal.action === "unlink")
      .map((proposal) => productNutritionLinkIdentityKey(proposal.identity)) ?? []),
    [linkState],
  );

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void search(query);
  };

  return <section className={styles.productNutritionSection} aria-labelledby="product-nutrition-title">
    <div className={styles.sectionHeading}>
      <div>
        <h3 id="product-nutrition-title">Fitness 공개 영양</h3>
        <p>Nutrition DB의 공개 식품을 조회합니다. 이름은 후보 탐색에만 사용하고 연결은 정확 ID와 revision으로 승인됩니다.</p>
      </div>
      <small>{item.packageLabel}</small>
    </div>

    <div className={styles.nutritionIdentity}>
      <span>namespace <code>pricetrace</code></span>
      <span>정확 규격 <code>{item.catalogProductId}</code></span>
      {product && <span>revision <code>{product.revision.slice(0, 19)}…</code></span>}
    </div>

    {loading && <p className={styles.nutritionStatus} role="status">PriceTrace revision과 Nutrition 링크 상태를 확인하고 있습니다.</p>}
    {!nutritionConfigured && <p className={styles.nutritionOffline} role="status">Fitness Nutrition 공개 연결이 설정되지 않았습니다. 가격·판매처 상세는 계속 사용할 수 있습니다.</p>}
    {productError && <p className={styles.nutritionWarning} role="status">{productError} 후보 조회는 가능하지만 제안 버튼은 잠깁니다.</p>}
    {linkError && nutritionConfigured && <p className={styles.nutritionOffline} role="status">{linkError} 가격·판매처 상세에는 영향이 없습니다.</p>}

    {linkState && <div className={styles.nutritionLinks}>
      <h4>승인된 연결</h4>
      {linkState.approvedLinks.length === 0
        ? <p>승인된 Nutrition 연결이 없습니다.</p>
        : linkState.approvedLinks.map((link) => {
          const linkedFood = link.nutritionFood ? nutritionFoodFromReadRow(link.nutritionFood) : null;
          const identityKey = productNutritionLinkIdentityKey(link.identity);
          const unlinkPending = pendingUnlinkIdentityKeys.has(identityKey);
          return <article key={link.id}>
            <div>
              <strong>{linkedFood?.name ?? link.candidateEvidence.nutritionFoodName}</strong>
              {linkedFood
                ? <NutritionSummary food={linkedFood} />
                : <small>공개 영양 행은 현재 없어도 승인 링크 identity는 보존됩니다.</small>}
              <small>승인 revision {link.approvalRevision} · {link.approvedAt.slice(0, 10)}</small>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={!product || unlinkPending || submittingIdentityKey === identityKey}
              onClick={() => void proposeUnlink(link)}
            >{unlinkPending ? "해제 승인 대기" : "연결 해제 제안"}</button>
          </article>;
        })}
    </div>}

    <form className={styles.nutritionSearch} onSubmit={submitSearch}>
      <label htmlFor="nutrition-food-search">Nutrition 후보 이름 검색</label>
      <div>
        <input
          id="nutrition-food-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={!nutritionConfigured}
        />
        <button type="submit" disabled={!nutritionConfigured || searching || !query.trim()}>{searching ? "검색 중" : "후보 검색"}</button>
      </div>
    </form>

    {searchError && nutritionConfigured && <p className={styles.nutritionOffline} role="status">{searchError} PriceTrace 상세는 계속 사용할 수 있습니다.</p>}
    {nutritionConfigured && !searchError && !loading && foods.length === 0 && <p className={styles.nutritionStatus}>검색된 공개 영양 후보가 없습니다.</p>}
    {foods.length > 0 && <div className={styles.nutritionCandidates} aria-label="Nutrition 후보">
      {foods.map((food) => {
        const identityKey = productNutritionLinkIdentityKey({
          namespace: "pricetrace",
          catalogProductId: item.catalogProductId,
          nutritionFoodId: food.id,
        });
        const approved = approvedIdentityKeys.has(identityKey);
        const pending = pendingLinkIdentityKeys.has(identityKey);
        return <article key={food.id}>
          <div>
            <strong>{food.name}</strong>
            <NutritionSummary food={food} />
            <small>{food.sourceReference ?? "출처 상세 미입력"}{food.sourceRevision ? ` · ${food.sourceRevision}` : ""} · revision {food.revision}</small>
          </div>
          <button
            type="button"
            disabled={!product || approved || pending || submittingIdentityKey === identityKey}
            onClick={() => void proposeLink(food)}
          >{approved ? "연결 승인됨" : pending ? "연결 승인 대기" : "연결 제안"}</button>
        </article>;
      })}
    </div>}

    {(actionMessage || actionError) && <p className={actionError ? styles.nutritionWarning : styles.nutritionSuccess} role="status">{actionError || actionMessage}</p>}
    {linkState && <small className={styles.nutritionRevision}>Nutrition 링크 revision {linkState.revision.slice(0, 19)}… · 승인 전에는 연결 상태가 바뀌지 않습니다.</small>}
  </section>;
}
