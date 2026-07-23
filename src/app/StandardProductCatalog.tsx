"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeMarketPrice } from "@/domain/canonical-price";
import { summarizeStandardProducts, type StandardProductVariant } from "@/domain/standard-product";
import type { ProductSort } from "@/domain/product-browser";
import { formatKrw } from "@/domain/settlement";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type StandardRow = { id: string; canonical_name: string };
type VariantRow = { id: string; standard_product_id: string; canonical_name: string; content_amount: number | null; content_unit: "g" | "ml" | "each" | null; package_count: number };
type ReceiptObservation = { catalog_product_id: string | null; unit_price_krw: number; observed_at: string; location_label: string | null };
type MarketObservation = { catalog_product_id: string; seller_name: string; listed_price_krw: number; shipping_fee_krw: number; observed_at: string };

export function StandardProductCatalog({ query, sort }: { query: string; sort: ProductSort }) {
  const client = getSupabaseBrowserClient();
  const [standards, setStandards] = useState<StandardRow[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [receiptObservations, setReceiptObservations] = useState<ReceiptObservation[]>([]);
  const [marketObservations, setMarketObservations] = useState<MarketObservation[]>([]);

  useEffect(() => {
    if (!client) return;
    void Promise.all([
      client.from("standard_products").select("id,canonical_name").eq("status", "active").order("canonical_name"),
      client.from("catalog_products").select("id,standard_product_id,canonical_name,content_amount,content_unit,package_count").eq("status", "active"),
      client.from("price_observations").select("catalog_product_id,unit_price_krw,observed_at,location_label").eq("verification_status", "verified"),
      client.from("market_price_observations").select("catalog_product_id,seller_name,listed_price_krw,shipping_fee_krw,observed_at").eq("verification_status", "verified"),
    ]).then(([standardResult, variantResult, receiptResult, marketResult]) => {
      if (standardResult.error || variantResult.error || receiptResult.error || marketResult.error) return;
      setStandards((standardResult.data ?? []) as StandardRow[]);
      setVariants((variantResult.data ?? []) as VariantRow[]);
      setReceiptObservations((receiptResult.data ?? []) as ReceiptObservation[]);
      setMarketObservations((marketResult.data ?? []) as MarketObservation[]);
    });
  }, [client]);

  const summaries = useMemo(() => {
    const byVariant = new Map(variants.map((variant) => [variant.id, variant]));
    const grouped: Record<string, StandardProductVariant[]> = {};
    const add = (variantId: string, sellerName: string, observedAt: string, listedPriceKrw: number, shippingFeeKrw = 0) => {
      const variant = byVariant.get(variantId);
      if (!variant?.content_amount || !variant.content_unit) return;
      const row: StandardProductVariant = { id: variant.id, listingName: variant.canonical_name, sellerName, observedAt, listedPriceKrw, shippingFeeKrw, contentAmount: variant.content_amount, contentUnit: variant.content_unit, packageCount: variant.package_count };
      grouped[variant.standard_product_id] = [...(grouped[variant.standard_product_id] ?? []), row];
    };
    for (const observation of receiptObservations) if (observation.catalog_product_id) add(observation.catalog_product_id, observation.location_label ?? "영수증 판매처", observation.observed_at, observation.unit_price_krw);
    for (const observation of marketObservations) add(observation.catalog_product_id, observation.seller_name, observation.observed_at, observation.listed_price_krw, observation.shipping_fee_krw);
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return summarizeStandardProducts(standards.map((standard) => ({ id: standard.id, name: standard.canonical_name })), grouped)
      .filter((summary) => !normalizedQuery || `${summary.name} ${summary.variants.map((variant) => `${variant.listingName} ${variant.sellerName}`).join(" ")}`.toLocaleLowerCase("ko-KR").includes(normalizedQuery))
      .sort((left, right) => {
        if (sort === "expensive") return right.lowestUnitPriceKrw - left.lowestUnitPriceKrw || left.name.localeCompare(right.name);
        if (sort === "sellers") return right.sellerCount - left.sellerCount || left.name.localeCompare(right.name);
        return left.lowestUnitPriceKrw - right.lowestUnitPriceKrw || left.name.localeCompare(right.name);
      });
  }, [marketObservations, query, receiptObservations, sort, standards, variants]);

  if (!client || summaries.length === 0) return null;
  return <section className={styles.standardCatalog} aria-labelledby="standard-catalog-title">
    <div className={styles.browserHead}><div><p className={styles.kicker}>STANDARD PRODUCT PRICE</p><h2 id="standard-catalog-title">표준 상품 최저 단위가격</h2><p>하위 판매 상품은 통합하며, 100g·100ml·1개 기준 가격으로 비교합니다.</p></div></div>
    <div className={styles.standardCatalogGrid}>{summaries.map((summary) => <article key={summary.id}>
      <span>(표준) 상품</span><h3>(표준) - {summary.name}</h3><strong>{summary.unitLabel} {formatKrw(summary.lowestUnitPriceKrw)}</strong>
      <p>최저: {summary.lowestVariant.sellerName} · {summary.lowestVariant.listingName}</p><small>판매처 {summary.sellerCount}곳 · 판매 기록 {summary.variants.length}건</small>
      <details><summary>하위 판매 상품 보기</summary>{summary.variants.map((variant, index) => {
        const normalized = normalizeMarketPrice({ sellerName: variant.sellerName, listedPriceKrw: variant.listedPriceKrw, shippingFeeKrw: variant.shippingFeeKrw ?? 0, minimumOrderQuantity: 1, observedAt: variant.observedAt, verificationStatus: "verified" }, variant);
        return <p key={`${variant.id}:${variant.sellerName}:${index}`}>{variant.sellerName} · {variant.listingName} · {formatKrw(normalized.effectivePriceKrw)} · {normalized.referenceLabel} {formatKrw(normalized.pricePerReferenceUnitKrw)}</p>;
      })}</details>
    </article>)}</div>
  </section>;
}
