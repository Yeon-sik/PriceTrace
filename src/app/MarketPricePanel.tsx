"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { lowestVerifiedMarketPrice, normalizeMarketPrice, type MarketPriceObservation, type ProductSpecification } from "@/domain/canonical-price";
import { formatKrw } from "@/domain/settlement";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type ContentUnit = "g" | "ml" | "each";
type CatalogProduct = { id: string; canonical_name: string; brand: string | null; specification: string | null; content_amount: number | null; content_unit: ContentUnit | null; package_count: number; product_reference_url: string | null };
type StoredObservation = { id: string; seller_name: string; product_url: string; listed_price_krw: number; shipping_fee_krw: number; minimum_order_quantity: number; observed_at: string; verification_status: "pending" | "verified" | "rejected" };

const initialOffer = { sellerName: "", productUrl: "", listedPriceKrw: "", shippingFeeKrw: "0", minimumOrderQuantity: "1" };

function specificationFor(product: CatalogProduct | undefined): ProductSpecification | null {
  if (!product?.content_amount || !product.content_unit || !product.package_count) return null;
  return { contentAmount: product.content_amount, contentUnit: product.content_unit, packageCount: product.package_count };
}

function asDomainObservation(observation: StoredObservation): MarketPriceObservation {
  return { sellerName: observation.seller_name, listedPriceKrw: observation.listed_price_krw, shippingFeeKrw: observation.shipping_fee_krw, minimumOrderQuantity: observation.minimum_order_quantity, observedAt: observation.observed_at, verificationStatus: observation.verification_status };
}

export function MarketPricePanel() {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [offers, setOffers] = useState<StoredObservation[]>([]);
  const [offer, setOffer] = useState(initialOffer);
  const [message, setMessage] = useState("");

  const loadProducts = useCallback(async () => {
    if (!client) return;
    const { data, error } = await client.from("catalog_products").select("id,canonical_name,brand,specification,content_amount,content_unit,package_count,product_reference_url").eq("status", "active").order("canonical_name");
    if (error) setMessage(error.message);
    else setProducts((data ?? []) as CatalogProduct[]);
  }, [client]);

  useEffect(() => { if (client) void client.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, [client]);
  useEffect(() => { void loadProducts(); }, [loadProducts]);
  useEffect(() => {
    if (!client || !selectedProductId) { setOffers([]); return; }
    void client.from("market_price_observations").select("id,seller_name,product_url,listed_price_krw,shipping_fee_krw,minimum_order_quantity,observed_at,verification_status").eq("catalog_product_id", selectedProductId).order("observed_at", { ascending: false }).then(({ data, error }) => {
      if (error) setMessage(error.message);
      else setOffers((data ?? []) as StoredObservation[]);
    });
  }, [client, selectedProductId]);

  const selectedProduct = products.find((product) => product.id === selectedProductId);
  const specification = specificationFor(selectedProduct);
  const lowest = useMemo(() => specification ? lowestVerifiedMarketPrice(offers.map(asDomainObservation), specification) : null, [offers, specification]);

  async function saveOffer(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !userId || !selectedProductId || !specification) return;
    const listedPriceKrw = Number(offer.listedPriceKrw);
    const shippingFeeKrw = Number(offer.shippingFeeKrw);
    const minimumOrderQuantity = Number(offer.minimumOrderQuantity);
    if (!offer.sellerName.trim() || !/^https?:\/\//.test(offer.productUrl) || !Number.isInteger(listedPriceKrw) || listedPriceKrw < 0 || !Number.isInteger(shippingFeeKrw) || shippingFeeKrw < 0 || !Number.isInteger(minimumOrderQuantity) || minimumOrderQuantity < 1) {
      setMessage("판매처, URL, 가격, 배송비, 최소 구매 수량을 올바르게 입력하세요.");
      return;
    }
    const verifiedAt = new Date().toISOString();
    const { error } = await client.from("market_price_observations").insert({ catalog_product_id: selectedProductId, seller_name: offer.sellerName.trim(), product_url: offer.productUrl.trim(), listed_price_krw: listedPriceKrw, shipping_fee_krw: shippingFeeKrw, minimum_order_quantity: minimumOrderQuantity, observed_at: verifiedAt, verification_status: "verified", verified_by: userId, verified_at: verifiedAt });
    if (error) { setMessage(error.message); return; }
    setOffer(initialOffer);
    setMessage("검증된 시장 관측가를 등록했습니다.");
    const { data } = await client.from("market_price_observations").select("id,seller_name,product_url,listed_price_krw,shipping_fee_krw,minimum_order_quantity,observed_at,verification_status").eq("catalog_product_id", selectedProductId).order("observed_at", { ascending: false });
    setOffers((data ?? []) as StoredObservation[]);
  }

  if (!client || !userId) return null;
  return <section className={styles.marketPricePanel} aria-labelledby="market-price-title">
    <div className={styles.adminSectionHead}><div><p className={styles.kicker}>TRACKED SELLER PRICES</p><h2 id="market-price-title">관측 판매처 기준 최저가</h2><p>관리자가 상품 규격과 URL을 확인한 관측가만 비교합니다. 배송비는 포함하고 쿠폰·회원가는 포함하지 않습니다.</p></div></div>
    {message && <p role="status" className={styles.muted}>{message}</p>}
    <label className={styles.marketProductSelect}>표준 상품<select value={selectedProductId} onChange={(event) => { setSelectedProductId(event.target.value); setMessage(""); }}><option value="">상품을 선택하세요</option>{products.map((product) => <option key={product.id} value={product.id}>{[product.canonical_name, product.brand, product.specification].filter(Boolean).join(" | ")}</option>)}</select></label>
    {selectedProduct && <div className={styles.marketSpecification}><strong>{selectedProduct.canonical_name}</strong>{specification ? <><span>규격 {specification.contentAmount}{specification.contentUnit} × {specification.packageCount}</span>{selectedProduct.product_reference_url && <a href={selectedProduct.product_reference_url} target="_blank" rel="noreferrer">상품 확인 출처</a>}</> : <span>규격이 없어 단위가격을 계산할 수 없습니다. 카탈로그 관리에서 내용량과 확인 URL을 먼저 등록하세요.</span>}</div>}
    {specification && <><div className={styles.marketLowest}>{lowest ? <><span>현재 관측 판매처 기준 최저가</span><strong>{lowest.sellerName} · {formatKrw(lowest.effectivePriceKrw)}</strong><b>{lowest.referenceLabel} {formatKrw(lowest.pricePerReferenceUnitKrw)}</b></> : <span>검증된 시장 관측가가 없습니다.</span>}</div>
      <form className={styles.marketOfferForm} onSubmit={saveOffer}>
        <h3>수동 시장 관측가 등록</h3><label>판매처<input required value={offer.sellerName} onChange={(event) => setOffer({ ...offer, sellerName: event.target.value })} /></label><label>상품 URL<input required type="url" placeholder="https://" value={offer.productUrl} onChange={(event) => setOffer({ ...offer, productUrl: event.target.value })} /></label><label>판매가<input required inputMode="numeric" value={offer.listedPriceKrw} onChange={(event) => setOffer({ ...offer, listedPriceKrw: event.target.value })} /></label><label>배송비<input required inputMode="numeric" value={offer.shippingFeeKrw} onChange={(event) => setOffer({ ...offer, shippingFeeKrw: event.target.value })} /></label><label>최소 구매 수량<input required type="number" min="1" step="1" value={offer.minimumOrderQuantity} onChange={(event) => setOffer({ ...offer, minimumOrderQuantity: event.target.value })} /></label><button type="submit">검증 후 등록</button>
      </form>
      <div className={styles.marketOfferList}>{offers.map((item) => { const normalized = normalizeMarketPrice(asDomainObservation(item), specification); return <article key={item.id}><div><strong>{item.seller_name}</strong><small>{new Date(item.observed_at).toLocaleDateString("ko-KR")} · 최소 {item.minimum_order_quantity}개</small></div><div><b>{formatKrw(normalized.effectivePriceKrw)}</b><small>{normalized.referenceLabel} {formatKrw(normalized.pricePerReferenceUnitKrw)}</small></div><a href={item.product_url} target="_blank" rel="noreferrer">상품 보기</a></article>; })}</div>
    </>}
  </section>;
}
