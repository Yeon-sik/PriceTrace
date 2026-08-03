import { describe, expect, it } from "vitest";
import {
  normalizeBrandLabel,
  officialBrandSourceLabel,
  prepareBrandRegistration,
} from "./brand";
import { inferOfficialPackageCount } from "./catalog-specification";
import { summarizeStandardProducts } from "./standard-product";
import {
  assertReviewedProposalMatchesExecutionTarget,
  buildStrictRegistrationIdentity,
  canonicalJson,
  findExpectedCatalogProductId,
  findUniqueOfficialExactNameMatch,
  parseOfficialSpecification,
  parseReviewedLinkProposal,
  parseReviewedLinkProposalForLiveCandidate,
  parseReviewedLinkProposalEnvelope,
  receiptAndOfficialNamesMatch,
  reviewedLinkProposalTargetFingerprint,
} from "./standard-product-registration";

describe("standard product summaries", () => {
  it("ranks a standard product by its cheapest child listing's unit price", () => {
    const [rice] = summarizeStandardProducts([{ id: "rice", name: "햇반" }], {
      rice: [
        { id: "a", listingName: "햇반 130g 4입", sellerName: "A마트", sourceProductCode: "190370", observedAt: "2026-07-24", listedPriceKrw: 5_200, contentAmount: 130, contentUnit: "g", packageCount: 4 },
        { id: "b", listingName: "햇반 210g", sellerName: "B마트", observedAt: "2026-07-24", listedPriceKrw: 2_100, contentAmount: 210, contentUnit: "g", packageCount: 1 },
      ],
    });
    expect(rice).toMatchObject({ name: "햇반", lowestUnitPriceKrw: 1_000, unitLabel: "100g당", lowestVariant: { id: "a", sourceProductCode: "190370" } });
  });
});

describe("standard product brand registration", () => {
  it("normalizes evidence labels without merging them into a product name", () => {
    expect(normalizeBrandLabel("  Baskin   Robbins  ")).toBe("Baskin Robbins");
    expect(prepareBrandRegistration({
      canonicalName: "  Baskin   Robbins ",
      receiptObservedName: " BR ",
      officialObservedName: " 배스킨라빈스 ",
      officialSourceUrl: "https://www.baskinrobbins.co.kr/menu/list.php",
    })).toEqual({
      value: {
        canonicalName: "Baskin Robbins",
        receiptObservedName: "BR",
        officialObservedName: "배스킨라빈스",
        officialSourceLabel: "baskinrobbins.co.kr",
      },
      error: null,
    });
  });

  it("requires a canonical brand when evidence is supplied", () => {
    expect(prepareBrandRegistration({
      canonicalName: "",
      receiptObservedName: "BR",
      officialObservedName: "",
      officialSourceUrl: "https://example.com",
    })).toEqual({
      value: null,
      error: "브랜드 표기 근거를 저장하려면 표준 브랜드명을 입력하세요.",
    });
  });

  it("returns a stable official source label", () => {
    expect(officialBrandSourceLabel("https://shop.example.com/products/1")).toBe("shop.example.com");
    expect(officialBrandSourceLabel("not-a-url")).toBeNull();
  });
});

describe("official product package count", () => {
  it("defaults to one when the official product name has no count", () => {
    expect(inferOfficialPackageCount("베리베리스트로베리큐브")).toBe(1);
    expect(inferOfficialPackageCount("베리베리스트로베리큐브 52g")).toBe(1);
  });

  it("uses an explicitly written package count", () => {
    expect(inferOfficialPackageCount("햇반 210g 3개입")).toBe(3);
    expect(inferOfficialPackageCount("탄산수 500ml × 20")).toBe(20);
    expect(inferOfficialPackageCount("탄산수 500ml X20")).toBe(20);
  });

  it("does not treat a model number as a package count", () => {
    expect(inferOfficialPackageCount("비타민C1000")).toBe(1);
    expect(inferOfficialPackageCount("RX100")).toBe(1);
  });
});

describe("strict standard product registration", () => {
  it("allows only receipt and official names that differ by whitespace", () => {
    expect(receiptAndOfficialNamesMatch("베리베리 스트로베리 큐브", "베리베리스트로베리큐브")).toBe(true);
    expect(receiptAndOfficialNamesMatch("베리베리 스트로베리 큐브", "베리베리 스트로베리 바")).toBe(false);
    expect(receiptAndOfficialNamesMatch("베리베리\t스트로베리큐브", "베리베리스트로베리큐브")).toBe(true);
    expect(receiptAndOfficialNamesMatch("\u00e9", "e\u0301")).toBe(false);
    expect(receiptAndOfficialNamesMatch("빕스 미트 라자냐", "빕스 미트 라자냐")).toBe(true);
    expect(receiptAndOfficialNamesMatch("빕스 미트 라자냐", "빕스 미트 라자냐 405g")).toBe(false);
  });

  it("parses only an exact official content specification", () => {
    expect(parseOfficialSpecification("52g")).toEqual({ contentAmount: 52, contentUnit: "g" });
    expect(parseOfficialSpecification("500 ml")).toEqual({ contentAmount: 500, contentUnit: "ml" });
    expect(parseOfficialSpecification("1개")).toEqual({ contentAmount: 1, contentUnit: "each" });
    expect(parseOfficialSpecification("약 52g")).toBeNull();
    expect(parseOfficialSpecification("52g x 3")).toBeNull();
  });

  it("selects one exact official name without requiring receipt and official codes to match", () => {
    const listing = findUniqueOfficialExactNameMatch([
      { sourceProductCode: "35276", sourceNameRaw: "베리베리스트로베리큐브" },
      { sourceProductCode: "99999", sourceNameRaw: "비슷한 베리 큐브" },
    ], "베리베리 스트로베리 큐브");
    expect(listing?.sourceProductCode).toBe("35276");
    expect(listing?.sourceProductCode).not.toBe("250428");
    expect(findUniqueOfficialExactNameMatch([
      { sourceNameRaw: "중복 상품" },
      { sourceNameRaw: "중복상품" },
    ], "중복 상품")).toBeNull();
  });

  it("reuses only an exact approved variant", () => {
    const variants = [{
      id: "variant-52g",
      standardProductId: "standard",
      canonicalName: "베리베리 스트로베리 큐브",
      specificationStatus: "verified" as const,
      contentAmount: 52,
      contentUnit: "g" as const,
      packageCount: 1,
      referenceUnit: 100,
    }];
    expect(findExpectedCatalogProductId(variants, {
      standardProductId: "standard",
      canonicalName: "베리베리스트로베리큐브",
      specificationStatus: "verified",
      contentAmount: 52,
      contentUnit: "g",
      packageCount: 1,
      referenceUnit: 100,
    })).toBe("variant-52g");
    expect(findExpectedCatalogProductId(variants, {
      standardProductId: "standard",
      canonicalName: "베리베리스트로베리큐브",
      specificationStatus: "verified",
      contentAmount: 104,
      contentUnit: "g",
      packageCount: 1,
      referenceUnit: 100,
    })).toBeNull();
  });

  it("produces stable fingerprints and changes the target fingerprint when an effect changes", async () => {
    const base = {
      caseId: "merchant:와마트 일산점:35276",
      receipt: {
        receiptId: "receipt-1",
        receiptItemId: "item-1",
        receiptRevision: "revision-1",
        sourceCatalogNamespace: "korean-military-px",
        sourceLabel: "와마트 일산점",
        sourceProductCode: "35276",
        sourceNameRaw: "베리베리스트로베리큐브",
        observedAt: "2026-04-28T00:00:00+09:00",
        unitPriceKrw: 3_900,
        quantity: 1,
      },
      officialListing: {
        channelId: "korean-military-px",
        sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
        sourceProductCode: "35276",
        snapshotId: "33333333-3333-4333-8333-333333333333",
        snapshotHash: `sha256:${"1".repeat(64)}`,
        sourceNameRaw: "베리베리스트로베리큐브",
        specificationTextRaw: "52g",
        sourceRefs: ["snapshot:33333333-3333-4333-8333-333333333333"],
        image: {
          url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=35276&type=1",
          contentHash: `sha256:${"4".repeat(64)}`,
          mediaType: "image/jpeg",
          byteLength: 12_345,
        },
      },
      assessment: {
        decision: {
          confidence: "high" as const,
          matchedFields: ["brand", "productFamilyName", "contentAmount", "contentUnit", "packageCount"],
          conflictingFields: [],
          missingFields: [],
        },
        evidence: [
          {
            sourceType: "receipt" as const,
            sourceId: "receipt-1:item-1",
            authority: "transactional" as const,
            url: null,
            capturedAt: "2026-07-31T00:00:00+09:00",
            claims: ["영수증 이름과 상품 코드를 확인했습니다."],
            sourceRefs: ["receipt:receipt-1:item-1"],
          },
          {
            sourceType: "official_channel" as const,
            sourceId: "korean-military-px:welfare.mil.kr:shop:p_code:35276",
            authority: "primary" as const,
            url: "https://www.welfare.mil.kr/shop/product/35276",
            capturedAt: "2026-07-31T00:05:00+09:00",
            claims: ["공식 이름과 52g 규격을 확인했습니다."],
            sourceRefs: ["snapshot:33333333-3333-4333-8333-333333333333"],
          },
          {
            sourceType: "coupang" as const,
            sourceId: "coupang:exact-option:1",
            authority: "transactional" as const,
            url: "https://coupang.example/1",
            capturedAt: "2026-07-31T00:10:00+09:00",
            claims: ["52g 3개 정확 옵션의 가격을 확인했습니다."],
            sourceRefs: ["coupang:exact-option:1"],
          },
        ],
        review: {
          verdict: "approve" as const,
          reviewerAgent: "pricetrace_independent_reviewer",
          counterCandidates: ["호환되는 반대 후보 없음"],
          conflicts: [],
          evidenceQuality: "sufficient" as const,
          notes: ["GTIN은 없지만 현재 연결 경로에는 비필수입니다."],
        },
      },
      target: {
        standardProductId: null,
        catalogProductId: null,
        standardName: "베리베리스트로베리큐브",
        listingName: "베리베리스트로베리큐브",
        brandName: "배스킨라빈스",
        receiptBrandName: null,
        officialBrandName: "BR",
        officialBrandSourceLabel: "welfare.mil.kr",
        productReferenceUrl: "https://www.welfare.mil.kr/shop/product/35276",
        specificationStatus: "verified" as const,
        contentAmount: 52,
        contentUnit: "g" as const,
        packageCount: 1,
        referenceUnit: 100,
        coupangProductUrl: "https://coupang.example/1",
        coupangListedPriceKrw: 4_380,
        coupangQuantity: 3,
        coupangContentAmount: 52,
        coupangContentUnit: "g" as const,
        coupangMaxBundleQuantity: 12,
        coupangMaxBundleListedPriceKrw: 13_150,
        representativeImageAction: "create" as const,
        representativeImageExpectedCurrent: null,
      },
    };
    const first = await buildStrictRegistrationIdentity(base);
    const repeated = await buildStrictRegistrationIdentity(base);
    const explicitPackageCount = await buildStrictRegistrationIdentity({
      ...base,
      receipt: {
        ...base.receipt,
        sourceNameRaw: "베리베리스트로베리큐브 1개입",
      },
      officialListing: {
        ...base.officialListing,
        sourceNameRaw: "베리베리스트로베리큐브 1개입",
      },
      target: {
        ...base.target,
        listingName: "베리베리스트로베리큐브 1개입",
      },
    });
    const changedSnapshot = await buildStrictRegistrationIdentity({
      ...base,
      officialListing: { ...base.officialListing, snapshotHash: `sha256:${"2".repeat(64)}` },
    });
    const changedPrice = await buildStrictRegistrationIdentity({
      ...base,
      target: { ...base.target, coupangListedPriceKrw: 4_390 },
    });
    const changedImage = await buildStrictRegistrationIdentity({
      ...base,
      officialListing: {
        ...base.officialListing,
        image: { ...base.officialListing.image, contentHash: `sha256:${"5".repeat(64)}` },
      },
    });
    expect(first).toEqual(repeated);
    expect(first.inputFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.inputFingerprint).not.toBe(changedSnapshot.inputFingerprint);
    expect(first.targetFingerprint).not.toBe(changedPrice.targetFingerprint);
    expect(first.inputFingerprint).not.toBe(changedImage.inputFingerprint);
    expect(first.targetFingerprint).not.toBe(changedImage.targetFingerprint);
    expect(first.idempotencyKey).not.toBe(changedPrice.idempotencyKey);
    expect(JSON.parse(explicitPackageCount.targetCanonicalJson)).toMatchObject({
      sameChannelNameRule: {
        importedOfficialFields: ["brand", "contentAmount", "contentUnit", "packageCount"],
      },
      officialSpecificationCheck: { packageCountBasis: "explicit" },
    });
    expect(JSON.parse(first.targetCanonicalJson)).toMatchObject({
      approvalPolicy: {
        mode: "authenticated_admin_explicit_second_step",
        requiredStatementPrefix: "APPROVE_STANDARD_PRODUCT_LINK",
      },
      sameChannelNameRule: {
        outcome: "apply_official_identity",
        importedOfficialFields: ["brand", "contentAmount", "contentUnit"],
      },
      officialSpecificationCheck: {
        parsedContentAmount: 52,
        parsedContentUnit: "g",
        parsedPackageCount: 1,
        packageCountBasis: "default_one_absent_count",
        matchesTarget: true,
      },
      normalizedIdentity: { specificationStatus: "verified", referenceUnit: 100 },
      brandEvidence: {
        canonicalName: "배스킨라빈스",
        officialObservedName: "BR",
      },
      review: {
        verdict: "approve",
        reviewerAgent: "pricetrace_independent_reviewer",
        evidenceQuality: "sufficient",
      },
      representativeImage: {
        scope: "standard_product_family",
        action: "create",
        imageUrl: base.officialListing.image.url,
      },
      plannedEffects: ["create_standard_family", "create_catalog_variant", "link_official_listing", "verify_receipt_mapping", "register_coupang_offer", "update_representative_image"],
    });
    expect(first.approvalStatement).toContain(first.targetFingerprint);

    const executionTarget = JSON.parse(first.targetCanonicalJson);
    const reviewedProposal = {
      schemaVersion: "pricetrace-link-proposal.v3" as const,
      caseId: base.caseId,
      status: "approval_requested" as const,
      inputFingerprint: first.inputFingerprint,
      receipt: base.receipt,
      officialListing: base.officialListing,
      sameChannelNameRule: executionTarget.sameChannelNameRule,
      normalizedIdentity: {
        brand: executionTarget.normalizedIdentity.brand,
        productFamilyName: executionTarget.normalizedIdentity.productFamilyName,
        variantName: executionTarget.normalizedIdentity.variantName,
        contentAmount: executionTarget.normalizedIdentity.contentAmount,
        contentUnit: executionTarget.normalizedIdentity.contentUnit,
        packageCount: executionTarget.normalizedIdentity.packageCount,
        gtin: executionTarget.normalizedIdentity.gtin,
      },
      decision: executionTarget.decision,
      coupangOffer: {
        url: executionTarget.coupangOffer.productUrl,
        totalPriceKrw: executionTarget.coupangOffer.listedPriceKrw,
        quantity: executionTarget.coupangOffer.quantity,
        contentAmount: executionTarget.coupangOffer.contentAmount,
        contentUnit: executionTarget.coupangOffer.contentUnit,
        observedAt: "2026-07-31T00:10:00+09:00",
        maxBundleQuantity: executionTarget.coupangOffer.maxBundleQuantity,
        maxBundleTotalPriceKrw: executionTarget.coupangOffer.maxBundleListedPriceKrw,
      },
      representativeImage: executionTarget.representativeImage,
      executionTarget,
      evidence: base.assessment.evidence,
      review: base.assessment.review,
      plannedEffects: executionTarget.plannedEffects,
      approval: {
        status: "requested" as const,
        targetFingerprint: "",
      },
      execution: {
        status: "not_started" as const,
        idempotencyKey: first.idempotencyKey,
        appliedAt: null,
        result: null,
      },
    };
    reviewedProposal.approval.targetFingerprint = await reviewedLinkProposalTargetFingerprint(
      reviewedProposal,
    );
    expect(reviewedProposal.approval.targetFingerprint).toBe(first.targetFingerprint);
    expect(parseReviewedLinkProposalEnvelope(JSON.stringify(reviewedProposal))).toMatchObject({
      caseId: base.caseId,
      decision: { proposedVariantName: executionTarget.decision.proposedVariantName },
    });
    expect(parseReviewedLinkProposalEnvelope(JSON.stringify({
      ...reviewedProposal,
      status: "approved",
      approval: {
        ...reviewedProposal.approval,
        status: "approved",
        approvalRef: "codex-task:user-message:test",
        userApprovalText: "이 정확한 대상을 승인합니다.",
        approvedAt: "2026-08-01T00:00:00+09:00",
      },
    }))).toMatchObject({
      status: "approved",
      approval: { status: "approved" },
    });
    const imported = await parseReviewedLinkProposal(JSON.stringify(reviewedProposal), {
      caseId: base.caseId,
      receipt: base.receipt,
      officialListing: base.officialListing,
    });
    expect(() => assertReviewedProposalMatchesExecutionTarget(
      imported,
      first.targetCanonicalJson,
    )).not.toThrow();
    expect(() => assertReviewedProposalMatchesExecutionTarget(
      imported,
      canonicalJson({ ...executionTarget, evidence: executionTarget.evidence.slice(0, 2) }),
    )).toThrow("독립 검토 대상");
    await expect(parseReviewedLinkProposalForLiveCandidate(JSON.stringify(reviewedProposal), {
      receipt: { ...base.receipt, observedAt: "2026-04-28" },
      officialListing: {
        ...base.officialListing,
        sourceRefs: [base.officialListing.sourceRefs[0]],
      },
    })).resolves.toMatchObject({
      receipt: { observedAt: base.receipt.observedAt },
      officialListing: { sourceRefs: base.officialListing.sourceRefs },
    });
    await expect(parseReviewedLinkProposal(JSON.stringify({
      ...reviewedProposal,
      receipt: { ...reviewedProposal.receipt, sourceProductCode: "tampered" },
    }), {
      caseId: base.caseId,
      receipt: base.receipt,
      officialListing: base.officialListing,
    })).rejects.toThrow("동결 입력");
  });

  it("rejects an unreviewed, conflicting, or specification-drifted proposal", async () => {
    const valid = {
      caseId: "case-1",
      receipt: {
        receiptId: "receipt-1",
        receiptItemId: "item-1",
        receiptRevision: "revision-1",
        sourceCatalogNamespace: "channel",
        sourceLabel: "store",
        sourceProductCode: "receipt-code",
        sourceNameRaw: "상품",
        observedAt: "2026-07-31T00:00:00+09:00",
        unitPriceKrw: 1_000,
        quantity: 1,
      },
      officialListing: {
        channelId: "channel",
        sourceProductCodeNamespace: "official-namespace",
        sourceProductCode: "official-code",
        snapshotId: "33333333-3333-4333-8333-333333333333",
        snapshotHash: `sha256:${"1".repeat(64)}`,
        sourceNameRaw: "상품",
        specificationTextRaw: "52g",
        sourceRefs: ["snapshot:1"],
        image: {
          url: "https://official.example/image.jpg",
          contentHash: `sha256:${"3".repeat(64)}`,
          mediaType: "image/jpeg",
          byteLength: 1_024,
        },
      },
      assessment: {
        decision: {
          confidence: "high" as const,
          matchedFields: ["contentAmount"],
          conflictingFields: [],
          missingFields: [],
        },
        evidence: [
          { sourceType: "receipt" as const, sourceId: "receipt-1:item-1", authority: "transactional" as const, url: null, capturedAt: "2026-07-31T00:00:00+09:00", claims: ["receipt"], sourceRefs: ["receipt:1"] },
          { sourceType: "official_channel" as const, sourceId: "channel:official-namespace:official-code", authority: "primary" as const, url: "https://official.example/1", capturedAt: "2026-07-31T00:00:00+09:00", claims: ["official"], sourceRefs: ["snapshot:1"] },
          { sourceType: "coupang" as const, sourceId: "coupang:1", authority: "transactional" as const, url: "https://coupang.example/1", capturedAt: "2026-07-31T00:00:00+09:00", claims: ["option"], sourceRefs: ["coupang:1"] },
        ],
        review: {
          verdict: "approve" as const,
          reviewerAgent: "pricetrace_independent_reviewer",
          counterCandidates: [],
          conflicts: [],
          evidenceQuality: "sufficient" as const,
          notes: [],
        },
      },
      target: {
        standardProductId: null,
        catalogProductId: null,
        standardName: "상품",
        listingName: "상품",
        brandName: "브랜드",
        receiptBrandName: null,
        officialBrandName: "브랜드",
        officialBrandSourceLabel: "official.example",
        productReferenceUrl: "https://official.example/1",
        specificationStatus: "verified" as const,
        contentAmount: 52,
        contentUnit: "g" as const,
        packageCount: 1,
        referenceUnit: 100,
        coupangProductUrl: "https://coupang.example/1",
        coupangListedPriceKrw: 1_000,
        coupangQuantity: 1,
        coupangContentAmount: 52,
        coupangContentUnit: "g" as const,
        coupangMaxBundleQuantity: null,
        coupangMaxBundleListedPriceKrw: null,
        representativeImageAction: "create" as const,
        representativeImageExpectedCurrent: null,
      },
    };

    await expect(buildStrictRegistrationIdentity({
      ...valid,
      assessment: {
        ...valid.assessment,
        review: { ...valid.assessment.review, verdict: "needs_more_evidence" as const },
      },
    })).rejects.toThrow("독립 검토");
    await expect(buildStrictRegistrationIdentity({
      ...valid,
      assessment: {
        ...valid.assessment,
        decision: { ...valid.assessment.decision, conflictingFields: ["brand"] },
      },
    })).rejects.toThrow("독립 검토");
    await expect(buildStrictRegistrationIdentity({
      ...valid,
      target: { ...valid.target, contentAmount: 53 },
    })).rejects.toThrow("공식 규격 원문");
  });
});
