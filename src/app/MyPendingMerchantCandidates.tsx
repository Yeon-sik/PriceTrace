"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  MerchantIdentityCandidateRepository,
  type PendingMerchantIdentityCandidate,
} from "@/repositories/merchant-identity-candidate.repository";
import styles from "./page.module.css";

export function MyPendingMerchantCandidates() {
  const client = getSupabaseBrowserClient();
  const requestGeneration = useRef(0);
  const [candidates, setCandidates] = useState<PendingMerchantIdentityCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!client) {
      setCandidates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      if (!sessionData.session) {
        if (generation === requestGeneration.current) setCandidates([]);
        return;
      }
      const { data, error: authError } = await client.auth.getUser();
      if (authError) throw new Error(authError.message);
      if (!data.user) {
        if (generation === requestGeneration.current) setCandidates([]);
        return;
      }
      const rows = await new MerchantIdentityCandidateRepository(client).listMyPending();
      if (generation === requestGeneration.current) setCandidates(rows);
    } catch (reason) {
      if (generation === requestGeneration.current) {
        setCandidates([]);
        setError(reason instanceof Error ? reason.message : "내 판매처 후보를 불러오지 못했습니다.");
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
    if (!client) return () => { requestGeneration.current += 1; };
    let refreshTimer: number | undefined;
    const { data: { subscription } } = client.auth.onAuthStateChange(() => {
      requestGeneration.current += 1;
      setCandidates([]);
      setLoading(true);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { void load(); }, 0);
    });
    return () => {
      requestGeneration.current += 1;
      subscription.unsubscribe();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [client, load]);

  if (!loading && !error && candidates.length === 0) return null;

  return <section className={styles.adminReceipts} aria-labelledby="my-pending-merchants-title">
    <div className={styles.adminSectionHead}>
      <div>
        <h2 id="my-pending-merchants-title">내 식당 판매처 후보 / 검토 대기</h2>
        <p>확인해 제출한 식당 정보입니다. 아래 후보는 관리자 검토를 기다리고 있습니다.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading}>새로고침</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.emptyState}>내 판매처 후보를 불러오는 중입니다.</p>
      : <div className={styles.receiptList}>{candidates.map((candidate) =>
        <details key={candidate.candidate_id}>
          <summary>
            <span>
              <b>{candidate.merchant_name}{candidate.branch_name ? " · " + candidate.branch_name : ""}</b>
              <small>검토 대기 · {candidate.created_at}</small>
            </span>
          </summary>
          <div className={styles.adminReceiptItems}>
            <p><span>사업자등록번호</span><span>{candidate.business_registration_number ?? "확인되지 않음"}</span></p>
            <p><span>전화</span><span>{candidate.phone ?? "확인되지 않음"}</span></p>
            <p><span>주소</span><span>{candidate.address ?? "확인되지 않음"}</span></p>
            <p><span>후보 ID</span><code>{candidate.candidate_id}</code></p>
          </div>
        </details>)}</div>}
  </section>;
}
