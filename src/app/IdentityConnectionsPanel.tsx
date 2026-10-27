"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { IdentityConnectionRepository } from "@/repositories/identity-connection.repository";
import { identityEntityLabel, identityMatchLabel, type IdentityChoice, type IdentitySource } from "@/domain/identity-connection";
import styles from "./IdentityConnectionsPanel.module.css";

export function IdentityConnectionsPanel({ onConnected }: { onConnected?: () => void }) {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(() => client ? new IdentityConnectionRepository(client) : null, [client]);
  const generation = useRef(0);
  const [sources, setSources] = useState<IdentitySource[]>([]);
  const [sourceKey, setSourceKey] = useState("");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [choices, setChoices] = useState<IdentityChoice[]>([]);
  const [pending, setPending] = useState<IdentityChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const source = sources.find(row => `${row.entity}:${row.sourceId}` === sourceKey);
  useEffect(() => {
    const requestGeneration = generation;
    const reset = () => {
      generation.current++; setSources([]); setSourceKey(""); setChoices([]); setPending(null);
      setSearched(null); setLoaded(false); setBusy(false); setError(""); setNotice("");
    };
    const subscription = client?.auth.onAuthStateChange(reset).data.subscription;
    return () => { requestGeneration.current++; subscription?.unsubscribe(); };
  }, [client]);
  async function run(action: () => Promise<void>) {
    if (!repository || busy) return;
    const request = ++generation.current;
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (reason) {
      if (request === generation.current) setError(reason instanceof Error ? reason.message : "다시 시도해 주세요.");
    } finally { if (request === generation.current) setBusy(false); }
  }
  function load() { void run(async () => {
    const request = generation.current; const result = await repository!.load();
    if (request !== generation.current) return;
    setSources(result.sources); setTruncated(result.truncated); setLoaded(true);
    setSourceKey(""); setChoices([]); setPending(null); setSearched(null);
  }); }
  function search() { if (!source) return; void run(async () => {
    const request = generation.current; const result = await repository!.search(source, query.trim());
    if (request !== generation.current) return;
    setChoices(result.choices); setSearched(result.query); setPending(null);
  }); }
  function connect() { if (!source || !pending || searched !== query.trim()) return; void run(async () => {
    const request = generation.current; const selected = pending;
    const result = await repository!.connect(source, selected, searched);
    if (request !== generation.current) return;
    setSources(rows => rows.map(row => result.sources.find(updated => updated.entity === row.entity && updated.sourceId === row.sourceId) ?? row));
    setPending(null); setChoices([]); setNotice(`${selected.name}에 연결했습니다.`); onConnected?.();
    window.dispatchEvent(new Event("pricetrace-identity-connected"));
  }); }
  return <details className={styles.panel}>
    <summary>내 브랜드·가게·식당 연결</summary>
    <p>저장한 이름을 기존 항목에 연결합니다. 원본 기록은 보존되며 연결은 내 계정에만 적용됩니다.</p>
    <button type="button" onClick={load} disabled={busy || !repository}>{busy ? "처리 중…" : loaded ? "연결 목록 새로고침" : "내 기록 불러오기"}</button>
    {!repository && <p>서버 연결 설정을 확인해 주세요.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loaded && <>
      {truncated && <p>최근 200개 항목을 표시합니다. 이전 기록은 OCR의 해당 수집 기록에서 연결할 수 있습니다.</p>}
      {sources.length === 0 ? <p>연결할 기록이 없습니다. OCR에서 브랜드나 구매 기록을 저장한 뒤 다시 불러오세요.</p> :
        <label>연결할 입력값<select value={sourceKey} disabled={busy} onChange={event => {
          setSourceKey(event.target.value); setChoices([]); setPending(null); setSearched(null); setNotice(""); setError("");
          setQuery(sources.find(row => `${row.entity}:${row.sourceId}` === event.target.value)?.name.slice(0, 200) ?? "");
        }}><option value="">항목 선택</option>{sources.map(row => <option key={`${row.entity}:${row.sourceId}`} value={`${row.entity}:${row.sourceId}`}>
          {identityEntityLabel[row.entity]} · {row.name}{row.branchName ? ` · ${row.branchName}` : ""}{row.context ? ` · ${row.context}` : ""}{row.selected ? ` → ${row.selected.name}` : ""}
        </option>)}</select></label>}
      {source && <>
        <p>원래 입력: {source.name}{source.branchName && ` · ${source.branchName}`}</p>
        {source.selected ? <p role="status">연결됨: {source.selected.name}</p> : <>
          <form onSubmit={event => { event.preventDefault(); search(); }} className={styles.search}>
            <label>기존 {identityEntityLabel[source.entity]} 검색<input value={query} maxLength={200} disabled={busy}
              onChange={event => { setQuery(event.target.value); setChoices([]); setPending(null); setSearched(null); }} /></label>
            <button disabled={busy || query.trim().length < 2}>검색</button>
          </form>
          <p>유사도는 이름 비교 점수입니다. 지점과 주소를 확인하고 선택하세요.</p>
          {searched !== null && choices.length === 0 && <p role="status">일치하거나 비슷한 항목이 없습니다. 짧은 이름으로 다시 검색해 보세요.</p>}
          <ul className={styles.choices}>{choices.map(choice => <li key={choice.id}>
            <button type="button" disabled={busy} aria-pressed={pending?.id === choice.id} onClick={() => setPending(choice)}>
              <strong>{choice.name}</strong><span>{[choice.branchName, choice.context, identityMatchLabel(choice)].filter(Boolean).join(" · ")}</span>
            </button>
          </li>)}</ul>
          {pending && <div className={styles.confirm}>
            <p>‘{source.name}’을 ‘{pending.name}’{pending.branchName ? ` · ${pending.branchName}` : ""}과 같은 {identityEntityLabel[source.entity]}로 연결합니다.</p>
            <button type="button" disabled={busy} onClick={connect}>같은 항목으로 확인하고 연결</button>
            <button type="button" disabled={busy} onClick={() => setPending(null)}>선택 취소</button>
          </div>}
        </>}
      </>}
    </>}
  </details>;
}
