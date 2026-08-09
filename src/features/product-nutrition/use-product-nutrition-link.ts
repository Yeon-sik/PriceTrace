"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildProductNutritionProposalRequest,
  buildProductNutritionProposalRequestFromEvidence,
  productNutritionLinkIdentityKey,
  type NutritionFood,
  type ProductNutritionLink,
  type ProductNutritionLinkState,
} from "../../domain/product-nutrition-link";
import type { ProductReadProduct } from "../../domain/product-read";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { getNutritionSupabaseBrowserClient } from "../../lib/supabase/nutrition-client";
import { NutritionCatalogRepository } from "../../repositories/nutrition-catalog.repository";
import { ProductReadRepository } from "../../repositories/product-read.repository";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function useProductNutritionLink({
  catalogProductId,
  candidateName,
}: {
  catalogProductId: string;
  candidateName: string;
}) {
  const productClient = getSupabaseBrowserClient();
  const nutritionClient = getNutritionSupabaseBrowserClient();
  const productRepository = useMemo(
    () => productClient ? new ProductReadRepository(productClient) : null,
    [productClient],
  );
  const nutritionRepository = useMemo(
    () => nutritionClient ? new NutritionCatalogRepository(nutritionClient) : null,
    [nutritionClient],
  );

  const [product, setProduct] = useState<ProductReadProduct | null>(null);
  const [productError, setProductError] = useState("");
  const [linkState, setLinkState] = useState<ProductNutritionLinkState | null>(null);
  const [linkError, setLinkError] = useState("");
  const [foods, setFoods] = useState<NutritionFood[]>([]);
  const [searchError, setSearchError] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [submittingIdentityKey, setSubmittingIdentityKey] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let active = true;
    setProduct(null);
    setProductError("");
    setLinkState(null);
    setLinkError("");
    setFoods([]);
    setSearchError("");
    setActionMessage("");
    setActionError("");
    setLoading(true);

    const tasks: Promise<void>[] = [];

    if (productRepository) {
      tasks.push(productRepository.readExactProduct(catalogProductId)
        .then((result) => {
          if (!active) return;
          if (!result) {
            setProductError("PriceTrace product-read.v1에 선택한 정확 규격이 없습니다.");
            return;
          }
          setProduct(result);
        })
        .catch((error) => {
          if (active) setProductError(errorMessage(error, "PriceTrace 상품 revision을 불러오지 못했습니다."));
        }));
    } else {
      setProductError("PriceTrace Supabase 공개 연결이 설정되지 않았습니다.");
    }

    if (nutritionRepository) {
      tasks.push(nutritionRepository.readLinkState(catalogProductId)
        .then((state) => { if (active) setLinkState(state); })
        .catch((error) => {
          if (active) setLinkError(errorMessage(error, "Nutrition 링크 상태를 불러오지 못했습니다."));
        }));
      tasks.push(nutritionRepository.searchPublicFoods(candidateName)
        .then((results) => { if (active) setFoods(results); })
        .catch((error) => {
          if (active) setSearchError(errorMessage(error, "Fitness 공개 영양을 검색하지 못했습니다."));
        }));
    } else {
      setLinkError("Fitness Nutrition 공개 연결이 설정되지 않았습니다.");
      setSearchError("Fitness Nutrition 공개 연결이 설정되지 않았습니다.");
    }

    void Promise.allSettled(tasks).then(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [candidateName, catalogProductId, nutritionRepository, productRepository]);

  const search = useCallback(async (query: string) => {
    if (!nutritionRepository) {
      setSearchError("Fitness Nutrition 공개 연결이 설정되지 않았습니다.");
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      setFoods(await nutritionRepository.searchPublicFoods(query));
    } catch (error) {
      setSearchError(errorMessage(error, "Fitness 공개 영양을 검색하지 못했습니다."));
    } finally {
      setSearching(false);
    }
  }, [nutritionRepository]);

  const storeProposal = useCallback(async (
    request: ReturnType<typeof buildProductNutritionProposalRequest>,
  ) => {
    if (!nutritionRepository) {
      setActionError("Fitness Nutrition 공개 연결이 설정되지 않았습니다.");
      return;
    }
    const identityKey = productNutritionLinkIdentityKey(request.identity);
    setSubmittingIdentityKey(identityKey);
    setActionError("");
    setActionMessage("");
    try {
      const proposal = await nutritionRepository.propose(request);
      setActionMessage(
        proposal.action === "link"
          ? "연결 제안을 Nutrition 승인 대기열에 저장했습니다."
          : "연결 해제 제안을 Nutrition 승인 대기열에 저장했습니다.",
      );
      setLinkState((current) => current ? {
        ...current,
        pendingProposals: [
          proposal,
          ...current.pendingProposals.filter((item) => item.id !== proposal.id),
        ],
      } : current);
      try {
        setLinkState(await nutritionRepository.readLinkState(request.identity.catalogProductId));
        setLinkError("");
      } catch (refreshError) {
        setLinkError(errorMessage(refreshError, "저장 후 Nutrition 링크 상태를 다시 확인하지 못했습니다."));
      }
    } catch (error) {
      setActionError(errorMessage(error, "Nutrition 연결 제안을 저장하지 못했습니다."));
    } finally {
      setSubmittingIdentityKey("");
    }
  }, [nutritionRepository]);

  const proposeLink = useCallback(async (nutritionFood: NutritionFood) => {
    if (!product) {
      setActionError("정확 ID와 revision을 확인할 때까지 연결을 제안할 수 없습니다.");
      return;
    }
    await storeProposal(buildProductNutritionProposalRequest({
      action: "link",
      product,
      nutritionFood,
    }));
  }, [product, storeProposal]);

  const proposeUnlink = useCallback(async (link: ProductNutritionLink) => {
    if (!product) {
      setActionError("정확 ID와 revision을 확인할 때까지 연결 해제를 제안할 수 없습니다.");
      return;
    }
    await storeProposal(buildProductNutritionProposalRequestFromEvidence({
      action: "unlink",
      product,
      nutritionFoodId: link.identity.nutritionFoodId,
      candidateEvidence: link.candidateEvidence,
    }));
  }, [product, storeProposal]);

  return {
    nutritionConfigured: Boolean(nutritionRepository),
    product,
    productError,
    linkState,
    linkError,
    foods,
    searchError,
    loading,
    searching,
    submittingIdentityKey,
    actionMessage,
    actionError,
    search,
    proposeLink,
    proposeUnlink,
  };
}
