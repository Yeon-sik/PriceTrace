"use client";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { InformationInboxEntry } from "@/repositories/information-inbox.repository";
import { InformationPriceProjectionRepository, type InformationPriceMapping, type InformationPricePreview } from "@/repositories/information-price-projection.repository";
import { ProductReadRepository } from "@/repositories/product-read.repository";
import { formatKrw } from "@/domain/settlement";
import styles from "@/app/InformationInboxPage.module.css";
import { InformationSellerReview } from "./InformationSellerReview";

export function InformationPriceProjection({ entry }: { entry: InformationInboxEntry }) {
  const client = getSupabaseBrowserClient();
  const repo = useMemo(() => client ? new InformationPriceProjectionRepository(client) : null, [client]);
  const [prepared, setPrepared] = useState<Awaited<ReturnType<InformationPriceProjectionRepository["prepare"]>> | null>(null);
  const [query, setQuery] = useState(""); const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [mapping, setMapping] = useState<InformationPriceMapping>({ catalog_product_id: "", store_id: "", price_field: "", date_field: "" });
  const [preview, setPreview] = useState<InformationPricePreview | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [approved, setApproved] = useState(false);
  useEffect(() => { let active = true;
    if (repo) { setBusy(true); void repo.prepare(entry).then(value => { if (active) { setPrepared(value); setPreview(value.receipt); } }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setBusy(false); }); }
    return () => { active = false; };
  }, [repo, entry]);
  const update = (patch: Partial<InformationPriceMapping>) => { setMapping(previous => ({ ...previous, ...patch })); setPreview(null); setApproved(false); setError(""); };
  const execute = async (action: () => Promise<void>) => { setBusy(true); setError(""); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "처리하지 못했습니다."); setApproved(false); } finally { setBusy(false); } };
  const impact = preview?.impact;
  const priceFields = entry.record.fields.filter(field => field.value_type === "decimal" && field.unit === "KRW");
  const dateFields = entry.record.fields.filter(field => field.value_type === "date" || field.value_type === "datetime");
  const project = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : "서버 미설정";
  return <section aria-labelledby="price-projection-title" className={styles.editor}>
    <h2 id="price-projection-title">공개 가격으로 반영</h2>
    <p>기존의 검증된 상품과 승인된 판매처에 가격 관측을 연결합니다. 서비스·메뉴·미상 정보는 원문 그대로 보관합니다.</p>
    {prepared && <p>반영 계정: <strong>{prepared.account.email}</strong><br />계정 ID: {prepared.account.id}<br />연결 프로젝트: {project}</p>}
    {prepared && !prepared.stores.length && <p>아직 승인된 공개 판매처가 없습니다. 관리자가 판매처의 정확한 식별 근거를 확인해 등록한 뒤 반영할 수 있습니다. 원문은 비공개 보관함에 유지됩니다.</p>}
    {client && repo && prepared && preview?.status !== "applied" && <InformationSellerReview client={client} recordId={entry.record_id} onApproved={async () => { setPrepared(await repo.prepare(entry)); setPreview(null); setApproved(false); }} />}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {preview?.status !== "applied" && <>
      <label>정확한 상품 검색<input value={query} onChange={event => setQuery(event.target.value)} disabled={busy} placeholder="상품명 또는 브랜드" /></label>
      <button type="button" disabled={busy || !query.trim() || !client} onClick={() => void execute(async () => { const result = await new ProductReadRepository(client!).read({ query, limit: 50 }); setProducts(result.products.map(product => ({ id: product.catalogProduct.id, name: `${product.catalogProduct.name} · ${product.catalogProduct.specificationText ?? product.standardProduct.name}` }))); update({ catalog_product_id: "" }); })}>검증된 상품 찾기</button>
      <label>원문에서 확인한 상품<select value={mapping.catalog_product_id} disabled={busy} onChange={event => update({ catalog_product_id: event.target.value })}><option value="">정확한 상품 선택 · 없으면 반영하지 않음</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <label>원문에서 확인한 판매처<select value={mapping.store_id} disabled={busy} onChange={event => update({ store_id: event.target.value })}><option value="">판매처 미상 / 선택하지 않음</option>{prepared?.stores.map(store => <option key={store.store_id} value={store.store_id}>{store.display_name}{store.location_label ? ` · ${store.location_label}` : ""}</option>)}</select></label>
      <div className={styles.twoColumns}>
        <label>선택한 상품 포장 1개의 가격 항목<select value={mapping.price_field} disabled={busy} onChange={event => update({ price_field: event.target.value })}><option value="">KRW 개별 가격 항목 선택</option>{priceFields.map(field => <option key={field.key} value={field.key}>{field.label ?? field.key}: {String(field.value)} KRW</option>)}</select></label>
        <label>관측일로 사용할 원문 항목<select value={mapping.date_field} disabled={busy} onChange={event => update({ date_field: event.target.value })}><option value="">관측일 선택 · 캡처일 사용 안 함</option>{entry.record.occurred_at && <option value="$occurred_at">관측 시각: {entry.record.occurred_at}</option>}{dateFields.map(field => <option key={field.key} value={field.key}>{field.label ?? field.key}: {String(field.value)}</option>)}</select></label>
      </div>
      <button type="button" disabled={busy || !prepared || !repo} onClick={() => void execute(async () => { setApproved(false); setPreview(await repo!.preview(entry, mapping)); })}>반영 영향 미리보기</button>
    </>}
    {preview?.status === "blocked" && <p role="status" className={styles.error}>{preview.reason} 원문과 검토 상태는 변경하지 않았습니다.</p>}
    {impact && <div aria-label="공개 반영 미리보기">
      <h3>{preview?.status === "applied" ? "반영 영수증" : "공개되는 정보"}</h3>
      <dl><dt>상품</dt><dd>{impact.product_name} {impact.specification}</dd><dt>판매처</dt><dd>{impact.store_name} {impact.location_label}</dd><dt>관측일</dt><dd>{impact.observed_on}</dd><dt>가격</dt><dd>{formatKrw(impact.unit_price_krw)}</dd><dt>관측 수 영향</dt><dd>{impact.observation_count_before}건에서 최대 {impact.additional_observations}건 추가 · 동일 관측은 중복 추가하지 않음</dd><dt>최저 관측가</dt><dd>{impact.minimum_before === null ? "기존 관측 없음" : formatKrw(impact.minimum_before)} → {formatKrw(impact.minimum_after)}</dd></dl>
      <p>이 상품·판매처·날짜·가격은 로그인하지 않은 사람도 볼 수 있습니다. 원문, 출처 메모, 개인 계정 정보와 다른 앱의 기록은 공개하지 않습니다.</p>
      {preview?.status === "ready" && <><label className={styles.check}><input type="checkbox" checked={approved} disabled={busy} onChange={event => setApproved(event.target.checked)} />위 계정과 원문 항목, 상품·판매처를 직접 확인했고 이 가격 정보의 공개 반영을 승인합니다.</label>
        <button type="button" disabled={busy || !approved} onClick={() => void execute(async () => { const result = await repo!.apply(entry, mapping, preview, approved); setPreview(result); setApproved(false); window.dispatchEvent(new Event("pricetrace-information-applied")); })}>승인한 공개 가격 반영</button></>}
      {preview?.status === "applied" && <p role="status">반영 완료 · 관측 ID {preview.observation_id}<br />{preview.applied_at}<br />다시 눌러도 가격 관측을 추가하지 않습니다. <a href="?view=products">상품 가격·통계에서 보기</a></p>}
    </div>}
    {busy && <p role="status">확인 중…</p>}
  </section>;
}
