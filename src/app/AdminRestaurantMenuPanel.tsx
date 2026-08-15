"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  RestaurantMenuReadEntry,
  RestaurantMenuReceiptCandidate,
  RestaurantMenuRegistrationResult,
} from "@/domain/restaurant-menu";
import { formatKrw } from "@/domain/settlement";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { RestaurantMenuRepository } from "@/repositories/restaurant-menu.repository";
import styles from "./page.module.css";

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
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

function candidateLabel(candidate: RestaurantMenuReceiptCandidate) {
  return `${candidate.observed_on} · ${candidate.store_name} · ${candidate.product_name} · ${formatKrw(candidate.total_price_krw)}`;
}

export function AdminRestaurantMenuPanel() {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(
    () => client ? new RestaurantMenuRepository(client) : null,
    [client],
  );
  const [entries, setEntries] = useState<RestaurantMenuReadEntry[]>([]);
  const [candidates, setCandidates] = useState<RestaurantMenuReceiptCandidate[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [loading, setLoading] = useState(Boolean(repository));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<RestaurantMenuRegistrationResult | null>(null);

  const load = useCallback(async () => {
    if (!repository) return;
    setLoading(true);
    setError("");
    try {
      const [catalog, receiptCandidates] = await Promise.all([
        repository.read({ limit: 200 }),
        repository.readAdminReceiptCandidates(),
      ]);
      setEntries(catalog.restaurants);
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
      setResult(registered);
      setMessage(registered.replayed
        ? "동일 요청을 다시 쓰지 않고 기존 등록 결과를 확인했습니다."
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
      <div><p className={styles.kicker}>DATABASE RECEIPT-VERIFIED MENU</p><h2 id="restaurant-admin-title">음식점·메뉴 가격 등록</h2><p>브라우저에서 가격이나 영수증 ID를 입력받지 않습니다. 서버가 실제 menu_item 영수증 FK chain을 확인한 후보만 등록할 수 있습니다.</p></div>
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

    <form className={styles.restaurantAdminForm} onSubmit={register}>
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
    </form>
  </section>;
}
