"use client";

import { useEffect, useMemo, useState } from "react";
import { categoryForProduct, compareCoupangPrice, distinctSellerCount, filterAndSortProductGroups, latestSellerRows, mergeOfficialProductGroups, PRODUCT_CATEGORIES, type CoupangPriceComparison, type MartType, type ProductCategory, type ProductGroup, type ProductSort } from "@/domain/product-browser";
import { buildPublicStandardCatalogIndex, publicStandardMappingKey, PublicStandardCatalogRowsSchema, type PublicCoupangPrice } from "@/domain/public-standard-catalog";
import { resolveCoupangPrice, type ResolvedCoupangPrice } from "@/domain/coupang-price";
import { sellerPricePointsFromGroup, summarizeSellerPrices } from "@/domain/seller-price-insights";
import { formatKrw } from "@/domain/settlement";
import { officialProductCandidateKey, seededOfficialProducts, type OfficialProductRecord } from "@/domain/official-product";
import { normalizeMarketPrice, type ProductSpecification } from "@/domain/canonical-price";
import {
  filterAndSortOfficialChannelListings,
  partitionOfficialChannelListingsByStandardProduct,
  type PublicOfficialChannelListing,
} from "@/domain/public-official-channel-catalog";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { OfficialProductRepository } from "@/repositories/official-product.repository";
import { PublicOfficialChannelCatalogRepository } from "@/repositories/public-official-channel-catalog.repository";
import { CoupangComparisonMessage } from "./CoupangComparisonMessage";
import { ProductImage } from "./ProductImage";
import { PxOfficialProductBrowser } from "./PxOfficialProductBrowser";
import { StandardProductDetailModal } from "./StandardProductDetailModal";
import { StoreListModal } from "./StoreListModal";
import styles from "./page.module.css";

const officialProductRepository = new OfficialProductRepository();
const publicPxCatalog = new PublicOfficialChannelCatalogRepository().loadPxCatalog();
type CatalogView = "all" | "standard" | "official";

export type StandardProductItem = ProductGroup & { unitPriceLabel: string; unitPriceKrw: number; packageLabel: string; referenceUnit: number };

export type CoupangPrice = ResolvedCoupangPrice;

export type PriceHistoryPoint = { date: string; unitPriceKrw: number; unitPriceLabel: string; actualPriceKrw: number; storeLabel: string };

export type StandardProductGroup = {
  id: string;
  name: string;
  imageUrl?: string;
  category: ProductCategory;
  items: StandardProductItem[];
  lowestUnitPriceKrw: number;
  highestUnitPriceKrw: number;
  unitPriceLabel: string;
  lowestPriceKrw: number;
  sellerCount: number;
  latestObservedAt: string;
  observationCount: number;
  coupangPrice: CoupangPrice | null;
  coupangComparison: CoupangPriceComparison | null;
  priceHistory: PriceHistoryPoint[];
  officialListings: PublicOfficialChannelListing[];
};

type OfficialLinkedStandardSummary = {
  id: string;
  standardProductId: string;
  name: string;
  imageUrl?: string;
  category: ProductCategory;
  listings: PublicOfficialChannelListing[];
};

function formatPackageLabel(spec: ProductSpecification) {
  const unitLabel = spec.contentUnit === "each" ? "개" : spec.contentUnit;
  const base = `${spec.contentAmount}${unitLabel}`;
  return spec.packageCount > 1 ? `${base} x ${spec.packageCount}` : base;
}

function StoreInfo({ sellerCount, martTypeLabel, onOpen }: { sellerCount: number; martTypeLabel?: string; onOpen: () => void }) {
  return <p className={styles.storeInfo}>판매처 {sellerCount}곳{martTypeLabel && <em>{martTypeLabel}</em>}<button type="button" className={styles.storeInfoButton} aria-label="판매처 정보 보기" onClick={onOpen}>›</button></p>;
}

function buildCoupangPrice(entry: PublicCoupangPrice, referenceUnit: number): CoupangPrice {
  return resolveCoupangPrice(entry, referenceUnit as 10 | 100 | 1000);
}

function isMissingCatalogRpc(error: { code?: string; message?: string } | null) {
  return error?.code === "PGRST202"
    || error?.message?.includes("Could not find the function") === true;
}

function RecordedPriceBlock({ group }: { group: ProductGroup }) {
  return <div className={styles.listedPrice}><strong>{formatKrw(group.latestPriceKrw)}</strong></div>;
}

function officialListingSearchText(listing: PublicOfficialChannelListing) {
  return [
    listing.sourceNameRaw,
    listing.vendorNameRaw,
    listing.specificationTextRaw,
    listing.sourceProductCode,
  ].filter(Boolean).join(" ");
}

function OfficialLinkedStandardCard({
  standard,
  onOpen,
}: {
  standard: OfficialLinkedStandardSummary;
  onOpen?: () => void;
}) {
  const prices = standard.listings.map((listing) => listing.officialPrice.amountKrw);
  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);
  const firstListing = standard.listings[0];

  return <article className={`${styles.productCard} ${styles.officialLinkedStandardCard}`}>
    <div className={styles.productVisual} data-testid="product-image-slot">
      <ProductImage
        productName={standard.name}
        sourceProductCode={firstListing.sourceProductCode}
        category={standard.category}
        imageUrl={standard.imageUrl}
      />
      <span className={styles.standardProductBadge}>표준 상품</span>
    </div>
    <div className={`${styles.productInfo} ${styles.officialChannelInfo}`}>
      <span className={styles.officialCategoryBadge}>{standard.category}</span>
      <h2>{standard.name}</h2>
      <p><b>공식 출처</b> PX 공식 판매상품 {standard.listings.length.toLocaleString("ko-KR")}개 연결</p>
      <div className={styles.officialChannelPrice}>
        <small>PX 공식 사이트 표시가</small>
        <strong>{formatKrw(lowestPrice)}{highestPrice === lowestPrice ? "" : ` ~ ${formatKrw(highestPrice)}`}</strong>
      </div>
      <div className={styles.officialChannelMeta}>
        <span>연결된 원문: {standard.listings.map((listing) => listing.sourceNameRaw).join(", ")}</span>
        <span>특정 지점 판매·재고 확인 아님</span>
      </div>
      {onOpen && <button type="button" onClick={onOpen}>출처·가격 상세 보기 ›</button>}
    </div>
  </article>;
}

export function ProductBrowser({ groups, query, setQuery, category, setCategory, martType, setMartType, selectedStore, setSelectedStore, sort, setSort, authRevision, onAdd, onTrend, onOpenStore }: {
  groups: ProductGroup[]; query: string; setQuery: (value: string) => void; category: ProductCategory; setCategory: (value: ProductCategory) => void; martType: MartType; setMartType: (value: MartType) => void; selectedStore: string; setSelectedStore: (value: string) => void; sort: ProductSort; setSort: (value: ProductSort) => void; authRevision: number; onAdd: (group: ProductGroup) => void; onTrend: (group: ProductGroup) => void; onOpenStore: (store: string) => void;
}) {
  const client = getSupabaseBrowserClient();
  const { linkedByStandardProduct, standaloneListings } = useMemo(
    () => partitionOfficialChannelListingsByStandardProduct(publicPxCatalog.listings),
    [],
  );
  const [officialProducts, setOfficialProducts] = useState<Record<string, OfficialProductRecord>>(seededOfficialProducts);
  const [standardMappings, setStandardMappings] = useState<Map<string, string>>(new Map());
  const [exactStandardMappings, setExactStandardMappings] = useState<Map<string, string>>(new Map());
  const [catalogSpecs, setCatalogSpecs] = useState<Map<string, ProductSpecification & { standardProductId: string }>>(new Map());
  const [standardNames, setStandardNames] = useState<Map<string, string>>(new Map());
  const [standardImages, setStandardImages] = useState<Map<string, string>>(new Map());
  const [coupangByStandard, setCoupangByStandard] = useState<Map<string, PublicCoupangPrice>>(new Map());
  const [catalogNotice, setCatalogNotice] = useState("");
  const [catalogView, setCatalogView] = useState<CatalogView>("all");
  const [openStandardId, setOpenStandardId] = useState<string | null>(null);
  const [storeListTarget, setStoreListTarget] = useState<{ title: string; rows: { storeLabel: string; observedAt: string }[] } | null>(null);
  useEffect(() => setOfficialProducts({ ...seededOfficialProducts, ...officialProductRepository.loadAll() }), []);
  useEffect(() => {
    let active = true;
    if (!client) {
      setCatalogNotice("표준 상품 정보를 불러오지 못해 현재는 개별 상품으로 표시합니다.");
      return () => { active = false; };
    }

    const loadStandardCatalog = async () => {
      let publicCatalogReady = false;
      let signedInCatalogReady = false;
      let coupangReady = false;
      let sharedMappings = new Map<string, string>();
      const exactMappings = new Map<string, string>();
      let specs = new Map<string, ProductSpecification & { standardProductId: string }>();
      let names = new Map<string, string>();
      let images = new Map<string, string>();
      let coupangPrices = new Map<string, PublicCoupangPrice>();

      const v2PublicResult = await client.rpc("get_public_exact_standard_product_catalog_v2");
      const exactPublicResult = v2PublicResult.error && isMissingCatalogRpc(v2PublicResult.error)
        ? await client.rpc("get_public_exact_standard_product_catalog")
        : v2PublicResult;
      const publicResult = exactPublicResult.error && isMissingCatalogRpc(exactPublicResult.error)
        ? await client.rpc("get_public_standard_product_catalog")
        : exactPublicResult;
      if (!publicResult.error) {
        const parsed = PublicStandardCatalogRowsSchema.safeParse(publicResult.data ?? []);
        if (parsed.success) {
          const publicIndex = buildPublicStandardCatalogIndex(parsed.data);
          sharedMappings = publicIndex.standardMappings;
          for (const [key, catalogProductId] of publicIndex.exactStandardMappings) {
            exactMappings.set(key, catalogProductId);
          }
          specs = publicIndex.catalogSpecs;
          names = publicIndex.standardNames;
          coupangPrices = publicIndex.coupangByStandard;
          publicCatalogReady = true;
          coupangReady = true;
        }
      }

      const imageResult = await client.from("standard_product_images").select("standard_product_id,image_url");
      if (!imageResult.error) {
        images = new Map((imageResult.data ?? []).map((row) => [row.standard_product_id as string, row.image_url as string]));
      }

      const { data: authData } = await client.auth.getUser();
      if (authData.user) {
        const [mappingResult, catalogResult, standardResult, coupangResult] = await Promise.all([
          client.from("source_product_mappings").select("source_label,source_product_code,catalog_product_id").eq("review_status", "verified"),
          client.from("catalog_products").select("id,standard_product_id,content_amount,content_unit,package_count,reference_unit").eq("status", "active").eq("specification_status", "verified"),
          client.from("standard_products").select("id,canonical_name").eq("status", "active"),
          client.from("standard_product_coupang_prices").select("standard_product_id,listed_price_krw,quantity,content_amount,content_unit,max_bundle_quantity,max_bundle_listed_price_krw,product_url,observed_at").order("observed_at", { ascending: false }),
        ]);
        if (!mappingResult.error) {
          for (const mapping of mappingResult.data ?? []) {
            exactMappings.set(
              publicStandardMappingKey(mapping.source_label, mapping.source_product_code),
              mapping.catalog_product_id as string,
            );
          }
        }
        if (!catalogResult.error) {
          specs = new Map([
            ...specs,
            ...(catalogResult.data ?? [])
              .filter((row) => row.content_amount && row.content_unit)
              .map((row) => [row.id as string, { contentAmount: row.content_amount as number, contentUnit: row.content_unit as ProductSpecification["contentUnit"], packageCount: row.package_count as number, referenceUnit: row.reference_unit as 10 | 100 | 1000, standardProductId: row.standard_product_id as string }] as const),
          ]);
        }
        if (!standardResult.error) {
          names = new Map([...names, ...(standardResult.data ?? []).map((row) => [row.id as string, row.canonical_name as string] as const)]);
        }
        if (!coupangResult.error) {
          const mergedCoupang = new Map(coupangPrices);
          for (const row of coupangResult.data ?? []) {
            const standardProductId = row.standard_product_id as string;
            const existing = mergedCoupang.get(standardProductId);
            if (!existing || (row.observed_at as string) > existing.observedAt) mergedCoupang.set(standardProductId, {
              listedPriceKrw: row.listed_price_krw as number,
              quantity: row.quantity as number,
              maxBundleQuantity: row.max_bundle_quantity as number | null,
              maxBundleListedPriceKrw: row.max_bundle_listed_price_krw as number | null,
              contentAmount: row.content_amount as number | null,
              contentUnit: row.content_unit as ProductSpecification["contentUnit"] | null,
              productUrl: row.product_url as string,
              observedAt: row.observed_at as string,
            });
          }
          coupangPrices = mergedCoupang;
          coupangReady = true;
        }
        signedInCatalogReady = !mappingResult.error && !catalogResult.error && !standardResult.error;
      }

      if (!active) return;
      setStandardMappings(sharedMappings);
      setExactStandardMappings(exactMappings);
      setCatalogSpecs(specs);
      setStandardNames(names);
      setStandardImages(images);
      setCoupangByStandard(coupangPrices);
      setCatalogNotice(
        !publicCatalogReady && !signedInCatalogReady
          ? "표준 상품 정보를 불러오지 못해 현재는 개별 상품으로 표시합니다."
          : !coupangReady
            ? "표준 상품은 표시하지만 쿠팡 가격 정보를 불러오지 못했습니다."
            : "",
      );
    };

    void loadStandardCatalog();
    return () => { active = false; };
  }, [authRevision, client]);

  const { productGroups, standardGroups } = useMemo(() => {
    const standardBuckets = new Map<string, StandardProductItem[]>();
    const historyBuckets = new Map<string, PriceHistoryPoint[]>();
    const regular: ProductGroup[] = [];
    for (const group of groups) {
      const key = officialProductCandidateKey(group);
      const withOfficial = officialProducts[key] ? { ...group, officialProduct: officialProducts[key] } : group;
      const catalogProductId = exactStandardMappings.get(publicStandardMappingKey(group.storeLabel, group.sourceProductCode))
        ?? (group.catalogNamespace ? standardMappings.get(group.sourceProductCode) : undefined);
      const spec = catalogProductId ? catalogSpecs.get(catalogProductId) : undefined;
      if (!spec) { regular.push(withOfficial); continue; }
      const unitPrice = normalizeMarketPrice({ sellerName: group.storeLabel, listedPriceKrw: group.latestPriceKrw, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: group.latest.observedAt, verificationStatus: "verified" }, spec);
      const item: StandardProductItem = { ...withOfficial, unitPriceLabel: unitPrice.referenceLabel, unitPriceKrw: unitPrice.pricePerReferenceUnitKrw, packageLabel: formatPackageLabel(spec), referenceUnit: spec.referenceUnit ?? 100 };
      standardBuckets.set(spec.standardProductId, [...(standardBuckets.get(spec.standardProductId) ?? []), item]);
      const historyPoints = group.observations.map((observation): PriceHistoryPoint => {
        const normalized = normalizeMarketPrice({ sellerName: group.storeLabel, listedPriceKrw: observation.item.unitPriceKrw, shippingFeeKrw: 0, minimumOrderQuantity: 1, observedAt: observation.observedAt, verificationStatus: "verified" }, spec);
        return { date: observation.observedAt, unitPriceKrw: normalized.pricePerReferenceUnitKrw, unitPriceLabel: normalized.referenceLabel, actualPriceKrw: observation.item.unitPriceKrw, storeLabel: group.storeLabel };
      });
      historyBuckets.set(spec.standardProductId, [...(historyBuckets.get(spec.standardProductId) ?? []), ...historyPoints]);
    }
    const standards: StandardProductGroup[] = [...standardBuckets.entries()].map(([standardProductId, items]) => {
      const ordered = [...items].sort((a, b) => a.unitPriceKrw - b.unitPriceKrw);
      const lowest = ordered[0];
      const name = standardNames.get(standardProductId) ?? lowest.productName;
      const coupangEntry = coupangByStandard.get(standardProductId);
      const coupangPrice = coupangEntry ? buildCoupangPrice(coupangEntry, lowest.referenceUnit) : null;
      const coupangComparison = compareCoupangPrice(lowest, coupangPrice?.requiredOffer ?? null);
      const comparableItems = ordered.filter((item) => item.unitPriceLabel === lowest.unitPriceLabel);
      const bestByDate = new Map<string, PriceHistoryPoint>();
      for (const point of historyBuckets.get(standardProductId) ?? []) {
        const existing = bestByDate.get(point.date);
        if (!existing || point.unitPriceKrw < existing.unitPriceKrw) bestByDate.set(point.date, point);
      }
      const priceHistory = [...bestByDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
      return {
        id: `standard:${standardProductId}`,
        name,
        imageUrl: standardImages.get(standardProductId),
        category: categoryForProduct(name),
        items: ordered,
        lowestUnitPriceKrw: lowest.unitPriceKrw,
        highestUnitPriceKrw: Math.max(...comparableItems.map((item) => item.unitPriceKrw)),
        unitPriceLabel: lowest.unitPriceLabel,
        lowestPriceKrw: lowest.latestPriceKrw,
        sellerCount: distinctSellerCount(items.flatMap((item) => item.observations)),
        latestObservedAt: items.reduce((latest, item) => (item.latest.observedAt > latest ? item.latest.observedAt : latest), items[0].latest.observedAt),
        observationCount: items.reduce((sum, item) => sum + item.observations.length, 0),
        coupangPrice,
        coupangComparison,
        priceHistory,
        officialListings: linkedByStandardProduct.get(standardProductId) ?? [],
      };
    });
    return { productGroups: regular, standardGroups: standards };
  }, [groups, officialProducts, standardMappings, exactStandardMappings, catalogSpecs, standardNames, standardImages, coupangByStandard, linkedByStandardProduct]);

  const stores = useMemo(() => [...new Set([
    ...productGroups.filter((group) => martType === "all" || group.martType === martType).map((group) => group.storeLabel),
    ...standardGroups.flatMap((standard) => standard.items).filter((item) => martType === "all" || item.martType === martType).map((item) => item.storeLabel),
  ])].sort(), [martType, productGroups, standardGroups]);

  const visibleGroups = useMemo(() => mergeOfficialProductGroups(filterAndSortProductGroups(productGroups, { query, category, martType, storeLabel: selectedStore, sort })), [category, martType, query, selectedStore, sort, productGroups]);
  const officialListingsEligible = martType !== "regular" && selectedStore === "all";

  const linkedStandardSummaries = useMemo<OfficialLinkedStandardSummary[]>(() =>
    [...linkedByStandardProduct.entries()].map(([standardProductId, listings]) => {
      const name = standardNames.get(standardProductId) ?? listings[0].sourceNameRaw;
      const inferredCategory = categoryForProduct(name);
      return {
        id: `official-standard:${standardProductId}`,
        standardProductId,
        name,
        imageUrl: standardImages.get(standardProductId) ?? listings.find((listing) => listing.image)?.image?.url,
        category: inferredCategory === "미분류" ? listings[0].category : inferredCategory,
        listings,
      };
    }), [linkedByStandardProduct, standardImages, standardNames]);

  const visibleLinkedStandardSummaries = useMemo(() => {
    if (!officialListingsEligible) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return linkedStandardSummaries
      .filter((standard) => category === "전체" || standard.category === category)
      .filter((standard) => !normalizedQuery || [
        standard.name,
        ...standard.listings.map(officialListingSearchText),
      ].join(" ").toLocaleLowerCase("ko-KR").includes(normalizedQuery));
  }, [category, linkedStandardSummaries, officialListingsEligible, query]);

  const visibleStandardGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return standardGroups
      .map((standard) => {
        const officialListings = officialListingsEligible ? standard.officialListings : [];
        const items = standard.items.filter((item) => (martType === "all" || item.martType === martType) && (selectedStore === "all" || item.storeLabel === selectedStore));
        if (items.length === 0) return { ...standard, items, officialListings };
        const lowest = [...items].sort((left, right) => left.unitPriceKrw - right.unitPriceKrw || right.latest.observedAt.localeCompare(left.latest.observedAt))[0];
        const coupangEntry = coupangByStandard.get(standard.id.replace("standard:", ""));
        const coupangPrice = coupangEntry ? buildCoupangPrice(coupangEntry, lowest.referenceUnit) : standard.coupangPrice;
        const coupangComparison = compareCoupangPrice(lowest, coupangPrice?.requiredOffer ?? null);
        const comparableItems = items.filter((item) => item.unitPriceLabel === lowest.unitPriceLabel);
        return {
          ...standard,
          items,
          lowestUnitPriceKrw: lowest.unitPriceKrw,
          highestUnitPriceKrw: Math.max(...comparableItems.map((item) => item.unitPriceKrw)),
          unitPriceLabel: lowest.unitPriceLabel,
          lowestPriceKrw: lowest.latestPriceKrw,
          sellerCount: distinctSellerCount(items.flatMap((item) => item.observations)),
          latestObservedAt: items.reduce((latest, item) => item.latest.observedAt > latest ? item.latest.observedAt : latest, items[0].latest.observedAt),
          observationCount: items.reduce((sum, item) => sum + item.observations.length, 0),
          coupangPrice,
          coupangComparison,
          officialListings,
        };
      })
      .filter((standard) => standard.items.length > 0)
      .filter((standard) => category === "전체" || standard.category === category)
      .filter((standard) => !normalizedQuery || [
        standard.name,
        ...standard.items.map((item) => `${item.productName} ${item.sourceProductCode} ${item.storeLabel}`),
        ...standard.officialListings.map(officialListingSearchText),
      ].join(" ").toLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        if (sort === "expensive") return b.lowestUnitPriceKrw - a.lowestUnitPriceKrw || a.name.localeCompare(b.name);
        if (sort === "sellers") return b.sellerCount - a.sellerCount || a.name.localeCompare(b.name);
        return a.lowestUnitPriceKrw - b.lowestUnitPriceKrw || a.name.localeCompare(b.name);
      });
  }, [standardGroups, coupangByStandard, query, category, martType, officialListingsEligible, selectedStore, sort]);

  const gridEntries = useMemo(() => {
    type Entry =
      | { kind: "standard"; standard: StandardProductGroup }
      | { kind: "official-standard"; standard: OfficialLinkedStandardSummary }
      | { kind: "product"; group: ProductGroup };
    const standardEntries: Entry[] = visibleStandardGroups.map((standard) => ({ kind: "standard" as const, standard }));
    const representedStandardIds = new Set(
      visibleStandardGroups.map((standard) => standard.id.replace("standard:", "")),
    );
    const linkedStandardEntries: Entry[] = visibleLinkedStandardSummaries
      .filter((standard) => catalogView === "official" || !representedStandardIds.has(standard.standardProductId))
      .map((standard) => ({ kind: "official-standard" as const, standard }));
    const entries: Entry[] = catalogView === "official"
      ? linkedStandardEntries
      : catalogView === "standard"
        ? [...standardEntries, ...linkedStandardEntries]
        : [
          ...standardEntries,
          ...linkedStandardEntries,
          ...visibleGroups.map((group) => ({ kind: "product" as const, group })),
        ];
    const priceOf = (entry: Entry) => {
      if (entry.kind === "standard") return entry.standard.lowestUnitPriceKrw;
      if (entry.kind === "official-standard") {
        return Math.min(...entry.standard.listings.map((listing) => listing.officialPrice.amountKrw));
      }
      const latestOffers = summarizeSellerPrices(sellerPricePointsFromGroup(entry.group));
      return sort === "expensive"
        ? Math.max(...latestOffers.map((offer) => offer.latestPriceKrw))
        : latestOffers[0]?.latestPriceKrw ?? entry.group.latestPriceKrw;
    };
    const sellersOf = (entry: Entry) => entry.kind === "standard"
      ? entry.standard.sellerCount
      : entry.kind === "official-standard"
        ? 1
        : distinctSellerCount(entry.group.observations);
    const nameOf = (entry: Entry) => entry.kind === "product" ? entry.group.productName : entry.standard.name;
    return entries.sort((a, b) => {
      if (sort === "sellers") return sellersOf(b) - sellersOf(a) || nameOf(a).localeCompare(nameOf(b));
      if (sort === "expensive") return priceOf(b) - priceOf(a) || nameOf(a).localeCompare(nameOf(b));
      return priceOf(a) - priceOf(b) || nameOf(a).localeCompare(nameOf(b));
    });
  }, [visibleStandardGroups, visibleGroups, visibleLinkedStandardSummaries, catalogView, sort]);

  const standaloneOfficialListingCount = useMemo(
    () => officialListingsEligible
      ? filterAndSortOfficialChannelListings(standaloneListings, query, "price-asc", category).length
      : 0,
    [category, officialListingsEligible, query, standaloneListings],
  );
  const openStandard = visibleStandardGroups.find((standard) => standard.id === openStandardId)
    ?? standardGroups.find((standard) => standard.id === openStandardId)
    ?? null;
  const showStandardOnly = catalogView === "standard";
  const showOfficialOnly = catalogView === "official";
  const showStandaloneOfficialListings = catalogView !== "standard"
    && officialListingsEligible
    && standaloneOfficialListingCount > 0;
  const officialProductDisplayCount = standaloneListings.length + linkedByStandardProduct.size;
  const resultCount = gridEntries.length
    + (showStandaloneOfficialListings ? standaloneOfficialListingCount : 0);

  return <section className={styles.browser}>
    <div className={styles.browserHead}>
      <div>
        <p className={styles.kicker}>PRODUCT CATALOG</p>
        <h1>상품 목록</h1>
        <p>표준 상품, 유통채널 공식 판매상품, 영수증 가격 관측을 출처별로 구분합니다.</p>
      </div>
      <label className={styles.search}>
        <span aria-hidden="true">⌕</span>
        <span className={styles.srOnly}>상품 검색</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={showOfficialOnly ? "상품명, 업체명, 규격, 상품 코드 검색" : "상품명, 판매처 코드, 판매 마트 검색"}
        />
      </label>
    </div>

    <div className={styles.catalogLayerTabs} role="group" aria-label="상품 데이터 계층">
      <button type="button" aria-pressed={catalogView === "all"} className={catalogView === "all" ? styles.catalogLayerTabActive : ""} onClick={() => setCatalogView("all")}>전체 상품</button>
      <button type="button" aria-pressed={catalogView === "standard"} className={catalogView === "standard" ? styles.catalogLayerTabActive : ""} onClick={() => setCatalogView("standard")}>표준 상품만</button>
      <button type="button" aria-pressed={catalogView === "official"} className={catalogView === "official" ? styles.catalogLayerTabActive : ""} onClick={() => setCatalogView("official")}>공식 상품만 <span>{officialProductDisplayCount.toLocaleString("ko-KR")}</span></button>
    </div>

    {catalogNotice && !showOfficialOnly && <p className={styles.dataNotice} role="status">{catalogNotice}</p>}
    <div className={styles.marketControls}>
      <div className={styles.segmented} aria-label="판매처 유형">{([ ["all", "전체"], ["regular", "일반 마트"], ["px", "PX (군마트)"] ] as const).map(([value, label]) => <button key={value} aria-pressed={martType === value} className={martType === value ? styles.selectedSegment : ""} onClick={() => { setMartType(value); setSelectedStore("all"); }}>{label}</button>)}</div>
      <label className={styles.storeSelect}>판매 마트<select value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)}><option value="all">전체 마트</option>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label>
      {!showOfficialOnly &&
          <label className={styles.sortSelect}>정렬<select value={sort} onChange={(event) => setSort(event.target.value as ProductSort)}><option value="expensive">비싼 물품 순</option><option value="cheap">저렴한 물품 순</option><option value="sellers">판매처 많은 물품 순</option></select></label>
      }
    </div>
    <div className={styles.filters} aria-label="상품 카테고리">{PRODUCT_CATEGORIES.map((item) => <button aria-pressed={category === item} className={category === item ? styles.filterActive : ""} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className={styles.resultBar}><p>상품 {resultCount.toLocaleString("ko-KR")}개</p>{(query || category !== "전체" || martType !== "all" || selectedStore !== "all" || showStandardOnly || showOfficialOnly) && <button onClick={() => { setQuery(""); setCategory("전체"); setMartType("all"); setSelectedStore("all"); setCatalogView("all"); }}>필터 초기화</button>}</div>

    <div className={styles.productGrid} aria-live="polite">{gridEntries.map((entry) => entry.kind === "official-standard"
      ? <OfficialLinkedStandardCard
          key={entry.standard.id}
          standard={entry.standard}
          onOpen={standardGroups.some((standard) => standard.id === `standard:${entry.standard.standardProductId}`)
            ? () => setOpenStandardId(`standard:${entry.standard.standardProductId}`)
            : undefined}
        />
      : entry.kind === "standard"
        ? <article className={styles.productCard} key={entry.standard.id}>
            <div className={styles.productVisual} data-testid="product-image-slot">
              <ProductImage item={entry.standard.items[0].latest.item} category={entry.standard.category} imageUrl={entry.standard.imageUrl} />
              <span className={styles.standardProductBadge}>표준 상품</span>
            </div>
            <div className={styles.productInfo}>
              <h2>{entry.standard.name}</h2>
              <StoreInfo sellerCount={entry.standard.sellerCount} onOpen={() => setStoreListTarget({ title: `${entry.standard.name} 판매처`, rows: latestSellerRows(entry.standard.items.flatMap((item) => item.observations)) })} />
              <div className={styles.standardPriceBlock}><strong>{formatKrw(entry.standard.lowestPriceKrw)} ~</strong><small>{entry.standard.unitPriceLabel} {formatKrw(entry.standard.lowestUnitPriceKrw)} ~ {formatKrw(entry.standard.highestUnitPriceKrw)}</small>{entry.standard.coupangComparison && <CoupangComparisonMessage compact unitPriceLabel={entry.standard.unitPriceLabel} comparison={entry.standard.coupangComparison} />}</div>
              {entry.standard.officialListings.length > 0 && <div className={styles.standardOfficialSource}>
                <small>PX 공식 판매상품 {entry.standard.officialListings.length.toLocaleString("ko-KR")}개 연결</small>
                <strong>공식 표시가 {formatKrw(Math.min(...entry.standard.officialListings.map((listing) => listing.officialPrice.amountKrw)))} ~</strong>
              </div>}
              <button aria-label={`${entry.standard.name} 하위 상품 보기`} onClick={() => setOpenStandardId(entry.standard.id)}>판매처 가격 기준 비교 보기 ›</button>
            </div>
          </article>
        : <article className={styles.productCard} key={entry.group.id}><div className={styles.productVisual} data-testid="product-image-slot"><ProductImage item={entry.group.latest.item} category={entry.group.category} imageUrl={entry.group.officialProduct?.imageUrl} /></div><div className={styles.productInfo}><h2>{entry.group.officialProduct?.officialName ?? entry.group.productName}</h2><StoreInfo sellerCount={distinctSellerCount(entry.group.observations)} onOpen={() => setStoreListTarget({ title: `${entry.group.productName} 판매처`, rows: latestSellerRows(entry.group.observations) })} /><RecordedPriceBlock group={entry.group} /><div className={styles.productActions}><button className={styles.trendButton} aria-label={`${entry.group.productName} 가격 이력 보기`} onClick={() => onTrend(entry.group)}>가격 이력</button><button aria-label={`${entry.group.productName} 장바구니에 담기`} onClick={() => onAdd(entry.group)}>+ 담기</button></div></div></article>)}</div>
    {gridEntries.length === 0 && !showStandaloneOfficialListings && !(showOfficialOnly && !officialListingsEligible) && <div className={styles.noResult}><strong>조건에 맞는 상품이 없습니다.</strong></div>}

    {showStandaloneOfficialListings && <PxOfficialProductBrowser catalog={publicPxCatalog} listings={standaloneListings} query={query} category={category} />}
    {showOfficialOnly && !officialListingsEligible && <div className={styles.noResult}><strong>{selectedStore !== "all" ? "공식 상품은 특정 지점의 판매·재고로 확인할 수 없습니다." : "일반 마트 조건에 해당하는 공식 상품 컬렉션이 없습니다."}</strong><p>판매처 유형을 전체 또는 PX로 선택하고, 판매 마트는 전체 마트로 두세요.</p></div>}

    {openStandard && !showOfficialOnly && <StandardProductDetailModal standard={openStandard} onClose={() => setOpenStandardId(null)} onOpenStore={onOpenStore} />}
    {storeListTarget && !showOfficialOnly && <StoreListModal title={storeListTarget.title} rows={storeListTarget.rows} onClose={() => setStoreListTarget(null)} onOpenStore={onOpenStore} />}
  </section>;
}
