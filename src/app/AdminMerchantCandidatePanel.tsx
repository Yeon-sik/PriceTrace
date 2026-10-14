"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  MerchantIdentityCandidateRepository,
  type PendingMerchantIdentityCandidate,
} from "@/repositories/merchant-identity-candidate.repository";
import styles from "./page.module.css";

export function AdminMerchantCandidatePanel() {
  const client = getSupabaseBrowserClient();
  const [candidates, setCandidates] = useState<PendingMerchantIdentityCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!client) {
      setError("Supabase 연결이 없어 판매처 후보를 불러올 수 없습니다.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setCandidates(await new MerchantIdentityCandidateRepository(client).listPending());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "판매처 후보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  return <section className={styles.adminReceipts} aria-labelledby="merchant-candidates-title">
    <div className={styles.adminSectionHead}>
      <div>
        <h2 id="merchant-candidates-title">판매처 후보 / 검토 대기</h2>
        <p>확인해 제출된 판매처 정보입니다. 검토 대기 후보는 아직 정식 음식점으로 확정되지 않았습니다.</p>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading}>새로고침</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.emptyState}>판매처 후보를 불러오는 중입니다.</p>
      : candidates.length === 0 ? <p className={styles.emptyState}>검토 대기 중인 판매처 후보가 없습니다.</p>
      : <div className={styles.receiptList}>{candidates.map((candidate) =>
        <details key={candidate.candidate_id}>
          <summary>
            <span>
              <b>{candidate.merchant_name}{candidate.branch_name ? " · " + candidate.branch_name : ""}</b>
              <small>검토 대기 · {candidate.origin === "receipt_ingestion" ? "영수증 도착" : "판매처 단독"} · {candidate.business_kind} · {candidate.created_at}</small>
            </span>
          </summary>
          <div className={styles.adminReceiptItems}>
            <p><span>후보 ID</span><code>{candidate.candidate_id}</code></p>
            <p><span>사업자등록번호</span><span>{candidate.business_registration_number ?? "확인되지 않음"}</span></p>
            <p><span>전화</span><span>{candidate.phone ?? "확인되지 않음"}</span></p>
            <p><span>주소</span><span>{candidate.address ?? "확인되지 않음"}</span></p>
            <p><span>출처 위치 코드</span><span>{candidate.source_namespace && candidate.source_code ? candidate.source_namespace + " / " + candidate.source_code : "확인되지 않음"}</span></p>
          </div>
        </details>)}</div>}
  </section>;
}
