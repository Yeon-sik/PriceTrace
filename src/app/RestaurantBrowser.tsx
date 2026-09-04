"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterRestaurantDirectoryEntries,
  groupRestaurantMenusForDisplay,
  latestRestaurantMenuObservation,
  restaurantCategoryPathLabel,
  restaurantDirectoryCategories,
  restaurantMenuCategories,
  restaurantMenuNameLooksLikeOption,
  summarizeRestaurantMenuPrices,
  type RestaurantMenu,
  type RestaurantFulfillmentMode,
} from "@/domain/restaurant-menu";
import { formatKrw } from "@/domain/settlement";
import { useRestaurantMenuCatalog } from "@/features/restaurant-menu/use-restaurant-menu-catalog";
import { PrivateIdentityDetail } from "./PrivateIdentityDetail";
import { StandardProductNutritionModal } from "./StandardProductNutritionModal";
import styles from "./page.module.css";

type RestaurantBrowserProps = {
  selectedRestaurant: string | null;
  selectedRestaurantMenuId: string | null;
  onSelectRestaurant: (restaurantId: string | null) => void;
  onClearMenuIdentity: () => void;
};

type RestaurantDetailTab = "menus" | "info" | "locations";

function formatObservedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function latestRestaurantObservation(menus: readonly RestaurantMenu[]) {
  return menus
    .flatMap((menu) => menu.observations)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id))[0] ?? null;
}

function sourceTypeLabel(sourceType: RestaurantMenu["observations"][number]["sourceType"]) {
  return sourceType === "database_receipt" || sourceType === "receipt" ? "영수증 검증" : "출처 검증";
}

function fulfillmentLabel(type: RestaurantFulfillmentMode["type"]) {
  return type === "delivery" ? "배달" : type === "takeout" ? "포장" : "매장";
}

function RestaurantFulfillmentBadges({ modes, menuContext = false }: {
  modes: readonly RestaurantFulfillmentMode[];
  menuContext?: boolean;
}) {
  if (modes.length === 0) {
    return <span className={styles.restaurantFulfillmentUnknown}>{menuContext ? "이 메뉴의 식당 이용 방식 확인 정보 없음" : "이용 방식 확인 정보 없음"}</span>;
  }
  return <span className={styles.restaurantFulfillmentModes} aria-label={menuContext ? "식당 공통 이용 방식" : "확인된 이용 방식"}>
    {menuContext && <small>식당 공통</small>}
    {modes.map((mode) => <span key={mode.type} title={mode.evidence === "receipt" ? "영수증으로 확인" : "직접 확인"}>{fulfillmentLabel(mode.type)}</span>)}
  </span>;
}

export function RestaurantBrowser({ selectedRestaurant, selectedRestaurantMenuId, onSelectRestaurant, onClearMenuIdentity }: RestaurantBrowserProps) {
  const {
    configured,
    directory,
    detail,
    loading,
    detailLoading,
    error,
    detailError,
    refresh,
  } = useRestaurantMenuCatalog(selectedRestaurant);
  const [query, setQuery] = useState("");
  const [restaurantCategory, setRestaurantCategory] = useState("전체");
  const [detailTab, setDetailTab] = useState<RestaurantDetailTab>("menus");
  const [menuQuery, setMenuQuery] = useState("");
  const [menuCategory, setMenuCategory] = useState("전체");
  const [nutritionMenu, setNutritionMenu] = useState<{ brand: string; menu: RestaurantMenu } | null>(null);
  const nutritionTriggerRef = useRef<HTMLElement | null>(null);
  const entries = useMemo(() => directory?.restaurants ?? [], [directory]);
  const restaurantCategories = useMemo(
    () => restaurantDirectoryCategories(entries),
    [entries],
  );
  const visibleEntries = useMemo(
    () => filterRestaurantDirectoryEntries(entries, query, restaurantCategory),
    [entries, query, restaurantCategory],
  );
  const menuCategories = useMemo(
    () => detail ? restaurantMenuCategories(detail.menus) : [],
    [detail],
  );
  const visibleMenuGroups = useMemo(
    () => detail ? groupRestaurantMenusForDisplay(detail.menus, detail.optionLinks, menuQuery, menuCategory) : [],
    [detail, menuCategory, menuQuery],
  );

  useEffect(() => {
    setDetailTab("menus");
    setMenuQuery("");
    setMenuCategory("전체");
    setNutritionMenu(null);
  }, [selectedRestaurant]);

  if (selectedRestaurantMenuId) {
    return <PrivateIdentityDetail
      selector={{ type: "restaurant_menu", id: selectedRestaurantMenuId }}
      onBack={onClearMenuIdentity}
    />;
  }

  if (!selectedRestaurant) {
    const menuCount = entries.reduce((total, entry) => total + entry.menuCount, 0);
    return <section className={styles.browser}>
      <div className={styles.browserHead}>
        <div>
          <p className={styles.kicker}>RESTAURANTS &amp; MENUS</p>
          <h1>음식점</h1>
          <p>검증된 식당을 선택하면 식당 정보, 확인된 지점, 메뉴별 가격 관측 이력을 한 화면에서 확인합니다.</p>
        </div>
        <label className={styles.search}>
          <span aria-hidden="true">⌕</span>
          <span className={styles.srOnly}>음식점 검색</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="식당 Brand, 업종, 지역 검색"
          />
        </label>
      </div>

      <div className={styles.restaurantBoundaryNotice}>
        <strong>음식점 상세 구조</strong>
        <span>목록은 식당 identity를 찾는 공간이고, 상세 화면은 메뉴·식당 정보·지점 및 출처를 분리해 보여줍니다. 가격은 현재가가 아닌 관측 시점이 있는 기록입니다.</span>
      </div>

      {configured && !loading && !error && entries.length > 0 && <div className={styles.restaurantDirectorySummary} aria-live="polite">
        <span><b>{entries.length}</b>개 식당</span>
        <span><b>{menuCount}</b>개 메뉴</span>
        <span>검증된 공개 기록</span>
      </div>}

      {restaurantCategories.length > 0 && <div className={styles.restaurantCategoryFilters} role="group" aria-label="음식점 카테고리">
        {([{ id: "전체", label: "전체", pathLabel: "전체", depth: 0 }, ...restaurantCategories]).map((category) => <button
          type="button"
          key={category.id}
          title={category.pathLabel}
          aria-pressed={restaurantCategory === category.id}
          className={restaurantCategory === category.id ? styles.restaurantCategoryActive : undefined}
          onClick={() => setRestaurantCategory(category.id)}
        >{category.depth > 0 ? `↳ ${category.label}` : category.label}</button>)}
      </div>}

      {!configured && <div className={styles.restaurantEmpty} role="status">
        <strong>공개 음식점 DB 연결이 필요합니다.</strong>
        <span>PriceTrace Supabase 공개 설정이 연결되면 검증된 음식점과 메뉴 가격 기록을 표시합니다.</span>
      </div>}
      {configured && loading && <p className={styles.emptyState} role="status">음식점 목록을 불러오는 중입니다.</p>}
      {configured && !loading && error && <div className={styles.restaurantError} role="alert">
        <strong>{error}</strong>
        <button type="button" onClick={refresh}>다시 시도</button>
      </div>}
      {configured && !loading && !error && visibleEntries.length === 0 && <div className={styles.restaurantEmpty} role="status">
        <strong>{entries.length === 0 ? "등록된 음식점이 없습니다." : "검색 결과가 없습니다."}</strong>
        <span>{entries.length === 0 ? "검토를 통과한 음식점이 등록되면 이곳에서 식당별 상세 화면으로 들어갈 수 있습니다." : "다른 Brand, 업종, 지역 또는 카테고리로 검색해 보세요."}</span>
      </div>}
      {visibleEntries.length > 0 && <div className={styles.restaurantGrid} aria-live="polite">
        {visibleEntries.map((entry) => <button
          type="button"
          key={entry.restaurant.id}
          className={styles.restaurantCard}
          onClick={() => onSelectRestaurant(entry.restaurant.id)}
        >
          <span className={styles.restaurantCardIcon} aria-hidden="true">🍽</span>
          <span className={styles.restaurantCardBody}>
            <small>{restaurantCategoryPathLabel(entry.restaurant) ?? "음식점"}</small>
            <strong>{entry.restaurant.brand}</strong>
            {entry.restaurant.legalName && <span>{entry.restaurant.legalName}</span>}
            <span>메뉴 {entry.menuCount}개 · 확인 지점 {entry.locations.length}곳</span>
            <RestaurantFulfillmentBadges modes={entry.restaurant.fulfillmentModes} />
            <b>{entry.latestObservedAt ? `최근 관측 ${formatObservedAt(entry.latestObservedAt)}` : "가격 관측 준비 중"}</b>
          </span>
          <span className={styles.arrow} aria-hidden="true">›</span>
        </button>)}
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

  if (detailLoading || (!detail && !detailError)) {
    return <section className={styles.browser}>
      <button className={styles.backLinkButton} type="button" onClick={() => onSelectRestaurant(null)}>← 음식점 목록</button>
      <p className={styles.emptyState} role="status">음식점 상세 정보를 불러오는 중입니다.</p>
    </section>;
  }

  if (detailError) {
    return <section className={styles.browser}><div className={styles.restaurantError} role="alert">
      <strong>{detailError}</strong>
      <button type="button" onClick={refresh}>다시 시도</button>
      <button type="button" onClick={() => onSelectRestaurant(null)}>음식점 목록으로</button>
    </div></section>;
  }

  if (!detail) {
    return <section className={styles.browser}>
      <div className={styles.restaurantEmpty} role="alert">
        <strong>공개된 음식점 identity를 찾을 수 없습니다.</strong>
        <span>목록에서 다시 선택하거나, 관리자 검토가 완료된 공개 식당인지 확인하세요.</span>
        <button type="button" onClick={() => onSelectRestaurant(null)}>음식점 목록으로</button>
      </div>
    </section>;
  }

  const latest = latestRestaurantObservation(detail.menus);
  const tabLabel = detailTab === "menus" ? "메뉴" : detailTab === "info" ? "식당 정보" : "지점·출처";

  return <section className={styles.browser}>
    <div className={styles.restaurantDetailTopline}>
      <button className={styles.backLinkButton} type="button" onClick={() => onSelectRestaurant(null)}>← 음식점 목록</button>
      <span className={styles.restaurantVerifiedBadge}>검증된 공개 식당</span>
    </div>

    <div className={styles.restaurantDetailHeader}>
      <div>
        <p className={styles.kicker}>RESTAURANT DETAIL</p>
        <h1>{detail.restaurant.brand}</h1>
        <p>이 식당의 메뉴와 출처를 계층별로 확인하세요. 메뉴 가격은 지점과 관측 시점이 확인되는 기록이며 현재가나 재고 보장이 아닙니다.</p>
        <RestaurantFulfillmentBadges modes={detail.restaurant.fulfillmentModes} />
      </div>
      <div className={styles.restaurantDetailHeaderMeta}>
        <strong>{detail.menus.length}개 메뉴</strong>
        <span>{detail.locations.length}개 확인 지점</span>
        {latest && <span>최근 관측 {formatObservedAt(latest.observedAt)}</span>}
      </div>
    </div>

    <nav className={styles.restaurantDetailTabs} role="tablist" aria-label={`${detail.restaurant.brand} 상세 메뉴`}>
      {(["menus", "info", "locations"] as const).map((tab) => {
        const label = tab === "menus" ? `메뉴 ${detail.menus.length}` : tab === "info" ? "식당 정보" : `지점·출처 ${detail.locations.length}`;
        return <button
          key={tab}
          type="button"
          id={`restaurant-tab-${tab}`}
          role="tab"
          aria-selected={detailTab === tab}
          aria-controls={`restaurant-panel-${tab}`}
          onClick={() => setDetailTab(tab)}
        >{label}</button>;
      })}
    </nav>

    <p className={styles.restaurantTabStatus} role="status">현재 보고 있는 영역: {tabLabel}</p>

    {detailTab === "menus" && <section id="restaurant-panel-menus" role="tabpanel" aria-labelledby="restaurant-tab-menus" className={styles.restaurantMenus}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>TRACKED MENUS</p><h2>메뉴 가격 기록</h2><p className={styles.restaurantSectionHint}>정확한 메뉴 ID별로 가격 범위와 관측 이력을 확인합니다.</p></div>
      </div>
      {detail.menus.length > 0 && <div className={styles.restaurantMenuToolbar}>
        <label className={styles.restaurantMenuSearch}>
          <span className={styles.srOnly}>메뉴 검색</span>
          <input type="search" value={menuQuery} onChange={(event) => setMenuQuery(event.target.value)} placeholder="메뉴명, 제공 단위 검색" />
        </label>
        <div className={styles.restaurantMenuCategories} role="group" aria-label="메뉴 카테고리">
          {(["전체", ...menuCategories]).map((category) => <button
            key={category}
            type="button"
            className={menuCategory === category ? styles.restaurantMenuCategoryActive : undefined}
            aria-pressed={menuCategory === category}
            onClick={() => setMenuCategory(category)}
          >{category}</button>)}
        </div>
      </div>}
      {detail.menus.length === 0 && <div className={styles.restaurantEmpty} role="status">
        <strong>등록된 메뉴가 아직 없습니다.</strong>
        <span>식당 정보는 확인됐지만 메뉴 identity와 가격 관측이 공개된 상태는 아닙니다.</span>
      </div>}
      {detail.menus.length > 0 && visibleMenuGroups.length === 0 && <div className={styles.restaurantEmpty} role="status">
        <strong>조건에 맞는 메뉴가 없습니다.</strong>
        <span>다른 메뉴명이나 카테고리를 선택해 보세요.</span>
      </div>}
      <div className={styles.restaurantMenuList}>
        {visibleMenuGroups.map(({ menu, options }) => {
          const summary = summarizeRestaurantMenuPrices(menu);
          const menuLatest = latestRestaurantMenuObservation(menu);
          return <article key={menu.id} className={styles.restaurantMenuCard}>
            <header>
              <div>
                {restaurantMenuNameLooksLikeOption(menu.name) && options.length === 0 && <span className={styles.restaurantMenuOptionBadge}>추가 옵션 후보 · 부모 연결 대기</span>}
                <small>{menu.categoryLabel ?? "메뉴"} · {menu.servingLabel}</small>
                <h3>{menu.name}</h3>
                <code title="Fitness Nutrition exact link key">catalog_product_id {menu.catalogProductId}</code>
                <RestaurantFulfillmentBadges modes={detail.restaurant.fulfillmentModes} menuContext />
              </div>
              <div className={styles.restaurantMenuLatest}>
                <span>최근 관측가</span>
                <strong>{menuLatest ? formatKrw(menuLatest.unitPriceKrw) : "기록 없음"}</strong>
                {menuLatest && <small>{menuLatest.locationLabel ?? "지점 미상"} · {formatObservedAt(menuLatest.observedAt)}</small>}
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
                  setNutritionMenu({ brand: detail.restaurant.brand, menu });
                }}
              >Nutrition DB 영양성분</button>
              {menu.officialUrl && <a href={menu.officialUrl} target="_blank" rel="noreferrer">공식 메뉴 보기</a>}
            </div>

            <details className={styles.restaurantPriceHistory}>
              <summary>가격 관측 이력 {menu.observations.length}건</summary>
              {menu.observations.length === 0
                ? <p>공개된 가격 관측이 없습니다.</p>
                : <div>{[...menu.observations]
                  .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id))
                  .map((observation) => <article key={observation.id}>
                    <span><strong>{observation.locationLabel ?? "지점 미상"}</strong><small>{formatObservedAt(observation.observedAt)} · {sourceTypeLabel(observation.sourceType)}</small></span>
                    <b>{formatKrw(observation.unitPriceKrw)}</b>
                    {observation.receiptReference && <small>영수증 {observation.receiptReference.receiptId} · 항목 {observation.receiptReference.receiptItemId}</small>}
                  </article>)}</div>}
            </details>
            {options.length > 0 && <section className={styles.restaurantMenuOptions} aria-label={menu.name + " 추가 옵션"}>
              <div className={styles.restaurantMenuOptionsHeading}>
                <strong>추가 옵션</strong>
                <span>정확한 메뉴 ID 관계</span>
              </div>
              <ul className={styles.restaurantMenuOptionList}>
                {options.map(({ menu: option, link }) => {
                  const optionLatest = latestRestaurantMenuObservation(option);
                  return <li key={option.id}>
                    <div>
                      <strong>{option.name}</strong>
                      <small>{link.source === "automatic" ? "자동 인식 · 같은 영수증의 유일한 기본 메뉴" : "관리자 수동 연결"}</small>
                      <code>catalog_product_id {option.catalogProductId}</code>
                    </div>
                    <b>{optionLatest ? formatKrw(optionLatest.unitPriceKrw) : "기록 없음"}</b>
                  </li>;
                })}
              </ul>
            </section>}
          </article>;
        })}
      </div>
    </section>}

    {detailTab === "info" && <section id="restaurant-panel-info" role="tabpanel" aria-labelledby="restaurant-tab-info" className={styles.restaurantInfoPanel}>
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>RESTAURANT PROFILE</p><h2>식당 정보</h2></div></div>
      <dl className={styles.restaurantInfoGrid}>
        <div><dt>Brand</dt><dd>{detail.restaurant.brand}</dd></div>
        <div><dt>법적 상호</dt><dd>{detail.restaurant.legalName ?? "정보 없음"}</dd></div>
        <div><dt>업종</dt><dd>{restaurantCategoryPathLabel(detail.restaurant) ?? "정보 없음"}</dd></div>
        <div><dt>메뉴 수</dt><dd>{detail.menus.length}개</dd></div>
        <div><dt>확인 지점</dt><dd>{detail.locations.length}곳</dd></div>
        <div><dt>이용 방식</dt><dd><RestaurantFulfillmentBadges modes={detail.restaurant.fulfillmentModes} /></dd></div>
        <div><dt>정보 업데이트</dt><dd>{formatUpdatedAt(detail.restaurant.updatedAt)}</dd></div>
      </dl>
      {detail.restaurant.officialSiteUrl && <a className={styles.restaurantOfficialLink} href={detail.restaurant.officialSiteUrl} target="_blank" rel="noreferrer">공식 사이트 확인 ↗</a>}
      <div className={styles.restaurantDataNotice}>
        <strong>공개 데이터 범위</strong>
        <span>식당·메뉴 identity는 검토된 공개 데이터만 표시합니다. 메뉴명만으로 Nutrition DB나 다른 상품을 자동 연결하지 않고, 정확한 catalog_product_id를 사용합니다.</span>
      </div>
    </section>}

    {detailTab === "locations" && <section id="restaurant-panel-locations" role="tabpanel" aria-labelledby="restaurant-tab-locations" className={styles.restaurantLocations}>
      <div className={styles.sectionHeading}><div><p className={styles.kicker}>VERIFIED SOURCES</p><h2>확인된 지점·출처</h2><p className={styles.restaurantSectionHint}>지점명과 source identity를 분리해 보관합니다.</p></div></div>
      {detail.locations.length === 0 && <div className={styles.restaurantEmpty} role="status"><strong>확인된 지점이 없습니다.</strong><span>식당 identity는 공개됐지만 지점 출처가 아직 연결되지 않았습니다.</span></div>}
      {detail.locations.length > 0 && <div className={styles.restaurantLocationGrid}>
        {detail.locations.map((location) => <article key={location.id}>
          <strong>{location.locationLabel ?? detail.restaurant.brand}</strong>
          <small>{location.sourceLabel} · {location.sourceRestaurantCode}</small>
          {location.sourceUrl && <a href={location.sourceUrl} target="_blank" rel="noreferrer">출처 보기 ↗</a>}
        </article>)}
      </div>}
    </section>}

    {nutritionMenu && <StandardProductNutritionModal
      title="메뉴 영양 정보"
      standardName={`${nutritionMenu.brand} · ${nutritionMenu.menu.name}`}
      catalogProductIds={[nutritionMenu.menu.catalogProductId]}
      restoreFocusRef={nutritionTriggerRef}
      onClose={() => setNutritionMenu(null)}
    />}
  </section>;
}
