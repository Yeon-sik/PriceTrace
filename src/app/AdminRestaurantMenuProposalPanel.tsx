"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RestaurantMenuReadEntry } from "@/domain/restaurant-menu";
import type { RestaurantMenuCandidate } from "@/domain/restaurant-menu-proposal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { RestaurantMenuProposalRepository } from "@/repositories/restaurant-menu-proposal.repository";
import styles from "./page.module.css";

export function AdminRestaurantMenuProposalPanel({ entries, onRefresh }: {
  entries: RestaurantMenuReadEntry[]; onRefresh: () => Promise<void>;
}) {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(() => client ? new RestaurantMenuProposalRepository(client) : null, [client]);
  const [candidates, setCandidates] = useState<RestaurantMenuCandidate[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [menuId, setMenuId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const candidate = candidates.find((row) => row.candidateId === candidateId);
  const restaurant = entries.find((row) => row.restaurant.id === restaurantId);
  const menu = restaurant?.menus.find((row) => row.id === menuId);
  const load = useCallback(async () => {
    if (!repository) return;
    setBusy(true); setError("");
    try { setCandidates(await repository.listPending()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "등록 제안을 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }, [repository]);
  useEffect(() => { void load(); }, [load]);

  function chooseCandidate(id: string) {
    const selected = candidates.find((row) => row.candidateId === id);
    setCandidateId(id); setRestaurantId(selected?.proposedRestaurantId ?? "");
    setLocationId(selected?.proposedRestaurantLocationId ?? ""); setMenuId(""); setNote("");
    setError(""); setMessage("");
  }
  async function refresh() { await onRefresh(); await load(); }
  async function resolve(decision: "accept" | "reject") {
    if (!repository || !candidate) return;
    if (decision === "accept" && (!menu || !restaurant?.locations.some((row) => row.id === locationId))) {
      setError("검증된 식당·지점·메뉴를 모두 선택하세요."); return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await repository.resolve(decision === "accept" ? {
        candidateId: candidate.candidateId, decision, restaurantId,
        restaurantLocationId: locationId, restaurantMenuId: menu!.id,
        catalogProductId: menu!.catalogProductId, reviewNote: note,
      } : { candidateId: candidate.candidateId, decision, reviewNote: note });
      setMessage(decision === "accept" ? "메뉴 등록 제안을 승인했습니다. 영양정보 공개는 제안자가 직접 선택합니다." : "등록 제안을 거절했습니다.");
      setCandidateId(""); setRestaurantId(""); setLocationId(""); setMenuId(""); setNote(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "등록 제안을 검토하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className={styles.restaurantAdminForm} aria-label="Fitness 메뉴 등록 제안 검토">
    <h3>메뉴 등록 제안 검토</h3>
    <p>새 메뉴는 아래 기존 직접 연결 흐름으로 먼저 등록한 뒤 새로고침하여 선택하세요. 가게 제안은 기존 가게 검토에서 먼저 승인해야 합니다.</p>
    <button type="button" disabled={busy || !repository} onClick={() => void refresh()}>제안·메뉴 새로고침</button>
    <label>검토할 제안<select disabled={busy} value={candidateId} onChange={(event) => chooseCandidate(event.target.value)}>
      <option value="">제안 선택</option>{candidates.map((row) => <option key={row.candidateId} value={row.candidateId}>{row.menuName} · {row.candidateId}</option>)}
    </select></label>
    {!busy && candidates.length === 0 && <p>검토 중인 메뉴 등록 제안이 없습니다.</p>}
    {candidate && <>
      <p>제안 메뉴: {candidate.menuName} · {candidate.metadata.serving_label ?? "제공 기준 미확인"}</p>
      {candidate.merchantCandidateId && <p>가게 제안 참조: <code>{candidate.merchantCandidateId}</code></p>}
      <label>검증된 식당<select disabled={busy || candidate.proposedRestaurantId !== null} value={restaurantId}
        onChange={(event) => { setRestaurantId(event.target.value); setLocationId(""); setMenuId(""); }}>
        <option value="">식당 선택</option>{entries.map((row) => <option key={row.restaurant.id} value={row.restaurant.id}>{row.restaurant.brand}</option>)}
      </select></label>
      <label>검증된 지점<select disabled={busy || candidate.proposedRestaurantLocationId !== null} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
        <option value="">지점 선택</option>{restaurant?.locations.map((row) => <option key={row.id} value={row.id}>{row.locationLabel ?? "본점"}</option>)}
      </select></label>
      <label>검증된 메뉴<select disabled={busy} value={menuId} onChange={(event) => setMenuId(event.target.value)}>
        <option value="">메뉴 선택</option>{restaurant?.menus.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.servingLabel}</option>)}
      </select></label>
      <label>검토 메모<input value={note} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
      <button type="button" disabled={busy || !menu || !locationId} onClick={() => void resolve("accept")}>선택한 메뉴로 승인</button>
      <button type="button" disabled={busy} onClick={() => void resolve("reject")}>제안 거절</button>
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
