"use client";
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InformationSellerReviewRepository, type SellerReview, type SellerReviewDetails } from "@/repositories/information-seller-review.repository";
import styles from "@/app/InformationInboxPage.module.css";

export function InformationSellerReview({ client, recordId, onApproved }: { client: SupabaseClient; recordId: string; onApproved: () => Promise<void> }) {
  const repo = useMemo(() => new InformationSellerReviewRepository(client), [client]);
  const [data, setData] = useState<Awaited<ReturnType<typeof repo.list>> | null>(null);
  const [details, setDetails] = useState<SellerReviewDetails>({ display_name: "", location_label: "", evidence_url: "", evidence_note: "" });
  const [requestId, setRequestId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { let active = true; void repo.list().then(result => { if (active) setData(result); }).catch(cause => { if (active) setError(cause.message); }); return () => { active = false; }; }, [repo]);
  const update = (key: keyof SellerReviewDetails, value: string) => { setDetails(previous => ({ ...previous, [key]: value })); setConfirmed(false); setRequestId(null); };
  const execute = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); setData(await repo.list()); } catch (cause) { setError(cause instanceof Error ? cause.message : "판매처 검토 실패"); } finally { setBusy(false); } };
  return <details className={styles.editor}><summary>판매처 등록 신청·관리자 검토</summary>
    <p>정확한 판매처가 목록에 없으면 식별 근거를 제출하세요. 이름만으로 등록하거나 자동 승인하지 않습니다. 신청 근거는 본인과 관리자만 볼 수 있습니다.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <label>정확한 판매처명<input value={details.display_name} maxLength={200} disabled={busy} onChange={event => update("display_name", event.target.value)} /></label>
    <label>지점·주소 또는 온라인 판매자 식별<input value={details.location_label} maxLength={300} disabled={busy} onChange={event => update("location_label", event.target.value)} /></label>
    <label>공개 확인 URL (HTTPS)<input type="url" value={details.evidence_url} maxLength={2000} disabled={busy} placeholder="https://" onChange={event => update("evidence_url", event.target.value)} /></label>
    <label>판매처 확인 근거<textarea value={details.evidence_note} maxLength={2000} disabled={busy} placeholder="이 이름·지점·판매자임을 확인한 근거. 토큰·계좌·결제 정보는 입력하지 마세요." onChange={event => update("evidence_note", event.target.value)} /></label>
    <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />정확한 판매처 식별과 근거를 확인했으며 관리자에게 이 신청을 보냅니다.</label>
    <button type="button" disabled={!data || busy || !confirmed || Object.values(details).some(value => !value.trim())} onClick={() => void execute(async () => { const id = requestId ?? crypto.randomUUID(); setRequestId(id); await repo.submit(recordId, id, details, confirmed); setConfirmed(false); })}>판매처 검토 신청</button>
    <button type="button" disabled={busy} onClick={() => void execute(async () => { await onApproved(); })}>판매처 승인 상태 새로고침</button>
    {data?.account.admin && <p>현재 계정은 관리자입니다. 신청 근거와 공개할 이름·위치를 직접 검토하세요. 승인 이후에도 가격 반영은 별도의 미리보기와 공개 승인이 필요합니다.</p>}
    {data?.requests.map(request => <SellerReviewItem key={request.request_id} request={request} admin={data.account.admin} busy={busy}
      review={(approve, note, reviewed) => execute(async () => { await repo.review(request, approve, note, reviewed); await onApproved(); })} />)}
  </details>;
}

function SellerReviewItem({ request, admin, busy, review }: { request: SellerReview; admin: boolean; busy: boolean; review: (approve: boolean, note: string, confirmed: boolean) => Promise<void> }) {
  const [note, setNote] = useState(""); const [confirmed, setConfirmed] = useState(false);
  return <article className={styles.editor} aria-label={`판매처 신청 ${request.details.display_name}`}>
    <h3>{request.details.display_name} · {request.details.location_label}</h3>
    <p>{request.state === "pending" ? "관리자 검토 대기" : request.state === "approved" ? "승인됨 · 공개 판매처 목록에서 선택 가능" : "반려됨"}</p>
    <dl><dt>공개 확인 URL</dt><dd>{request.details.evidence_url}</dd><dt>비공개 검토 근거</dt><dd>{request.details.evidence_note}</dd></dl>
    {request.review_note && <p>검토 결과: {request.review_note}</p>}
    {admin && request.state === "pending" && <>
      <label>관리자 검토 사유<textarea value={note} maxLength={2000} disabled={busy} onChange={event => { setNote(event.target.value); setConfirmed(false); }} /></label>
      <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />근거를 확인했습니다. 승인 시 위 판매처명·지점 식별 정보가 공개되며, 근거 메모는 공개되지 않습니다.</label>
      <button type="button" disabled={busy || !confirmed || !note.trim()} onClick={() => void review(true, note, confirmed)}>이 판매처 공개 승인</button>
      <button type="button" disabled={busy || !confirmed || !note.trim()} onClick={() => void review(false, note, confirmed)}>근거 불충분으로 반려</button>
    </>}
  </article>;
}
