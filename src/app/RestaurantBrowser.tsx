"use client";

import { useMemo, useRef, useState } from "react";
import {
  filterRestaurantMenuEntries,
  latestRestaurantMenuObservation,
  summarizeRestaurantMenuPrices,
  type RestaurantMenu,
  type RestaurantMenuReadEntry,
} from "@/domain/restaurant-menu";
import { formatKrw } from "@/domain/settlement";
import { useRestaurantMenuCatalog } from "@/features/restaurant-menu/use-restaurant-menu-catalog";
import { StandardProductNutritionModal } from "./StandardProductNutritionModal";
import styles from "./page.module.css";

type RestaurantBrowserProps = {
  selectedRestaurant: string | null;
  onSelectRestaurant: (restaurantId: string | null) => void;
};

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function latestRestaurantObservation(entry: RestaurantMenuReadEntry) {
  return entry.menus
    .flatMap((menu) => menu.observations)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))[0] ?? null;
}

export function RestaurantBrowser({ selectedRestaurant, onSelectRestaurant }: RestaurantBrowserProps) {
  const { configured, payload, loading, error, refresh } = useRestaurantMenuCatalog();
  const [query, setQuery] = useState("");
  const [nutritionMenu, setNutritionMenu] = useState<{ brand: string; menu: RestaurantMenu } | null>(null);
  const nutritionTriggerRef = useRef<HTMLElement | null>(null);
  const entries = useMemo(() => payload?.restaurants ?? [], [payload]);
  const visibleEntries = useMemo(
    () => filterRestaurantMenuEntries(entries, query),
    [entries, query],
  );
  const selectedEntry = entries.find((entry) => entry.restaurant.id === selectedRestaurant) ?? null;

  if (!selectedRestaurant) {
    return <section className={styles.browser}>
      <div className={styles.browserHead}>
        <div>
          <p className={styles.kicker}>RESTAURANTS &amp; MENUS</p>
          <h1>음식점</h1>
          <p>검증된 영수증 출처를 기준으로 식당 Brand, 메뉴, 지점별 관측 가격을 분리해 확인합니다.</p>
        </div>
        <label className={styles.search}>
          <span aria-hidden="true">⌕</span>
          <span className={styles.srOnly}>음식점 또는 메뉴 검색</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="음식점 Brand, 메뉴, 지역 검색"
          />
        </label>
      </div>

      <div className={styles.restaurantBoundaryNotice}>
        <strong>정확한 연결 기준</strong>
        <span>식당명·메뉴명은 표시와 검색에만 사용합니다. Fitness Nutrition 연결은 메뉴의 정확한 catalog_product_id를 사용합니다.</span>
      </div>

      {!configured && <div className={styles.restaurantEmpty} role="status">
        <strong>공개 음식점 DB 연결이 필요합니다.</strong>
        <span>PriceTrace Supabase 공개 설정이 연결되면 검증된 음식점과 메뉴 가격 기록을 표시합니다.</span>
      </div>}
      {configured && loading && <p className={styles.emptyState} role="status">음식점과 메뉴 가격 기록을 불러오는 중입니다.</p>}
      {configured && !loading && error && <div className={styles.restaurantError} role="alert">
        <strong>{error}</strong>
        <button type="button" onClick={refresh}>다시 시도</button>
      </div>}
      {configured && !loading && !error && visibleEntries.length === 0 && <div className={styles.restaurantEmpty} role="status">
        <strong>{entries.length === 0 ? "등록된 음식점이 없습니다." : "검색 결과가 없습니다."}</strong>
        <span>{entries.length === 0 ? "관리자가 영수증 근거와 함께 등록한 음식점이 여기에 표시됩니다." : "다른 Brand, 메뉴 또는 지역으로 검색해 보세요."}</span>
      </div>}
      {visibleEntries.length > 0 && <div className={styles.restaurantGrid} aria-live="polite">
        {visibleEntries.map((entry) => {
          const latest = latestRestaurantObservation(entry);
          return <button
            type="button"
            key={entry.restaurant.id}
            className={styles.restaurantCard}
            onClick={() => onSelectRestaurant(entry.restaurant.id)}
          >
            <span className={styles.restaurantCardIcon} aria-hidden="true">🍽</span>
            <span className={styles.restaurantCardBody}>
              <small>{entry.restaurant.cuisineType ?? "음식점"}</small>
              <strong>{entry.restaurant.brand}</strong>
              {entry.restaurant.legalName && <span>{entry.restaurant.legalName}</span>}
              <span>메뉴 {entry.menus.length}개 · 확인 지점 {entry.locations.length}곳</span>
              <b>{latest ? `최근 관측 ${formatObservedAt(latest.observedAt)}` : "가격 관측 준비 중"}</b>
            </span>
            <span className={styles.arrow} aria-hidden="true">›</span>
          </button>;
        })}
      </div>}
    </section>;
  }

  if (!configured) {
    return <section className={styles.browser}><div className={styles.restaurantEmpty} role="status">
      <strong>공개 음식점 DB 연결이 필요합니다.</strong>
      <span>PriceTrace Supabase 공개 설정을 연결한 뒤 이 음식점의 메뉴 기록을 확인하세요.</span>
      <button type="button" onClick={() => onSelectRestaurant(null)}>음식점 목록으로</button>
    </div></section>;
  }

  if (loading) {
    return <section className={styles.browser}><p className={styles.emptyState} role="status">음식점 정보를 불러오는 중입니다.</p></section>;
  }

  if (error) {
    return <section className={styles.browser}><div className={styles.restaurantError} role="alert">
      <strong>{error}</strong>
      <button type="button" onClick={refresh}>다시 시도</button>
      <button type="button" onClick={() => onSelectRestaurant(null)}>음식점 목록으로</button>
    </div></section>;
  }

  if (!selectedEntry) {
    return <section className={styles.browser}>
      <div className={styles.restaurantEmpty} role="alert">
        <strong>공개된 음식점 identity를 찾을 수 없습니다.</strong>
        <button type="button" onClick={() => onSelectRestaurant(null)}>음식점 목록으로</button>
      </div>
    </section>;
  }

  return <section className={styles.browser}>
    <div className={styles.browserHead}>
      <div>
        <p className={styles.kicker}>RESTAURANT MENU PRICE HISTORY</p>
        <h1>{selectedEntry.restaurant.brand}</h1>
        <p>메뉴 가격은 지점과 관측 시점이 확인되는 기록이며, 현재가나 재고 보장이 아닙니다.</p>
      </div>
      <button className={styles.outlineButton} type="button" onClick={() => onSelectRestaurant(null)}>음식점 목록</button>
    </div>

    <section className={styles.restaurantProfile} aria-label="음식점 정보">
      <div>
        <span>Brand</span>
        <strong>{selectedEntry.restaurant.brand}</strong>
      </div>
      <div>
        <span>법적 상호</span>
        <strong>{selectedEntry.restaurant.legalName ?? "정보 없음"}</strong>
      </div>
      <div>
        <span>업종</span>
        <strong>{selectedEntry.restaurant.cuisineType ?? "정보 없음"}</strong>
      </div>
      <div>
        <span>메뉴</span>
        <strong>{selectedEntry.menus.length}개</strong>
      </div>
      {selectedEntry.restaurant.officialSiteUrl && <a href={selectedEntry.restaurant.officialSiteUrl} target="_blank" rel="noreferrer">공식 사이트 확인</a>}
    </section>

    {selectedEntry.locations.length > 0 && <section className={styles.restaurantLocations} aria-labelledby="restaurant-locations-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>VERIFIED SOURCES</p><h2 id="restaurant-locations-title">확인된 지점·출처</h2></div>
        <small>sourceLabel + sourceRestaurantCode</small>
      </div>
      <div>
        {selectedEntry.locations.map((location) => <article key={location.id}>
          <strong>{location.locationLabel ?? selectedEntry.restaurant.brand}</strong>
          <small>{location.sourceLabel} · {location.sourceRestaurantCode}</small>
          {location.sourceUrl && <a href={location.sourceUrl} target="_blank" rel="noreferrer">출처 보기</a>}
        </article>)}
      </div>
    </section>}

    <section className={styles.restaurantMenus} aria-labelledby="restaurant-menus-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>TRACKED MENUS</p><h2 id="restaurant-menus-title">메뉴 가격 기록</h2></div>
        <small>정확 메뉴 ID별 추적</small>
      </div>
      <div className={styles.restaurantMenuList}>
        {selectedEntry.menus.map((menu) => {
          const summary = summarizeRestaurantMenuPrices(menu);
          const latest = latestRestaurantMenuObservation(menu);
          return <article key={menu.id} className={styles.restaurantMenuCard}>
            <header>
              <div>
                <small>{menu.categoryLabel ?? "메뉴"} · {menu.servingLabel}</small>
                <h3>{menu.name}</h3>
                <code title="Fitness Nutrition exact link key">catalog_product_id {menu.catalogProductId}</code>
              </div>
              <div className={styles.restaurantMenuLatest}>
                <span>최근 관측가</span>
                <strong>{latest ? formatKrw(latest.unitPriceKrw) : "기록 없음"}</strong>
                {latest && <small>{latest.locationLabel ?? "지점 미상"} · {formatObservedAt(latest.observedAt)}</small>}
              </div>
            </header>

            {summary && <div className={styles.restaurantMenuStats}>
              <span>최저 <b>{formatKrw(summary.minimumPriceKrw)}</b></span>
              <span>최고 <b>{formatKrw(summary.maximumPriceKrw)}</b></span>
              <span>관측 <b>{summary.observationCount}건</b></span>
            </div>}

            <div className={styles.restaurantMenuActions}>
              <button
                type="button"
                className={styles.nutritionInfoButton}
                onClick={(event) => {
                  nutritionTriggerRef.current = event.currentTarget;
                  setNutritionMenu({ brand: selectedEntry.restaurant.brand, menu });
                }}
              >Nutrition DB 영양성분</button>
              {menu.officialUrl && <a href={menu.officialUrl} target="_blank" rel="noreferrer">공식 메뉴 보기</a>}
            </div>

            <details className={styles.restaurantPriceHistory}>
              <summary>가격 관측 이력 {menu.observations.length}건</summary>
              {menu.observations.length === 0
                ? <p>공개된 가격 관측이 없습니다.</p>
                : <div>{[...menu.observations]
                  .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
                  .map((observation) => <article key={observation.id}>
                    <span><strong>{observation.locationLabel ?? "지점 미상"}</strong><small>{formatObservedAt(observation.observedAt)} · 영수증 검증</small></span>
                    <b>{formatKrw(observation.unitPriceKrw)}</b>
                    {observation.receiptReference && <small>영수증 {observation.receiptReference.receiptId} · 항목 {observation.receiptReference.receiptItemId}</small>}
                  </article>)}</div>}
            </details>
          </article>;
        })}
      </div>
    </section>

    {nutritionMenu && <StandardProductNutritionModal
      title="메뉴 영양 정보"
      standardName={`${nutritionMenu.brand} · ${nutritionMenu.menu.name}`}
      catalogProductIds={[nutritionMenu.menu.catalogProductId]}
      restoreFocusRef={nutritionTriggerRef}
      onClose={() => setNutritionMenu(null)}
    />}
  </section>;
}
