"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SanitizedOrderCaptureSchema,
  orderCaptureReviewIssues,
  reviewOrderCapture,
  type OrderCaptureItem,
  type OrderCapturePlatform,
  type SanitizedOrderCapture,
} from "@/domain/order-capture";
import {
  buildOrderProductLinkRequestInput,
  orderCaptureCatalogCandidates,
  type OrderCaptureCatalogCandidate,
  type OrderProductLinkRequestRow,
} from "@/domain/order-product-link-request";
import { ProductReadRepository } from "@/repositories/product-read.repository";
import { OrderCaptureRepository } from "@/repositories/order-capture.repository";
import { OrderProductLinkRequestRepository } from "@/repositories/order-product-link-request.repository";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  recognizeOrderCaptureFiles,
  type OrderCaptureOcrProgress,
} from "@/features/order-capture/order-capture-ocr";
import styles from "./page.module.css";

const platformLabels: Record<OrderCapturePlatform, string> = {
  coupang: "쿠팡",
  iherb: "iHerb",
  myprotein: "MyProtein",
  naver: "네이버/Npay",
  unknown: "직접 선택",
};

type CandidateLoadState = {
  loading: boolean;
  error: string;
  candidates: OrderCaptureCatalogCandidate[];
};

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableInteger(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed.replace(/,/g, ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function stateLabel(state: SanitizedOrderCapture["state"]) {
  return {
    draft: "검토 전",
    reviewed_partial: "부분 확인",
    verified: "확인 완료",
  }[state];
}

function requestStatusLabel(status: OrderProductLinkRequestRow["status"]) {
  return {
    pending: "관리자 검토 대기",
    approved: "연결 승인",
    rejected: "반려",
    withdrawn: "철회",
  }[status];
}

export function OrderCapturePage({
  authRevision,
  onBack,
  onRequireAuth,
}: {
  authRevision: number;
  onBack: () => void;
  onRequireAuth: () => void;
}) {
  const localRepository = useMemo(() => new OrderCaptureRepository(), []);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ name: string; url: string }[]>([]);
  const [capture, setCapture] = useState<SanitizedOrderCapture | null>(null);
  const [savedCaptures, setSavedCaptures] = useState<SanitizedOrderCapture[]>([]);
  const [candidateState, setCandidateState] = useState<Record<string, CandidateLoadState>>({});
  const [requests, setRequests] = useState<OrderProductLinkRequestRow[]>([]);
  const [progress, setProgress] = useState<OrderCaptureOcrProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestingItemId, setRequestingItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setSavedCaptures(localRepository.load());
  }, [localRepository]);

  const clearPreviews = useCallback(() => {
    setPreviews((current) => {
      current.forEach((preview) => URL.revokeObjectURL(preview.url));
      return [];
    });
  }, []);

  useEffect(() => () => {
    previews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [previews]);

  useEffect(() => {
    let active = true;
    const client = getSupabaseBrowserClient();
    if (!client) return () => { active = false; };
    void client.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      try {
        const loaded = await new OrderProductLinkRequestRepository(client).loadMine();
        if (active) setRequests(loaded);
      } catch {
        if (active) setRequests([]);
      }
    });
    return () => { active = false; };
  }, [authRevision]);

  const reviewIssues = useMemo(
    () => capture ? orderCaptureReviewIssues(capture) : [],
    [capture],
  );

  function selectFiles(selected: File[]) {
    clearPreviews();
    const next = selected.slice(0, 20);
    setFiles(next);
    setPreviews(next.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
    setError(selected.length > 20 ? "한 번에 최대 20장까지만 처리합니다." : "");
    setNotice("");
  }

  function releaseSourceImages() {
    clearPreviews();
    setFiles([]);
  }

  async function runOcr() {
    if (files.length === 0) {
      setError("주문 상세 캡처를 먼저 선택하세요.");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    setCandidateState({});
    try {
      const result = await recognizeOrderCaptureFiles({ files, onProgress: setProgress });
      setCapture(result);
      setNotice("정제된 주문 정보만 만들었습니다. 원본 이미지와 OCR 원문은 저장하지 않았습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "주문 캡처를 읽지 못했습니다.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  function updateCapture(updater: (current: SanitizedOrderCapture) => SanitizedOrderCapture) {
    setCapture((current) => current ? updater(current) : current);
    setNotice("");
  }

  function updateItem(itemId: string, updater: (item: OrderCaptureItem) => OrderCaptureItem) {
    updateCapture((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? updater(item) : item),
    }));
  }

  function saveLocally() {
    if (!capture) return;
    setError("");
    try {
      const reviewed = reviewOrderCapture(SanitizedOrderCaptureSchema.parse(capture));
      setSavedCaptures(localRepository.upsert(reviewed));
      setCapture(reviewed);
      releaseSourceImages();
      setNotice(reviewed.state === "verified"
        ? "확인된 주문을 이 기기의 로컬 저장소에 저장했습니다."
        : "누락 항목을 유지한 채 부분 확인 주문으로 로컬 저장했습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "정제된 주문을 저장하지 못했습니다.");
    }
  }

  async function findCandidates(item: OrderCaptureItem) {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setCandidateState((current) => ({
        ...current,
        [item.id]: { loading: false, error: "Supabase 연결이 없어 표준 상품 후보를 찾을 수 없습니다.", candidates: [] },
      }));
      return;
    }
    setCandidateState((current) => ({
      ...current,
      [item.id]: { loading: true, error: "", candidates: [] },
    }));
    try {
      const result = await new ProductReadRepository(client).read({ query: item.name, limit: 5 });
      const candidates = orderCaptureCatalogCandidates({
        products: result.products,
        sourceLabel: item.sourceLabel ?? "",
        sourceProductCode: item.sourceProductCode,
      });
      setCandidateState((current) => ({
        ...current,
        [item.id]: { loading: false, error: "", candidates },
      }));
      const exact = candidates.find((candidate) => candidate.exactSourceMapping);
      if (exact) {
        updateItem(item.id, (current) => ({
          ...current,
          link: {
            state: "verified_mapping_suggested",
            standardProductId: exact.standardProductId,
            catalogProductId: exact.catalogProductId,
            requestId: null,
          },
        }));
      }
    } catch (reason) {
      setCandidateState((current) => ({
        ...current,
        [item.id]: {
          loading: false,
          error: reason instanceof Error ? reason.message : "표준 상품 후보를 찾지 못했습니다.",
          candidates: [],
        },
      }));
    }
  }

  function chooseCandidate(itemId: string, candidate: OrderCaptureCatalogCandidate) {
    updateItem(itemId, (item) => ({
      ...item,
      link: {
        state: candidate.exactSourceMapping
          ? "verified_mapping_confirmed"
          : "user_selected_pending_admin",
        standardProductId: candidate.standardProductId,
        catalogProductId: candidate.catalogProductId,
        requestId: null,
      },
    }));
    setNotice(candidate.exactSourceMapping
      ? "검증된 판매처 코드 매핑을 로컬 주문에 연결했습니다."
      : "이름 검색 후보를 사용자가 선택했습니다. 공유 연결은 아직 확정되지 않았습니다.");
  }

  async function submitAdminRequest(item: OrderCaptureItem, candidate?: OrderCaptureCatalogCandidate) {
    if (!capture || capture.platform === "unknown") {
      setError("관리자 요청 전에 플랫폼을 확인하세요.");
      return;
    }
    if (!item.sourceLabel) {
      setError("관리자 요청 전에 판매처 식별자를 입력하세요.");
      return;
    }
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Supabase 연결이 없어 관리자 요청을 보낼 수 없습니다.");
      return;
    }
    const { data } = await client.auth.getUser();
    if (!data.user) {
      onRequireAuth();
      setError("관리자 검토 요청은 로그인 후 보낼 수 있습니다.");
      return;
    }

    setRequestingItemId(item.id);
    setError("");
    try {
      const input = await buildOrderProductLinkRequestInput({
        requestKind: candidate ? "link_existing" : "register_new",
        platform: capture.platform,
        sourceLabel: item.sourceLabel,
        sellerLabel: item.sellerLabel,
        sourceProductCode: item.sourceProductCode,
        productName: item.name,
        optionText: item.optionText,
        suggestedStandardProductId: candidate?.standardProductId ?? null,
        suggestedCatalogProductId: candidate?.catalogProductId ?? null,
      });
      const request = await new OrderProductLinkRequestRepository(client).submit(input);
      const now = new Date().toISOString();
      const nextCapture = SanitizedOrderCaptureSchema.parse({
        ...capture,
        revision: capture.revision + 1,
        updatedAt: now,
        items: capture.items.map((current) => current.id === item.id ? {
          ...current,
          link: {
            state: "admin_request_pending",
            standardProductId: candidate?.standardProductId ?? null,
            catalogProductId: candidate?.catalogProductId ?? null,
            requestId: request.id,
          },
        } : current),
      });
      setCapture(nextCapture);
      setSavedCaptures(localRepository.upsert(nextCapture));
      setRequests((current) => [request, ...current.filter((stored) => stored.id !== request.id)]);
      setNotice(item.sourceProductCode
        ? "상품·판매처 식별 정보만 관리자 요청함에 보냈습니다."
        : "판매처 코드가 없어 관리자가 외부 근거를 확인해야 합니다. 주문·결제 정보는 보내지 않았습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "관리자 요청을 보내지 못했습니다.");
    } finally {
      setRequestingItemId(null);
    }
  }

  return <section className={styles.browser}>
    <div className={styles.browserHead}>
      <div>
        <p className={styles.kicker}>LOCAL ORDER IMPORT</p>
        <h1>주문 캡처 등록</h1>
        <p>쿠팡·iHerb 주문 상세 화면을 우선 지원하며, 여러 장을 한 주문으로 합칠 수 있습니다.</p>
      </div>
      <button type="button" className={styles.outlineButton} onClick={onBack}>상품 목록으로</button>
    </div>

    <div className={styles.orderPrivacyNotice}>
      <strong>이미지는 이 브라우저 안에서만 OCR 처리합니다.</strong>
      <span>수령인·주소·전화·배송메모·카드 표기는 버리고, 주문·결제금액·상품 필드만 정제합니다. 원본과 OCR 원문은 저장하지 않습니다.</span>
    </div>

    <section className={styles.orderCaptureUpload} aria-labelledby="order-capture-upload-title">
      <div>
        <h2 id="order-capture-upload-title">1. 주문 상세 캡처 선택</h2>
        <p>첫 실행에는 한글·영문 OCR 모델을 내려받기 때문에 시간이 조금 걸릴 수 있습니다.</p>
      </div>
      <label className={styles.orderFilePicker}>
        <span>이미지 선택</span>
        <input type="file" accept="image/*" multiple disabled={loading} onChange={(event) => selectFiles([...event.target.files ?? []])} />
      </label>
      {previews.length > 0 && <div className={styles.orderCapturePreviews}>
        {previews.map((preview) => <figure key={preview.url}><img src={preview.url} alt={`${preview.name} 주문 캡처 미리보기`} /><figcaption>{preview.name}</figcaption></figure>)}
      </div>}
      <div className={styles.orderCaptureActions}>
        <button type="button" onClick={() => void runOcr()} disabled={loading || files.length === 0}>{loading ? "로컬 OCR 처리 중" : `${files.length || ""}장 자동 탐지`}</button>
        {files.length > 0 && <button type="button" className={styles.secondaryButton} onClick={releaseSourceImages} disabled={loading}>원본 미리보기 지우기</button>}
      </div>
      {progress && <p className={styles.orderProgress} role="status">{progress.fileIndex + 1}/{progress.fileCount}장 · {Math.round(progress.progress * 100)}%</p>}
    </section>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.dataNotice} role="status">{notice}</p>}

    {capture && <>
      <section className={styles.orderEditor} aria-labelledby="order-editor-title">
        <div className={styles.adminSectionHead}>
          <div><h2 id="order-editor-title">2. 추출 결과 확인</h2><p>캡처에 없는 값은 비워 두세요. 날짜·주문번호·코드를 추측해 채우지 않습니다.</p></div>
          <span className={styles.orderStateBadge}>{stateLabel(capture.state)}</span>
        </div>
        <div className={styles.orderFieldGrid}>
          <label>플랫폼<select value={capture.platform} onChange={(event) => updateCapture((current) => ({ ...current, platform: event.target.value as OrderCapturePlatform }))}>{Object.entries(platformLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>주문번호<input value={capture.order.orderNumber ?? ""} onChange={(event) => updateCapture((current) => ({ ...current, order: { ...current.order, orderNumber: nullableText(event.target.value) } }))} /></label>
          <label>주문일<input type="date" value={capture.order.orderedOn ?? ""} onChange={(event) => updateCapture((current) => ({ ...current, order: { ...current.order, orderedOn: nullableText(event.target.value) } }))} /></label>
          <label>배송완료일<input type="date" value={capture.order.deliveredOn ?? ""} onChange={(event) => updateCapture((current) => ({ ...current, order: { ...current.order, deliveredOn: nullableText(event.target.value) } }))} /></label>
          <label>통화<select value={capture.order.currency ?? ""} onChange={(event) => updateCapture((current) => ({ ...current, order: { ...current.order, currency: nullableText(event.target.value) } }))}><option value="">확인 불가</option><option value="KRW">KRW</option><option value="USD">USD</option></select></label>
          <label>상품 합계<input inputMode="numeric" value={capture.payment.itemsSubtotalMinor ?? ""} onChange={(event) => updateCapture((current) => ({ ...current, payment: { ...current.payment, itemsSubtotalMinor: nullableInteger(event.target.value) } }))} /></label>
          <label>배송비<input inputMode="numeric" value={capture.payment.shippingFeeMinor ?? ""} onChange={(event) => updateCapture((current) => ({ ...current, payment: { ...current.payment, shippingFeeMinor: nullableInteger(event.target.value) } }))} /></label>
          <label>할인<input inputMode="numeric" value={capture.payment.discountMinor ?? ""} onChange={(event) => updateCapture((current) => ({ ...current, payment: { ...current.payment, discountMinor: nullableInteger(event.target.value) } }))} /></label>
          <label>총 결제금액<input inputMode="numeric" value={capture.payment.paidAmountMinor ?? ""} onChange={(event) => updateCapture((current) => ({ ...current, payment: { ...current.payment, paidAmountMinor: nullableInteger(event.target.value) } }))} /></label>
        </div>
        {reviewIssues.length > 0 && <div className={styles.orderReviewIssues}><strong>부분 캡처로 유지되는 이유</strong><ul>{reviewIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
      </section>

      <section className={styles.orderItems} aria-labelledby="order-items-title">
        <div className={styles.adminSectionHead}><div><h2 id="order-items-title">3. 주문 상품 확인·연결</h2><p>상품명 검색은 후보만 제시합니다. 정확한 판매처 코드 매핑이 없으면 자동 확정하지 않습니다.</p></div></div>
        {capture.items.length === 0 && <p className={styles.emptyState}>자동 추출된 상품이 없습니다. 더 넓은 주문 상세 캡처를 추가해 다시 시도하세요.</p>}
        {capture.items.map((item, index) => {
          const candidateLoad = candidateState[item.id];
          const selectedCandidate = candidateLoad?.candidates.find((candidate) => candidate.catalogProductId === item.link.catalogProductId);
          return <article className={styles.orderItemCard} key={item.id}>
            <header><strong>상품 {index + 1}</strong><span>{item.confidence === "user_verified" ? "사용자 확인" : `OCR ${item.confidence}`}</span></header>
            <div className={styles.orderFieldGrid}>
              <label className={styles.orderWideField}>상품명<input value={item.name} onChange={(event) => updateItem(item.id, (current) => ({ ...current, name: event.target.value }))} /></label>
              <label className={styles.orderWideField}>옵션·규격<input value={item.optionText ?? ""} onChange={(event) => updateItem(item.id, (current) => ({ ...current, optionText: nullableText(event.target.value) }))} /></label>
              <label>수량<input inputMode="numeric" value={item.quantity ?? ""} onChange={(event) => updateItem(item.id, (current) => ({ ...current, quantity: nullableInteger(event.target.value) }))} /></label>
              <label>개당 가격<input inputMode="numeric" value={item.unitPriceMinor ?? ""} onChange={(event) => updateItem(item.id, (current) => ({ ...current, unitPriceMinor: nullableInteger(event.target.value) }))} /></label>
              <label>상품 합계<input inputMode="numeric" value={item.lineTotalMinor ?? ""} onChange={(event) => updateItem(item.id, (current) => ({ ...current, lineTotalMinor: nullableInteger(event.target.value) }))} /></label>
              <label>판매처 식별자<input value={item.sourceLabel ?? ""} onChange={(event) => updateItem(item.id, (current) => ({ ...current, sourceLabel: nullableText(event.target.value), link: { state: "unlinked", standardProductId: null, catalogProductId: null, requestId: null } }))} /></label>
              <label>판매자명<input value={item.sellerLabel ?? ""} onChange={(event) => updateItem(item.id, (current) => ({ ...current, sellerLabel: nullableText(event.target.value) }))} /></label>
              <label>판매처 상품 코드<input value={item.sourceProductCode ?? ""} onChange={(event) => updateItem(item.id, (current) => ({ ...current, sourceProductCode: nullableText(event.target.value), link: { state: "unlinked", standardProductId: null, catalogProductId: null, requestId: null } }))} /></label>
            </div>
            <div className={styles.orderCaptureActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => void findCandidates(item)} disabled={candidateLoad?.loading}>{candidateLoad?.loading ? "후보 검색 중" : "표준 상품 후보 찾기"}</button>
              {!selectedCandidate && <button type="button" onClick={() => void submitAdminRequest(item)} disabled={requestingItemId === item.id}>{requestingItemId === item.id ? "요청 중" : "신규 상품 검토 요청"}</button>}
            </div>
            {candidateLoad?.error && <p className={styles.error} role="alert">{candidateLoad.error}</p>}
            {candidateLoad && !candidateLoad.loading && !candidateLoad.error && candidateLoad.candidates.length === 0 && <p className={styles.emptyState}>일치 후보가 없습니다. 신규 상품 검토 요청을 보낼 수 있습니다.</p>}
            {candidateLoad?.candidates.length ? <div className={styles.orderCandidates}>{candidateLoad.candidates.map((candidate) => <div key={candidate.catalogProductId} className={item.link.catalogProductId === candidate.catalogProductId ? styles.orderCandidateSelected : ""}>
              <span>{candidate.exactSourceMapping ? "검증된 코드 매핑" : "이름 검색 후보"}</span>
              <strong>{candidate.brand ? `${candidate.brand} · ` : ""}{candidate.standardName}</strong>
              <small>{candidate.catalogName}{candidate.specificationText ? ` · ${candidate.specificationText}` : ""}</small>
              <div><button type="button" onClick={() => chooseCandidate(item.id, candidate)}>{candidate.exactSourceMapping ? "검증된 연결 사용" : "이 후보 선택"}</button>{!candidate.exactSourceMapping && <button type="button" className={styles.secondaryButton} onClick={() => void submitAdminRequest(item, candidate)} disabled={requestingItemId === item.id}>관리자 연결 요청</button>}</div>
            </div>)}</div> : null}
            {item.link.state === "admin_request_pending" && <p className={styles.orderLinkState}>관리자 검토 요청 ID {item.link.requestId}</p>}
          </article>;
        })}
        <div className={styles.orderSaveBar}><button type="button" onClick={saveLocally}>확인하고 로컬 저장</button><small>저장하면 현재 원본 미리보기도 메모리에서 지웁니다.</small></div>
      </section>
    </>}

    <section className={styles.orderLocalHistory} aria-labelledby="local-order-history-title">
      <div className={styles.adminSectionHead}><div><h2 id="local-order-history-title">이 기기에 저장된 주문</h2><p>정제된 주문만 최대 100건 보관합니다.</p></div></div>
      {savedCaptures.length === 0 ? <p className={styles.emptyState}>아직 로컬 저장된 주문이 없습니다.</p> : <div>{savedCaptures.map((stored) => <article key={stored.id}>
        <button type="button" onClick={() => setCapture(stored)}><strong>{platformLabels[stored.platform]} · {stored.items.length}개 상품</strong><span>{stored.order.orderedOn ?? "주문일 없음"} · {stateLabel(stored.state)}</span></button>
        <button type="button" className={styles.dangerButton} onClick={() => setSavedCaptures(localRepository.remove(stored.id))}>삭제</button>
      </article>)}</div>}
    </section>

    {requests.length > 0 && <section className={styles.orderLocalHistory} aria-labelledby="order-request-history-title">
      <div className={styles.adminSectionHead}><div><h2 id="order-request-history-title">내 관리자 검토 요청</h2><p>이 목록에는 주문번호·금액·결제정보·캡처가 포함되지 않습니다.</p></div></div>
      <div>{requests.map((request) => <article key={request.id}><div><strong>{request.product_name}</strong><span>{request.source_label} · {request.source_product_code ?? "상품 코드 미확인"} · {requestStatusLabel(request.status)}</span></div></article>)}</div>
    </section>}
  </section>;
}
