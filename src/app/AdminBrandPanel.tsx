"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { brandParentCandidates } from "@/domain/brand-hierarchy";
import { useAdminBrands } from "@/features/brand-hall/use-admin-brands";
import { filterAdminBrands } from "@/features/brand-hall/brand-selectors";
import { BrandInputSchema, type AdminBrand } from "@/repositories/admin-brand.repository";
import styles from "./AdminBrandPanel.module.css";

export function AdminBrandPanel() {
  const state = useAdminBrands();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [canonicalName, setCanonicalName] = useState("");
  const [parentBrandId, setParentBrandId] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [officialSiteUrl, setOfficialSiteUrl] = useState("");
  const [alias, setAlias] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const selected = state.brands.find((brand) => brand.id === editing);
  const parents = useMemo(() => brandParentCandidates(state.brands, editing), [state.brands, editing]);
  const filtered = useMemo(() => filterAdminBrands(state.brands, query), [state.brands, query]);

  function select(brand: AdminBrand | null) {
    setEditing(brand?.id ?? null); setCanonicalName(brand?.canonicalName ?? "");
    setParentBrandId(brand?.parentBrandId ?? ""); setLogoUrl(brand?.logoUrl ?? "");
    setOfficialSiteUrl(brand?.officialSiteUrl ?? ""); setAlias(""); setError(""); setNotice("");
    if (window.matchMedia("(max-width: 760px)").matches) {
      requestAnimationFrame(() => {
        nameInputRef.current?.focus({ preventScroll: true });
        nameInputRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
      });
    }
  }

  async function mutate(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); state.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "변경을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const parsed = BrandInputSchema.safeParse({ canonicalName, parentBrandId: parentBrandId || null,
      logoUrl: logoUrl.trim() || null, officialSiteUrl: officialSiteUrl.trim() || null });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    if (!state.repository) return;
    void mutate(async () => { const id = await state.repository!.save(editing, parsed.data); setEditing(id); }, "브랜드를 저장했습니다.");
  }

  return <section className={styles.panel} aria-labelledby="admin-brands-title">
    <header className={styles.header}><div><h2 id="admin-brands-title">브랜드 관리</h2><p>브랜드명, 상위 브랜드와 검색 별칭을 관리합니다.</p></div>
      <button onClick={() => select(null)} disabled={busy}>새 브랜드</button></header>
    {state.error && <div role="alert"><p>{state.error}</p><button onClick={state.reload}>다시 시도</button></div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className={styles.workspace}>
      <div><label className={styles.search}>관리 브랜드 검색<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="브랜드명·상위 브랜드·별칭" /></label>
        {state.loading ? <p role="status">브랜드 목록을 불러오는 중입니다.</p> : <ul className={styles.list}>
          {filtered.map((brand) => <li key={brand.id}><button onClick={() => select(brand)} disabled={busy} aria-pressed={editing === brand.id}>
            <strong>{brand.canonicalName}</strong><span>상위: {brand.parentBrandId ? brand.parentCanonicalName ?? "정보 없음" : "없음 (최상위)"}</span>
            <span>별칭: {brand.aliases.map((item) => item.name).join(", ") || "없음"}</span>
            <small>로고 {brand.logoUrl ? "있음" : "없음"} · 사이트 {brand.officialSiteUrl ? "있음" : "없음"} · {brand.status === "active" ? "활성" : "보관됨"}</small>
          </button></li>)}
          {!filtered.length && <li>조건에 맞는 브랜드가 없습니다.</li>}
        </ul>}
      </div>
      <div className={styles.editor}>
        <h3>{editing ? "브랜드 수정" : "브랜드 만들기"}</h3>
        <form onSubmit={save}><fieldset disabled={busy || state.loading || !state.repository || !!state.error}>
          <label>브랜드명<input ref={nameInputRef} required value={canonicalName} onChange={(event) => setCanonicalName(event.target.value)} /></label>
          <label>상위 브랜드<select value={parentBrandId} onChange={(event) => setParentBrandId(event.target.value)}>
            <option value="">없음 (최상위 브랜드)</option>{parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.canonicalName}{parent.status === "archived" ? " (보관됨)" : ""}</option>)}
          </select></label>
          <p className={styles.help}>현재 브랜드와 하위 브랜드는 상위 후보에서 제외됩니다. 제조사와 브랜드 관계를 동일시하지 마세요.</p>
          <label>로고 URL<input type="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://" /></label>
          <label>공식 사이트 URL<input type="url" value={officialSiteUrl} onChange={(event) => setOfficialSiteUrl(event.target.value)} placeholder="https://" /></label>
          <button type="submit">{busy ? "저장 중…" : "브랜드 저장"}</button>
        </fieldset></form>
        {selected && <section className={styles.aliases} aria-labelledby="brand-alias-title"><h3 id="brand-alias-title">검색 별칭</h3>
          <ul>{selected.aliases.map((item) => <li key={item.id}><span>{item.name}</span><button disabled={busy || state.loading} aria-label={`${item.name} 별칭 삭제`} onClick={() => {
            if (!window.confirm(`“${item.name}” 별칭을 삭제할까요?`)) return;
            void mutate(() => state.repository!.removeAlias(selected.id, item.id), "별칭을 삭제했습니다.");
          }}>삭제</button></li>)}</ul>
          <form onSubmit={(event) => { event.preventDefault(); if (!alias.trim()) return; void mutate(async () => { await state.repository!.addAlias(selected.id, alias); setAlias(""); }, "별칭을 추가했습니다."); }}>
            <label>새 별칭<input required value={alias} onChange={(event) => setAlias(event.target.value)} disabled={busy || state.loading} /></label>
            <button disabled={busy || state.loading} type="submit">별칭 추가</button>
          </form>
        </section>}
      </div>
    </div>
  </section>;
}
