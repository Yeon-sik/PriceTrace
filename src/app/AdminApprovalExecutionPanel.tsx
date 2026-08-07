"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";
import type { OfficialProductCandidate } from "@/domain/official-product";
import { buildOfficialImageApprovalExecution } from "@/domain/official-image-approval";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  applyApprovedOfficialImage,
  type OfficialImageApprovalResult,
} from "@/repositories/official-image-approval.repository";
import {
  STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY,
  StandardProductLinkProposalQueueRepository,
  type StandardProductLinkProposalQueueItem,
} from "@/repositories/standard-product-link-proposal-queue.repository";
import { PublicOfficialChannelCatalogRepository } from "@/repositories/public-official-channel-catalog.repository";
import { StandardProductWorkspace } from "./OfficialProductPanel";
import styles from "./page.module.css";

type ApprovalPreview = Awaited<ReturnType<typeof buildOfficialImageApprovalExecution>>;
type SelectedProposal = {
  item: StandardProductLinkProposalQueueItem;
  candidate: OfficialProductCandidate;
};

const queueRepository = new StandardProductLinkProposalQueueRepository();
const publicOfficialCatalog = new PublicOfficialChannelCatalogRepository().loadPxCatalog();

function messageFor(reason: unknown) {
  if (reason instanceof SyntaxError) return "제안서 JSON 형식이 올바르지 않습니다.";
  return reason instanceof Error ? reason.message : "승인 제안서를 처리하지 못했습니다.";
}

function findCurrentCandidate(
  item: StandardProductLinkProposalQueueItem,
  candidates: OfficialProductCandidate[],
) {
  const { receipt, officialListing } = item.proposal;
  const receiptCandidate = candidates.find((candidate) => (
    candidate.receiptId === receipt.receiptId
    && candidate.receiptItemId === receipt.receiptItemId
    && candidate.catalogNamespace === receipt.sourceCatalogNamespace
    && candidate.storeLabel === receipt.sourceLabel
    && candidate.sourceProductCode === receipt.sourceProductCode
    && candidate.productName === receipt.sourceNameRaw
  ));
  if (
    !receiptCandidate
    || publicOfficialCatalog.channel.id !== officialListing.channelId
  ) return undefined;
  const currentOfficialListing = publicOfficialCatalog.listings.find((listing) => (
    listing.sourceProductCodeNamespace === officialListing.sourceProductCodeNamespace
    && listing.sourceProductCode === officialListing.sourceProductCode
  ));
  if (!currentOfficialListing) return undefined;
  // Opening is a review-only action. The save path performs the exact frozen-input check.
  return {
    ...receiptCandidate,
    catalogNamespace: receipt.sourceCatalogNamespace,
    officialChannelId: publicOfficialCatalog.channel.id,
    officialSourceProductCodeNamespace: currentOfficialListing.sourceProductCodeNamespace,
    officialSourceProductCode: currentOfficialListing.sourceProductCode,
    officialSnapshotId: publicOfficialCatalog.sourceSnapshot.id,
    officialSnapshotHash: publicOfficialCatalog.sourceSnapshot.contentHash,
    officialSourceNameRaw: currentOfficialListing.sourceNameRaw,
    officialVendorNameRaw: currentOfficialListing.vendorNameRaw ?? undefined,
    officialSpecificationTextRaw: currentOfficialListing.specificationTextRaw ?? undefined,
    officialPriceAmountKrw: currentOfficialListing.officialPrice.amountKrw,
    officialPriceSourceText: currentOfficialListing.officialPrice.sourceText,
    officialPriceObservedAt: currentOfficialListing.officialPrice.observedAt,
    officialSourceRefs: currentOfficialListing.sourceRefs,
    officialImageUrl: currentOfficialListing.image?.url,
    officialImageContentHash: currentOfficialListing.image?.contentHash,
    officialImageMediaType: currentOfficialListing.image?.mediaType,
    officialImageByteLength: currentOfficialListing.image?.byteLength,
  };
}

export function AdminApprovalExecutionPanel({ candidates }: { candidates: OfficialProductCandidate[] }) {
  const [items, setItems] = useState<StandardProductLinkProposalQueueItem[]>([]);
  const [selected, setSelected] = useState<SelectedProposal | null>(null);
  const [proposalText, setProposalText] = useState("");
  const [message, setMessage] = useState("");

  const refreshQueue = useCallback(() => {
    setItems(queueRepository.load());
  }, []);

  useEffect(() => {
    refreshQueue();
    const refreshOnFocus = () => refreshQueue();
    const refreshOnStorage = (event: StorageEvent) => {
      if (event.key === STANDARD_PRODUCT_LINK_PROPOSAL_QUEUE_STORAGE_KEY) refreshQueue();
    };
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("storage", refreshOnStorage);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("storage", refreshOnStorage);
    };
  }, [refreshQueue]);

  function enqueueProposal() {
    try {
      const saved = queueRepository.enqueue(proposalText);
      setProposalText("");
      refreshQueue();
      setMessage(`${saved.proposal.executionTarget.normalizedIdentity.productFamilyName} 제안서를 로컬 승인 대기열에 저장했습니다.`);
    } catch (reason) {
      setMessage(messageFor(reason));
    }
  }

  function openProposal(item: StandardProductLinkProposalQueueItem) {
    const candidate = findCurrentCandidate(item, candidates);
    if (!candidate) {
      setMessage("현재 영수증 행 또는 공식 카탈로그 상품을 찾을 수 없습니다. 최신 제안서를 다시 요청하세요.");
      return;
    }
    setMessage("");
    setSelected({ item, candidate });
  }

  function discardProposal(item: StandardProductLinkProposalQueueItem) {
    const productName = item.proposal.executionTarget.normalizedIdentity.productFamilyName;
    if (!window.confirm(`${productName} 제안서를 로컬 대기열에서 삭제할까요?`)) return;
    setItems(queueRepository.remove(item.id));
    if (selected?.item.id === item.id) setSelected(null);
    setMessage(`${productName} 제안서를 삭제했습니다.`);
  }

  function completeApproval() {
    if (!selected) return;
    const productName = selected.item.proposal.executionTarget.normalizedIdentity.productFamilyName;
    setItems(queueRepository.remove(selected.item.id));
    setSelected(null);
    setMessage(`${productName} 연결을 승인하고 등록했습니다. 완료된 안건은 로컬 대기열에서 삭제했습니다.`);
  }

  return <section className={styles.approvalExecutor} aria-labelledby="approval-executor-title">
    <div className={styles.adminSectionHead}>
      <div>
        <h2 id="approval-executor-title">표준 상품 연결 승인 대기</h2>
        <p>GPT가 검증한 제안서를 이 브라우저에만 보관합니다. 카드를 열어 승인하거나 수정 후 승인하면, 등록 성공 뒤 해당 안건이 자동 삭제됩니다.</p>
      </div>
    </div>

    {items.length === 0 ? <p className={styles.emptyState}>승인을 기다리는 표준 상품 연결 제안이 없습니다.</p> : <div className={styles.linkApprovalQueue}>
      {items.map((item) => {
        const target = item.proposal.executionTarget;
        return <article className={styles.linkApprovalCard} key={item.id}>
          <button type="button" className={styles.linkApprovalOpen} onClick={() => openProposal(item)} aria-label={`${target.normalizedIdentity.productFamilyName} 표준 상품 연결 제안 확인`}>
            <span className={styles.linkApprovalThumb}>
              <img src={target.representativeImage.imageUrl} alt="" />
            </span>
            <span className={styles.linkApprovalInfo}>
              <small>표준 상품 연결 승인 대기</small>
              <strong>{target.normalizedIdentity.productFamilyName}</strong>
            </span>
          </button>
          <button type="button" className={styles.linkApprovalDiscard} onClick={() => discardProposal(item)}>대기열에서 삭제</button>
        </article>;
      })}
    </div>}

    {message && <p className={styles.approvalQueueMessage} role="status">{message}</p>}

    <details className={styles.approvalQueueImport}>
      <summary>GPT 제안서 로컬 저장</summary>
      <p>이 입력 영역은 GPT가 검증된 LinkProposal v3를 현재 브라우저 대기열에 넣을 때 사용합니다.</p>
      <label className={styles.approvalProposalInput}>
        <span>검증된 LinkProposal JSON</span>
        <textarea rows={8} spellCheck={false} value={proposalText} onChange={(event) => setProposalText(event.target.value)} />
      </label>
      <button type="button" className={styles.secondaryButton} disabled={!proposalText.trim()} onClick={enqueueProposal}>승인 대기열에 저장</button>
    </details>

    <details className={styles.approvalQueueImport}>
      <summary>대표 이미지 전용 승인 실행</summary>
      <OfficialImageApprovalExecutor />
    </details>

    {selected && <StandardProductWorkspace
      candidates={[selected.candidate]}
      approvalRequest={{
        candidate: selected.candidate,
        proposal: selected.item.proposal,
        onClose: () => setSelected(null),
        onApproved: completeApproval,
      }}
    />}
  </section>;
}

function OfficialImageApprovalExecutor() {
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
