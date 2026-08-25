"use client";

import { useEffect, useMemo, useState } from "react";
import {
  inferRestaurantMenuOptionParent,
  restaurantMenuNameLooksLikeOption,
  type RestaurantDetailV1,
  type RestaurantMenuReadEntry,
} from "@/domain/restaurant-menu";
import { RestaurantMenuRepository } from "@/repositories/restaurant-menu.repository";
import styles from "./page.module.css";

type AdminRestaurantMenuOptionPanelProps = {
  repository: RestaurantMenuRepository;
  entries: RestaurantMenuReadEntry[];
  onSaved: () => Promise<void>;
};

function menuLabel(menu: RestaurantMenuReadEntry["menus"][number]) {
  return menu.name + " · " + menu.servingLabel;
}

export function AdminRestaurantMenuOptionPanel({
  repository,
  entries,
  onSaved,
}: AdminRestaurantMenuOptionPanelProps) {
  const [restaurantId, setRestaurantId] = useState("");
  const [optionMenuId, setOptionMenuId] = useState("");
  const [parentMenuId, setParentMenuId] = useState("");
  const [detail, setDetail] = useState<RestaurantDetailV1 | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedRestaurant = entries.find((entry) => entry.restaurant.id === restaurantId) ?? null;
  const menus = useMemo(
    () => selectedRestaurant?.menus ?? [],
    [selectedRestaurant],
  );
  const links = detail?.optionLinks ?? [];
  const selectedLink = links.find((link) => link.optionMenuId === optionMenuId) ?? null;
  const selectedOption = menus.find((menu) => menu.id === optionMenuId) ?? null;
  const optionMenus = useMemo(() => [...menus].sort((left, right) => (
    Number(restaurantMenuNameLooksLikeOption(right.name))
      - Number(restaurantMenuNameLooksLikeOption(left.name))
      || left.name.localeCompare(right.name, "ko-KR")
      || left.id.localeCompare(right.id)
  )), [menus]);
  const parentMenus = useMemo(
    () => menus.filter((menu) => menu.id !== optionMenuId),
    [menus, optionMenuId],
  );

  useEffect(() => {
    let cancelled = false;
    setOptionMenuId("");
    setParentMenuId("");
    setDetail(null);
    setError("");
    setMessage("");
    if (!restaurantId) return () => { cancelled = true; };

    setDetailLoading(true);
    void repository.readDetail(restaurantId)
      .then((payload) => {
        if (!cancelled) setDetail(payload);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "메뉴 옵션 연결 상태를 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [repository, restaurantId]);

  function chooseOption(nextOptionMenuId: string) {
    const nextLink = links.find((link) => link.optionMenuId === nextOptionMenuId) ?? null;
    setOptionMenuId(nextOptionMenuId);
    setParentMenuId(
      nextLink?.parentMenuId
        ?? inferRestaurantMenuOptionParent(menus, nextOptionMenuId)
        ?? "",
    );
    setError("");
    setMessage("");
  }

  async function refreshDetail() {
    if (!restaurantId) return;
    const payload = await repository.readDetail(restaurantId);
    setDetail(payload);
  }

  async function autoLink() {
    if (!restaurantId) return;
    setAutoSaving(true);
    setError("");
    setMessage("");
    try {
      const linksCreatedOrFound = await repository.autoLinkRestaurantMenuOptions(restaurantId);
      await refreshDetail();
      await onSaved();
      setMessage(
        linksCreatedOrFound.length > 0
          ? "자동 인식 결과 " + linksCreatedOrFound.length + "건을 확인했습니다."
          : "같은 영수증에 기본 메뉴가 하나로 좁혀지는 옵션이 아직 없습니다.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "메뉴 옵션 자동 인식에 실패했습니다.");
    } finally {
      setAutoSaving(false);
    }
  }

  async function saveManualLink() {
    if (!restaurantId || !parentMenuId || !optionMenuId) {
      setError("음식점, 부모 메뉴, 옵션 메뉴를 모두 선택하세요.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await repository.setRestaurantMenuOptionLink(restaurantId, parentMenuId, optionMenuId);
      await refreshDetail();
      await onSaved();
      setMessage("정확한 부모 메뉴 ID와 옵션 메뉴 ID를 수동 연결했습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "메뉴 옵션 수동 연결에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function clearLink() {
    if (!restaurantId || !optionMenuId || !selectedLink) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await repository.clearRestaurantMenuOptionLink(restaurantId, optionMenuId);
      setParentMenuId("");
      await refreshDetail();
      await onSaved();
      setMessage("메뉴 옵션 연결을 해제했습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "메뉴 옵션 연결 해제에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.restaurantOptionLinker} aria-labelledby="restaurant-option-link-title">
    <div className={styles.restaurantOptionLinkerHead}>
      <div>
        <h3 id="restaurant-option-link-title">메뉴 옵션 연결</h3>
        <p>“계란 후라이 추가”처럼 옵션 표식이 있는 행은 같은 영수증의 유일한 기본 메뉴에 먼저 자동 연결합니다. 애매하면 자동 저장하지 않고 정확한 메뉴 ID를 직접 선택합니다.</p>
      </div>
      <button type="button" disabled={!restaurantId || autoSaving || detailLoading} onClick={() => void autoLink()}>
        {autoSaving ? "자동 인식 중…" : "자동 인식 실행"}
      </button>
    </div>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.restaurantAdminSuccess} role="status">{message}</p>}

    <div className={styles.restaurantOptionLinkerForm}>
      <label>음식점
        <select value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>
          <option value="">음식점을 선택하세요</option>
          {entries.map((entry) => <option key={entry.restaurant.id} value={entry.restaurant.id}>{entry.restaurant.brand}</option>)}
        </select>
      </label>
      <label>옵션 메뉴
        <select
          value={optionMenuId}
          disabled={!restaurantId || detailLoading}
          onChange={(event) => chooseOption(event.target.value)}
        >
          <option value="">옵션으로 연결할 메뉴를 선택하세요</option>
          {optionMenus.map((menu) => <option key={menu.id} value={menu.id}>
            {restaurantMenuNameLooksLikeOption(menu.name) ? "자동 후보 · " : ""}{menuLabel(menu)}
          </option>)}
        </select>
      </label>
      <label>부모 메뉴
        <select
          value={parentMenuId}
          disabled={!optionMenuId || detailLoading}
          onChange={(event) => setParentMenuId(event.target.value)}
        >
          <option value="">부모 메뉴를 선택하세요</option>
          {parentMenus.map((menu) => <option key={menu.id} value={menu.id}>{menuLabel(menu)}</option>)}
        </select>
      </label>
      <div className={styles.restaurantOptionLinkerActions}>
        <button type="button" disabled={!optionMenuId || !parentMenuId || saving || autoSaving} onClick={() => void saveManualLink()}>
          {saving ? "저장 중…" : "수동 연결 저장"}
        </button>
        <button type="button" className={styles.restaurantOptionLinkerClear} disabled={!selectedLink || saving || autoSaving} onClick={() => void clearLink()}>
          연결 해제
        </button>
      </div>
    </div>

    {selectedOption && selectedLink && <p className={styles.restaurantOptionLinkerStatus} role="status">
      현재 연결: <strong>{selectedOption.name}</strong> → <strong>{menus.find((menu) => menu.id === selectedLink.parentMenuId)?.name ?? selectedLink.parentMenuId}</strong>
      <span>{selectedLink.source === "automatic" ? "자동 인식" : "수동 연결"}</span>
    </p>}
  </section>;
}
