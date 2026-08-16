"use client";

import { useState } from "react";
import { buildOfficialImageApprovalExecution } from "@/domain/official-image-approval";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  applyApprovedOfficialImage,
  type OfficialImageApprovalResult,
} from "@/repositories/official-image-approval.repository";
import styles from "../page.module.css";

type ApprovalPreview = Awaited<ReturnType<typeof buildOfficialImageApprovalExecution>>;

function messageFor(reason: unknown) {
  if (reason instanceof SyntaxError) return "제안서 JSON 형식이 올바르지 않습니다.";
  return reason instanceof Error ? reason.message : "승인 제안서를 처리하지 못했습니다.";
}

export function OfficialImageApprovalExecutor() {
  const client = getSupabaseBrowserClient();
  const [proposalText, setProposalText] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<ApprovalPreview | null>(null);
  const [result, setResult] = useState<OfficialImageApprovalResult | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function validateProposal() {
    setMessage("");
    setResult(null);
    setConfirmation("");
    try {
      setPreview(await buildOfficialImageApprovalExecution(JSON.parse(proposalText)));
      setMessage("승인 지문과 공식 이미지 실행 범위가 일치합니다.");
    } catch (reason) {
      setPreview(null);
      setMessage(messageFor(reason));
    }
  }

  async function executeProposal() {
    if (!client) { setMessage("Supabase 연결 설정이 없습니다."); return; }
    if (!preview) { setMessage("먼저 승인 제안서를 검증하세요."); return; }
    if (confirmation.trim() !== preview.proposal.approval.targetFingerprint) {
      setMessage("전체 승인 대상 지문을 정확히 입력하세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    setResult(null);
    try {
      const applied = await applyApprovedOfficialImage(client, JSON.parse(proposalText));
      setResult(applied);
      setMessage(applied.replayed ? "기존 승인 결과를 정확히 재검증했습니다." : "공식 대표 이미지를 적용하고 승인 원장을 재검증했습니다.");
    } catch (reason) {
      setMessage(messageFor(reason));
    } finally {
      setSaving(false);
    }
  }

  function changeProposal(value: string) {
    setProposalText(value);
    setPreview(null);
    setResult(null);
    setConfirmation("");
    setMessage("");
  }

  return <div className={styles.approvalImageExecutor}>
    <label className={styles.approvalProposalInput}>
      <span>승인된 LinkProposal JSON</span>
      <textarea rows={12} spellCheck={false} value={proposalText} onChange={(event) => changeProposal(event.target.value)} />
    </label>
    <button type="button" className={styles.secondaryButton} disabled={!proposalText.trim() || saving} onClick={() => void validateProposal()}>제안서 검증</button>
    {preview && <div className={styles.approvalPreview}>
      <strong>{preview.proposal.receipt.sourceNameRaw}</strong>
      <dl>
        <div><dt>영수증</dt><dd>{preview.proposal.receipt.sourceLabel}/{preview.proposal.receipt.sourceProductCode}</dd></div>
        <div><dt>적용 상품</dt><dd>{preview.proposal.normalizedIdentity.brand} · {preview.proposal.normalizedIdentity.productFamilyName}</dd></div>
        <div><dt>승인 대상</dt><dd className={styles.approvalFingerprint}>{preview.proposal.approval.targetFingerprint}</dd></div>
      </dl>
      <label className={styles.approvalConfirmation}><span>실행 확인 — 전체 승인 대상 지문 입력</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
      <button type="button" className={styles.submitButton} disabled={saving || confirmation.trim() !== preview.proposal.approval.targetFingerprint} onClick={() => void executeProposal()}>{saving ? "적용 및 재검증 중" : "승인된 공식 이미지 적용"}</button>
    </div>}
    {message && <p role={result ? "status" : "alert"} className={result ? styles.muted : styles.error}>{message}</p>}
    {result && <div className={styles.approvalResult}>
      <strong>{result.replayed ? "정확한 기존 실행" : "적용 완료"}</strong>
      <small>승인 원장 {result.approvalId}</small>
      <small>표준 상품 {result.standardProductId}</small>
      <small>판매 규격 {result.catalogProductId}</small>
      <small>실제 작업 {result.appliedAction}</small>
      <a href={result.imageUrl} target="_blank" rel="noreferrer">적용 이미지 확인</a>
    </div>}
  </div>;
}
