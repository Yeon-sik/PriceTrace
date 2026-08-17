"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  AdminUnverifiedRestaurantMenuResult,
} from "@/domain/admin-unverified-registration";
import type { RestaurantMenuReadEntry } from "@/domain/restaurant-menu";
import { formatKrw } from "@/domain/settlement";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { AdminUnverifiedRegistrationRepository } from "@/repositories/admin-unverified-registration.repository";
import { RestaurantMenuRepository } from "@/repositories/restaurant-menu.repository";
import {
  RestaurantMenuSourceRepository,
  type ImportedRestaurantMenu,
} from "@/repositories/restaurant-menu-source.repository";
import { AdminFitnessNutritionAuthPanel } from "./AdminFitnessNutritionAuthPanel";
import styles from "./page.module.css";

type DirectSourceMode = "manual" | "fitnessapp" | "cashos";

type RestaurantForm = {
  restaurantId: string;
  restaurantName: string;
  restaurantLegalName: string;
  cuisineType: string;
  restaurantOfficialSiteUrl: string;
  sourceLocationCode: string;
  locationLabel: string;
  locationOfficialUrl: string;
  restaurantMenuId: string;
  menuName: string;
  menuCategoryLabel: string;
  servingLabel: string;
  menuOfficialUrl: string;
  unitPriceKrw: string;
  quantity: string;
  observedOn: string;
  sourceUrl: string;
  note: string;
};

function localDateValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function newIdempotencyKey() {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `admin-direct-restaurant-menu:${id}`;
}

function initialRestaurantForm(): RestaurantForm {
  return {
    restaurantId: "",
    restaurantName: "",
    restaurantLegalName: "",
    cuisineType: "",
    restaurantOfficialSiteUrl: "",
    sourceLocationCode: "",
    locationLabel: "",
    locationOfficialUrl: "",
    restaurantMenuId: "",
    menuName: "",
    menuCategoryLabel: "",
    servingLabel: "1인분",
    menuOfficialUrl: "",
    unitPriceKrw: "",
    quantity: "1",
    observedOn: localDateValue(),
    sourceUrl: "",
    note: "",
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

function normalizeIdentity(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function selectedMenu(entries: RestaurantMenuReadEntry[], restaurantId: string, menuId: string) {
  return entries.find((entry) => entry.restaurant.id === restaurantId)?.menus.find((menu) => menu.id === menuId) ?? null;
}

function sourceNote(item: ImportedRestaurantMenu) {
  return `${item.sourceLabel}에서 불러온 정보입니다. ${item.sourceDescription}`.slice(0, 500);
}

export function AdminDirectRestaurantMenuPanel() {
  const client = getSupabaseBrowserClient();
  const directRepository = useMemo(
    () => client ? new AdminUnverifiedRegistrationRepository(client) : null,
    [client],
  );
  const restaurantRepository = useMemo(
    () => client ? new RestaurantMenuRepository(client) : null,
    [client],
  );
  const sourceRepository = useMemo(() => new RestaurantMenuSourceRepository(), []);
  const [sourceMode, setSourceMode] = useState<DirectSourceMode>("manual");
  const [restaurants, setRestaurants] = useState<RestaurantMenuReadEntry[]>([]);
  const [sourceItems, setSourceItems] = useState<ImportedRestaurantMenu[]>([]);
  const [selectedSourceItem, setSelectedSourceItem] = useState<ImportedRestaurantMenu | null>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const [form, setForm] = useState<RestaurantForm>(initialRestaurantForm);
  const [fitnessNutritionConnected, setFitnessNutritionConnected] = useState(false);
  const [loading, setLoading] = useState(Boolean(client));
  const [sourceLoading, setSourceLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AdminUnverifiedRestaurantMenuResult | null>(null);

  const loadRestaurants = useCallback(async () => {
    if (!restaurantRepository) return;
    setLoading(true);
    setError("");
    try {
      const payload = await restaurantRepository.read({ limit: 200 });
      setRestaurants(payload.restaurants);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "기존 음식점 메뉴를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [restaurantRepository]);

  useEffect(() => { void loadRestaurants(); }, [loadRestaurants]);

  const selectedRestaurant = restaurants.find((entry) => entry.restaurant.id === form.restaurantId) ?? null;
  const currentMenu = selectedMenu(restaurants, form.restaurantId, form.restaurantMenuId);
  const identityLocked = selectedSourceItem !== null;

  const handleFitnessNutritionConnectionChange = useCallback((connected: boolean) => {
    setFitnessNutritionConnected(connected);
    if (!connected) {
      setSourceItems([]);
      setSourceError("");
    }
  }, []);

  function updateForm(patch: Partial<RestaurantForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function resetDirectForm() {
    setSelectedSourceItem(null);
    setForm(initialRestaurantForm());
    setResult(null);
    setError("");
    setMessage("");
  }

  function selectRestaurant(restaurantId: string) {
    const selected = restaurants.find((entry) => entry.restaurant.id === restaurantId);
    setSelectedSourceItem(null);
    updateForm({
      restaurantId,
      restaurantName: selected?.restaurant.brand ?? "",
      restaurantLegalName: selected?.restaurant.legalName ?? "",
      cuisineType: selected?.restaurant.cuisineType ?? "",
      restaurantOfficialSiteUrl: selected?.restaurant.officialSiteUrl ?? "",
      sourceLocationCode: selected ? `pricetrace:restaurant:${selected.restaurant.id}` : "",
      locationLabel: selected?.locations[0]?.locationLabel ?? "",
      locationOfficialUrl: selected?.locations[0]?.sourceUrl ?? "",
      restaurantMenuId: "",
      menuName: "",
      menuCategoryLabel: "",
      servingLabel: "1인분",
      menuOfficialUrl: "",
    });
    setError("");
    setMessage("");
    setResult(null);
  }

  function selectMenu(restaurantMenuId: string) {
    const menu = selectedMenu(restaurants, form.restaurantId, restaurantMenuId);
    setSelectedSourceItem(null);
    updateForm({
      restaurantMenuId,
      menuName: menu?.name ?? "",
      menuCategoryLabel: menu?.categoryLabel ?? "",
      servingLabel: menu?.servingLabel ?? "1인분",
      menuOfficialUrl: menu?.officialUrl ?? "",
    });
    setError("");
    setMessage("");
    setResult(null);
  }

  function selectSourceMode(nextMode: DirectSourceMode) {
    setSourceMode(nextMode);
    setSourceItems([]);
    setSourceError("");
    if (nextMode === "manual") {
      resetDirectForm();
    } else {
      setSelectedSourceItem(null);
      setForm(initialRestaurantForm());
      setResult(null);
      setError("");
      setMessage("");
    }
  }

  async function loadSourceItems() {
    if (sourceMode === "manual") return;
    if (sourceMode === "fitnessapp" && !fitnessNutritionConnected) {
      setSourceItems([]);
      setSourceError("FitnessApp 영양 DB에 먼저 연결하세요.");
      return;
    }
    setSourceLoading(true);
    setSourceError("");
    try {
      const items = sourceMode === "fitnessapp"
        ? await sourceRepository.searchFitnessMenus(sourceQuery)
        : await sourceRepository.searchCashOsMenus(sourceQuery);
      setSourceItems(items);
      if (items.length === 0) {
        setSourceError("조건에 맞는 식당·메뉴 정보가 없습니다.");
      }
    } catch (reason) {
      setSourceItems([]);
      setSourceError(reason instanceof Error ? reason.message : "외부 앱 정보를 불러오지 못했습니다.");
    } finally {
      setSourceLoading(false);
    }
  }

  function applySourceItem(item: ImportedRestaurantMenu) {
    const matchedRestaurant = restaurants.find((entry) => (
      normalizeIdentity(entry.restaurant.brand) === normalizeIdentity(item.restaurantName)
    )) ?? null;
    const matchedMenu = matchedRestaurant?.menus.find((menu) => (
      (item.catalogProductId && menu.catalogProductId === item.catalogProductId)
      || normalizeIdentity(menu.name) === normalizeIdentity(item.menuName)
    )) ?? null;
    const nextForm = initialRestaurantForm();
    setSelectedSourceItem(item);
    setForm({
      ...nextForm,
      restaurantId: matchedRestaurant?.restaurant.id ?? "",
      restaurantName: matchedRestaurant?.restaurant.brand ?? item.restaurantName,
      restaurantLegalName: matchedRestaurant?.restaurant.legalName ?? "",
      cuisineType: matchedRestaurant?.restaurant.cuisineType ?? "",
      restaurantOfficialSiteUrl: matchedRestaurant?.restaurant.officialSiteUrl ?? "",
      sourceLocationCode: item.sourceLocationCode,
      locationLabel: matchedRestaurant?.locations[0]?.locationLabel ?? "",
      locationOfficialUrl: matchedRestaurant?.locations[0]?.sourceUrl ?? "",
      restaurantMenuId: matchedMenu?.id ?? "",
      menuName: matchedMenu?.name ?? item.menuName,
      menuCategoryLabel: matchedMenu?.categoryLabel ?? "",
      servingLabel: matchedMenu?.servingLabel ?? "1인분",
      menuOfficialUrl: matchedMenu?.officialUrl ?? item.sourceReference ?? "",
      observedOn: item.observedOn ?? nextForm.observedOn,
      sourceUrl: item.sourceReference ?? "",
      note: sourceNote(item),
    });
    setError("");
    setMessage(`${item.sourceLabel} 정보를 불러왔습니다. 가격·수량·관측일만 입력하면 됩니다.`);
    setResult(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!directRepository) return;
    setSaving(true);
    setError("");
    setMessage("");
    setResult(null);
    try {
      const registered = await directRepository.registerRestaurantMenu({
        idempotencyKey: newIdempotencyKey(),
        restaurantId: nullable(form.restaurantId),
        restaurantName: form.restaurantName,
        restaurantLegalName: nullable(form.restaurantLegalName),
        cuisineType: nullable(form.cuisineType),
        restaurantOfficialSiteUrl: nullable(form.restaurantOfficialSiteUrl),
        sourceNamespace: "admin-manual",
        sourceLocationCode: form.sourceLocationCode,
        locationLabel: nullable(form.locationLabel),
        locationOfficialUrl: nullable(form.locationOfficialUrl),
        restaurantMenuId: nullable(form.restaurantMenuId),
        menuName: form.menuName,
        menuCategoryLabel: nullable(form.menuCategoryLabel),
        servingLabel: form.servingLabel,
        menuOfficialUrl: nullable(form.menuOfficialUrl),
        unitPriceKrw: Number(form.unitPriceKrw),
        quantity: Number(form.quantity),
        observedOn: form.observedOn,
        sourceUrl: nullable(form.sourceUrl),
        note: nullable(form.note),
      });
      const successMessage = registered.replayed
        ? "동일 요청을 다시 쓰지 않고 기존 직접 연결 결과를 확인했습니다."
        : "직접 입력한 가격을 미인증 메뉴 관측으로 등록했습니다. 영수증 검증 전에는 공개 메뉴 기록에 포함되지 않습니다.";
      setResult(registered);
      setMessage(successMessage);
      setSelectedSourceItem(null);
      setForm(initialRestaurantForm());
      await loadRestaurants();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "직접 연결 등록에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!client || !directRepository) {
    return <section className={styles.unverifiedRegistrationPanel}>
      <div className={styles.restaurantEmpty} role="status">
        <strong>Supabase 관리자 연결이 필요합니다.</strong>
        <span>관리자 로그인과 Supabase 설정을 확인하세요.</span>
      </div>
    </section>;
  }

  return <section className={styles.unverifiedRegistrationPanel} aria-labelledby="direct-restaurant-menu-title">
    <div className={styles.adminSectionHead}>
      <div>
        <p className={styles.kicker}>ADMIN DIRECT MENU LINK</p>
        <h2 id="direct-restaurant-menu-title">직접 연결 <span className={styles.unverifiedBadge}>미인증</span></h2>
        <p>영수증 FK chain 없이 식당·메뉴 정보를 직접 연결합니다. 외부 앱에서 불러온 정보는 가격을 직접 확인해 미인증 관측으로 저장합니다.</p>
      </div>
      <button type="button" onClick={() => void loadRestaurants()} disabled={loading || saving}>기존 메뉴 새로고침</button>
    </div>

    <div className={styles.unverifiedBoundaryNotice}>
      <strong>직접 연결 경계</strong>
      <span>식당·메뉴 identity는 수동 또는 외부 앱에서 가져올 수 있지만, 입력한 가격은 영수증 검증 가격과 별도인 미인증 기록입니다.</span>
    </div>

    <AdminFitnessNutritionAuthPanel onConnectionChange={handleFitnessNutritionConnectionChange} />

    <div className={styles.unverifiedModeTabs} role="tablist" aria-label="음식점 메뉴 직접 연결 방식">
      <button type="button" role="tab" aria-selected={sourceMode === "manual"} onClick={() => selectSourceMode("manual")}>전체 직접 입력</button>
      <button type="button" role="tab" aria-selected={sourceMode === "fitnessapp"} onClick={() => selectSourceMode("fitnessapp")}>FitnessApp에서 불러오기</button>
      <button type="button" role="tab" aria-selected={sourceMode === "cashos"} onClick={() => selectSourceMode("cashos")}>CashOS에서 불러오기</button>
    </div>

    {(sourceMode === "fitnessapp" || sourceMode === "cashos") && <div className={styles.restaurantSourcePicker}>
      <div className={styles.restaurantSourceSearch}>
        <label>{sourceMode === "fitnessapp" ? "FitnessApp 식당·메뉴 검색" : "CashOS 식당·메뉴 검색"}
          <input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder={sourceMode === "fitnessapp" ? "식당명 또는 메뉴명" : "식당명·메모·지출 제목 (비워도 됨)"} />
        </label>
        <button type="button" onClick={() => void loadSourceItems()} disabled={sourceLoading || (sourceMode === "fitnessapp" && !fitnessNutritionConnected)}>{sourceLoading ? "불러오는 중…" : "정보 불러오기"}</button>
      </div>
      {sourceError && <p className={styles.error} role="alert">{sourceError}</p>}
      {sourceItems.length > 0 && <div className={styles.restaurantSourceResults}>
        {sourceItems.map((item) => <article key={item.id} className={styles.restaurantSourceResult}>
          <div>
            <strong>{item.restaurantName} · {item.menuName}</strong>
            <small>{item.sourceDescription}{item.observedOn ? ` · ${item.observedOn}` : ""}</small>
            {item.suggestedPriceKrw !== null && <small>CashOS 기록 금액 {formatKrw(item.suggestedPriceKrw)} · 등록 가격은 다시 확인해 입력</small>}
          </div>
          <button type="button" onClick={() => applySourceItem(item)}>이 정보 사용</button>
        </article>)}
      </div>}
    </div>}

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.restaurantAdminSuccess} role="status">{message}</p>}
    {result && <dl className={styles.unverifiedResult}>
      <div><dt>상태</dt><dd><span className={styles.unverifiedBadge}>미인증</span></dd></div>
      <div><dt>음식점</dt><dd><code>{result.restaurantId}</code></dd></div>
      <div><dt>메뉴</dt><dd><code>{result.restaurantMenuId}</code></dd></div>
      <div><dt>가격 관측</dt><dd><code>{result.manualObservationId}</code></dd></div>
    </dl>}

    <form className={styles.unverifiedForm} onSubmit={submit}>
      <fieldset>
        <legend>음식점 identity</legend>
        <label className={styles.unverifiedWide}>기존 PriceTrace 음식점
          <select disabled={identityLocked} value={form.restaurantId} onChange={(event) => selectRestaurant(event.target.value)}>
            <option value="">새 음식점 만들기</option>
            {restaurants.map((entry) => <option key={entry.restaurant.id} value={entry.restaurant.id}>{entry.restaurant.brand}</option>)}
          </select>
        </label>
        <label>음식점 Brand<input required value={form.restaurantName} readOnly={identityLocked || Boolean(selectedRestaurant)} onChange={(event) => updateForm({ restaurantName: event.target.value })} /></label>
        <label>법적 상호<input value={form.restaurantLegalName} readOnly={identityLocked || Boolean(selectedRestaurant)} onChange={(event) => updateForm({ restaurantLegalName: event.target.value })} /></label>
        <label>업종<input value={form.cuisineType} readOnly={identityLocked || Boolean(selectedRestaurant)} onChange={(event) => updateForm({ cuisineType: event.target.value })} placeholder="예: 한식" /></label>
        <label>음식점 공식 URL<input type="url" placeholder="https://" value={form.restaurantOfficialSiteUrl} readOnly={identityLocked || Boolean(selectedRestaurant)} onChange={(event) => updateForm({ restaurantOfficialSiteUrl: event.target.value })} /></label>
        <label>등록 출처<input readOnly value={selectedSourceItem?.sourceLabel ?? "직접 입력"} /></label>
        <label>지점 source code<input required value={form.sourceLocationCode} readOnly={identityLocked} onChange={(event) => updateForm({ sourceLocationCode: event.target.value })} placeholder="예: 강남점-2026" /></label>
        <label>지점 표기<input value={form.locationLabel} readOnly={identityLocked} onChange={(event) => updateForm({ locationLabel: event.target.value })} /></label>
        <label>지점 공식 URL<input type="url" placeholder="https://" value={form.locationOfficialUrl} readOnly={identityLocked} onChange={(event) => updateForm({ locationOfficialUrl: event.target.value })} /></label>
      </fieldset>

      <fieldset>
        <legend>메뉴 identity</legend>
        <label className={styles.unverifiedWide}>기존 메뉴
          <select disabled={identityLocked || !selectedRestaurant} value={form.restaurantMenuId} onChange={(event) => selectMenu(event.target.value)}>
            <option value="">새 메뉴 만들기</option>
            {selectedRestaurant?.menus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name} · {menu.servingLabel}</option>)}
          </select>
        </label>
        <label>메뉴명<input required value={form.menuName} readOnly={identityLocked || Boolean(form.restaurantMenuId)} onChange={(event) => updateForm({ menuName: event.target.value })} /></label>
        <label>메뉴 분류<input value={form.menuCategoryLabel} readOnly={identityLocked || Boolean(currentMenu)} onChange={(event) => updateForm({ menuCategoryLabel: event.target.value })} /></label>
        <label>제공 기준<input required value={form.servingLabel} readOnly={identityLocked || Boolean(currentMenu)} onChange={(event) => updateForm({ servingLabel: event.target.value })} /></label>
        <label>공식 메뉴 URL<input type="url" placeholder="https://" value={form.menuOfficialUrl} readOnly={identityLocked || Boolean(currentMenu)} onChange={(event) => updateForm({ menuOfficialUrl: event.target.value })} /></label>
      </fieldset>

      <fieldset>
        <legend>가격 관측 · 직접 입력</legend>
        <label>메뉴 가격<input required type="number" min="0" step="1" inputMode="numeric" value={form.unitPriceKrw} onChange={(event) => updateForm({ unitPriceKrw: event.target.value })} /></label>
        <label>수량<input required type="number" min="1" step="1" value={form.quantity} onChange={(event) => updateForm({ quantity: event.target.value })} /></label>
        <label>관측일<input required type="date" value={form.observedOn} onChange={(event) => updateForm({ observedOn: event.target.value })} /></label>
        <label>메뉴 출처 URL<input type="url" placeholder="https://" value={form.sourceUrl} readOnly={identityLocked && Boolean(form.sourceUrl)} onChange={(event) => updateForm({ sourceUrl: event.target.value })} /></label>
        <label className={styles.unverifiedWide}>메모<textarea rows={3} value={form.note} readOnly={identityLocked} onChange={(event) => updateForm({ note: event.target.value })} placeholder="영수증이 아닌 가격표·메뉴판 확인 메모" /></label>
      </fieldset>

      <div className={styles.unverifiedSubmit}>
        <p>외부 앱에서 불러온 경우에도 가격은 자동 확정하지 않습니다. 입력한 가격은 영수증 FK chain이 없는 미인증 관측으로만 저장됩니다.</p>
        <div className={styles.directFormActions}>
          {selectedSourceItem && <button type="button" onClick={resetDirectForm} disabled={saving}>전체 직접 입력으로 전환</button>}
          <button type="submit" disabled={saving}>{saving ? "직접 연결 등록 중…" : "음식점 메뉴 직접 연결"}</button>
        </div>
      </div>
    </form>
  </section>;
}
