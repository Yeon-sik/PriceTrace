"use client";

import { useMemo, useState } from "react";
import { latestOwnerMenuPrice, ownerMenuPriceHistory } from "@/domain/owner-confirmed-restaurant";
import { formatKrw } from "@/domain/settlement";
import { useOwnerConfirmedRestaurants } from "@/features/restaurant-menu/use-owner-confirmed-restaurants";
import styles from "./page.module.css";
import privateStyles from "./OwnerConfirmedRestaurants.module.css";

export function RestaurantScopeSwitch({ privateView, onChange }: { privateView: boolean; onChange: (value: boolean) => void }) {
  return <div className={privateStyles.scopeSwitch} role="group" aria-label="음식점 기록 범위">
    <button type="button" aria-pressed={!privateView} onClick={() => onChange(false)}>공개 식당</button>
    <button type="button" aria-pressed={privateView} onClick={() => onChange(true)}>내 확인 식당</button>
  </div>;
}

export function OwnerConfirmedRestaurants({ onPublic }: { onPublic: () => void }) {
  const { status, read, error, refresh } = useOwnerConfirmedRestaurants();
  const [query, setQuery] = useState("");
  const restaurants = useMemo(() => (read?.restaurants ?? []).filter(restaurant =>
    [restaurant.name, restaurant.branchName, ...restaurant.menus.map(menu => menu.name)].some(value => value?.includes(query.trim()))), [read, query]);
  return <section className={styles.browser} aria-label="내 확인 식당">
    <div className={styles.browserHead}>
      <div><h1>내 확인 식당</h1><p>직접 확인한 구매에서 모은 메뉴와 가격 기록입니다. 내 계정에서만 조회할 수 있습니다.</p></div>
      {status === "ready" && <label className={styles.search}><span className={styles.srOnly}>내 확인 식당 검색</span>
        <input type="search" placeholder="식당·지점·메뉴 검색" value={query} onChange={event => setQuery(event.target.value)} />
      </label>}
    </div>
    <RestaurantScopeSwitch privateView onChange={value => { if (!value) onPublic(); }} />
    {status === "signed_out" && <div className={styles.restaurantEmpty} role="status"><strong>로그인이 필요합니다.</strong><span>로그인하면 내가 확인한 식당과 구매 날짜별 가격 기록을 볼 수 있습니다.</span></div>}
    {status === "loading" && <p className={styles.emptyState} role="status">내 확인 식당을 불러오는 중입니다.</p>}
    {status === "error" && <div className={styles.restaurantError} role="alert"><strong>{error}</strong><button type="button" onClick={refresh}>다시 시도</button></div>}
    {status === "ready" && <>
      <div className={privateStyles.recordHeading}><p>사용자 확인 · 본인에게만 표시</p><button type="button" onClick={refresh}>새로고침</button></div>
      {restaurants.length === 0 && <div className={styles.restaurantEmpty} role="status"><strong>{read?.restaurants.length ? "검색 결과가 없습니다." : "아직 확인한 식당이 없습니다."}</strong>
        <span>{read?.restaurants.length ? "다른 식당명이나 메뉴명으로 검색해 보세요." : "OCR App에서 식당 구매를 검토하고 등록하면 이곳에 메뉴와 가격 이력이 쌓입니다."}</span></div>}
      <div className={privateStyles.restaurants}>
        {restaurants.map(restaurant => <details key={restaurant.id} className={privateStyles.restaurant} open>
          <summary><span><strong>{restaurant.name}</strong>{restaurant.branchName && <span>{restaurant.branchName}</span>}</span><span>메뉴 {restaurant.menus.length}개</span></summary>
          {restaurant.menus.map(menu => {
            const latest = latestOwnerMenuPrice(menu);
            const latestPrice = latest?.unitPriceKrw ?? latest?.netPriceKrw ?? latest?.grossPriceKrw;
            const history = ownerMenuPriceHistory(menu);
            return <article key={menu.id} className={privateStyles.menu} aria-label={menu.name}>
              <div className={privateStyles.menuHeading}><div><h2>{menu.name}</h2>{menu.servingLabel && <p>{menu.servingLabel}</p>}</div>
                {latest && <div className={privateStyles.latest}><strong>{latestPrice === null || latestPrice === undefined ? "미기록" : formatKrw(latestPrice)}</strong>
                  <span>{latest.unitPriceKrw !== null ? "최근 개당 관측가" : "최근 합계 관측가"} · <time dateTime={latest.observedOn}>{latest.observedOn}</time></span></div>}
              </div>
              {!!menu.components?.length && <ul aria-label={`${menu.name} 구성요소`}>
                {menu.components.map(component => <li key={component.id}>{component.name} · {component.role === "complimentary_side" ? "함께 제공" : component.role} · 가격 미관측</li>)}
              </ul>}
              <details className={privateStyles.history}><summary>가격 이력 {history.length}건</summary>
                <div className={privateStyles.tableScroll} role="region" aria-label={`${menu.name} 가격 이력`} tabIndex={0}>
                  <table><caption className={styles.srOnly}>{menu.name} 구매 날짜별 가격</caption><thead><tr><th>구매 날짜</th><th>개당 가격</th><th>수량</th><th>구매 합계</th></tr></thead>
                    <tbody>{history.map(price => <tr key={price.id}><td><time dateTime={price.observedOn}>{price.observedOn}</time></td><td>{price.unitPriceKrw === null ? "미기록" : formatKrw(price.unitPriceKrw)}</td><td>{price.quantity ?? "미기록"}</td><td>{price.netPriceKrw !== null || price.grossPriceKrw !== null ? formatKrw(price.netPriceKrw ?? price.grossPriceKrw!) : "미기록"}</td></tr>)}</tbody>
                  </table>
                </div>
              </details>
            </article>;
          })}
        </details>)}
      </div>
    </>}
  </section>;
}
