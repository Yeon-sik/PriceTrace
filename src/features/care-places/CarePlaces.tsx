"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { carePlaceInputSchema, carePlaceLabel, type CarePlace, type CarePlaceInput } from "@/domain/care-place";
import { CarePlaceRepository } from "@/repositories/care-place.repository";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./care-places.module.css";

export function CarePlaces({ compact = false, onOpen, onRequireAuth, authRevision = 0 }: {
  compact?: boolean; onOpen?: () => void; onRequireAuth: () => void; authRevision?: number;
}) {
  const repository = useMemo(() => { const c = getSupabaseBrowserClient(); return c ? new CarePlaceRepository(c) : null; }, []);
  const [places, setPlaces] = useState<CarePlace[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [form, setForm] = useState<CarePlaceInput>({ category: "hospital", name: "", address: "", phone: "" });
  const request = useRef<{ id: string; payload: string } | null>(null);
  useEffect(() => {
    let stale = false;
    setLoading(true); setError("");
    const timer = setTimeout(() => {
      if (!repository) { setLoading(false); setError("서버 연결 설정이 필요합니다."); return; }
      repository.search(query, category, compact ? 4 : 50).then(items => { if (!stale) setPlaces(items); })
        .catch(e => { if (!stale) setError(e instanceof Error ? e.message : "조회하지 못했습니다."); })
        .finally(() => { if (!stale) setLoading(false); });
    }, query ? 250 : 0);
    return () => { stale = true; clearTimeout(timer); };
  }, [repository, query, category, compact, revision]);
  useEffect(() => { setConfirmed(false); }, [authRevision]);
  function update(patch: Partial<CarePlaceInput>) { setForm(value => ({ ...value, ...patch })); setConfirmed(false); setNotice(""); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!repository || saving || !confirmed) return;
    const parsed = carePlaceInputSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    const payload = JSON.stringify(parsed.data);
    if (request.current?.payload !== payload) request.current = { id: crypto.randomUUID(), payload };
    setSaving(true); setError("");
    try {
      const result = await repository.register(request.current.id, parsed.data, confirmed);
      setNotice(result.duplicate ? "이미 등록된 기관에 연결했습니다." : "기관을 등록했습니다. CashOS와 HealthTrace에서 이름으로 찾을 수 있어요.");
      setEditing(false); setConfirmed(false); setQuery(result.place.name); setCategory(""); setRevision(v => v + 1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "등록하지 못했습니다.";
      setError(message); if (message.includes("로그인")) onRequireAuth();
    } finally { setSaving(false); }
  }
  return <section className={`${styles.section} ${compact ? styles.compact : ""}`} aria-label="병원·약국" id="care-places">
    <div className={styles.heading}><div><h2>병원·약국</h2><p>기관의 이름과 주소를 확인하고 결제·처방에 같은 장소를 연결하세요.</p></div>
      {compact ? <button type="button" onClick={onOpen}>전체 보기·등록</button> : <button type="button" onClick={() => setEditing(v => !v)}>{editing ? "입력 접기" : "병원·약국 등록"}</button>}</div>
    {!compact && <div className={styles.search}><label>기관명·주소<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="이름이나 지점 주소로 검색" /></label>
      <label>종류<select value={category} onChange={e => setCategory(e.target.value)}><option value="">전체</option><option value="hospital">병원</option><option value="pharmacy">약국</option></select></label></div>}
    {editing && !compact && <form className={styles.form} onSubmit={save}>
      <h3>기관 정보 직접 등록</h3><label>종류<select value={form.category} disabled={saving} onChange={e => update({ category: e.target.value as CarePlaceInput["category"] })}><option value="hospital">병원</option><option value="pharmacy">약국</option></select></label>
      <label>기관 이름<input required maxLength={200} disabled={saving} value={form.name} onChange={e => update({ name: e.target.value })} /></label>
      <label>주소·지점<input required maxLength={500} disabled={saving} value={form.address} onChange={e => update({ address: e.target.value })} /></label>
      <label>대표 전화 (선택)<input type="tel" maxLength={60} disabled={saving} value={form.phone} onChange={e => update({ phone: e.target.value })} /></label>
      <label className={styles.check}><input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} />기관명·주소·대표 전화가 공개 목록에 등록됨을 확인했습니다. 환자 정보와 결제·처방 내용은 입력하지 않았습니다.</label>
      <button type="submit" disabled={saving || !confirmed}>{saving ? "등록 중…" : "확인한 기관 등록"}</button>
    </form>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRevision(v => v + 1)}>다시 조회</button></p>}
    {notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">병원·약국을 불러오는 중…</p> : places.length === 0 ? <p>등록된 기관이 없습니다. OCR App이나 직접 입력으로 등록할 수 있어요.</p> :
      <ul className={styles.list}>{places.map(place => <li key={place.place_id}><div><span>{carePlaceLabel(place.category)}</span><h3>{place.name}</h3><p>{place.address}</p>{place.phone && <p>대표 전화 {place.phone}</p>}</div>
        {!compact && <details><summary>결제·처방에 연결하는 방법</summary><p>CashOS의 병원·약국 화면과 HealthTrace 처방의 장소 선택에서 이 기관을 검색하세요.</p></details>}</li>)}</ul>}
  </section>;
}
