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
  buildLinkOnlyRegistrationIdentity,
  buildStrictRegistrationIdentity,
  canonicalJson,
  findExpectedCatalogProductId,
  findWhitespaceEquivalentStandardProduct,
  findUniqueOfficialContainedNameMatch,
  findUniqueOfficialExactNameMatch,
  findUniqueOfficialRelaxedNameMatch,
  parseOfficialSpecification,
  parseCompositeKitSpecification,
  parseOfficialWiperBladeFitment,
  parseStructuredOfficialSpecification,
  parseReviewedLinkProposal,
  parseReviewedLinkProposalForLiveCandidate,
  parseReviewedLinkProposalEnvelope,
  receiptAndOfficialNamesMatch,
  receiptRevisionMatchesLiveCandidate,
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

describe("standard product family uniqueness", () => {
  const standards = [
    { id: "shrimp-cracker", canonical_name: "농심 새우깡" },
  ];

  it("finds the existing family with the same case-insensitive whitespace key", () => {
    expect(findWhitespaceEquivalentStandardProduct(standards, "  농심새우깡  "))
      .toEqual(standards[0]);
  });

  it("does not treat a different product name as the same family", () => {
    expect(findWhitespaceEquivalentStandardProduct(standards, "농심 새우깡 매운맛"))
      .toBeUndefined();
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
  it("accepts only the known legacy receipt revision format for receipt-v1 rows", () => {
    expect(receiptRevisionMatchesLiveCandidate(
      "89c3a3b216d05e82",
      "receipt-v1:2026-07-14_001.json:line-1:2026-07-14:짜왕:260112:3530:2:7060",
    )).toBe(true);
    expect(receiptRevisionMatchesLiveCandidate(
      "89c3a3b216d05e82",
      "revision-2",
    )).toBe(false);
    expect(receiptRevisionMatchesLiveCandidate(
      "old-revision",
      "receipt-v1:row",
    )).toBe(false);
  });

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
    expect(parseOfficialSpecification("1kg")).toEqual({ contentAmount: 1000, contentUnit: "g" });
    expect(parseOfficialSpecification("4입")).toEqual({ contentAmount: 4, contentUnit: "each" });
    expect(parseOfficialSpecification("약 52g")).toBeNull();
    expect(parseOfficialSpecification("52g x 3")).toBeNull();
  });

  it("parses reviewed structured official specifications without inflating total content", () => {
    expect(parseStructuredOfficialSpecification("5매", "대일 시프쿨파스 5매")).toEqual({
      contentAmount: 1,
      contentUnit: "each",
      packageCount: 5,
      parseRule: "count_only_v1",
      packageCountBasis: "explicit_specification",
    });
    for (const separator of ["x", "X", "×", "*"]) {
      expect(parseStructuredOfficialSpecification(
        `134g ${separator} 4개입`,
        "짜왕 134g 4개입",
      )).toMatchObject({
        contentAmount: 134,
        contentUnit: "g",
        packageCount: 4,
        parseRule: "per_item_times_count_v1",
      });
    }
    expect(parseStructuredOfficialSpecification(
      "1.5g x 20개입",
      "옥수수수염차 1.5g x 20개입",
    )).toMatchObject({ contentAmount: 1.5, contentUnit: "g", packageCount: 20 });
    expect(parseStructuredOfficialSpecification(
      "360g/30매입",
      "듀이트리 픽 앤 퀵 카밍풀 마스크 30매",
    )).toEqual({
      contentAmount: 12,
      contentUnit: "g",
      packageCount: 30,
      parseRule: "total_amount_per_count_v1",
      packageCountBasis: "explicit_specification",
      parsedTotalContentAmount: 360,
    });
    expect(parseStructuredOfficialSpecification(
      "140g*2개/280g",
      "그릭콩포트 블루베리",
    )).toEqual({
      contentAmount: 140,
      contentUnit: "g",
      packageCount: 2,
      parseRule: "per_item_times_count_with_total_v1",
      packageCountBasis: "explicit_specification",
      parsedTotalContentAmount: 280,
    });
    expect(parseStructuredOfficialSpecification(
      "424.8",
      "즉석해물칼국수 424.8g",
    )).toEqual({
      contentAmount: 424.8,
      contentUnit: "g",
      packageCount: 1,
      parseRule: "numeric_spec_unit_from_official_name_v1",
      packageCountBasis: "default_one_absent_count",
      matchedOfficialNameFragment: "424.8g",
    });
  });

  it("preserves a razor handle and replacement blades as one composite kit", () => {
    expect(parseCompositeKitSpecification("면도기1 면도날2")).toEqual([
      { componentType: "razor_handle", quantity: 1, unit: "each" },
      { componentType: "razor_blade", quantity: 2, unit: "each" },
    ]);
    expect(parseCompositeKitSpecification("3개")).toBeNull();
    expect(parseCompositeKitSpecification("면도기0 면도날2")).toBeNull();
  });

  it("parses only a bounded millimetre fitment for an official wiper listing", () => {
    expect(parseOfficialWiperBladeFitment("400mm", "RainOK 메탈 그래핀 하이브리드 와이퍼"))
      .toEqual({ lengthMm: 400 });
    expect(parseOfficialWiperBladeFitment("400mm", "일반 금속 제품")).toBeNull();
    expect(parseOfficialWiperBladeFitment("900mm", "RainOK 와이퍼")).toBeNull();
  });

  it("rejects incomplete or ambiguous structured specification evidence", () => {
    expect(parseStructuredOfficialSpecification("약 52g", "제품 52g")).toBeNull();
    expect(parseStructuredOfficialSpecification("134g*4", "짜왕 134g 4개입")).toBeNull();
    expect(parseStructuredOfficialSpecification("110", "스포츠런닝 110")).toBeNull();
    expect(parseStructuredOfficialSpecification("424.8", "즉석면 424.8g + 424.8g")).toBeNull();
    expect(parseStructuredOfficialSpecification("424.8", "즉석면 400g")).toBeNull();
    expect(parseStructuredOfficialSpecification("140g*2개/270g", "그릭콩포트 블루베리")).toBeNull();
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

  it("returns only one close typo candidate for discovery", () => {
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "32746", sourceNameRaw: "56시간 저온숙성 숙 탕종숙식빵" },
      { sourceProductCode: "32712", sourceNameRaw: "상쾌한아침우유식빵" },
    ], "56시간 저온숙성 속 탕종숙식빵")?.sourceProductCode).toBe("32746");
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "1", sourceNameRaw: "테스트상품가" },
      { sourceProductCode: "2", sourceNameRaw: "테스트상품나" },
    ], "테스트상품다")).toBeNull();
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "90", sourceNameRaw: "가나다라마바사아자카" },
    ], "가나다라마바사아자차")?.sourceProductCode).toBe("90");
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "89", sourceNameRaw: "가나다라마바사아카" },
    ], "가나다라마바사아차")?.sourceProductCode).toBe("89");
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "85", sourceNameRaw: "가나다라마바사" },
    ], "가나다라마바샤")?.sourceProductCode).toBe("85");
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "84", sourceNameRaw: "가나다라마바" },
    ], "가나다라마샤")).toBeNull();
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "37602", sourceNameRaw: "RainOK 메탈 그래핀 하이브리드 와이퍼" },
      { sourceProductCode: "other", sourceNameRaw: "다른 자동차 와이퍼" },
    ], "(260366)RainOK 메탈")?.sourceProductCode).toBe("37602");
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "36376", sourceNameRaw: "규격(240046)자외선차단 쿨토시ZSTO0169(free/wh)" },
      { sourceProductCode: "other", sourceNameRaw: "규격(240047)방한 팔토시" },
    ], "규격(240046) 자외선차단쿨토시")?.sourceProductCode).toBe("36376");
    expect(findUniqueOfficialRelaxedNameMatch([
      { sourceProductCode: "35592", sourceNameRaw: "(영외)호밍스 해물누룽지탕(670g)" },
      { sourceProductCode: "36820", sourceNameRaw: "(영외)호밍스 우삼겹 스키야키 (680g)" },
    ], "(영외)호밍스 해물누룽지탕(670)")?.sourceProductCode).toBe("35592");
  });

  it("selects one longer official name only when the frozen official price also matches", () => {
    const listings = [
      {
        sourceProductCode: "37900",
        sourceNameRaw: "규격(250550)네파 반바지(105)",
        officialPrice: { amountKrw: 15_360 },
      },
      {
        sourceProductCode: "37902",
        sourceNameRaw: "규격(250550)네파 반바지(95)",
        officialPrice: { amountKrw: 15_360 },
      },
    ];
    expect(findUniqueOfficialContainedNameMatch(
      listings,
      "(250550)네파 반바지(105",
      15_360,
    )?.sourceProductCode).toBe("37900");
    expect(findUniqueOfficialContainedNameMatch(listings, "네파", 15_360)).toBeNull();
    expect(findUniqueOfficialContainedNameMatch(
      listings,
      "(250550)네파 반바지(105",
      15_350,
    )).toBeNull();
    expect(findUniqueOfficialContainedNameMatch([
      ...listings,
      {
        sourceProductCode: "37901",
        sourceNameRaw: "구규(250550)네파 반바지(105)-기획",
        officialPrice: { amountKrw: 16_000 },
      },
    ], "(250550)네파 반바지(105", 15_360)).toBeNull();
  });

  it("reuses only an exact approved variant", () => {
    const variants = [{
      id: "variant-52g",
      standardProductId: "standard",
      canonicalName: "베리베리 스트로베리 큐브",
      specification: "52g",
      attributes: {},
      specificationStatus: "verified" as const,
      contentAmount: 52,
      contentUnit: "g" as const,
      packageCount: 1,
      referenceUnit: 100,
    }];
    expect(findExpectedCatalogProductId(variants, {
      standardProductId: "standard",
      canonicalName: "베리베리스트로베리큐브",
      specification: "52g",
      attributes: {},
      specificationStatus: "verified",
      contentAmount: 52,
      contentUnit: "g",
      packageCount: 1,
      referenceUnit: 100,
    })).toBe("variant-52g");
    expect(findExpectedCatalogProductId(variants, {
      standardProductId: "standard",
      canonicalName: "베리베리스트로베리큐브",
      specification: "104g",
      attributes: {},
      specificationStatus: "verified",
      contentAmount: 104,
      contentUnit: "g",
      packageCount: 1,
      referenceUnit: 100,
    })).toBeNull();
    expect(findExpectedCatalogProductId(variants, {
      standardProductId: "standard",
      canonicalName: "베리베리스트로베리큐브",
      specification: "52g",
      attributes: { wiperBladeFitment: { lengthMm: 400 } },
      specificationStatus: "verified",
      contentAmount: 52,
      contentUnit: "g",
      packageCount: 1,
      referenceUnit: 100,
    })).toBeNull();
  });

  it("reuses a verified legacy variant when only its specification text is null", () => {
    const variants = [{
      id: "legacy-420g",
      standardProductId: "standard",
      canonicalName: "product 420g",
      specification: "",
      attributes: {},
      specificationStatus: "verified" as const,
      contentAmount: 420,
      contentUnit: "g" as const,
      packageCount: 1,
      referenceUnit: 100,
    }];
    expect(findExpectedCatalogProductId(variants, {
      standardProductId: "standard",
      canonicalName: "product 420g",
      specification: "420g",
      attributes: {},
      specificationStatus: "verified",
      contentAmount: 420,
      contentUnit: "g",
      packageCount: 1,
      referenceUnit: 100,
    })).toBe("legacy-420g");
    expect(findExpectedCatalogProductId(variants, {
      standardProductId: "standard",
      canonicalName: "product 420g",
      specification: "420g",
      attributes: {},
      specificationStatus: "verified",
      contentAmount: 90,
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
    const verifiedMismatchBase = {
      ...base,
      receipt: {
        ...base.receipt,
        sourceNameRaw: "56시간 저온숙성 속 탕종숙식빵",
      },
      officialListing: {
        ...base.officialListing,
        sourceNameRaw: "56시간 저온숙성 숙 탕종숙식빵",
      },
      assessment: {
        ...base.assessment,
        evidence: [
          ...base.assessment.evidence,
          {
            sourceType: "manufacturer" as const,
            sourceId: "manufacturer:spc-samlip:56-hour-bread",
            authority: "primary" as const,
            url: "https://spcsamlip.example/56-hour-bread",
            capturedAt: "2026-08-03T00:00:00+09:00",
            claims: ["제조사 명칭과 동일한 56시간 탕종 숙식빵 제품군을 확인했습니다."],
            sourceRefs: ["manufacturer:spc-samlip:56-hour-bread"],
          },
        ],
      },
      verifiedNameEquivalence: {
        method: "single_unicode_code_point_substitution_v1" as const,
        scope: "frozen_receipt_official_pair_only" as const,
        zeroBasedCodePointIndex: 8,
        receiptCodePoint: "속",
        officialCodePoint: "숙",
        supportingEvidenceSourceIds: [
          "korean-military-px:welfare.mil.kr:shop:p_code:35276",
          "manufacturer:spc-samlip:56-hour-bread",
        ],
        supportingSourceRefs: [
          "snapshot:33333333-3333-4333-8333-333333333333",
          "manufacturer:spc-samlip:56-hour-bread",
        ],
        reviewerAgent: "pricetrace_independent_reviewer" as const,
        reviewedAt: "2026-08-03T00:00:00+09:00",
        conclusion: "same_exact_sellable_variant" as const,
      },
    };
    const containedMismatchBase = {
      ...base,
      receipt: {
        ...base.receipt,
        sourceNameRaw: "닥터지 모이스처 인 바디 5.0 바",
        unitPriceKrw: 6_960,
      },
      officialListing: {
        ...base.officialListing,
        sourceNameRaw: "닥터지 모이스처 인바디 5.0 바디워시",
        specificationTextRaw: "500ml",
        officialPrice: {
          amountKrw: 6_960,
          sourceText: "6,960원",
          observedAt: "2026-07-30T14:02:27.744Z",
        },
      },
      target: {
        ...base.target,
        listingName: "닥터지 모이스처 인바디 5.0 바디워시 500ml",
        contentAmount: 500,
        contentUnit: "ml" as const,
        coupangContentAmount: 500,
        coupangContentUnit: "ml" as const,
      },
      verifiedNameEquivalence: {
        method: "official_name_contains_receipt_name_v1" as const,
        scope: "frozen_receipt_official_pair_only" as const,
        zeroBasedOfficialCodePointIndex: 0,
        receiptCodePointLength: 14,
        officialCodePointLength: 17,
        officialPrefix: "",
        officialSuffix: "디워시",
        officialDisplayedPriceKrw: 6_960,
        officialPriceObservedAt: "2026-07-30T14:02:27.744Z",
        uniqueOfficialCandidate: true as const,
        supportingEvidenceSourceIds: [
          "receipt-1:item-1",
          "korean-military-px:welfare.mil.kr:shop:p_code:35276",
        ],
        supportingSourceRefs: [
          "receipt:receipt-1:item-1",
          "snapshot:33333333-3333-4333-8333-333333333333",
        ],
        reviewerAgent: "pricetrace_independent_reviewer" as const,
        reviewedAt: "2026-08-03T22:30:00+09:00",
        conclusion: "same_exact_sellable_variant" as const,
      },
    };
    const insertionDeletionMismatchBase = {
      ...base,
      caseId: "receipt-2026-07-14_001-line_77be98e4966cc5ae-px-35592",
      receipt: {
        ...base.receipt,
        receiptId: "2026-07-14_001",
        receiptItemId: "line_77be98e4966cc5ae",
        receiptRevision: "89c3a3b216d05e82",
        sourceProductCode: "250073",
        sourceNameRaw: "(영외)호밍스 해물누룽지탕(670)",
        observedAt: "2026-07-14T00:00:00+09:00",
        unitPriceKrw: 9_060,
        quantity: 3,
      },
      officialListing: {
        ...base.officialListing,
        sourceProductCode: "35592",
        snapshotId: "1ce9706a-1ea4-45db-ac72-ed3414a955b0",
        snapshotHash: "sha256:2086f833afd9e0f30ac5130b4f6389f381aa372c3bc56f34aa08d019b6f5b3d9",
        sourceNameRaw: "(영외)호밍스 해물누룽지탕(670g)",
        specificationTextRaw: "670g",
        officialPrice: {
          amountKrw: 9_060,
          sourceText: "9,060원",
          observedAt: "2026-07-30T14:02:27.744Z",
        },
        sourceRefs: ["source-component-3-page-33"],
        image: {
          url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=35592&type=1",
          contentHash: "sha256:2e945842b4419c4d6c9f7b1051dd137138bb70b321ec268247a8d04c727d28b6",
          mediaType: "image/jpeg",
          byteLength: 95_600,
        },
      },
      assessment: {
        decision: {
          confidence: "high" as const,
          matchedFields: [
            "same catalog channel",
            "unique official candidate at 90% similarity",
            "official 670g specification",
            "manufacturer exact 670g product identity",
          ],
          conflictingFields: [],
          missingFields: [],
        },
        evidence: [
          {
            sourceType: "receipt" as const,
            sourceId: "2026-07-14_001:line_77be98e4966cc5ae",
            authority: "transactional" as const,
            url: null,
            capturedAt: "2026-07-14T00:00:00+09:00",
            claims: ["영수증 원문명과 판매처 상품 코드를 확인했습니다."],
            sourceRefs: ["data/public/receipts/2026-07-14_001.json#line_77be98e4966cc5ae"],
          },
          {
            sourceType: "official_channel" as const,
            sourceId: "korean-military-px:welfare.mil.kr:shop:p_code:35592",
            authority: "primary" as const,
            url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=35592&type=1",
            capturedAt: "2026-07-30T14:02:27.744Z",
            claims: ["PX 공식명, 670g 규격, p_code 35592를 확인했습니다."],
            sourceRefs: ["source-component-3-page-33"],
          },
          {
            sourceType: "manufacturer" as const,
            sourceId: "manufacturer:daesang:homeings-seafood-nurungji-670g",
            authority: "primary" as const,
            url: "https://m.jungoneshop.com/goods/goods_view.php?goodsNo=26134",
            capturedAt: "2026-08-04T12:00:00+09:00",
            claims: ["대상 공식 판매 페이지에서 호밍스 해물누룽지탕 670g을 확인했습니다."],
            sourceRefs: ["manufacturer:daesang:homeings-seafood-nurungji-670g"],
          },
          {
            sourceType: "brand" as const,
            sourceId: "brand:daesang:homeings",
            authority: "primary" as const,
            url: "https://www.daesang.com/kr/business/food/food_business.jsp",
            capturedAt: "2026-08-04T12:00:00+09:00",
            claims: ["대상 기업 페이지에서 호밍스를 간편식 브랜드로 확인했습니다."],
            sourceRefs: ["brand:daesang:homeings"],
          },
        ],
        review: {
          verdict: "approve" as const,
          reviewerAgent: "pricetrace_independent_reviewer",
          counterCandidates: ["다른 PX 해물누룽지탕 후보는 규격 또는 제품명이 다릅니다."],
          conflicts: [],
          evidenceQuality: "sufficient" as const,
          notes: ["90% 유사도는 후보 탐색에만 사용하고 공식 규격과 제조사 근거로 확정합니다."],
        },
      },
      target: {
        standardProductId: null,
        catalogProductId: null,
        standardName: "호밍스 해물누룽지탕",
        listingName: "호밍스 해물누룽지탕 670g",
        brandName: "호밍스",
        receiptBrandName: "호밍스",
        officialBrandName: "호밍스",
        officialBrandSourceLabel: "daesang.com",
        productReferenceUrl: "https://www.daesang.com/kr/business/food/food_business.jsp",
        specificationStatus: "verified" as const,
        contentAmount: 670,
        contentUnit: "g" as const,
        packageCount: 1,
        referenceUnit: 100,
        apparelSize: null,
        representativeImageAction: "create" as const,
        representativeImageExpectedCurrent: null,
      },
      verifiedNameEquivalence: {
        method: "single_unicode_code_point_insertion_deletion_v1" as const,
        scope: "frozen_receipt_official_pair_only" as const,
        editDirection: "insert_official_code_point_into_receipt" as const,
        zeroBasedEditIndex: 17,
        editedCodePoint: "g",
        receiptCodePointLength: 18,
        officialCodePointLength: 19,
        discoverySimilarityBasisPoints: 9333,
        uniqueOfficialCandidate: true as const,
        supportingEvidenceSourceIds: [
          "korean-military-px:welfare.mil.kr:shop:p_code:35592",
          "manufacturer:daesang:homeings-seafood-nurungji-670g",
        ],
        supportingSourceRefs: [
          "source-component-3-page-33",
          "manufacturer:daesang:homeings-seafood-nurungji-670g",
        ],
        reviewerAgent: "pricetrace_independent_reviewer" as const,
        reviewedAt: "2026-08-04T12:30:00+09:00",
        conclusion: "same_exact_sellable_variant" as const,
      },
    };
    const first = await buildStrictRegistrationIdentity(base);
    const differentCoupangWeight = await buildStrictRegistrationIdentity({
      ...base,
      target: {
        ...base.target,
        coupangContentAmount: 360,
      },
    });
    const repeated = await buildStrictRegistrationIdentity(base);
    const verifiedMismatch = await buildStrictRegistrationIdentity(verifiedMismatchBase);
    const containedMismatch = await buildStrictRegistrationIdentity(containedMismatchBase);
    const insertionDeletionMismatch = await buildLinkOnlyRegistrationIdentity(
      insertionDeletionMismatchBase,
    );
    await expect(buildStrictRegistrationIdentity({
      ...verifiedMismatchBase,
      verifiedNameEquivalence: null,
    })).rejects.toThrow("검증된 이름 동등성");
    await expect(buildStrictRegistrationIdentity({
      ...verifiedMismatchBase,
      verifiedNameEquivalence: {
        ...verifiedMismatchBase.verifiedNameEquivalence,
        zeroBasedCodePointIndex: 7,
      },
    })).rejects.toThrow("단일 Unicode 문자 치환");
    await expect(buildStrictRegistrationIdentity({
      ...verifiedMismatchBase,
      officialListing: {
        ...verifiedMismatchBase.officialListing,
        sourceNameRaw: "56시간 저온숙성 숙 탕종숙식밤",
      },
    })).rejects.toThrow("단일 Unicode 문자 치환");
    await expect(buildStrictRegistrationIdentity({
      ...verifiedMismatchBase,
      verifiedNameEquivalence: {
        ...verifiedMismatchBase.verifiedNameEquivalence,
        supportingSourceRefs: ["unknown", "manufacturer:spc-samlip:56-hour-bread"],
      },
    })).rejects.toThrow("공식 채널과 제조사");
    await expect(buildStrictRegistrationIdentity({
      ...verifiedMismatchBase,
      verifiedNameEquivalence: {
        ...verifiedMismatchBase.verifiedNameEquivalence,
        reviewedAt: "not-a-date",
      },
    })).rejects.toThrow();
    await expect(buildStrictRegistrationIdentity({
      ...containedMismatchBase,
      receipt: { ...containedMismatchBase.receipt, unitPriceKrw: 6_950 },
    })).rejects.toThrow("공식 표시가격");
    await expect(buildStrictRegistrationIdentity({
      ...containedMismatchBase,
      verifiedNameEquivalence: {
        ...containedMismatchBase.verifiedNameEquivalence,
        officialSuffix: "워시",
      },
    })).rejects.toThrow("공식 표시가격");
    await expect(buildLinkOnlyRegistrationIdentity({
      ...insertionDeletionMismatchBase,
      verifiedNameEquivalence: {
        ...insertionDeletionMismatchBase.verifiedNameEquivalence,
        zeroBasedEditIndex: 16,
      },
    })).rejects.toThrow("단일 Unicode 문자 삽입·누락");
    await expect(buildLinkOnlyRegistrationIdentity({
      ...insertionDeletionMismatchBase,
      verifiedNameEquivalence: {
        ...insertionDeletionMismatchBase.verifiedNameEquivalence,
        discoverySimilarityBasisPoints: 9000,
      },
    })).rejects.toThrow("단일 Unicode 문자 삽입·누락");
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
    expect(JSON.parse(differentCoupangWeight.targetCanonicalJson)).toMatchObject({
      normalizedIdentity: { contentAmount: 52, contentUnit: "g" },
      coupangOffer: { contentAmount: 360, contentUnit: "g" },
    });
    await expect(buildStrictRegistrationIdentity({
      ...base,
      officialListing: {
        ...base.officialListing,
        specificationTextRaw: "4개",
      },
      target: {
        ...base.target,
        contentAmount: 4,
        contentUnit: "each",
        coupangContentAmount: 5,
        coupangContentUnit: "each",
      },
    })).rejects.toThrow("개 단위는 판매 규격과 같아야 합니다.");
    expect(first.inputFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.inputFingerprint).not.toBe(changedSnapshot.inputFingerprint);
    expect(first.targetFingerprint).not.toBe(changedPrice.targetFingerprint);
    expect(first.inputFingerprint).not.toBe(changedImage.inputFingerprint);
    expect(first.targetFingerprint).not.toBe(changedImage.targetFingerprint);
    expect(first.idempotencyKey).not.toBe(changedPrice.idempotencyKey);
    expect(JSON.parse(verifiedMismatch.targetCanonicalJson)).toMatchObject({
      sameChannelNameRule: {
        exactNameMatch: false,
        outcome: "apply_verified_name_equivalence",
        verifiedEquivalence: {
          conclusion: "same_exact_sellable_variant",
        },
      },
    });
    expect(JSON.parse(containedMismatch.targetCanonicalJson)).toMatchObject({
      sameChannelNameRule: {
        exactNameMatch: false,
        outcome: "apply_verified_name_equivalence",
        verifiedEquivalence: {
          method: "official_name_contains_receipt_name_v1",
          officialDisplayedPriceKrw: 6_960,
          uniqueOfficialCandidate: true,
        },
      },
    });
    expect(JSON.parse(insertionDeletionMismatch.targetCanonicalJson)).toMatchObject({
      executionMode: "link_only_v1",
      sameChannelNameRule: {
        exactNameMatch: false,
        outcome: "apply_verified_name_equivalence",
        verifiedEquivalence: {
          method: "single_unicode_code_point_insertion_deletion_v1",
          editDirection: "insert_official_code_point_into_receipt",
          zeroBasedEditIndex: 17,
          editedCodePoint: "g",
          discoverySimilarityBasisPoints: 9333,
          uniqueOfficialCandidate: true,
        },
      },
      normalizedIdentity: {
        brand: "호밍스",
        productFamilyName: "호밍스 해물누룽지탕",
        variantName: "호밍스 해물누룽지탕 670g",
      },
      coupangOffer: null,
      plannedEffects: [
        "create_standard_family",
        "create_catalog_variant",
        "link_official_listing",
        "verify_receipt_mapping",
        "update_representative_image",
      ],
    });
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

  it("builds a link-only apparel target without treating size as content or Coupang", async () => {
    const identity = await buildLinkOnlyRegistrationIdentity({
      caseId: "case-nepa-105",
      receipt: {
        receiptId: "2026-07-14_001",
        receiptItemId: "line_49d5b8c67cdb0c08",
        receiptRevision: "revision-nepa",
        sourceCatalogNamespace: "korean-military-px",
        sourceLabel: "와마트 일산점",
        sourceProductCode: "250621",
        sourceNameRaw: "(250550)네파 반바지(105",
        observedAt: "2026-07-14T00:00:00+09:00",
        unitPriceKrw: 15_360,
        quantity: 1,
      },
      officialListing: {
        channelId: "korean-military-px",
        sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
        sourceProductCode: "37900",
        snapshotId: "1ce9706a-1ea4-45db-ac72-ed3414a955b0",
        snapshotHash: `sha256:${"2".repeat(64)}`,
        sourceNameRaw: "규격(250550)네파 반바지(105)",
        specificationTextRaw: "105",
        officialPrice: {
          amountKrw: 15_360,
          sourceText: "15,360원",
          observedAt: "2026-07-30T14:02:27.744Z",
        },
        sourceRefs: ["source-component-3-page-14"],
        image: {
          url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=37900&type=1",
          contentHash: `sha256:${"f".repeat(64)}`,
          mediaType: "image/jpeg",
          byteLength: 95_195,
        },
      },
      assessment: {
        decision: {
          confidence: "high",
          matchedFields: ["styleCode", "apparelSize", "officialCode"],
          conflictingFields: [],
          missingFields: [],
        },
        evidence: [
          {
            sourceType: "receipt",
            sourceId: "2026-07-14_001:line_49d5b8c67cdb0c08",
            authority: "transactional",
            url: null,
            capturedAt: "2026-08-04T00:00:00+09:00",
            claims: ["영수증 SKU 250621, 스타일 250550, 숫자 규격 105"],
            sourceRefs: ["receipt:2026-07-14_001:line_49d5b8c67cdb0c08"],
          },
          {
            sourceType: "official_channel",
            sourceId: "korean-military-px:welfare.mil.kr:shop:p_code:37900",
            authority: "primary",
            url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=37900&type=1",
            capturedAt: "2026-08-04T00:00:00+09:00",
            claims: ["p37900의 공식 원문과 숫자 규격 105"],
            sourceRefs: ["source-component-3-page-14"],
          },
        ],
        review: {
          verdict: "approve",
          reviewerAgent: "pricetrace_independent_reviewer",
          counterCandidates: ["p37898 size 110", "p37902 size 95"],
          conflicts: [],
          evidenceQuality: "sufficient",
          notes: ["XL(105)은 프로젝트 표시 규칙이며 공식 원규격 105를 보존합니다."],
        },
      },
      verifiedNameEquivalence: {
        method: "official_name_contains_receipt_name_v1",
        scope: "frozen_receipt_official_pair_only",
        zeroBasedOfficialCodePointIndex: 2,
        receiptCodePointLength: 17,
        officialCodePointLength: 20,
        officialPrefix: "규격",
        officialSuffix: ")",
        officialDisplayedPriceKrw: 15_360,
        officialPriceObservedAt: "2026-07-30T14:02:27.744Z",
        uniqueOfficialCandidate: true,
        supportingEvidenceSourceIds: [
          "2026-07-14_001:line_49d5b8c67cdb0c08",
          "korean-military-px:welfare.mil.kr:shop:p_code:37900",
        ],
        supportingSourceRefs: [
          "receipt:2026-07-14_001:line_49d5b8c67cdb0c08",
          "source-component-3-page-14",
        ],
        reviewerAgent: "pricetrace_independent_reviewer",
        reviewedAt: "2026-08-04T00:00:00+09:00",
        conclusion: "same_exact_sellable_variant",
      },
      target: {
        standardProductId: null,
        catalogProductId: null,
        standardName: "네파 반바지 (스타일 250550)",
        listingName: "네파 반바지 (스타일 250550) XL(105)",
        brandName: "네파",
        receiptBrandName: null,
        officialBrandName: "NEPA",
        officialBrandSourceLabel: "nplus.co.kr",
        productReferenceUrl: "https://www.nplus.co.kr/customer/sizeguide.asp",
        specificationStatus: "verified",
        contentAmount: 1,
        contentUnit: "each",
        packageCount: 1,
        referenceUnit: 100,
        apparelSize: { alpha: "XL", kr: 105, label: "XL(105)" },
        representativeImageAction: "create",
        representativeImageExpectedCurrent: null,
      },
    });

    expect(JSON.parse(identity.targetCanonicalJson)).toMatchObject({
      executionMode: "link_only_v1",
      coupangOffer: null,
      officialSpecificationCheck: {
        kind: "apparel_size",
        parsedApparelSize: { alpha: "XL", kr: 105, label: "XL(105)" },
      },
      normalizedIdentity: {
        contentAmount: 1,
        contentUnit: "each",
        apparelSize: { alpha: "XL", kr: 105, label: "XL(105)" },
      },
      plannedEffects: [
        "create_standard_family",
        "create_catalog_variant",
        "link_official_listing",
        "verify_receipt_mapping",
        "update_representative_image",
      ],
    });
  });

  it("builds a link-only content target without inventing a Coupang offer", async () => {
    const identity = await buildLinkOnlyRegistrationIdentity({
      caseId: "case-baskin-shooting-star",
      receipt: {
        receiptId: "2026-07-14_001",
        receiptItemId: "line_1ea9661b10453b6f",
        receiptRevision: "revision-shooting-star",
        sourceCatalogNamespace: "korean-military-px",
        sourceLabel: "와마트 일산점",
        sourceProductCode: "260399",
        sourceNameRaw: "슈팅스타 프리팩",
        observedAt: "2026-07-14T00:00:00+09:00",
        unitPriceKrw: 1_650,
        quantity: 4,
      },
      officialListing: {
        channelId: "korean-military-px",
        sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
        sourceProductCode: "37174",
        snapshotId: "1ce9706a-1ea4-45db-ac72-ed3414a955b0",
        snapshotHash: `sha256:${"2".repeat(64)}`,
        sourceNameRaw: "슈팅스타 프리팩",
        specificationTextRaw: "100ml",
        officialPrice: {
          amountKrw: 1_650,
          sourceText: "1,650원",
          observedAt: "2026-07-30T14:02:27.744Z",
        },
        sourceRefs: ["source-component-3-page-31"],
        image: {
          url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=37174&type=1",
          contentHash: `sha256:${"8".repeat(64)}`,
          mediaType: "image/jpeg",
          byteLength: 98_458,
        },
      },
      assessment: {
        decision: {
          confidence: "high",
          matchedFields: ["sameChannel", "exactName", "officialSpecification"],
          conflictingFields: [],
          missingFields: [],
        },
        evidence: [
          {
            sourceType: "receipt",
            sourceId: "2026-07-14_001:line_1ea9661b10453b6f",
            authority: "transactional",
            url: null,
            capturedAt: "2026-08-04T00:00:00+09:00",
            claims: ["영수증 원문과 merchant SKU"],
            sourceRefs: ["receipt:2026-07-14_001:line_1ea9661b10453b6f"],
          },
          {
            sourceType: "official_channel",
            sourceId: "korean-military-px:welfare.mil.kr:shop:p_code:37174",
            authority: "primary",
            url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=37174&type=1",
            capturedAt: "2026-08-04T00:00:00+09:00",
            claims: ["PX 정확명과 100ml 규격"],
            sourceRefs: ["source-component-3-page-31"],
          },
        ],
        review: {
          verdict: "approve",
          reviewerAgent: "pricetrace_independent_reviewer",
          counterCandidates: ["다른 맛 프리팩"],
          conflicts: [],
          evidenceQuality: "sufficient",
          notes: ["Coupang 가격 관측을 만들지 않습니다."],
        },
      },
      target: {
        standardProductId: null,
        catalogProductId: null,
        standardName: "배스킨라빈스 슈팅스타 프리팩",
        listingName: "배스킨라빈스 슈팅스타 프리팩 100ml",
        brandName: "배스킨라빈스",
        receiptBrandName: null,
        officialBrandName: "배스킨라빈스",
        officialBrandSourceLabel: "baskinrobbins.co.kr",
        productReferenceUrl: "https://www.baskinrobbins.co.kr/menu/view.php?seq=227",
        specificationStatus: "verified",
        contentAmount: 100,
        contentUnit: "ml",
        packageCount: 1,
        referenceUnit: 100,
        apparelSize: null,
        representativeImageAction: "create",
        representativeImageExpectedCurrent: null,
      },
    });

    expect(JSON.parse(identity.targetCanonicalJson)).toMatchObject({
      executionMode: "link_only_v1",
      coupangOffer: null,
      officialSpecificationCheck: {
        kind: "content",
        parsedContentAmount: 100,
        parsedContentUnit: "ml",
        parsedPackageCount: 1,
        packageCountBasis: "default_one_absent_count",
      },
      normalizedIdentity: {
        contentAmount: 100,
        contentUnit: "ml",
        packageCount: 1,
        apparelSize: null,
      },
      plannedEffects: [
        "create_standard_family",
        "create_catalog_variant",
        "link_official_listing",
        "verify_receipt_mapping",
        "update_representative_image",
      ],
    });
  });

  it("builds a typed wiper fitment without treating blade length as content", async () => {
    const identity = await buildLinkOnlyRegistrationIdentity({
      caseId: "case-rainok-400",
      receipt: {
        receiptId: "2026-07-14_001",
        receiptItemId: "line-rainok",
        receiptRevision: "revision-rainok",
        sourceCatalogNamespace: "korean-military-px",
        sourceLabel: "와마트 일산점",
        sourceProductCode: "260621",
        sourceNameRaw: "RainOK 메탈 그래핀 하이브리드 와이퍼",
        observedAt: "2026-07-14T00:00:00+09:00",
        unitPriceKrw: 9_600,
        quantity: 1,
      },
      officialListing: {
        channelId: "korean-military-px",
        sourceProductCodeNamespace: "welfare.mil.kr:shop:p_code",
        sourceProductCode: "37602",
        snapshotId: "11111111-1111-4111-8111-111111111111",
        snapshotHash: `sha256:${"1".repeat(64)}`,
        sourceNameRaw: "RainOK 메탈 그래핀 하이브리드 와이퍼",
        specificationTextRaw: "400mm",
        sourceRefs: ["source-component-3-page-1"],
        image: {
          url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=37602&type=1",
          contentHash: `sha256:${"2".repeat(64)}`,
          mediaType: "image/jpeg",
          byteLength: 33_782,
        },
      },
      assessment: {
        decision: { confidence: "high", matchedFields: ["model", "lengthMm"], conflictingFields: [], missingFields: [] },
        evidence: [
          { sourceType: "receipt", sourceId: "2026-07-14_001:line-rainok", authority: "transactional", url: null, capturedAt: "2026-08-05T00:00:00+09:00", claims: ["영수증 상품"], sourceRefs: ["receipt:rainok"] },
          { sourceType: "official_channel", sourceId: "korean-military-px:welfare.mil.kr:shop:p_code:37602", authority: "primary", url: "https://www.welfare.mil.kr/shop/imgView.do?p_code=37602&type=1", capturedAt: "2026-08-05T00:00:00+09:00", claims: ["400mm 공식 규격"], sourceRefs: ["source-component-3-page-1"] },
        ],
        review: { verdict: "approve", reviewerAgent: "pricetrace_independent_reviewer", counterCandidates: [], conflicts: [], evidenceQuality: "sufficient", notes: [] },
      },
      target: {
        standardProductId: null,
        catalogProductId: null,
        standardName: "RainOK 메탈 그래핀 하이브리드 와이퍼",
        listingName: "RainOK 메탈 그래핀 하이브리드 와이퍼 400mm",
        brandName: "불스원",
        receiptBrandName: null,
        officialBrandName: "불스원",
        officialBrandSourceLabel: "bullsonemall.com",
        productReferenceUrl: "https://m.bullsonemall.com/store/product.detail.oz?cataIdx=60000064&pdtIdx=87",
        specificationStatus: "verified",
        contentAmount: 1,
        contentUnit: "each",
        packageCount: 1,
        referenceUnit: 100,
        apparelSize: null,
        wiperBladeFitment: { lengthMm: 400 },
        representativeImageAction: "create",
        representativeImageExpectedCurrent: null,
      },
    });

    expect(JSON.parse(identity.targetCanonicalJson)).toMatchObject({
      officialSpecificationCheck: {
        kind: "wiper_blade_fitment",
        parsedWiperBladeFitment: { lengthMm: 400 },
      },
      normalizedIdentity: {
        contentAmount: 1,
        contentUnit: "each",
        packageCount: 1,
        wiperBladeFitment: { lengthMm: 400 },
      },
    });
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
