"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type QualityStatus = "open" | "accepted" | "rejected";
type QualityFlag = {
  id: string;
  user_id: string;
  document_id: string;
  flag_type: string;
  severity: string;
  details: Record<string, unknown>;
  status: QualityStatus;
  reviewed_at: string | null;
  created_at: string;
};

export function AdminQualityPanel() {
  const client = getSupabaseBrowserClient();
  const [isAdmin, setIsAdmin] = useState(false);
  const [flags, setFlags] = useState<QualityFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFlags = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const { data, error: queryError } = await client
      .from("receipt_quality_flags")
      .select("id,user_id,document_id,flag_type,severity,details,status,reviewed_at,created_at")
      .order("created_at", { ascending: false });
    if (queryError) setError(queryError.message);
    else setFlags((data ?? []) as QualityFlag[]);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    let active = true;
    if (!client) {
      setLoading(false);
      return;
    }
    void client.auth.getUser().then(({ data, error: userError }) => {
      if (!active) return;
      if (userError) setError(userError.message);
      const admin = data.user?.app_metadata?.role === "admin";
      setIsAdmin(admin);
      if (!admin) setLoading(false);
      else void loadFlags();
    });
    return () => {
      active = false;
    };
  }, [client, loadFlags]);

  async function review(flag: QualityFlag, status: Exclude<QualityStatus, "open">) {
    if (!client) return;
    setError(null);
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) {
      setError(userError?.message ?? "관리자 세션이 없습니다.");
      return;
    }
    const reviewedAt = new Date().toISOString();
    const { error: updateError } = await client
      .from("receipt_quality_flags")
      .update({ status, reviewed_by: userData.user.id, reviewed_at: reviewedAt })
      .eq("id", flag.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    const { error: auditError } = await client.from("audit_logs").insert({
      actor_user_id: userData.user.id,
      target_user_id: flag.user_id,
      action: "quality_flag_reviewed",
      entity_type: "receipt_quality_flag",
      entity_id: flag.id,
      metadata: { status, flagType: flag.flag_type },
    });
    if (auditError) {
      setError(`검토는 반영됐지만 감사 로그 저장에 실패했습니다: ${auditError.message}`);
    }
    await loadFlags();
  }

  if (!client || !isAdmin) return null;

  return (
    <section className={styles.section} aria-labelledby="admin-quality-title">
      <div className={styles.controls}>
        <div>
          <h2 id="admin-quality-title">관리자 품질 검토</h2>
          <p className={styles.muted}>관리자 권한으로 전체 사용자의 품질 플래그를 검토합니다.</p>
        </div>
        <button type="button" onClick={() => void loadFlags()} disabled={loading}>
          새로고침
        </button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {loading ? <p>품질 플래그를 불러오는 중입니다.</p> : flags.length === 0 ? <p>검토할 품질 플래그가 없습니다.</p> : (
        <div className={styles.adminFlags}>
          {flags.map((flag) => (
            <article className={styles.product} key={flag.id}>
              <div>
                <strong>{flag.flag_type} · {flag.severity}</strong>
                <small>문서 {flag.document_id} · 사용자 {flag.user_id}</small>
                <small>{new Date(flag.created_at).toLocaleString("ko-KR")}</small>
              </div>
              <div>
                <b>상태: {flag.status}</b>
                <small>{JSON.stringify(flag.details)}</small>
              </div>
              <div className={styles.inline}>
                <button type="button" disabled={flag.status === "accepted"} onClick={() => void review(flag, "accepted")}>승인</button>
                <button type="button" disabled={flag.status === "rejected"} onClick={() => void review(flag, "rejected")}>거절</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
