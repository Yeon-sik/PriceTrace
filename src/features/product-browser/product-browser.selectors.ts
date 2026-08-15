import { resolveCoupangPrice, type ResolvedCoupangPrice } from "../../domain/coupang-price";
import { normalizeMarketPrice, type ProductSpecification, type ReferenceUnit } from "../../domain/canonical-price";
import {
  officialProductCandidateKey,
  resolveMartTaggedStandardProductMapping,
  type OfficialProductRecord,
  type StandardProductMapping,
} from "../../domain/official-product";
import {
  categoryForProduct,
  compareCoupangPrice,
  distinctSellerCount,
  filterAndSortProductGroups,
  martTagFor,
  mergeOfficialProductGroups,
  type CoupangPriceComparison,
  type MartType,
  type ProductCategory,
  type ProductGroup,
  type ProductSort,
} from "../../domain/product-browser";
import {
  officialChannelRepresentativeImageUrl,
  type PublicOfficialChannelListing,
} from "../../domain/public-official-channel-catalog";
import { publicStandardMappingKey, type PublicCoupangPrice } from "../../domain/public-standard-catalog";
import { sellerPricePointsFromGroup, summarizeSellerPrices } from "../../domain/seller-price-insights";

export type CatalogView = "all" | "standard" | "official";

export type CatalogSpecification = ProductSpecification & {
  standardProductId: string;
};

export type StandardProductItem = ProductGroup & {
  catalogProductId: string;
  unitPriceLabel: string;
  unitPriceKrw: number;
  packageLabel: string;
  referenceUnit: ReferenceUnit;
};

export type CoupangPrice = ResolvedCoupangPrice;

export type PriceHistoryPoint = {
  date: string;
  unitPriceKrw: number;
  unitPriceLabel: string;
  actualPriceKrw: number;
  storeLabel: string;
};

export type StandardProductGroup = {
  id: string;
  name: string;
  brand: string | null;
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

export type OfficialLinkedStandardSummary = {
  id: string;
  standardProductId: string;
  name: string;
  brand: string | null;
  imageUrl?: string;
  category: ProductCategory;
  listings: PublicOfficialChannelListing[];
};

export type ProductBrowserEntry =
  | { kind: "standard"; standard: StandardProductGroup }
  | { kind: "official-standard"; standard: OfficialLinkedStandardSummary }
  | { kind: "product"; group: ProductGroup };

export function formatPackageLabel(specification: ProductSpecification) {
  const unitLabel = specification.contentUnit === "each" ? "개" : specification.contentUnit;
  const base = `${specification.contentAmount}${unitLabel}`;
  return specification.packageCount > 1 ? `${base} x ${specification.packageCount}` : base;
}

function buildCoupangPrice(entry: PublicCoupangPrice, referenceUnit: ReferenceUnit): CoupangPrice {
  return resolveCoupangPrice(entry, referenceUnit);
}

export function officialListingSearchText(listing: PublicOfficialChannelListing) {
  return [
    listing.sourceNameRaw,
    listing.vendorNameRaw,
    listing.specificationTextRaw,
    listing.sourceProductCode,
  ].filter(Boolean).join(" ");
}

export function selectProductCatalogGroups({
  groups,
  officialProducts,
  standardMappings,
  exactStandardMappings,
  catalogSpecs,
  standardNames,
  standardImages,
  standardBrands,
  coupangByStandard,
  linkedByStandardProduct,
}: {
  groups: ProductGroup[];
  officialProducts: Readonly<Record<string, OfficialProductRecord>>;
  standardMappings: ReadonlyMap<string, string>;
  exactStandardMappings: ReadonlyMap<string, string>;
  catalogSpecs: ReadonlyMap<string, CatalogSpecification>;
  standardNames: ReadonlyMap<string, string>;
  standardImages: ReadonlyMap<string, string>;
  standardBrands: ReadonlyMap<string, string>;
  coupangByStandard: ReadonlyMap<string, PublicCoupangPrice>;
  linkedByStandardProduct: ReadonlyMap<string, PublicOfficialChannelListing[]>;
}) {
  const standardBuckets = new Map<string, StandardProductItem[]>();
  const historyBuckets = new Map<string, PriceHistoryPoint[]>();
  const regular: ProductGroup[] = [];
  const identityAwareMappings: StandardProductMapping<string>[] = groups.flatMap((group) => {
    const catalogProductId = exactStandardMappings.get(
      publicStandardMappingKey(group.storeLabel, group.sourceProductCode),
    );
    return catalogProductId
      ? [{
          sourceLabel: group.storeLabel,
          sourceProductCode: group.sourceProductCode,
          martTag: martTagFor(group),
          productName: group.productName,
          product: catalogProductId,
        }]
      : [];
  });

  for (const group of groups) {
    const key = officialProductCandidateKey(group);
    const withOfficial = officialProducts[key]
      ? { ...group, officialProduct: officialProducts[key] }
      : group;
    const catalogProductId = resolveMartTaggedStandardProductMapping({
      sourceProductCode: group.sourceProductCode,
      productName: group.productName,
      storeLabel: group.storeLabel,
      martTag: martTagFor(group),
      catalogNamespace: group.catalogNamespace,
    }, identityAwareMappings)
      ?? (group.catalogNamespace ? standardMappings.get(group.sourceProductCode) : undefined);
    const spec = catalogProductId ? catalogSpecs.get(catalogProductId) : undefined;
    if (!catalogProductId || !spec) {
      regular.push(withOfficial);
      continue;
    }

    const unitPrice = normalizeMarketPrice({
      sellerName: group.storeLabel,
      listedPriceKrw: group.latestPriceKrw,
      shippingFeeKrw: 0,
      minimumOrderQuantity: 1,
      observedAt: group.latest.observedAt,
      verificationStatus: "verified",
    }, spec);
    const item: StandardProductItem = {
      ...withOfficial,
      catalogProductId,
      unitPriceLabel: unitPrice.referenceLabel,
      unitPriceKrw: unitPrice.pricePerReferenceUnitKrw,
      packageLabel: formatPackageLabel(spec),
      referenceUnit: spec.referenceUnit ?? 100,
    };
    standardBuckets.set(spec.standardProductId, [
      ...(standardBuckets.get(spec.standardProductId) ?? []),
      item,
    ]);

    const historyPoints = group.observations.map((observation): PriceHistoryPoint => {
      const normalized = normalizeMarketPrice({
        sellerName: group.storeLabel,
        listedPriceKrw: observation.item.unitPriceKrw,
        shippingFeeKrw: 0,
        minimumOrderQuantity: 1,
        observedAt: observation.observedAt,
        verificationStatus: "verified",
      }, spec);
      return {
        date: observation.observedAt,
        unitPriceKrw: normalized.pricePerReferenceUnitKrw,
        unitPriceLabel: normalized.referenceLabel,
        actualPriceKrw: observation.item.unitPriceKrw,
        storeLabel: group.storeLabel,
      };
    });
    historyBuckets.set(spec.standardProductId, [
      ...(historyBuckets.get(spec.standardProductId) ?? []),
      ...historyPoints,
    ]);
  }

  const standards: StandardProductGroup[] = [...standardBuckets.entries()].map(([
    standardProductId,
    items,
  ]) => {
    const ordered = [...items].sort((left, right) => left.unitPriceKrw - right.unitPriceKrw);
    const lowest = ordered[0];
    const name = standardNames.get(standardProductId) ?? lowest.productName;
    const brand = standardBrands.get(standardProductId) ?? null;
    const coupangEntry = coupangByStandard.get(standardProductId);
    const coupangPrice = coupangEntry
      ? buildCoupangPrice(coupangEntry, lowest.referenceUnit)
      : null;
    const coupangComparison = compareCoupangPrice(lowest, coupangPrice?.requiredOffer ?? null);
    const comparableItems = ordered.filter((item) => item.unitPriceLabel === lowest.unitPriceLabel);
    const bestByDate = new Map<string, PriceHistoryPoint>();
    for (const point of historyBuckets.get(standardProductId) ?? []) {
      const existing = bestByDate.get(point.date);
      if (!existing || point.unitPriceKrw < existing.unitPriceKrw) {
        bestByDate.set(point.date, point);
      }
    }
    const priceHistory = [...bestByDate.values()]
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, 7);
    const officialListings = linkedByStandardProduct.get(standardProductId) ?? [];

    return {
      id: `standard:${standardProductId}`,
      name,
      brand,
      imageUrl: officialChannelRepresentativeImageUrl(officialListings)
        ?? standardImages.get(standardProductId),
      category: categoryForProduct(name),
      items: ordered,
      lowestUnitPriceKrw: lowest.unitPriceKrw,
      highestUnitPriceKrw: Math.max(...comparableItems.map((item) => item.unitPriceKrw)),
      unitPriceLabel: lowest.unitPriceLabel,
      lowestPriceKrw: lowest.latestPriceKrw,
      sellerCount: distinctSellerCount(items.flatMap((item) => item.observations)),
      latestObservedAt: items.reduce(
        (latest, item) => item.latest.observedAt > latest ? item.latest.observedAt : latest,
        items[0].latest.observedAt,
      ),
      observationCount: items.reduce((sum, item) => sum + item.observations.length, 0),
      coupangPrice,
      coupangComparison,
      priceHistory,
      officialListings,
    };
  });

  return { productGroups: regular, standardGroups: standards };
}

export function selectStoreOptions({
  productGroups,
  standardGroups,
  martType,
}: {
  productGroups: ProductGroup[];
  standardGroups: StandardProductGroup[];
  martType: MartType;
}) {
  return [...new Set([
    ...productGroups
      .filter((group) => martType === "all" || group.martType === martType)
      .map((group) => group.storeLabel),
    ...standardGroups
      .flatMap((standard) => standard.items)
      .filter((item) => martType === "all" || item.martType === martType)
      .map((item) => item.storeLabel),
  ])].sort();
}

export function selectVisibleProductGroups(productGroups: ProductGroup[], options: {
  query: string;
  category: ProductCategory;
  martType: MartType;
  selectedStore: string;
  sort: ProductSort;
}) {
  return mergeOfficialProductGroups(filterAndSortProductGroups(productGroups, {
    query: options.query,
    category: options.category,
    martType: options.martType,
    storeLabel: options.selectedStore,
    sort: options.sort,
  }));
}

export function officialListingsAreEligible(martType: MartType, selectedStore: string) {
  return martType !== "regular" && selectedStore === "all";
}

export function selectLinkedStandardSummaries({
  linkedByStandardProduct,
  standardNames,
  standardImages,
  standardBrands,
}: {
  linkedByStandardProduct: ReadonlyMap<string, PublicOfficialChannelListing[]>;
  standardNames: ReadonlyMap<string, string>;
  standardImages: ReadonlyMap<string, string>;
  standardBrands: ReadonlyMap<string, string>;
}): OfficialLinkedStandardSummary[] {
  return [...linkedByStandardProduct.entries()].map(([standardProductId, listings]) => {
    const name = standardNames.get(standardProductId) ?? listings[0].sourceNameRaw;
    const brand = standardBrands.get(standardProductId) ?? null;
    const inferredCategory = categoryForProduct(name);
    return {
      id: `official-standard:${standardProductId}`,
      standardProductId,
      name,
      brand,
      imageUrl: officialChannelRepresentativeImageUrl(listings)
        ?? standardImages.get(standardProductId),
      category: inferredCategory === "미분류" ? listings[0].category : inferredCategory,
      listings,
    };
  });
}

export function selectVisibleLinkedStandardSummaries({
  summaries,
  eligible,
  query,
  category,
}: {
  summaries: OfficialLinkedStandardSummary[];
  eligible: boolean;
  query: string;
  category: ProductCategory;
}) {
  if (!eligible) return [];
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
  return summaries
    .filter((standard) => category === "전체" || standard.category === category)
    .filter((standard) => !normalizedQuery || [
      standard.name,
      ...standard.listings.map(officialListingSearchText),
    ].join(" ").toLocaleLowerCase("ko-KR").includes(normalizedQuery));
}

export function selectVisibleStandardGroups({
  standardGroups,
  coupangByStandard,
  query,
  category,
  martType,
  officialListingsEligible,
  selectedStore,
  sort,
}: {
  standardGroups: StandardProductGroup[];
  coupangByStandard: ReadonlyMap<string, PublicCoupangPrice>;
  query: string;
  category: ProductCategory;
  martType: MartType;
  officialListingsEligible: boolean;
  selectedStore: string;
  sort: ProductSort;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  return standardGroups
    .map((standard) => {
      const officialListings = officialListingsEligible ? standard.officialListings : [];
      const items = standard.items.filter(
        (item) => (martType === "all" || item.martType === martType)
          && (selectedStore === "all" || item.storeLabel === selectedStore),
      );
      if (items.length === 0) return { ...standard, items, officialListings };
      const lowest = [...items].sort(
        (left, right) => left.unitPriceKrw - right.unitPriceKrw
          || right.latest.observedAt.localeCompare(left.latest.observedAt),
      )[0];
      const standardProductId = standard.id.replace("standard:", "");
      const coupangEntry = coupangByStandard.get(standardProductId);
      const coupangPrice = coupangEntry
        ? buildCoupangPrice(coupangEntry, lowest.referenceUnit)
        : standard.coupangPrice;
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
        latestObservedAt: items.reduce(
          (latest, item) => item.latest.observedAt > latest ? item.latest.observedAt : latest,
          items[0].latest.observedAt,
        ),
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
      ...standard.items.map(
        (item) => `${item.productName} ${item.sourceProductCode} ${item.storeLabel}`,
      ),
      ...standard.officialListings.map(officialListingSearchText),
    ].join(" ").toLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      if (sort === "expensive") {
        return right.lowestUnitPriceKrw - left.lowestUnitPriceKrw
          || left.name.localeCompare(right.name);
      }
      if (sort === "sellers") {
        return right.sellerCount - left.sellerCount
          || left.name.localeCompare(right.name);
      }
      return left.lowestUnitPriceKrw - right.lowestUnitPriceKrw
        || left.name.localeCompare(right.name);
    });
}

function priceOf(entry: ProductBrowserEntry, sort: ProductSort) {
  if (entry.kind === "standard") return entry.standard.lowestUnitPriceKrw;
  if (entry.kind === "official-standard") {
    return Math.min(...entry.standard.listings.map((listing) => listing.officialPrice.amountKrw));
  }
  const latestOffers = summarizeSellerPrices(sellerPricePointsFromGroup(entry.group));
  return sort === "expensive"
    ? Math.max(...latestOffers.map((offer) => offer.latestPriceKrw))
    : latestOffers[0]?.latestPriceKrw ?? entry.group.latestPriceKrw;
}

function sellersOf(entry: ProductBrowserEntry) {
  if (entry.kind === "standard") return entry.standard.sellerCount;
  if (entry.kind === "official-standard") return 1;
  return distinctSellerCount(entry.group.observations);
}

function nameOf(entry: ProductBrowserEntry) {
  return entry.kind === "product" ? entry.group.productName : entry.standard.name;
}

export function selectGridEntries({
  visibleStandardGroups,
  visibleProductGroups,
  visibleLinkedStandardSummaries,
  catalogView,
  sort,
}: {
  visibleStandardGroups: StandardProductGroup[];
  visibleProductGroups: ProductGroup[];
  visibleLinkedStandardSummaries: OfficialLinkedStandardSummary[];
  catalogView: CatalogView;
  sort: ProductSort;
}): ProductBrowserEntry[] {
  const standardEntries: ProductBrowserEntry[] = visibleStandardGroups.map(
    (standard) => ({ kind: "standard", standard }),
  );
  const representedStandardIds = new Set(
    visibleStandardGroups.map((standard) => standard.id.replace("standard:", "")),
  );
  const linkedStandardEntries: ProductBrowserEntry[] = visibleLinkedStandardSummaries
    .filter(
      (standard) => catalogView === "official"
        || !representedStandardIds.has(standard.standardProductId),
    )
    .map((standard) => ({ kind: "official-standard", standard }));
  const entries: ProductBrowserEntry[] = catalogView === "official"
    ? linkedStandardEntries
    : catalogView === "standard"
      ? [...standardEntries, ...linkedStandardEntries]
      : [
          ...standardEntries,
          ...linkedStandardEntries,
          ...visibleProductGroups.map((group): ProductBrowserEntry => ({ kind: "product", group })),
        ];

  return entries.sort((left, right) => {
    if (sort === "sellers") {
      return sellersOf(right) - sellersOf(left) || nameOf(left).localeCompare(nameOf(right));
    }
    if (sort === "expensive") {
      return priceOf(right, sort) - priceOf(left, sort) || nameOf(left).localeCompare(nameOf(right));
    }
    return priceOf(left, sort) - priceOf(right, sort) || nameOf(left).localeCompare(nameOf(right));
  });
}
