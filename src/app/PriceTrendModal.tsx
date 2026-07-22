"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductGroup } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type TrendPoint = { storeLabel: string; observedAt: string; unitPriceKrw: number; source: "영수증" | "저장된 관측" };

export function PriceTrendModal({ group, onClose }: { group: ProductGroup; onClose: () => void }) {
  const client = getSupabaseBrowserClient();
  const [points, setPoints] = useState<TrendPoint[]>(() => group.observations.map((observation) => ({ storeLabel: observation.storeLabel, observedAt: observation.observedAt, unitPriceKrw: observation.item.unitPriceKrw, source: "영수증" })));
  const [loading, setLoading] = useState(Boolean(client));
  const [message, setMessage] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!client) { setLoading(false); return; }
      const { data: user } = await client.auth.getUser();
      if (!user.user) { if (active) { setLoading(false); setMessage("로그인하면 저장된 추가 관측가도 함께 확인할 수 있습니다."); } return; }
      const { data: mapping, error: mappingError } = await client.from("source_product_mappings").select("catalog_product_id").eq("source_label", group.storeLabel).eq("source_product_code", group.sourceProductCode).eq("review_status", "verified").maybeSingle();
      if (mappingError || !mapping) { if (active) { setLoading(false); setMessage("검증된 통합 상품 연결이 없어 현재 영수증 관측만 표시합니다."); } return; }
      const { data, error } = await client.from("price_observations").select("location_label,observed_at,unit_price_krw").eq("catalog_product_id", mapping.catalog_product_id).order("observed_at", { ascending: true });
      if (!active) return;
      if (error) setMessage("저장된 가격 관측을 불러오지 못했습니다.");
      else setPoints((current) => mergeTrendPoints(current, (data ?? []).map((row) => ({ storeLabel: row.location_label ?? "판매처 미상", observedAt: row.observed_at, unitPriceKrw: row.unit_price_krw, source: "저장된 관측" as const }))));
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [client, group]);

  const ordered = useMemo(() => [...points].sort((a, b) => a.observedAt.localeCompare(b.observedAt)), [points]);
  const prices = ordered.map((point) => point.unitPriceKrw);
  const minimum = prices.length ? Math.min(...prices) : null;
  const maximum = prices.length ? Math.max(...prices) : null;
  const latest = ordered.at(-1) ?? null;
  const changes = calculateTrendChanges(ordered);

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`${styles.authModal} ${styles.trendModal}`} role="dialog" aria-modal="true" aria-labelledby="trend-title"><button className={styles.closeButton} onClick={onClose} aria-label="가격 이력 창 닫기">×</button><p className={styles.kicker}>PRICE HISTORY</p><h2 id="trend-title">{group.productName}</h2><p className={styles.storeInfo}>판매 마트 <b>{group.storeLabel}</b> · 코드 {group.sourceProductCode}</p>
    <div className={styles.trendStats}><div><span>최근 관측가</span><strong>{latest ? formatKrw(latest.unitPriceKrw) : "-"}</strong></div><div><span>최저 관측가</span><strong>{minimum === null ? "-" : formatKrw(minimum)}</strong></div><div><span>최고 관측가</span><strong>{maximum === null ? "-" : formatKrw(maximum)}</strong></div></div>
    <TrendGraph points={ordered} />
    {loading && <p className={styles.trendNote}>저장된 관측가를 확인하고 있습니다.</p>}{message && <p className={styles.trendNote}>{message}</p>}
    <section className={styles.changeSection}><h3>관측 기록</h3><p>동일 판매처의 직전 관측가와 비교합니다.</p><div className={styles.trendTable}><div className={styles.trendTableHeader}><span>관측일</span><span>판매 마트</span><span>관측가</span><span>직전 대비</span></div>{changes.map((point, index) => <div key={`${point.storeLabel}:${point.observedAt}:${index}`}><span>{point.observedAt}</span><b>{point.storeLabel}</b><strong>{formatKrw(point.unitPriceKrw)}</strong><em className={point.differenceKrw === null ? styles.noChange : point.differenceKrw > 0 ? styles.priceUp : point.differenceKrw < 0 ? styles.priceDown : styles.noChange}>{formatPriceChange(point.differenceKrw, point.differencePercent)}</em></div>)}</div></section>
  </section></div>;
}

function mergeTrendPoints(local: TrendPoint[], remote: TrendPoint[]) {
  const seen = new Set(local.map((point) => `${point.storeLabel}:${point.observedAt}:${point.unitPriceKrw}`));
  return [...local, ...remote.filter((point) => !seen.has(`${point.storeLabel}:${point.observedAt}:${point.unitPriceKrw}`))];
}

function calculateTrendChanges(points: TrendPoint[]) {
  const previousByStore = new Map<string, number>();
  return points.map((point) => {
    const previous = previousByStore.get(point.storeLabel);
    previousByStore.set(point.storeLabel, point.unitPriceKrw);
    return { ...point, differenceKrw: previous === undefined ? null : point.unitPriceKrw - previous, differencePercent: previous === undefined || previous === 0 ? null : ((point.unitPriceKrw - previous) / previous) * 100 };
  });
}

function formatPriceChange(amount: number | null, percent: number | null) {
  if (amount === null) return "첫 관측";
  if (amount === 0) return "변동 없음";
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatKrw(amount)} (${sign}${percent?.toFixed(1) ?? "0.0"}%)`;
}

function TrendGraph({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <div className={styles.graphEmpty}>가격 변화 그래프를 만들려면 2개 이상의 관측가가 필요합니다.</div>;
  const prices = points.map((point) => point.unitPriceKrw);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 1);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${12 + (index / (points.length - 1)) * 276} ${92 - ((point.unitPriceKrw - min) / range) * 68}`).join(" ");
  return <div className={styles.graphWrap}><svg viewBox="0 0 300 110" role="img" aria-label="가격 관측 변화 그래프"><path className={styles.graphBase} d="M 12 92 H 288" /><path className={styles.graphLine} d={path} />{points.map((point, index) => <circle key={`${point.observedAt}:${index}`} cx={12 + (index / (points.length - 1)) * 276} cy={92 - ((point.unitPriceKrw - min) / range) * 68} r="4" />)}</svg><div><span>{points[0].observedAt}</span><span>{points.at(-1)?.observedAt}</span></div></div>;
}
