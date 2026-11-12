"use client";

import { ReceiptProductNutritionPanel } from "../features/product-nutrition/ReceiptProductNutritionPanel";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { ProductGroup } from "@/domain/product-browser";
import {
  sellerPricePointsFromGroup,
  summarizeSellerPrices,
  type PricePointSource,
  type SellerPricePoint,
} from "@/domain/seller-price-insights";
import { formatKrw } from "@/domain/settlement";
import { trapDialogFocus, useDialogLifecycle } from "@/hooks/use-dialog-lifecycle";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type TrendPoint = SellerPricePoint;

export function PriceTrendModal({ group, onClose, onOpenStore, onBack }: { group: ProductGroup; onClose: () => void; onOpenStore: (store: string) => void; onBack?: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const client = getSupabaseBrowserClient();
  const initialPoints = useMemo(() => sellerPricePointsFromGroup(group), [group]);
  const [points, setPoints] = useState<TrendPoint[]>(initialPoints);
  const [selectedSeller, setSelectedSeller] = useState(group.latest.storeLabel);
  const [loading, setLoading] = useState(Boolean(client && group.officialProduct));
  const initialMessage = group.latest.catalogNamespace === "public-price"
    ? `${group.latest.storeLabel}에서 공개한 정확한 상품의 가격 관측입니다. 개인 구매 기록과 합산하지 않습니다.`
    : group.officialProduct ? "" : `${group.latest.storeLabel}의 동일 상품 관측을 표시합니다. 판매처 비교는 검증된 공통 상품 연결이 있을 때 확장됩니다.`;
  const [message, setMessage] = useState(initialMessage);

  useDialogLifecycle({ onClose, initialFocusRef: closeButtonRef });

  useEffect(() => {
    setPoints(initialPoints);
    setSelectedSeller(group.latest.storeLabel);
    setLoading(Boolean(client && group.officialProduct));
    setMessage(initialMessage);
  }, [client, group, initialPoints, initialMessage]);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!group.officialProduct || !client) { setLoading(false); return; }
      const { data: user } = await client.auth.getUser();
      if (!user.user) {
        if (active) {
          setLoading(false);
          setMessage("로그인하면 내 계정에 저장된 판매처별 관측도 함께 확인할 수 있습니다.");
        }
        return;
      }
      const { data: mapping, error: mappingError } = await client
        .from("source_product_mappings")
        .select("catalog_product_id")
        .eq("source_label", group.sourceStoreLabel ?? group.latest.storeLabel)
        .eq("source_product_code", group.sourceProductCode)
        .eq("review_status", "verified")
        .maybeSingle();
      if (mappingError || !mapping) {
        if (active) {
          setLoading(false);
          setMessage("검증된 통합 상품 매핑이 없어 현재 영수증 관측만 표시합니다.");
        }
        return;
      }
      const { data, error } = await client
        .from("price_observations")
        .select("location_label,observed_at,unit_price_krw")
        .eq("catalog_product_id", mapping.catalog_product_id)
        .order("observed_at", { ascending: true });
      if (!active) return;
      if (error) {
        setMessage("저장된 가격 관측을 불러오지 못했습니다.");
      } else {
        setPoints((current) => mergeTrendPoints(current, (data ?? []).map((row) => ({
          sellerLabel: row.location_label ?? "판매처 미상",
          observedAt: row.observed_at,
          priceKrw: row.unit_price_krw,
          confidence: null,
          source: "stored",
        }))));
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [client, group]);

  const sellerSummaries = useMemo(() => summarizeSellerPrices(points), [points]);
  useEffect(() => {
    if (sellerSummaries.length > 0 && !sellerSummaries.some((summary) => summary.sellerLabel === selectedSeller)) {
      setSelectedSeller(sellerSummaries[0].sellerLabel);
    }
  }, [selectedSeller, sellerSummaries]);

  const selectedSummary = sellerSummaries.find((summary) => summary.sellerLabel === selectedSeller) ?? sellerSummaries[0] ?? null;
  const ordered = useMemo(
    () => points
      .filter((point) => point.sellerLabel === selectedSummary?.sellerLabel)
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt)),
    [points, selectedSummary?.sellerLabel],
  );
  const changes = calculateTrendChanges(ordered);
  const title = group.officialProduct?.officialName ?? group.productName;

  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`${styles.authModal} ${styles.trendModal}`} role="dialog" aria-modal="true" aria-labelledby="trend-title" onKeyDown={trapDialogFocus}>
      {onBack && <button type="button" className={styles.backButton} onClick={onBack} aria-label="이전 화면으로 돌아가기">‹ 뒤로</button>}
      <button ref={closeButtonRef} className={styles.closeButton} onClick={onClose} aria-label="가격 이력 창 닫기">×</button>
      <h2 id="trend-title">{title}</h2>
      {selectedSummary && <>
        <div className={styles.productDetailMeta}>
          <span>판매처</span>
          <button type="button" className={styles.storeInfoButton} aria-label={`${selectedSummary.sellerLabel} 판매처 정보 보기`} onClick={() => onOpenStore(selectedSummary.sellerLabel)}>
            {selectedSummary.sellerLabel} <Icon name="chevron" size={16} />
          </button>
          {group.latest.catalogNamespace !== "public-price" && <small>코드 {group.sourceProductCode}</small>}
        </div>
        <dl className={styles.trendStats}>
          <div><dt>최근 관측가</dt><dd>{formatKrw(selectedSummary.latestPriceKrw)}</dd></div>
          <div><dt>최저 관측가</dt><dd>{formatKrw(selectedSummary.minimumPriceKrw)}</dd></div>
          <div><dt>최고 관측가</dt><dd>{formatKrw(selectedSummary.maximumPriceKrw)}</dd></div>
        </dl>
        <section className={styles.trendVisualSection} aria-labelledby="trend-visual-title">
          <h3 id="trend-visual-title">가격 변동 추이</h3>
          <TrendGraph points={ordered} />
        </section>
      </>}

      {group.latest.storeProductId && <ReceiptProductNutritionPanel storeProductId={group.latest.storeProductId} />}
      {loading && <p className={styles.trendNote}>저장된 관측을 확인하고 있습니다.</p>}
      {message && <p className={styles.trendNote}>{message}</p>}

      {selectedSummary && <section className={styles.changeSection} aria-labelledby="trend-changes-title">
        <h3 id="trend-changes-title">변동 이력</h3>
        <table className={styles.trendTable} aria-labelledby="trend-changes-title">
          <thead><tr>
            <th scope="col">관측일</th>
            <th scope="col">데이터 출처</th>
            <th scope="col">관측가</th>
            <th scope="col">직전 대비</th>
          </tr></thead>
          <tbody>
            {[...changes].reverse().map((point, index) => <tr key={`${point.sellerLabel}:${point.observedAt}:${point.source}:${index}`}>
              <td><time dateTime={point.observedAt}>{point.observedAt}</time></td>
              <td>{formatSource(point.source)}</td>
              <td><strong>{formatKrw(point.priceKrw)}</strong></td>
              <td className={priceChangeClass(point.differenceKrw)}>{formatPriceChange(point.differenceKrw, point.differencePercent)}</td>
            </tr>)}
          </tbody>
        </table>
      </section>}
    </section>
  </div>;
}

function mergeTrendPoints(local: TrendPoint[], remote: TrendPoint[]) {
  const seen = new Set(local.map((point) => `${point.sellerLabel}:${point.observedAt}:${point.priceKrw}`));
  return [...local, ...remote.filter((point) => !seen.has(`${point.sellerLabel}:${point.observedAt}:${point.priceKrw}`))];
}

function calculateTrendChanges(points: TrendPoint[]) {
  let previous: number | null = null;
  return points.map((point) => {
    const differenceKrw = previous === null ? null : point.priceKrw - previous;
    const differencePercent = previous === null || previous === 0 ? null : (differenceKrw! / previous) * 100;
    previous = point.priceKrw;
    return { ...point, differenceKrw, differencePercent };
  });
}

function formatPriceChange(amount: number | null, percent: number | null) {
  if (amount === null) return "첫 관측";
  if (amount === 0) return "변화 없음";
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatKrw(amount)} (${sign}${percent?.toFixed(1) ?? "0.0"}%)`;
}

function formatSource(source: PricePointSource) {
  if (source === "public") return "공개 관측";
  if (source === "stored") return "내 저장 관측";
  return "영수증";
}

function priceChangeClass(amount: number | null) {
  if (amount === null || amount === 0) return styles.noChange;
  return amount > 0 ? styles.priceUp : styles.priceDown;
}

function TrendGraph({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <div className={styles.graphEmpty}>이 판매처의 가격 변화 그래프를 만들려면 서로 다른 시점의 관측이 2건 이상 필요합니다.</div>;
  const prices = points.map((point) => point.priceKrw);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  const plotPoints = points.map((point, index) => ({
    ...point,
    x: 12 + (index / (points.length - 1)) * 276,
    y: range === 0 ? 44 : 68 - ((point.priceKrw - min) / range) * 48,
  }));
  const path = plotPoints.map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  return <div className={styles.graphWrap}>
    <svg viewBox="0 0 300 88" role="img" aria-label={`${points[0].sellerLabel} 가격 관측 변화 그래프`}>
      <path className={styles.graphBase} d="M 12 20 H 288 M 12 44 H 288 M 12 68 H 288" />
      <path className={styles.graphLine} d={path} />
      {plotPoints.map((point, index) => <circle key={`${point.observedAt}:${point.priceKrw}:${index}`} cx={point.x} cy={point.y} r="2.4" />)}
    </svg>
    <div>
      <time dateTime={points[0].observedAt}>{points[0].observedAt}</time>
      <time dateTime={points[points.length - 1].observedAt}>{points[points.length - 1].observedAt}</time>
    </div>
  </div>;
}
