"use client";

import { useRef, useState, type FormEvent } from "react";
import { INFORMATION_RECORD_MAX_BYTES, parseInformationRecordText, type InformationField, type InformationRecord } from "@/domain/information-record";
import { useInformationInbox } from "@/features/information-inbox/use-information-inbox";
import { exportInformationRecord } from "@/lib/information-export";
import styles from "./InformationInboxPage.module.css";

type DraftField = { id: string; key: string; label: string; type: InformationField["value_type"]; value: string; unit: string };
const blankField = (): DraftField => ({ id: crypto.randomUUID(), key: "", label: "", type: "text", value: "", unit: "" });
const typeLabels = { text: "텍스트", decimal: "정확한 소수", boolean: "참 / 거짓", date: "날짜", datetime: "시각 (시간대 포함)", json: "JSON 구조" };
const stateLabels = { pending: "검토 전", reviewed: "검토함", archived: "보관함" };

function fieldJson(field: DraftField) {
  let value = JSON.stringify(field.value);
  if (field.type === "boolean") value = field.value === "true" ? "true" : "false";
  if (field.type === "json") { JSON.parse(field.value); value = field.value; }
  const metadata = { key: field.key, value_type: field.type, ...(field.label ? { label: field.label } : {}),
    ...(field.type === "decimal" && field.unit ? { unit: field.unit } : {}), source_ids: ["manual-1"] };
  return `${JSON.stringify(metadata).slice(0, -1)},"value":${value}}`;
}

export function InformationInboxPage({ authRevision, onRequireAuth }: { authRevision: number; onRequireAuth: () => void }) {
  const inbox = useInformationInbox(authRevision);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("service");
  const [sourceText, setSourceText] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [fields, setFields] = useState<DraftField[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [formError, setFormError] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [imported, setImported] = useState<{ text: string; record: InformationRecord; name: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [referenceApp, setReferenceApp] = useState("cashos");
  const [referenceId, setReferenceId] = useState("");
  const [referenceRelation, setReferenceRelation] = useState("related_to");
  const draftIdentity = useRef<{ id: string; capturedAt: string } | null>(null);
  const detail = inbox.entries.find(row => row.record_id === selected);

  function updateField(id: string, patch: Partial<DraftField>) {
    setFields(previous => previous.map(field => field.id === id ? { ...field, ...patch } : field));
  }

  async function create(event: FormEvent) {
    event.preventDefault(); setFormError(""); setExportNotice("");
    try {
      if (!reviewed) throw new Error("PriceTrace가 소유할 정보인지 확인해 주세요.");
      draftIdentity.current ??= { id: crypto.randomUUID(), capturedAt: new Date().toISOString() };
      const base = { schema_version: "information-record.v1", record_id: draftIdentity.current.id, owner_app: "pricetrace",
        record_type: "pricetrace.offering_observation", title, captured_at: draftIdentity.current.capturedAt,
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
        sources: [{ source_id: "manual-1", kind: "manual", ...(sourceText ? { text: sourceText } : {}) }],
        references: referenceId ? [{ owner_app: referenceApp, record_id: referenceId, relation: referenceRelation }] : [] };
      const kindField = { key: "offering_kind", value_type: "text", value: kind, label: "대상 종류", source_ids: ["manual-1"] };
      const text = `${JSON.stringify(base).slice(0, -1)},"fields":[${[JSON.stringify(kindField), ...fields.map(fieldJson)].join(",")}]}`;
      parseInformationRecordText(text, "pricetrace");
      if (await inbox.save(text)) { draftIdentity.current = null; setTitle(""); setFields([]); setSourceText(""); setOccurredAt(""); setReviewed(false); setReferenceId(""); }
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : "입력 내용을 확인하세요."); }
  }

  async function readFile(file?: File) {
    if (!file) return;
    setFormError(""); setExportNotice(""); setImported(null); setReviewed(false);
    try {
      if (file.size > INFORMATION_RECORD_MAX_BYTES) throw new Error("정보 파일은 1 MiB 이하여야 합니다.");
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      setImported({ text, record: parseInformationRecordText(text, "pricetrace"), name: file.name });
    } catch (failure) { setFormError(failure instanceof Error ? failure.message : "JSON 파일을 확인하세요."); }
  }

  async function download(text: string, id: string) {
    setExportBusy(true); setFormError(""); setExportNotice("");
    try { await exportInformationRecord(text, id); setExportNotice("내보내기를 완료했습니다. 선택한 파일 또는 브라우저 다운로드를 확인하세요."); }
    catch (failure) { setFormError(failure instanceof Error ? failure.message : "파일을 내보내지 못했습니다."); }
    finally { setExportBusy(false); }
  }

  return <section className={styles.page} aria-labelledby="information-title">
    <header className={styles.heading}><h1 id="information-title">내 정보 보관함</h1>
      <p>상품·메뉴·가게·서비스의 관측 정보를 출처와 함께 보관합니다. 내 계정에서만 볼 수 있습니다.</p>
      <p>개인 결제는 CashOS, 섭취·운동·체중은 Fitness, 건강 상태는 HealthTrace에 기록하고 여기서는 참조로 연결하세요.</p>
      <button type="button" onClick={onRequireAuth}>로그인 / 계정 확인</button>
    </header>
    <div className={styles.toolbar}>
      <label className={styles.fileLabel}>정보 파일 가져오기<input type="file" accept="application/json,.json" disabled={inbox.busy} onChange={event => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <button type="button" disabled={inbox.busy} onClick={() => void inbox.reload()}>목록 새로고침</button>
    </div>
    {(formError || inbox.error) && <p className={styles.error} role="alert">{formError || inbox.error}</p>}
    {(exportNotice || inbox.notice) && <p className={styles.notice} role="status">{exportNotice || inbox.notice}</p>}
    {inbox.busy && <p role="status">처리 중…</p>}
    {imported ? <section className={styles.editor} aria-labelledby="import-title">
      <h2 id="import-title">가져올 기록 확인</h2><p>{imported.record.title} · {imported.name}</p>
      <p>항목 {imported.record.fields.length}개 · 출처 {imported.record.sources.length}개 · 연결 {imported.record.references.length}개</p>
      <details><summary>원문 전체 보기</summary><pre>{imported.text}</pre></details>
      <label className={styles.check}><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />PriceTrace가 소유할 상품·서비스·가격 정보임을 확인했습니다.</label>
      <div className={styles.actions}><button type="button" disabled={!reviewed || inbox.busy} onClick={async () => { if (await inbox.save(imported.text)) { setImported(null); setReviewed(false); } }}>확인한 기록 가져오기</button>
        <button type="button" onClick={() => setImported(null)}>취소</button></div>
    </section> : <details className={styles.editor}><summary>관측 정보 직접 등록</summary>
      <form onSubmit={event => void create(event)}>
        <div className={styles.twoColumns}><label>제목<input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 자전거 수리 견적" /></label>
          <label>대상 종류<select value={kind} onChange={event => setKind(event.target.value)}><option value="retail_product">상품</option><option value="menu_item">메뉴</option><option value="place">가게·장소</option><option value="service">서비스</option><option value="raw_material">원자재</option><option value="property">부동산</option><option value="other">기타 판매 대상</option></select></label></div>
        <label>출처 메모 / 원문<textarea maxLength={100000} rows={3} value={sourceText} onChange={event => setSourceText(event.target.value)} placeholder="직접 확인한 내용과 출처를 적으세요." /></label>
        <label>관측 시각 (알 때만)<input value={occurredAt} onChange={event => setOccurredAt(event.target.value)} placeholder="2026-11-06T14:30:00+09:00" /></label>
        <h2>추가 항목</h2><p>금액·단위·조건 등 필요한 항목을 추가하세요. 모르는 값은 입력하지 않아도 됩니다.</p>
        {fields.map((field, index) => <fieldset key={field.id} className={styles.field}><legend>항목 {index + 1}</legend>
          <div className={styles.twoColumns}><label>항목 키<input required value={field.key} onChange={event => updateField(field.id, { key: event.target.value })} placeholder="예: observed_price" /></label>
            <label>표시 이름<input value={field.label} onChange={event => updateField(field.id, { label: event.target.value })} placeholder="예: 관측 가격" /></label></div>
          <label>자료형<select value={field.type} onChange={event => updateField(field.id, { type: event.target.value as DraftField["type"], value: event.target.value === "boolean" ? "false" : "", unit: "" })}>{Object.entries(typeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>값{field.type === "boolean" ? <select value={field.value || "false"} onChange={event => updateField(field.id, { value: event.target.value })}><option value="true">참</option><option value="false">거짓</option></select>
            : <textarea rows={field.type === "json" ? 4 : 2} value={field.value} onChange={event => updateField(field.id, { value: event.target.value })} placeholder={field.type === "date" ? "2026-11-06" : field.type === "json" ? '{"조건": "예약 필요"}' : field.type === "decimal" ? "12345.0010" : ""} />}</label>
          {field.type === "decimal" && <label>단위 (알 때만)<input value={field.unit} onChange={event => updateField(field.id, { unit: event.target.value })} placeholder="예: KRW, kg, 시간" /></label>}
          <button type="button" onClick={() => setFields(previous => previous.filter(item => item.id !== field.id))}>항목 {index + 1} 삭제</button>
        </fieldset>)}
        <button type="button" disabled={fields.length >= 127} onClick={() => setFields(previous => [...previous, blankField()])}>항목 추가</button>
        <details className={styles.reference}><summary>다른 앱의 기록 연결 (선택)</summary><div className={styles.twoColumns}>
          <label>소유 앱<select value={referenceApp} onChange={event => setReferenceApp(event.target.value)}><option value="cashos">CashOS</option><option value="fitness">Fitness</option><option value="healthtrace">HealthTrace</option><option value="pricetrace">PriceTrace</option></select></label>
          <label>기록 ID<input value={referenceId} onChange={event => setReferenceId(event.target.value)} maxLength={200} /></label>
          <label>관계<input value={referenceRelation} onChange={event => setReferenceRelation(event.target.value)} maxLength={80} /></label></div></details>
        <label className={styles.check}><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />PriceTrace가 소유할 상품·서비스·가격 정보임을 확인했습니다.</label>
        <p>보관함 등록은 공개 가격 게시나 결제·건강 기록 확정으로 이어지지 않습니다.</p>
        <button type="submit" disabled={!reviewed || inbox.busy}>비공개 기록 저장</button>
        <button type="button" disabled={inbox.busy} onClick={() => { draftIdentity.current = null; setReviewed(false); setFormError(""); }}>수정 내용으로 새 기록 준비</button>
      </form>
    </details>}
    <section className={styles.records} aria-labelledby="saved-title"><h2 id="saved-title">보관한 기록</h2>
      {!inbox.busy && !inbox.error && !inbox.entries.length && <p>아직 기록이 없습니다. 직접 등록하거나 OCR 앱에서 내보낸 정보 파일을 가져오세요.</p>}
      <ul>{inbox.entries.map(entry => <li key={entry.record_id}><button type="button" aria-pressed={selected === entry.record_id} onClick={() => setSelected(entry.record_id)}>
        <strong>{entry.record.title}</strong><span>{stateLabels[entry.state]} · {entry.record.record_type} · {entry.record.captured_at}</span></button></li>)}</ul>
      {inbox.hasMore && <button type="button" disabled={inbox.busy} onClick={() => void inbox.reload(inbox.entries.length)}>기록 더 보기</button>}
    </section>
    {detail && <section className={styles.detail} aria-labelledby="detail-title"><h2 id="detail-title">{detail.record.title}</h2>
      <dl><dt>캡처 시각</dt><dd>{detail.record.captured_at}</dd><dt>관측 시각</dt><dd>{detail.record.occurred_at ?? "기록되지 않음"}</dd><dt>출처</dt><dd>{detail.record.sources.map(source => source.name ?? source.source_id).join(", ")}</dd></dl>
      <p>출처·연결은 입력자가 제시한 정보이며, 파일 해시와 대상 기록은 자동 검증하지 않습니다.</p>
      <div className={styles.actions}><button type="button" disabled={exportBusy} onClick={() => void download(detail.payload_text, detail.record_id)}>{exportBusy ? "파일 내보내는 중…" : "원본 JSON 내보내기"}</button>
        <label>검토 상태<select value={detail.state} disabled={inbox.busy} onChange={event => void inbox.setState(detail.record_id, event.target.value as typeof detail.state)}>{Object.entries(stateLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      <details open><summary>출처·항목·참조 원문 전체</summary><pre>{detail.payload_text}</pre></details>
    </section>}
  </section>;
}
