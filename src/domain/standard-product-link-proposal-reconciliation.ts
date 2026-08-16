import {
  normalizeStandardProductNameForUniqueness,
  type ReviewedLinkProposal,
} from "./standard-product-registration";
import { PX_CATALOG_NAMESPACE } from "./standard-product-connection-queue";

export type RegisteredSourceMapping = {
  sourceLabel: string;
  sourceProductCode: string;
  catalogProductId: string;
};

export type RegisteredCatalogVariant = {
  id: string;
  standardProductId: string;
  canonicalName: string;
  specificationStatus: string;
  contentAmount: number | null;
  contentUnit: string | null;
  packageCount: number;
  referenceUnit: number;
};

export type RegisteredStandardProduct = {
  id: string;
  canonicalName: string;
};

export type ProposalRegistrationReconciliation =
  | { status: "active" }
  | {
    status: "already_registered";
    catalogProductId: string;
    standardProductId: string;
  }
  | {
    status: "mapping_collision";
    catalogProductId: string;
    reason: string;
  };

function exactSourceKey(sourceLabel: string, sourceProductCode: string) {
  return `${sourceLabel.trim().toLocaleLowerCase("ko-KR")}:${sourceProductCode.trim()}`;
}

export function reconcilePxProposalRegistration(
  proposal: ReviewedLinkProposal,
  mappings: RegisteredSourceMapping[],
  variants: RegisteredCatalogVariant[],
  standards: RegisteredStandardProduct[],
): ProposalRegistrationReconciliation {
  if (proposal.receipt.sourceCatalogNamespace !== PX_CATALOG_NAMESPACE) {
    return { status: "active" };
  }
  const expectedSourceKey = exactSourceKey(
    proposal.receipt.sourceLabel,
    proposal.receipt.sourceProductCode,
  );
  const mapping = mappings.find((candidate) => exactSourceKey(
    candidate.sourceLabel,
    candidate.sourceProductCode,
  ) === expectedSourceKey);
  if (!mapping) return { status: "active" };

  const expectedCatalogProductId = proposal.executionTarget.decision.catalogProductId;
  if (expectedCatalogProductId) {
    return expectedCatalogProductId === mapping.catalogProductId
      ? {
        status: "already_registered",
        catalogProductId: mapping.catalogProductId,
        standardProductId: proposal.executionTarget.decision.standardProductId!,
      }
      : {
        status: "mapping_collision",
        catalogProductId: mapping.catalogProductId,
        reason: "현재 판매처 매핑이 제안서의 기존 판매 규격 ID와 다릅니다.",
      };
  }

  const variant = variants.find((candidate) => candidate.id === mapping.catalogProductId);
  if (!variant) {
    return {
      status: "mapping_collision",
      catalogProductId: mapping.catalogProductId,
      reason: "현재 판매처 매핑의 활성 판매 규격을 찾을 수 없습니다.",
    };
  }
  const standard = standards.find((candidate) => candidate.id === variant.standardProductId);
  if (!standard) {
    return {
      status: "mapping_collision",
      catalogProductId: mapping.catalogProductId,
      reason: "현재 판매 규격의 활성 표준 상품을 찾을 수 없습니다.",
    };
  }
  const target = proposal.executionTarget;
  const identity = target.normalizedIdentity;
  const matchesExpectedStandardId = !target.decision.standardProductId
    || target.decision.standardProductId === standard.id;
  const matchesTarget = matchesExpectedStandardId
    && normalizeStandardProductNameForUniqueness(standard.canonicalName)
      === normalizeStandardProductNameForUniqueness(identity.productFamilyName)
    && normalizeStandardProductNameForUniqueness(variant.canonicalName)
      === normalizeStandardProductNameForUniqueness(identity.variantName)
    && variant.specificationStatus === identity.specificationStatus
    && variant.contentAmount === identity.contentAmount
    && variant.contentUnit === identity.contentUnit
    && variant.packageCount === identity.packageCount
    && variant.referenceUnit === identity.referenceUnit;
  return matchesTarget
    ? {
      status: "already_registered",
      catalogProductId: variant.id,
      standardProductId: standard.id,
    }
    : {
      status: "mapping_collision",
      catalogProductId: mapping.catalogProductId,
      reason: "현재 판매처 매핑의 표준 상품 또는 정확한 판매 규격이 제안 대상과 다릅니다.",
    };
}
