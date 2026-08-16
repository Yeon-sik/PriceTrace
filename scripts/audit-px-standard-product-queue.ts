import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { groupProductObservations, martTagFor } from "../src/domain/product-browser";
import {
  officialProductCandidateKey,
  resolveOfficialProductCandidates,
  type OfficialProductCandidate,
} from "../src/domain/official-product";
import { findOfficialListingCandidate } from "../src/domain/official-listing-candidate";
import { findPxProductNameReview } from "../src/domain/px-product-name-review";
import {
  buildPxStandardProductQueueEntries,
  groupPxStandardProductQueueEntries,
  isPxStandardProductCandidate,
} from "../src/domain/standard-product-connection-queue";
import { isExcludedFromStandardProductConnectionQueue } from "../src/domain/standard-product-connection-queue-exclusions";
import { PublicStandardCatalogRowsSchema } from "../src/domain/public-standard-catalog";
import { PublicReceiptRepository } from "../src/repositories/public-receipt.repository";
import { PublicOfficialChannelCatalogRepository } from "../src/repositories/public-official-channel-catalog.repository";
import { PxProductNameReviewRepository } from "../src/repositories/px-product-name-review.repository";

type AuditVariant = {
  id: string;
  standardProductId: string;
  standardName: string;
};

function parseEnvFile(source: string) {
  const values = new Map<string, string>();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values.set(key, value);
  }
  return values;
}

async function publicCatalogRows() {
  const envPath = path.join(process.cwd(), ".env.local");
  const env = parseEnvFile(await readFile(envPath, "utf8"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    ?? env.get("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("PX 대기열 감사에는 Supabase URL과 publishable key가 필요합니다.");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await client.rpc("get_public_exact_standard_product_catalog_v2");
  if (result.error) throw result.error;
  return PublicStandardCatalogRowsSchema.parse(result.data ?? []);
}

async function main() {
  const receiptData = new PublicReceiptRepository().loadAll();
  const officialCatalog = new PublicOfficialChannelCatalogRepository().loadPxCatalog();
  const nameReviews = new PxProductNameReviewRepository().load(officialCatalog);
  const groups = groupProductObservations(receiptData.observations);
  const candidates: OfficialProductCandidate[] = groups.map((group) => {
    const base: OfficialProductCandidate = {
      sourceProductCode: group.sourceProductCode,
      productName: group.productName,
      storeLabel: group.storeLabel,
      martTag: martTagFor(group),
      catalogNamespace: group.catalogNamespace,
      receiptId: group.latest.item.receiptId,
      receiptItemId: group.latest.item.id,
      receiptObservedAt: group.latest.observedAt,
      receiptUnitPriceKrw: group.latest.item.unitPriceKrw,
      receiptQuantity: group.latest.item.quantityValue,
      receiptTotalPriceKrw: group.latest.item.totalPriceKrw,
      receiptConfidence: group.latest.item.confidence,
    };
    const nameReview = findPxProductNameReview(base, nameReviews);
    const reviewedListing = nameReview
      ? officialCatalog.listings.find((listing) => (
        listing.sourceProductCodeNamespace
          === nameReview.officialListing.sourceProductCodeNamespace
        && listing.sourceProductCode === nameReview.officialListing.sourceProductCode
      ))
      : undefined;
    const discovered = group.catalogNamespace === officialCatalog.channel.id
      ? findOfficialListingCandidate(
        officialCatalog.listings,
        group.productName,
        group.latest.item.unitPriceKrw,
      )
      : null;
    const officialListing = reviewedListing ?? discovered?.listing;
    return {
      ...base,
      reviewedProductName: nameReview?.reviewedDisplayName,
      reviewedProductNameSourceRefs: nameReview?.sourceRefs,
      officialDiscoveryMethod: reviewedListing
        ? "reviewed_display_name"
        : discovered?.method,
      officialChannelId: officialListing ? officialCatalog.channel.id : undefined,
      officialSourceProductCodeNamespace: officialListing?.sourceProductCodeNamespace,
      officialSourceProductCode: officialListing?.sourceProductCode,
      officialSourceNameRaw: officialListing?.sourceNameRaw,
    };
  });

  const rows = await publicCatalogRows();
  const variants = new Map<string, AuditVariant>();
  for (const row of rows) variants.set(row.catalog_product_id, {
    id: row.catalog_product_id,
    standardProductId: row.standard_product_id,
    standardName: row.standard_name,
  });
  const mappings = rows.flatMap((row) => {
    const variant = variants.get(row.catalog_product_id);
    return row.source_label && variant ? [{
      sourceLabel: row.source_label,
      sourceProductCode: row.source_product_code,
      product: variant,
    }] : [];
  });
  const pxCandidates = candidates.filter(isPxStandardProductCandidate);
  const resolved = resolveOfficialProductCandidates(pxCandidates, mappings);
  const linked = resolved.filter(({ product }) => Boolean(product));
  const excluded = resolved.filter(({ candidate, product }) => (
    !product && isExcludedFromStandardProductConnectionQueue(candidate)
  ));
  const unlinkedCandidates = resolved.flatMap(({ candidate, product }) => (
    !product && !isExcludedFromStandardProductConnectionQueue(candidate)
      ? [candidate]
      : []
  ));
  const entries = buildPxStandardProductQueueEntries(
    unlinkedCandidates,
    mappings,
    [],
    pxCandidates,
  );
  const queueGroups = groupPxStandardProductQueueEntries(entries);
  const sameCodeReview = entries.filter((entry) => entry.reasons.some((reason) => (
    reason === "same_code_mapping_available"
      || reason === "same_code_mapping_ambiguous"
  )));
  const officialReview = entries.filter((entry) => (
    !sameCodeReview.includes(entry) && Boolean(entry.candidate.officialSourceProductCode)
  ));
  const manualResearch = entries.filter((entry) => (
    !sameCodeReview.includes(entry) && !officialReview.includes(entry)
  ));
  const report = {
    generatedAt: new Date().toISOString(),
    scope: "korean-military-px",
    mappingSource: "public exact catalog RPC; active placeholder variants require the signed-in admin UI",
    browserLocalApprovalQueue: "not_available_to_cli",
    counts: {
      publicObservations: receiptData.observations.length,
      pxObservations: receiptData.observations.filter((observation) => (
        observation.catalogNamespace === officialCatalog.channel.id
      )).length,
      pxUiCandidates: resolved.length,
      linkedOrCovered: linked.length,
      explicitDuplicateExclusions: excluded.length,
      actionableSourceRows: entries.length,
      actionableCodeGroups: queueGroups.length,
      sameCodeMappingReview: sameCodeReview.length,
      sameCodeMappingReviewGroups: groupPxStandardProductQueueEntries(sameCodeReview).length,
      officialCandidateReview: officialReview.length,
      officialCandidateReviewGroups: groupPxStandardProductQueueEntries(officialReview).length,
      manualResearch: manualResearch.length,
      manualResearchGroups: groupPxStandardProductQueueEntries(manualResearch).length,
      reviewedDisplayNames: entries.filter((entry) => (
        Boolean(entry.candidate.reviewedProductName)
      )).length,
      lowOrMediumConfidence: entries.filter((entry) => entry.reasons.includes(
        "low_confidence_source",
      )).length,
      sourceNameConflicts: entries.filter((entry) => entry.reasons.includes(
        "source_name_conflict",
      )).length,
    },
    groups: queueGroups.map((group) => ({
      key: group.key,
      sourceProductCode: group.sourceProductCode,
      rows: group.entries.map((entry) => ({
        key: officialProductCandidateKey(entry.candidate),
        sourceLabel: entry.candidate.storeLabel,
        sourceNameRaw: entry.candidate.productName,
        reviewedDisplayName: entry.candidate.reviewedProductName ?? null,
        officialCandidateName: entry.candidate.officialSourceNameRaw ?? null,
        officialSourceProductCode: entry.candidate.officialSourceProductCode ?? null,
        confidence: entry.candidate.receiptConfidence ?? null,
        reasons: entry.reasons,
      })),
    })),
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log("PX 표준 상품 연결 대기열 감사 · 공개 exact 규격 기준");
  console.log(`관측 ${report.counts.pxObservations}건 · UI 후보 ${report.counts.pxUiCandidates}건`);
  console.log(`연결/검증 재사용 ${report.counts.linkedOrCovered}건 · 명시 중복 제외 ${report.counts.explicitDuplicateExclusions}건`);
  console.log(`남은 원본 표현 ${report.counts.actionableSourceRows}건 · PX 코드 작업 ${report.counts.actionableCodeGroups}건`);
  console.log(`코드 작업 분류 · 기존 연결 검토 ${report.counts.sameCodeMappingReviewGroups}건 · 공식 후보 확인 ${report.counts.officialCandidateReviewGroups}건 · 추가 조사 ${report.counts.manualResearchGroups}건`);
  console.log(`원본 표현 분류 · 기존 연결 검토 ${report.counts.sameCodeMappingReview}건 · 공식 후보 확인 ${report.counts.officialCandidateReview}건 · 추가 조사 ${report.counts.manualResearch}건`);
  console.log(`검토 표시명 ${report.counts.reviewedDisplayNames}건 · low/medium 원문 ${report.counts.lowOrMediumConfidence}건 · 이름 충돌 ${report.counts.sourceNameConflicts}건`);
  console.log("placeholder 판매 규격 연결은 공개 RPC에서 제외되므로 정확한 관리자 탭 수치는 로그인 UI에서 확인합니다.");
  console.log("브라우저 로컬 승인 대기열은 origin별 localStorage라 CLI 집계에서 제외됩니다.");
}

main().catch((error) => {
  console.error(error instanceof Error
    ? error.message
    : typeof error === "object" && error
      ? JSON.stringify(error)
      : String(error));
  process.exitCode = 1;
});
