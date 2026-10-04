"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RestaurantMenuReadEntry } from "@/domain/restaurant-menu";
import type { DiningMerchantCandidate } from "@/domain/restaurant-menu-proposal";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { RestaurantMenuProposalRepository } from "@/repositories/restaurant-menu-proposal.repository";
import styles from "./page.module.css";

/** Reuses merchant-only submission's existing admin resolution contract. */
export function AdminDiningMerchantProposalPanel({ entries, onRefresh }: {
  entries: RestaurantMenuReadEntry[]; onRefresh: () => Promise<void>;
}) {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(() => client ? new RestaurantMenuProposalRepository(client) : null, [client]);
  const [candidates, setCandidates] = useState<DiningMerchantCandidate[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const candidate = candidates.find((row) => row.candidate_id === candidateId);
  const restaurant = entries.find((row) => row.restaurant.id === restaurantId);
  const load = useCallback(async () => {
    if (!repository) return;
    setBusy(true); setError("");
    try { setCandidates(await repository.listMerchantCandidates()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "가게 제안을 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }, [repository]);
  useEffect(() => { void load(); }, [load]);
  async function resolve(decision: "accept" | "reject") {
    if (!repository || !candidate) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await repository.resolveMerchant(candidate.candidate_id,
        decision === "accept" ? restaurantId : null, decision === "accept" ? locationId : null, decision);
      setCandidateId(""); setRestaurantId(""); setLocationId("");
      setMessage(decision === "accept" ? "가게 제안을 승인했습니다. 제안자가 메뉴 등록 제안을 계속할 수 있습니다." : "가게 제안을 거절했습니다.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "가게 제안을 검토하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section className={styles.restaurantAdminForm} aria-label="Fitness 가게 등록 제안 검토">
    <h3>가게 등록 제안 검토</h3>
    <p>아직 없는 가게·지점은 아래 기존 직접 연결 흐름으로 먼저 등록하세요. 검증된 목록에서 정확한 가게·지점을 선택해 승인합니다.</p>
    <button type="button" disabled={busy || !repository} onClick={() => void (async () => { await onRefresh(); await load(); })()}>가게 제안·목록 새로고침</button>
    <label>검토할 가게 제안<select disabled={busy} value={candidateId} onChange={(event) => {
      setCandidateId(event.target.value); setRestaurantId(""); setLocationId(""); setMessage("");
    }}><option value="">가게 제안 선택</option>{candidates.map((row) => <option key={row.candidate_id} value={row.candidate_id}>{row.merchant_name} · {row.branch_name ?? "지점 미확인"}</option>)}</select></label>
    {!busy && candidates.length === 0 && <p>검토 중인 가게 등록 제안이 없습니다.</p>}
    {candidate && <>
      <p>사용자 확인 정보: {candidate.merchant_name} · {candidate.branch_name ?? "지점 미확인"}</p>
      <p>주소: {candidate.address ?? "미확인"} · 전화: {candidate.phone ?? "미확인"} · 사업자등록번호: {candidate.business_registration_number ?? "미확인"}</p>
      <label>검증된 가게<select value={restaurantId} disabled={busy} onChange={(event) => {
        setRestaurantId(event.target.value); setLocationId("");
      }}><option value="">가게 선택</option>{entries.map((row) => <option key={row.restaurant.id} value={row.restaurant.id}>{row.restaurant.brand}</option>)}</select></label>
      <label>검증된 가게 지점<select value={locationId} disabled={busy} onChange={(event) => setLocationId(event.target.value)}>
        <option value="">지점 선택</option>{restaurant?.locations.map((row) => <option key={row.id} value={row.id}>{row.locationLabel ?? "본점"}</option>)}</select></label>
      <button type="button" disabled={busy || !locationId} onClick={() => void resolve("accept")}>선택한 가게·지점으로 승인</button>
      <button type="button" disabled={busy} onClick={() => void resolve("reject")}>가게 제안 거절</button>
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
