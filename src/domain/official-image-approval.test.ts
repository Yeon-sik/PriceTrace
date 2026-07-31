import { describe, expect, it } from "vitest";
import { buildOfficialImageApprovalExecution } from "./official-image-approval";
import { canonicalJson, sha256CanonicalJson } from "./standard-product-registration";
import { applyApprovedOfficialImage } from "../repositories/official-image-approval.repository";

async function proposal() {
  const receipt = {
    receiptId: "2026-07-14_001",
    receiptItemId: "line_berry",
    receiptRevision: "revision-1",
    sourceCatalogNamespace: "korean-military-px",
    sourceLabel: "와마트 일산점",
    sourceProductCode: "250428",
    sourceNameRaw: "베리베리스트로베리큐브",
    observedAt: "2026-07-14T10:00:00+09:00",
    unitPriceKrw: 1080,
    quantity: 5,
  };
  const officialListing = {
    channelId: "korean-military-px",
    sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
    sourceProductCode: "35276",
    snapshotId: "1ce9706a-1ea4-45db-ac72-ed3414a955b0",
    snapshotHash: `sha256:${"1".repeat(64)}`,
    sourceNameRaw: "베리베리스트로베리큐브",
    specificationTextRaw: "52g",
    sourceRefs: ["source-component-3-page-37"],
    image: {
      url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=35276&type=1",
      contentHash: `sha256:${"2".repeat(64)}`,
      mediaType: "image/jpeg" as const,
      byteLength: 85635,
    },
  };
  const inputFingerprint = await sha256CanonicalJson(canonicalJson({ receipt, officialListing }));
  const base = {
    schemaVersion: "pricetrace-link-proposal.v3" as const,
    caseId: "case-berry-image",
    status: "approved" as const,
    inputFingerprint,
    receipt,
    officialListing,
    sameChannelNameRule: {
      sameChannel: true,
      normalization: "remove_unicode_whitespace_only",
      normalizedReceiptName: "베리베리스트로베리큐브",
      normalizedOfficialName: "베리베리스트로베리큐브",
      exactNameMatch: true,
      outcome: "apply_official_identity",
      importedOfficialFields: ["brand", "contentAmount", "contentUnit", "packageCount"],
    },
    normalizedIdentity: {
      brand: "배스킨라빈스",
      productFamilyName: "베리베리스트로베리큐브",
      variantName: "베리베리스트로베리큐브",
      contentAmount: 52,
      contentUnit: "g",
      packageCount: 1,
      gtin: null,
    },
    decision: {
      action: "reuse_variant" as const,
      standardProductId: "49236876-d128-4ffc-b82b-0c4aecb7bf88",
      catalogProductId: "226a38d2-3520-43c3-9c76-9a6581fe532b",
      proposedStandardName: null,
      proposedVariantName: null,
      confidence: "high",
      matchedFields: ["brand", "productFamilyName", "contentAmount", "contentUnit", "packageCount"],
      conflictingFields: [],
      missingFields: [],
    },
    coupangOffer: null,
    representativeImage: {
      scope: "standard_product_family" as const,
      action: "create" as const,
      sourceType: "external_url" as const,
      imageUrl: officialListing.image.url,
      contentHash: officialListing.image.contentHash,
      mediaType: officialListing.image.mediaType,
      byteLength: officialListing.image.byteLength,
      expectedCurrent: null,
    },
    evidence: [
      {
        sourceType: "receipt" as const,
        sourceId: "2026-07-14_001:line_berry",
        authority: "transactional" as const,
        url: null,
        capturedAt: "2026-08-01T00:00:00+09:00",
        claims: ["receipt identity"],
        sourceRefs: ["receipt-source"],
      },
      {
        sourceType: "official_channel" as const,
        sourceId: "korean-military-px:welfare.mil.kr:shop:p_code:35276",
        authority: "primary" as const,
        url: "https://www.welfare.mil.kr/content/product/35276",
        capturedAt: "2026-08-01T00:00:00+09:00",
        claims: ["official identity and image"],
        sourceRefs: ["source-component-3-page-37"],
      },
    ],
    review: {
      verdict: "approve" as const,
      reviewerAgent: "pricetrace_independent_reviewer" as const,
      counterCandidates: [],
      conflicts: [],
      evidenceQuality: "sufficient" as const,
      notes: ["image-only reuse target"],
    },
    plannedEffects: [
      "reuse_standard_family",
      "reuse_catalog_variant",
      "update_representative_image",
    ] as const,
  };
  const targetFingerprint = await sha256CanonicalJson(canonicalJson({
    caseId: base.caseId,
    inputFingerprint,
    sameChannelNameRule: base.sameChannelNameRule,
    normalizedIdentity: base.normalizedIdentity,
    decision: base.decision,
    coupangOffer: base.coupangOffer,
    representativeImage: base.representativeImage,
    plannedEffects: base.plannedEffects,
  }));
  const userApprovalText = [
    "영수증 와마트 일산점/250428",
    "공식 korean-military-px/welfare.mil.kr:shop:p_code:35276",
    "배스킨라빈스 베리베리스트로베리큐브 / 베리베리스트로베리큐브",
    base.plannedEffects.join(","),
  ].join(" · ") + ` 연결을 승인합니다. [${targetFingerprint}]`;
  return {
    ...base,
    approval: {
      status: "approved" as const,
      approvalRef: "codex-task:test",
      userApprovalText,
      approvedAt: "2026-08-01T01:00:00+09:00",
      targetFingerprint,
    },
    execution: {
      status: "not_started" as const,
      idempotencyKey: `standard-product-official-image:${targetFingerprint.slice("sha256:".length)}`,
      appliedAt: null,
      result: null,
    },
  };
}

describe("official image approval execution", () => {
  it("builds an image-only idempotent RPC request", async () => {
    const input = await proposal();
    const execution = await buildOfficialImageApprovalExecution(input);

    expect(execution.rpcArgs.p_standard_product_id).toBe(input.decision.standardProductId);
    expect(execution.rpcArgs.p_idempotency_key).toBe(
      `standard-product-official-image:${input.approval.targetFingerprint.slice("sha256:".length)}`,
    );
    expect(execution.approvalStatement).toBe(input.approval.userApprovalText);
  });

  it("rejects a changed official image after approval", async () => {
    const input = await proposal();
    input.officialListing.image.url = "https://example.com/changed.webp";

    await expect(buildOfficialImageApprovalExecution(input)).rejects.toThrow(
      "현재 실행 대상과 일치하지 않습니다",
    );
  });

  it("rejects a proposal missing a strict receipt field", async () => {
    const input = await proposal();
    const receipt = Object.fromEntries(
      Object.entries(input.receipt).filter(([key]) => key !== "receiptRevision"),
    );

    await expect(buildOfficialImageApprovalExecution({ ...input, receipt })).rejects.toThrow();
  });

  it("rejects unknown proposal fields just like the skill validator", async () => {
    const input = await proposal();

    await expect(buildOfficialImageApprovalExecution({
      ...input,
      unexpectedField: true,
    })).rejects.toThrow();
  });

  it("uses the admin RPC once and verifies the image and approval ledger", async () => {
    const input = await proposal();
    const imageUrl = input.officialListing.image.url;
    const approvalId = "442040f9-3da7-4b6a-a7c7-3334f36e5088";
    let imageReads = 0;
    let rpcCalls = 0;
    let rpcArgs: unknown = null;
    const ledger = {
      id: approvalId,
      idempotency_key: input.execution.idempotencyKey,
      target_fingerprint: input.approval.targetFingerprint,
      standard_product_id: input.decision.standardProductId,
      catalog_product_id: input.decision.catalogProductId,
      image_url: imageUrl,
      content_hash: input.officialListing.image.contentHash,
      media_type: input.officialListing.image.mediaType,
      byte_length: input.officialListing.image.byteLength,
      applied_action: "created",
    };
    const client = {
      auth: {
        getUser: async () => ({
          data: { user: { app_metadata: { role: "admin" } } },
          error: null,
        }),
      },
      from(table: string) {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          async maybeSingle() {
            if (table === "standard_product_images") {
              imageReads += 1;
              return imageReads === 1
                ? { data: null, error: null }
                : { data: { standard_product_id: input.decision.standardProductId, source_type: "external_url", image_url: imageUrl }, error: null };
            }
            return { data: null, error: null };
          },
          async single() { return { data: ledger, error: null }; },
        };
        return builder;
      },
      async rpc(name: string, args: unknown) {
        rpcCalls += 1;
        rpcArgs = args;
        expect(name).toBe("approve_standard_product_official_image_v1");
        return {
          data: [{
            approval_id: approvalId,
            standard_product_id: input.decision.standardProductId,
            catalog_product_id: input.decision.catalogProductId,
            replayed: false,
            applied_action: "created",
          }],
          error: null,
        };
      },
    };

    const result = await applyApprovedOfficialImage(
      client as unknown as Parameters<typeof applyApprovedOfficialImage>[0],
      input,
    );

    expect(rpcCalls).toBe(1);
    expect(rpcArgs).toMatchObject({ p_idempotency_key: input.execution.idempotencyKey });
    expect(result).toMatchObject({ approvalId, imageUrl, replayed: false, appliedAction: "created" });
  });

  it("stops before the RPC when another representative image now exists", async () => {
    const input = await proposal();
    let rpcCalls = 0;
    const client = {
      auth: {
        getUser: async () => ({
          data: { user: { app_metadata: { role: "admin" } } },
          error: null,
        }),
      },
      from(table: string) {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          async maybeSingle() {
            return table === "standard_product_images"
              ? { data: { standard_product_id: input.decision.standardProductId, source_type: "upload", image_url: "https://example.com/other.webp" }, error: null }
              : { data: null, error: null };
          },
        };
        return builder;
      },
      async rpc() { rpcCalls += 1; return { data: null, error: null }; },
    };

    await expect(applyApprovedOfficialImage(
      client as unknown as Parameters<typeof applyApprovedOfficialImage>[0],
      input,
    )).rejects.toThrow("덮어쓰지 않습니다");
    expect(rpcCalls).toBe(0);
  });
});
