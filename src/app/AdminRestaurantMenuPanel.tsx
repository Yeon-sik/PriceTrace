"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  RestaurantMenuReadEntry,
  RestaurantMenuReceiptCandidate,
  RestaurantMenuRegistrationResult,
  RestaurantCategoryNodeRow,
  RestaurantDirectoryEntry,
} from "@/domain/restaurant-menu";
import { formatKrw } from "@/domain/settlement";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { RestaurantMenuRepository } from "@/repositories/restaurant-menu.repository";
import { AdminDirectRestaurantMenuPanel } from "./AdminDirectRestaurantMenuPanel";
import { AdminRestaurantMenuOptionPanel } from "./AdminRestaurantMenuOptionPanel";
import { AdminRestaurantProfileEditor } from "./AdminRestaurantProfileEditor";
import styles from "./page.module.css";

type RegistrationTab = "receipt" | "direct";

type FormState = {
  idempotencyKey: string;
  priceObservationId: string;
  restaurantId: string;
  restaurantName: string;
  restaurantLegalName: string;
  cuisineType: string;
  restaurantOfficialSiteUrl: string;
  restaurantSourceNamespace: "pricetrace-db-store";
  restaurantSourceCode: string;
  locationLabel: string;
  locationOfficialUrl: string;
  restaurantMenuId: string;
  menuName: string;
  menuCategoryLabel: string;
  servingLabel: string;
  menuOfficialUrl: string;
  fulfillmentType: "" | "delivery" | "takeout" | "dine_in";
};

function newIdempotencyKey() {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `restaurant-menu:${id}`;
}

function initialForm(): FormState {
  return {
    idempotencyKey: newIdempotencyKey(),
    priceObservationId: "",
    restaurantId: "",
    restaurantName: "",
    restaurantLegalName: "",
    cuisineType: "",
    restaurantOfficialSiteUrl: "",
    restaurantSourceNamespace: "pricetrace-db-store",
    restaurantSourceCode: "",
    locationLabel: "",
    locationOfficialUrl: "",
    restaurantMenuId: "",
    menuName: "",
    menuCategoryLabel: "",
    servingLabel: "1인분",
    menuOfficialUrl: "",
    fulfillmentType: "",
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

function candidateLabel(candidate: RestaurantMenuReceiptCandidate) {
  return `${candidate.observed_on} · ${candidate.store_name} · ${candidate.product_name} · ${formatKrw(candidate.total_price_krw)}`;
}

function categoryRestaurantLabel(entry: RestaurantDirectoryEntry) {
  const location = entry.locations.find((candidate) => candidate.locationLabel)?.locationLabel
    ?? "지점 미지정";
  const legalName = entry.restaurant.legalName
    && entry.restaurant.legalName !== entry.restaurant.brand
    ? ` · ${entry.restaurant.legalName}`
    : "";
  return `${entry.restaurant.brand}${legalName} · ${location} · ${entry.restaurant.id.slice(0, 8)}`;
}

function restaurantCategoryRowPathLabel(
  category: RestaurantCategoryNodeRow,
  categories: readonly RestaurantCategoryNodeRow[],
) {
  const byId = new Map(categories.map((node) => [node.id, node]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current: RestaurantCategoryNodeRow | undefined = category;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current.display_name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path.reverse().join(" › ");
}

function fulfillmentLabel(type: "delivery" | "takeout" | "dine_in") {
  return type === "delivery" ? "배달" : type === "takeout" ? "포장" : "매장";
}

export function AdminRestaurantMenuPanel() {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(
    () => client ? new RestaurantMenuRepository(client) : null,
    [client],
  );
  const [entries, setEntries] = useState<RestaurantMenuReadEntry[]>([]);
  const [categoryRestaurants, setCategoryRestaurants] = useState<RestaurantDirectoryEntry[]>([]);
  const [restaurantCategories, setRestaurantCategories] = useState<RestaurantCategoryNodeRow[]>([]);
  const [candidates, setCandidates] = useState<RestaurantMenuReceiptCandidate[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(Boolean(repository));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<RestaurantMenuRegistrationResult | null>(null);
  const [registrationTab, setRegistrationTab] = useState<RegistrationTab>("receipt");
  const [categoryRestaurantId, setCategoryRestaurantId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [fulfillmentSaving, setFulfillmentSaving] = useState<"delivery" | "takeout" | "dine_in" | null>(null);

  const load = useCallback(async () => {
    if (!repository) return;
    setLoading(true);
    setError("");
    try {
      const [catalog, directory, categories, receiptCandidates] = await Promise.all([
        repository.read({ limit: 200 }),
        repository.readDirectory({ limit: 200 }),
        repository.readCategories(),
        repository.readAdminReceiptCandidates(),
      ]);
      const directoryById = new Map(directory.restaurants.map((entry) => [
        entry.restaurant.id,
        entry.restaurant,
      ]));
      setEntries(catalog.restaurants.map((entry) => ({
        ...entry,
        restaurant: {
          ...entry.restaurant,
          category: directoryById.get(entry.restaurant.id)?.category ?? null,
        },
      })));
      setCategoryRestaurants(directory.restaurants);
      setRestaurantCategories(categories);
      setCandidates(receiptCandidates);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "음식점 메뉴 등록 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [repository]);

  useEffect(() => { void load(); }, [load]);

  const selectedCandidate = candidates.find((candidate) => (
    candidate.price_observation_id === form.priceObservationId
  )) ?? null;
  const selectedRestaurant = entries.find((entry) => entry.restaurant.id === form.restaurantId) ?? null;
  const selectedMenu = selectedRestaurant?.menus.find((menu) => menu.id === form.restaurantMenuId) ?? null;
  const selectedLocation = selectedRestaurant && selectedCandidate
    ? selectedRestaurant.locations.find((location) => (
      location.sourceLabel === "pricetrace-db-store"
      && location.sourceRestaurantCode === selectedCandidate.store_id
    )) ?? null
    : null;
  const leafRestaurantCategories = useMemo(() => {
    const parentIds = new Set(restaurantCategories.flatMap((category) => (
      category.parent_id ? [category.parent_id] : []
    )));
    return restaurantCategories.filter((category) => !parentIds.has(category.id));
  }, [restaurantCategories]);

  function chooseCategoryRestaurant(restaurantId: string) {
    const restaurant = categoryRestaurants.find((entry) => entry.restaurant.id === restaurantId);
    setCategoryRestaurantId(restaurantId);
    setCategoryId(restaurant?.restaurant.category?.id ?? "");
    setError("");
    setMessage("");
  }

  async function saveRestaurantCategory() {
    if (!repository || !categoryRestaurantId) {
      setError("카테고리를 연결할 음식점을 선택하세요.");
      return;
    }
    setCategorySaving(true);
    setError("");
    setMessage("");
    try {
      await repository.setRestaurantCategory(categoryRestaurantId, categoryId || null);
      setMessage(categoryId ? "음식점 카테고리를 연결했습니다." : "음식점 카테고리 연결을 해제했습니다.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "음식점 카테고리를 연결하지 못했습니다.");
    } finally {
      setCategorySaving(false);
    }
  }

  async function confirmRestaurantFulfillmentManually(type: "delivery" | "takeout" | "dine_in") {
    if (!repository || !categoryRestaurantId) {
      setError("이용 방식을 확인할 음식점을 선택하세요.");
      return;
    }
    setFulfillmentSaving(type);
    setError("");
    setMessage("");
    try {
      const result = await repository.confirmRestaurantFulfillmentManual(categoryRestaurantId, type);
      setMessage(result.replayed
        ? `${fulfillmentLabel(type)} 이용 방식은 이미 직접 확인되어 있습니다.`
        : `${fulfillmentLabel(type)} 이용 방식을 직접 확인으로 등록했습니다.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "음식점 이용 방식을 저장하지 못했습니다.");
    } finally {
      setFulfillmentSaving(null);
    }
  }

  function chooseCandidate(priceObservationId: string) {
    const candidate = candidates.find((entry) => entry.price_observation_id === priceObservationId) ?? null;
    const exactRestaurant = candidate
      ? entries.find((entry) => entry.locations.some((location) => (
        location.sourceLabel === "pricetrace-db-store"
        && location.sourceRestaurantCode === candidate.store_id
      ))) ?? null
      : null;
    setForm((current) => ({
      ...current,
      idempotencyKey: newIdempotencyKey(),
      priceObservationId,
      restaurantId: exactRestaurant?.restaurant.id ?? "",
      restaurantName: candidate?.store_name ?? "",
      restaurantLegalName: exactRestaurant?.restaurant.legalName ?? "",
      cuisineType: exactRestaurant?.restaurant.cuisineType ?? "",
      restaurantOfficialSiteUrl: exactRestaurant?.restaurant.officialSiteUrl ?? "",
      restaurantSourceCode: candidate?.store_id ?? "",
      locationLabel: exactRestaurant?.locations.find((location) => (
        location.sourceLabel === "pricetrace-db-store"
        && location.sourceRestaurantCode === candidate?.store_id
      ))?.locationLabel ?? candidate?.location_label ?? "",
      locationOfficialUrl: exactRestaurant?.locations.find((location) => (
        location.sourceLabel === "pricetrace-db-store"
        && location.sourceRestaurantCode === candidate?.store_id
      ))?.sourceUrl ?? "",
      restaurantMenuId: "",
      menuName: candidate?.product_name ?? "",
      menuCategoryLabel: "",
      servingLabel: "1인분",
      menuOfficialUrl: "",
      fulfillmentType: "",
    }));
    setMessage("");
    setError("");
    setResult(null);
  }

  function chooseRestaurant(restaurantId: string) {
    const restaurant = entries.find((entry) => entry.restaurant.id === restaurantId) ?? null;
    const sourceLocation = restaurant && selectedCandidate
      ? restaurant.locations.find((location) => (
        location.sourceLabel === "pricetrace-db-store"
        && location.sourceRestaurantCode === selectedCandidate.store_id
      )) ?? null
      : null;
    setForm((current) => ({
      ...current,
      restaurantId,
      restaurantName: restaurant?.restaurant.brand ?? selectedCandidate?.store_name ?? "",
      restaurantLegalName: restaurant?.restaurant.legalName ?? "",
      cuisineType: restaurant?.restaurant.cuisineType ?? "",
      restaurantOfficialSiteUrl: restaurant?.restaurant.officialSiteUrl ?? "",
      locationLabel: sourceLocation?.locationLabel ?? selectedCandidate?.location_label ?? "",
      locationOfficialUrl: sourceLocation?.sourceUrl ?? "",
      restaurantMenuId: "",
      menuName: selectedCandidate?.product_name ?? "",
      menuCategoryLabel: "",
      servingLabel: "1인분",
      menuOfficialUrl: "",
      fulfillmentType: "",
    }));
    setError("");
  }

  function chooseMenu(menuId: string) {
    const menu = selectedRestaurant?.menus.find((entry) => entry.id === menuId) ?? null;
    if (menu && selectedCandidate && menu.name !== selectedCandidate.product_name) {
      setError("선택한 메뉴명과 영수증의 menu_item 이름이 다릅니다. 이름만으로 자동 연결하지 않으므로 정확한 메뉴를 선택하세요.");
      return;
    }
    setForm((current) => ({
      ...current,
      restaurantMenuId: menuId,
      menuName: menu?.name ?? selectedCandidate?.product_name ?? "",
      menuCategoryLabel: menu?.categoryLabel ?? "",
      servingLabel: menu?.servingLabel ?? "1인분",
      menuOfficialUrl: menu?.officialUrl ?? "",
    }));
    setError("");
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository || !selectedCandidate) {
      setError("서버가 검증한 menu_item 영수증 관측을 먼저 선택하세요.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    setResult(null);
    try {
      const registered = await repository.registerReceiptObservation({
        idempotencyKey: form.idempotencyKey,
        priceObservationId: selectedCandidate.price_observation_id,
        restaurantId: nullable(form.restaurantId),
        restaurantName: form.restaurantName,
        restaurantLegalName: nullable(form.restaurantLegalName),
        cuisineType: nullable(form.cuisineType),
        restaurantOfficialSiteUrl: nullable(form.restaurantOfficialSiteUrl),
        restaurantSourceNamespace: form.restaurantSourceNamespace,
        restaurantSourceCode: selectedCandidate.store_id,
        locationLabel: nullable(form.locationLabel),
        locationOfficialUrl: nullable(form.locationOfficialUrl),
        restaurantMenuId: nullable(form.restaurantMenuId),
        menuName: form.menuName,
        menuCategoryLabel: nullable(form.menuCategoryLabel),
        servingLabel: form.servingLabel,
        menuOfficialUrl: nullable(form.menuOfficialUrl),
      });
      if (form.fulfillmentType) {
        await repository.confirmRestaurantFulfillmentFromReceipt(
          registered.restaurantId,
          registered.receiptObservationId,
          form.fulfillmentType,
        );
      }
      setResult(registered);
      setMessage(registered.replayed
        ? form.fulfillmentType ? "기존 영수증 메뉴 등록 결과와 이용 방식 확인을 다시 확인했습니다." : "동일 요청을 다시 쓰지 않고 기존 등록 결과를 확인했습니다."
        : form.fulfillmentType
          ? "서버가 영수증 FK chain과 금액 보존식을 확인한 뒤 음식점·메뉴 가격과 이용 방식을 등록했습니다."
          : "서버가 영수증 FK chain과 금액 보존식을 확인한 뒤 음식점·메뉴 가격을 등록했습니다.");
      setForm(initialForm());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "음식점 메뉴 관측 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!repository) {
    return <section className={styles.restaurantAdminPanel}><div className={styles.restaurantEmpty} role="status"><strong>Supabase 관리자 연결이 필요합니다.</strong><span>환경 설정과 관리자 로그인을 확인한 뒤 음식점·메뉴를 등록하세요.</span></div></section>;
  }

  return <section className={styles.restaurantAdminPanel} aria-labelledby="restaurant-admin-title">
    <div className={styles.adminSectionHead}>
      <div><p className={styles.kicker}>RESTAURANT MENU REGISTRATION</p><h2 id="restaurant-admin-title">음식점·메뉴 가격 등록</h2><p>영수증 연결과 직접 연결을 분리합니다. 직접 연결에서는 전체 정보를 입력하거나 FitnessApp·CashOS에서 식당·메뉴 정보를 불러올 수 있습니다.</p></div>
      <button type="button" onClick={() => void load()} disabled={loading || saving}>후보 새로고침</button>
    </div>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.restaurantAdminSuccess} role="status">{message}</p>}
    {result && <dl className={styles.restaurantAdminResult}>
      <div><dt>음식점 ID</dt><dd><code>{result.restaurantId}</code></dd></div>
      <div><dt>지점 ID</dt><dd><code>{result.restaurantLocationId}</code></dd></div>
      <div><dt>메뉴 ID</dt><dd><code>{result.restaurantMenuId}</code></dd></div>
      <div><dt>Fitness 연결 키</dt><dd><code>{result.catalogProductId}</code></dd></div>
      <div><dt>영수증 관측 ID</dt><dd><code>{result.receiptObservationId}</code></dd></div>
    </dl>}

    {restaurantCategories.length > 0 && <section className={styles.restaurantCategoryLinker} aria-labelledby="restaurant-category-link-title">
      <div>
        <h3 id="restaurant-category-link-title">음식점 카테고리 연결</h3>
        <p>음식점은 자동 분류하지 않습니다. 확인한 음식점에 세부 카테고리를 직접 연결합니다.</p>
      </div>
      <label>음식점<select value={categoryRestaurantId} onChange={(event) => chooseCategoryRestaurant(event.target.value)}>
        <option value="">음식점을 선택하세요</option>
        {categoryRestaurants.map((entry) => <option key={entry.restaurant.id} value={entry.restaurant.id}>{categoryRestaurantLabel(entry)}</option>)}
      </select></label>
      <label>세부 카테고리<select disabled={!categoryRestaurantId} value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
        <option value="">연결 안 함</option>
        {leafRestaurantCategories.map((category) => <option key={category.id} value={category.id}>{restaurantCategoryRowPathLabel(category, restaurantCategories)}</option>)}
      </select></label>
      <button type="button" disabled={!categoryRestaurantId || categorySaving} onClick={() => void saveRestaurantCategory()}>{categorySaving ? "저장 중…" : "카테고리 저장"}</button>
    </section>}

    <AdminRestaurantProfileEditor repository={repository} />

    <section className={styles.restaurantFulfillmentLinker} aria-labelledby="restaurant-fulfillment-title">
      <div>
        <h3 id="restaurant-fulfillment-title">음식점 이용 방식 확인</h3>
        <p>직접 확인한 배달·포장·매장 제공 방식만 추가합니다. 등록되지 않은 방식은 불가가 아니라 확인 정보 없음입니다.</p>
      </div>
      <label>음식점<select value={categoryRestaurantId} onChange={(event) => chooseCategoryRestaurant(event.target.value)}>
        <option value="">음식점을 선택하세요</option>
        {categoryRestaurants.map((entry) => <option key={entry.restaurant.id} value={entry.restaurant.id}>{categoryRestaurantLabel(entry)}</option>)}
      </select></label>
      <div className={styles.restaurantFulfillmentActions} aria-label="직접 확인할 이용 방식">
        {(["delivery", "takeout", "dine_in"] as const).map((type) => {
          const confirmed = categoryRestaurants.find((entry) => entry.restaurant.id === categoryRestaurantId)
            ?.restaurant.fulfillmentModes.some((mode) => mode.type === type) ?? false;
          return <button key={type} type="button" disabled={!categoryRestaurantId || fulfillmentSaving !== null} onClick={() => void confirmRestaurantFulfillmentManually(type)}>
            {fulfillmentSaving === type ? "저장 중…" : confirmed ? `${fulfillmentLabel(type)} 확인됨` : `${fulfillmentLabel(type)} 직접 확인`}
          </button>;
        })}
      </div>
    </section>

    <AdminRestaurantMenuOptionPanel repository={repository} entries={entries} onSaved={load} />

    <div className={styles.unverifiedModeTabs} role="tablist" aria-label="음식점 메뉴 등록 방식">
      <button type="button" role="tab" aria-selected={registrationTab === "receipt"} onClick={() => setRegistrationTab("receipt")}>영수증 연결</button>
      <button type="button" role="tab" aria-selected={registrationTab === "direct"} onClick={() => setRegistrationTab("direct")}>직접 연결</button>
    </div>

    {registrationTab === "receipt" && <form className={styles.restaurantAdminForm} onSubmit={register}>
      <fieldset>
        <legend>1. 서버 검증 영수증 관측</legend>
        <label className={styles.restaurantAdminWide}>등록 후보<select required value={form.priceObservationId} onChange={(event) => chooseCandidate(event.target.value)}><option value="">menu_item 영수증 관측을 선택하세요</option>{candidates.map((candidate) => <option key={candidate.price_observation_id} value={candidate.price_observation_id}>{candidateLabel(candidate)}</option>)}</select></label>
        {selectedCandidate && <div className={styles.restaurantReceiptEvidence}>
          <span><small>식당</small><strong>{selectedCandidate.store_name}</strong></span>
          <span><small>메뉴</small><strong>{selectedCandidate.product_name}</strong></span>
          <span><small>가격 보존식</small><strong>{formatKrw(selectedCandidate.unit_price_krw)} × {selectedCandidate.quantity} = {formatKrw(selectedCandidate.total_price_krw)}</strong></span>
          <span><small>관측일</small><strong>{selectedCandidate.observed_on}</strong></span>
          <code>price_observation_id {selectedCandidate.price_observation_id}</code>
        </div>}
        {!loading && candidates.length === 0 && <p className={styles.restaurantAdminHint}>등록 가능한 DB 영수증이 없습니다. 먼저 상품의 purchase_type이 menu_item인 영수증을 PriceTrace DB에 저장해야 합니다.</p>}
        <label>영수증 이용 방식 확인<select value={form.fulfillmentType} onChange={(event) => setForm((current) => ({ ...current, fulfillmentType: event.target.value as FormState["fulfillmentType"] }))}>
          <option value="">이번 영수증에서는 확인 안 함</option>
          <option value="delivery">배달</option>
          <option value="takeout">포장</option>
          <option value="dine_in">매장</option>
        </select><small>영수증이나 제출자가 직접 확인한 경우에만 선택하세요. 배달료·할인 문구만으로 추정하지 않습니다.</small></label>
      </fieldset>

      <fieldset disabled={!selectedCandidate}>
        <legend>2. 음식점 identity</legend>
        <label>기존 음식점<select value={form.restaurantId} onChange={(event) => chooseRestaurant(event.target.value)}><option value="">정확 source identity로 새 음식점 등록</option>{entries.map((entry) => <option key={entry.restaurant.id} value={entry.restaurant.id}>{entry.restaurant.brand}</option>)}</select></label>
        <label>Fitness Brand<input required readOnly value={form.restaurantName} /></label>
        <label>source namespace<input readOnly value={form.restaurantSourceNamespace} /></label>
        <label>source store ID<input readOnly value={form.restaurantSourceCode} /></label>
        <label>지점 표기<input value={form.locationLabel} readOnly={Boolean(selectedLocation)} onChange={(event) => setForm({ ...form, locationLabel: event.target.value })} placeholder="예: 강남점" /></label>
      </fieldset>

      <fieldset disabled={!selectedCandidate}>
        <legend>3. 정확 메뉴 identity</legend>
        <label>기존 메뉴<select value={form.restaurantMenuId} onChange={(event) => chooseMenu(event.target.value)} disabled={!selectedRestaurant}><option value="">새 exact menu catalog ID 생성</option>{selectedRestaurant?.menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name} · {menu.servingLabel}</option>)}</select></label>
        <label>메뉴명<input required readOnly value={form.menuName} /></label>
        <label>메뉴 분류<input value={form.menuCategoryLabel} readOnly={Boolean(selectedMenu)} onChange={(event) => setForm({ ...form, menuCategoryLabel: event.target.value })} placeholder="예: 식사" /></label>
        <label>제공 기준<input required value={form.servingLabel} readOnly={Boolean(selectedMenu)} onChange={(event) => setForm({ ...form, servingLabel: event.target.value })} /></label>
        <label>공식 메뉴 URL<input type="url" value={form.menuOfficialUrl} readOnly={Boolean(selectedMenu)} onChange={(event) => setForm({ ...form, menuOfficialUrl: event.target.value })} placeholder="https://" /></label>
      </fieldset>

      <details className={styles.restaurantAdminOptional}>
        <summary>음식점 부가 정보</summary>
        <div>
          <label>법적 상호<input value={form.restaurantLegalName} readOnly={Boolean(selectedRestaurant)} onChange={(event) => setForm({ ...form, restaurantLegalName: event.target.value })} /></label>
          <label>업종<input value={form.cuisineType} readOnly={Boolean(selectedRestaurant)} onChange={(event) => setForm({ ...form, cuisineType: event.target.value })} placeholder="예: 한식" /></label>
          <label>식당 공식 사이트<input type="url" value={form.restaurantOfficialSiteUrl} readOnly={Boolean(selectedRestaurant)} onChange={(event) => setForm({ ...form, restaurantOfficialSiteUrl: event.target.value })} placeholder="https://" /></label>
          <label>지점 공식 URL<input type="url" value={form.locationOfficialUrl} readOnly={Boolean(selectedLocation)} onChange={(event) => setForm({ ...form, locationOfficialUrl: event.target.value })} placeholder="https://" /></label>
        </div>
      </details>

      <div className={styles.restaurantAdminSubmit}>
        <p>등록 RPC가 DB 영수증·항목·가격 관측·store product·menu_item 타입을 잠그고 다시 검증합니다. 같은 source mapping은 정확한 메뉴를 재사용하지만 이름만 같은 다른 식당이나 메뉴는 재사용하지 않습니다.</p>
        <button type="submit" disabled={saving || !selectedCandidate}>{saving ? "서버 검증 및 등록 중…" : "영수증 관측으로 등록"}</button>
      </div>
    </form>}
    {registrationTab === "direct" && <AdminDirectRestaurantMenuPanel />}
  </section>;
}
