"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { summarizeCanonicalPrices } from "@/domain/canonical-price";
import type { PurchaseType } from "@/domain/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./page.module.css";

type Category = { id: string; purchase_type: PurchaseType; parent_id: string | null; display_name: string; depth: number };
type CatalogProduct = { id: string; purchase_type: PurchaseType; canonical_name: string; brand: string | null; specification: string | null; category_id: string | null };
type RemoteObservation = { location_label: string | null; unit_price_krw: number; observed_at: string; measurement_unit: string };

const purchaseTypeLabels: Record<PurchaseType, string> = {
  retail_product: "Retail product",
  menu_item: "Restaurant menu",
  raw_material: "Raw material",
  property: "Property",
  service: "Service",
};

function descendantIds(categories: Category[], categoryId: string) {
  const ids = new Set([categoryId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const category of categories) {
      if (category.parent_id && ids.has(category.parent_id) && !ids.has(category.id)) {
        ids.add(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function CatalogExplorerPanel() {
  const client = getSupabaseBrowserClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [purchaseType, setPurchaseType] = useState<PurchaseType>("retail_product");
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [observations, setObservations] = useState<RemoteObservation[]>([]);
  const [canonicalName, setCanonicalName] = useState("");
  const [brand, setBrand] = useState("");
  const [specification, setSpecification] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceProductCode, setSourceProductCode] = useState("");
  const [message, setMessage] = useState("");

  const loadCatalog = useCallback(async () => {
    if (!client) return;
    const [{ data: categoryData, error: categoryError }, { data: productData, error: productError }] = await Promise.all([
      client.from("catalog_categories").select("id,purchase_type,parent_id,display_name,depth").eq("purchase_type", purchaseType).order("depth").order("display_name"),
      client.from("catalog_products").select("id,purchase_type,canonical_name,brand,specification,category_id").eq("purchase_type", purchaseType).eq("status", "active").order("canonical_name"),
    ]);
    if (categoryError || productError) setMessage(categoryError?.message ?? productError?.message ?? "Could not load catalog.");
    else {
      setCategories((categoryData ?? []) as Category[]);
      setProducts((productData ?? []) as CatalogProduct[]);
    }
  }, [client, purchaseType]);

  useEffect(() => {
    if (!client) return;
    void client.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setIsAdmin(data.user?.app_metadata?.role === "admin");
    });
  }, [client]);

  useEffect(() => {
    void loadCatalog();
    setCategoryId("");
    setSelectedProductId("");
  }, [loadCatalog]);

  useEffect(() => {
    if (!client || !selectedProductId) {
      setObservations([]);
      return;
    }
    void client.from("price_observations").select("location_label,unit_price_krw,observed_at,measurement_unit").eq("catalog_product_id", selectedProductId).order("observed_at", { ascending: false }).then(({ data, error }) => {
      if (error) setMessage(error.message);
      else setObservations((data ?? []) as RemoteObservation[]);
    });
  }, [client, selectedProductId]);

  const visibleProducts = useMemo(() => {
    if (!categoryId) return products;
    const ids = descendantIds(categories, categoryId);
    return products.filter((product) => product.category_id && ids.has(product.category_id));
  }, [categories, categoryId, products]);
  const priceSummaries = useMemo(() => summarizeCanonicalPrices(observations.map((observation) => ({
    locationLabel: observation.location_label,
    unitPriceKrw: observation.unit_price_krw,
    observedAt: observation.observed_at,
    measurementUnit: observation.measurement_unit,
  }))), [observations]);

  async function createCatalogProduct(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !userId || !canonicalName.trim()) return;
    const { error } = await client.from("catalog_products").insert({
      purchase_type: purchaseType,
      canonical_name: canonicalName.trim(),
      brand: brand.trim() || null,
      specification: specification.trim() || null,
      created_by: userId,
    });
    if (error) setMessage(error.message);
    else {
      setCanonicalName("");
      setBrand("");
      setSpecification("");
      setMessage("Canonical product created.");
      await loadCatalog();
    }
  }

  async function createSourceMapping(event: React.FormEvent) {
    event.preventDefault();
    if (!client || !userId || !selectedProductId || !sourceLabel.trim() || !sourceProductCode.trim()) return;
    const reviewedAt = new Date().toISOString();
    const { error } = await client.from("source_product_mappings").insert({
      source_label: sourceLabel.trim(),
      source_product_code: sourceProductCode.trim(),
      catalog_product_id: selectedProductId,
      matching_method: "manual",
      confidence: 1,
      review_status: "verified",
      created_by: userId,
      reviewed_by: userId,
      reviewed_at: reviewedAt,
    });
    if (error) setMessage(error.message);
    else {
      setSourceLabel("");
      setSourceProductCode("");
      setMessage("Source product mapping created. New synchronized observations will use it.");
    }
  }

  if (!client || !userId) return null;

  return (
    <section className={styles.section} aria-labelledby="catalog-title">
      <div className={styles.controls}>
        <div>
          <h2 id="catalog-title">Catalog explorer</h2>
          <p className={styles.muted}>Canonical products and categories are managed separately from receipt JSON.</p>
        </div>
        <label>Purchase type
          <select value={purchaseType} onChange={(event) => setPurchaseType(event.target.value as PurchaseType)}>
            {Object.entries(purchaseTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Category
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">All</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{"-- ".repeat(category.depth)}{category.display_name}</option>)}
          </select>
        </label>
      </div>
      {message && <p role="status" className={styles.muted}>{message}</p>}
      <div className={styles.catalogGrid}>
        <div>
          <h3>Canonical products</h3>
          {visibleProducts.length === 0 ? <p>No canonical products in this scope.</p> : <div className={styles.catalogList}>
            {visibleProducts.map((product) => <button type="button" className={product.id === selectedProductId ? styles.selectedCatalogProduct : styles.catalogProduct} key={product.id} onClick={() => setSelectedProductId(product.id)}>
              <strong>{product.canonical_name}</strong>
              <small>{[product.brand, product.specification].filter(Boolean).join(" | ") || "No specification"}</small>
            </button>)}
          </div>}
        </div>
        <div>
          <h3>Observed prices by source</h3>
          {!selectedProductId ? <p>Select a canonical product.</p> : priceSummaries.length === 0 ? <p>No synchronized observations are mapped to this product.</p> : <div className={styles.catalogList}>
            {priceSummaries.map((summary) => <article className={styles.catalogProduct} key={summary.locationLabel}>
              <strong>{summary.locationLabel}</strong>
              <small>Latest {summary.latestKrw.toLocaleString("ko-KR")} KRW | Min {summary.minimumKrw.toLocaleString("ko-KR")} | Max {summary.maximumKrw.toLocaleString("ko-KR")}</small>
              <small>{summary.observationCount} observations | {summary.measurementUnits.join(", ")}</small>
            </article>)}
          </div>}
        </div>
      </div>
      {isAdmin && <div className={styles.catalogAdmin}>
        <h3>Admin catalog and source mapping</h3>
        <form className={styles.inline} onSubmit={createCatalogProduct}>
          <label>Canonical name<input value={canonicalName} onChange={(event) => setCanonicalName(event.target.value)} required /></label>
          <label>Brand<input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>
          <label>Specification<input value={specification} onChange={(event) => setSpecification(event.target.value)} /></label>
          <button type="submit">Create canonical product</button>
        </form>
        <form className={styles.inline} onSubmit={createSourceMapping}>
          <label>Source<input value={sourceLabel} onChange={(event) => setSourceLabel(event.target.value)} required /></label>
          <label>Source product code<input value={sourceProductCode} onChange={(event) => setSourceProductCode(event.target.value)} required /></label>
          <button type="submit" disabled={!selectedProductId}>Map to selected product</button>
        </form>
      </div>}
    </section>
  );
}
