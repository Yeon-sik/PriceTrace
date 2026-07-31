import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  buildExistingProductCategoryIndex,
  classifyOfficialProduct,
  OFFICIAL_PRODUCT_CATEGORIES,
  type ExistingCategoryProduct,
  type OfficialProductCategory,
} from "../src/domain/official-product-category";
import {
  officialChannelSourceIdentity,
  PublicOfficialChannelCatalogSchema,
  PublicOfficialChannelStandardLinkRegistrySchema,
  type PublicOfficialChannelCatalog,
  type PublicOfficialChannelStandardLinkRegistry,
} from "../src/domain/public-official-channel-catalog";

const PX_CHANNEL = {
  id: "korean-military-px",
  name: "국군복지단 PX",
  kind: "retailer",
  operator_name: "국군복지단",
} as const;
const PX_COLLECTION_KEY = "welfare.mil.kr|mart-sale-products|all-products";
const sourceDirectory = path.join(process.cwd(), "private-data", "official-channel", "px");
const publicDirectory = path.join(process.cwd(), "data", "public", "official-channel-catalog");
const publicCatalogPath = path.join(publicDirectory, "px.v1.json");
const publicLinkRegistryPath = path.join(
  process.cwd(),
  "data",
  "public",
  "official-channel-standard-links",
  "px.v1.json",
);
const publicObservationPath = path.join(process.cwd(), "data", "public", "product-observations.v3.json");
const checkOnly = process.argv.includes("--check");
const normalizeSource = process.argv.includes("--normalize-source");

const sourceRefSchema = z.string().min(1);
const sourceBundleSchema = z.object({
  schema_version: z.literal("official-channel-catalog.v1"),
  snapshot: z.object({
    id: z.string().uuid(),
    previous_snapshot_id: z.string().uuid().nullable(),
    captured_at: z.string().datetime({ offset: true }),
    coverage: z.object({
      scope_kind: z.enum(["entire_channel", "collection", "category", "query", "url_set", "unknown"]),
      scope_key: z.string().min(1).nullable(),
      completeness: z.enum(["full", "partial", "unknown"]),
      expected_listing_count: z.number().int().nonnegative().nullable(),
      collected_listing_count: z.number().int().nonnegative(),
      pages_expected: z.number().int().positive().nullable(),
      pages_collected: z.number().int().positive().nullable(),
      pagination_exhausted: z.boolean(),
      source_refs: z.array(sourceRefSchema),
    }).passthrough(),
    collection_status: z.literal("completed"),
    content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    notes: z.array(z.string()),
  }).passthrough(),
  channel: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.literal("retailer"),
    operator_name: z.string().min(1),
  }).strict(),
  listing_snapshots: z.array(z.object({
    id: z.string().uuid(),
    observed_at: z.string().datetime({ offset: true }),
    source_refs: z.array(sourceRefSchema).min(1),
    source_identity: z.object({
      source_product_code: z.object({
        value: z.string().min(1),
        namespace: z.string().min(1),
      }).passthrough(),
    }).passthrough(),
    source_fields: z.object({
      source_name: z.string().min(1),
      source_specification_text: z.string().min(1).nullable(),
      raw_attributes: z.array(z.object({
        source_label: z.string().min(1),
        source_value: z.unknown(),
      }).passthrough()),
    }).passthrough(),
    publication: z.object({
      status: z.literal("listed"),
      location_scope: z.literal("channel_unspecified"),
    }).passthrough(),
    images: z.array(z.object({
      url: z.string().url(),
      role: z.string(),
      content_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      byte_length: z.number().int().positive(),
      media_type: z.string().regex(/^image\//),
    }).passthrough()),
    offers: z.array(z.object({
      observed_at: z.string().datetime({ offset: true }),
      prices: z.array(z.object({
        amount_minor: z.string().regex(/^\d+$/),
        currency: z.literal("KRW"),
        source_text: z.string().min(1),
      }).passthrough()).min(1),
    }).passthrough()).min(1),
  }).passthrough()).min(1),
}).passthrough();
const existingProductSchema = z.object({
  productName: z.string().min(1),
}).passthrough();
const publicObservationSchema = z.object({
  observations: z.array(existingProductSchema),
}).passthrough();

type SourceBundle = z.infer<typeof sourceBundleSchema>;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
  }
  throw new Error(`RFC 8785 JSON으로 변환할 수 없는 값입니다: ${typeof value}`);
}

function bundleContentHash(bundle: SourceBundle) {
  const subject = structuredClone(bundle);
  delete (subject.snapshot as Partial<SourceBundle["snapshot"]>).content_hash;
  return `sha256:${createHash("sha256").update(canonicalize(subject)).digest("hex")}`;
}

function normalizePxSourceBundle(bundle: SourceBundle) {
  const normalized = structuredClone(bundle);
  normalized.channel = { ...PX_CHANNEL };
  normalized.snapshot.coverage.scope_kind = "collection";
  normalized.snapshot.coverage.scope_key = PX_COLLECTION_KEY;
  const correctionNote = "full은 국군복지단 PX 전체가 아니라 공식 사이트의 마트 판매상품 전체상품 컬렉션 범위에서 완전 수집되었다는 뜻이다.";
  normalized.snapshot.notes = [
    ...normalized.snapshot.notes.filter((note) => note !== correctionNote),
    correctionNote,
  ];
  normalized.snapshot.content_hash = bundleContentHash(normalized);
  return normalized;
}

function assertPxSourceSemantics(bundle: SourceBundle) {
  if (
    bundle.channel.id !== PX_CHANNEL.id
    || bundle.channel.name !== PX_CHANNEL.name
    || bundle.channel.operator_name !== PX_CHANNEL.operator_name
  ) {
    throw new Error("PX source channel 의미가 확정되지 않았습니다. normalize:private-px-catalog를 먼저 실행하세요.");
  }
  if (
    bundle.snapshot.coverage.scope_kind !== "collection"
    || bundle.snapshot.coverage.scope_key !== PX_COLLECTION_KEY
  ) {
    throw new Error("PX source coverage가 마트 판매상품 collection으로 확정되지 않았습니다.");
  }
  if (bundle.snapshot.content_hash !== bundleContentHash(bundle)) {
    throw new Error("PX source snapshot.content_hash가 현재 bundle 내용과 일치하지 않습니다.");
  }
}

function sourceAttribute(listing: SourceBundle["listing_snapshots"][number], label: string) {
  return listing.source_fields.raw_attributes.find((attribute) => attribute.source_label === label)?.source_value;
}

function buildPublicCatalog(
  bundle: SourceBundle,
  existingProducts: ExistingCategoryProduct[],
  linkRegistry: PublicOfficialChannelStandardLinkRegistry,
): PublicOfficialChannelCatalog {
  const coverage = bundle.snapshot.coverage;
  if (linkRegistry.channelId !== PX_CHANNEL.id) {
    throw new Error("PX 공식 상품 연결 파일의 channelId가 source channel과 일치하지 않습니다.");
  }
  const linksBySourceIdentity = new Map(
    linkRegistry.links.map((link) => [officialChannelSourceIdentity(link), link] as const),
  );
  const sourceIdentities = new Set(
    bundle.listing_snapshots.map((listing) => officialChannelSourceIdentity({
      sourceProductCodeNamespace: listing.source_identity.source_product_code.namespace,
      sourceProductCode: listing.source_identity.source_product_code.value,
    })),
  );
  const unknownLinks = [...linksBySourceIdentity.keys()].filter((identity) => !sourceIdentities.has(identity));
  if (unknownLinks.length > 0) {
    throw new Error(`PX 공식 상품 연결 파일에 현재 수집본에 없는 상품이 있습니다: ${unknownLinks.join(", ")}`);
  }
  const existingCategoryIndex = buildExistingProductCategoryIndex(existingProducts);
  const classificationResults = bundle.listing_snapshots.map((listing) => ({
    listing,
    result: classifyOfficialProduct({
      sourceProductCode: listing.source_identity.source_product_code.value,
      sourceNameRaw: listing.source_fields.source_name,
    }, existingCategoryIndex),
  }));
  const unclassified = classificationResults.filter((entry) => !entry.result);
  if (unclassified.length > 0) {
    const sample = unclassified.slice(0, 100).map((entry) =>
      `${entry.listing.source_identity.source_product_code.value}\t${entry.listing.source_fields.source_name}`);
    const omittedCount = unclassified.length - sample.length;
    const omitted = omittedCount > 0 ? `\n... ${omittedCount}개 생략` : "";
    throw new Error(`PX category 미분류 ${unclassified.length}개\n${sample.join("\n")}${omitted}`);
  }
  const categoryCounts = Object.fromEntries(
    OFFICIAL_PRODUCT_CATEGORIES.map((category) => [
      category,
      classificationResults.filter((entry) => entry.result?.category === category).length,
    ]),
  ) as Record<OfficialProductCategory, number>;
  const existingProductMatchCount = classificationResults.filter(
    (entry) => entry.result?.assignment.method === "existing_product_match",
  ).length;
  const catalog = {
    schemaVersion: "public-official-channel-catalog.v1",
    sourceSnapshot: {
      id: bundle.snapshot.id,
      contentHash: bundle.snapshot.content_hash,
      capturedAt: bundle.snapshot.captured_at,
    },
    channel: {
      id: PX_CHANNEL.id,
      name: PX_CHANNEL.name,
      kind: PX_CHANNEL.kind,
      operatorName: PX_CHANNEL.operator_name,
    },
    collection: {
      key: PX_COLLECTION_KEY,
      name: "마트 판매상품",
      completeness: coverage.completeness,
      listingCount: coverage.collected_listing_count,
      pagesCollected: coverage.pages_collected,
      paginationExhausted: coverage.pagination_exhausted,
    },
    classification: {
      version: "px-official-category.v1",
      existingProductMatchCount,
      curatedRuleCount: classificationResults.length - existingProductMatchCount,
      unclassifiedCount: 0,
      categoryCounts,
    },
    notices: [
      "공식 사이트 등재는 특정 PX 지점의 판매, 재고 또는 실제 구매 확인이 아닙니다.",
      "표시 가격은 PX 공식 사이트에서 관측한 판매가이며 영수증 실구매 관측가와 별도 출처입니다.",
      "상품명·업체명·규격은 공식 사이트 원문이며 표준 상품 연결은 자동 확정하지 않았습니다.",
    ],
    listings: classificationResults.map(({ listing, result }) => {
      if (!result) throw new Error("분류 invariant가 깨졌습니다.");
      const code = listing.source_identity.source_product_code;
      const offer = listing.offers[0];
      const price = offer.prices[0];
      const vendorValue = sourceAttribute(listing, "업체명");
      if (vendorValue !== null && vendorValue !== undefined && typeof vendorValue !== "string") {
        throw new Error(`${code.value}: 업체명 원문이 문자열이 아닙니다.`);
      }
      const amountKrw = Number(price.amount_minor);
      if (!Number.isSafeInteger(amountKrw) || amountKrw < 0) {
        throw new Error(`${code.value}: 판매가를 안전한 KRW 정수로 변환할 수 없습니다.`);
      }
      const primaryImage = listing.images.find((image) => image.role === "primary") ?? listing.images[0] ?? null;
      const standardLink = linksBySourceIdentity.get(officialChannelSourceIdentity({
        sourceProductCodeNamespace: code.namespace,
        sourceProductCode: code.value,
      }));

      return {
        id: `${PX_CHANNEL.id}:${code.namespace}:${code.value}`,
        sourceProductCode: code.value,
        sourceProductCodeNamespace: code.namespace,
        sourceNameRaw: listing.source_fields.source_name,
        vendorNameRaw: vendorValue ?? null,
        specificationTextRaw: listing.source_fields.source_specification_text,
        category: result.category,
        categoryAssignment: result.assignment,
        officialPrice: {
          amountKrw,
          sourceText: price.source_text,
          observedAt: offer.observed_at,
        },
        publication: {
          status: listing.publication.status,
          locationScope: listing.publication.location_scope,
        },
        image: primaryImage ? {
          url: primaryImage.url,
          contentHash: primaryImage.content_hash,
          mediaType: primaryImage.media_type,
          byteLength: primaryImage.byte_length,
        } : null,
        standardProductLink: standardLink
          ? {
            status: "linked",
            standardProductId: standardLink.standardProductId,
          }
          : {
            status: "unlinked",
            standardProductId: null,
          },
        sourceRefs: listing.source_refs,
      };
    }),
  };
  return PublicOfficialChannelCatalogSchema.parse(catalog);
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function findLatestCompletedSnapshot() {
  const candidates: Array<{ filePath: string; bundle: SourceBundle }> = [];
  for (const directory of await readdir(sourceDirectory, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const filePath = path.join(sourceDirectory, directory.name, "snapshot.json");
    try {
      const bundle = sourceBundleSchema.parse(await readJson(filePath));
      candidates.push({ filePath, bundle });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`${path.relative(process.cwd(), filePath)}는 PX 공개 투영 대상이 아닙니다.`);
      }
    }
  }
  const latest = candidates.sort((left, right) =>
    right.bundle.snapshot.captured_at.localeCompare(left.bundle.snapshot.captured_at))[0];
  if (!latest) throw new Error("완료된 PX 공식 상품 snapshot.json을 찾지 못했습니다.");
  return latest;
}

async function checkPublicCatalog() {
  const catalog = PublicOfficialChannelCatalogSchema.parse(await readJson(publicCatalogPath));
  const linkRegistry = PublicOfficialChannelStandardLinkRegistrySchema.parse(
    await readJson(publicLinkRegistryPath),
  );
  const expectedLinks = new Map(
    linkRegistry.links.map((link) => [officialChannelSourceIdentity(link), link.standardProductId] as const),
  );
  for (const listing of catalog.listings) {
    const expectedStandardProductId = expectedLinks.get(officialChannelSourceIdentity(listing));
    const actualStandardProductId = listing.standardProductLink.status === "linked"
      ? listing.standardProductLink.standardProductId
      : null;
    if ((expectedStandardProductId ?? null) !== actualStandardProductId) {
      throw new Error(`${listing.sourceProductCode}: 공개 카탈로그의 표준 상품 연결이 연결 파일과 일치하지 않습니다.`);
    }
    expectedLinks.delete(officialChannelSourceIdentity(listing));
  }
  if (expectedLinks.size > 0) {
    throw new Error(`공개 카탈로그에서 찾지 못한 표준 상품 연결이 있습니다: ${[...expectedLinks.keys()].join(", ")}`);
  }
  console.log(`PX 공식 판매상품 공개 투영 검증 통과 · ${catalog.listings.length}개 · source ${catalog.sourceSnapshot.contentHash}`);
}

async function syncPublicCatalog() {
  const source = await findLatestCompletedSnapshot();
  let bundle = source.bundle;

  if (normalizeSource) {
    const currentHash = bundleContentHash(bundle);
    if (currentHash !== bundle.snapshot.content_hash) {
      throw new Error("의미 수정 전 source bundle hash가 일치하지 않아 수정을 중단했습니다.");
    }
    bundle = normalizePxSourceBundle(bundle);
    await writeFile(source.filePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  }

  assertPxSourceSemantics(bundle);
  const existingProducts = publicObservationSchema.parse(await readJson(publicObservationPath)).observations;
  const linkRegistry = PublicOfficialChannelStandardLinkRegistrySchema.parse(
    await readJson(publicLinkRegistryPath),
  );
  const catalog = buildPublicCatalog(bundle, existingProducts, linkRegistry);
  await mkdir(publicDirectory, { recursive: true });
  await writeFile(publicCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`PX 공식 판매상품 공개 투영 갱신 완료 · ${catalog.listings.length}개 · source ${catalog.sourceSnapshot.contentHash}`);
}

(checkOnly ? checkPublicCatalog() : syncPublicCatalog()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
