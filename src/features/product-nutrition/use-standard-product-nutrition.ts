"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type NutritionFood,
} from "../../domain/product-nutrition-link";
import { getNutritionSupabasePublicBrowserClient } from "../../lib/supabase/nutrition-client";
import { NutritionCatalogRepository } from "../../repositories/nutrition-catalog.repository";

export function useStandardProductNutrition(catalogProductIds: readonly string[]) {
  const nutritionClient = getNutritionSupabasePublicBrowserClient();
  const nutritionRepository = useMemo(
    () => nutritionClient ? new NutritionCatalogRepository(nutritionClient) : null,
    [nutritionClient],
  );
  const normalizedCatalogProductIds = useMemo(
    () => [...new Set(catalogProductIds)].sort(),
    [catalogProductIds],
  );
  const catalogProductIdsKey = normalizedCatalogProductIds.join("|");
  const [foods, setFoods] = useState<NutritionFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [requestRevision, setRequestRevision] = useState(0);
  const retry = useCallback(() => setRequestRevision((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    setFoods([]);
    setError("");
    setWarning("");

    if (normalizedCatalogProductIds.length === 0) {
      setLoading(false);
      return () => { active = false; };
    }

    if (!nutritionRepository) {
      setLoading(false);
      setError("Fitness Nutrition 공개 연결이 설정되지 않았습니다.");
      return () => { active = false; };
    }

    setLoading(true);
    void Promise.allSettled(
      normalizedCatalogProductIds.map((catalogProductId) => (
        nutritionRepository.readPublicFoods(catalogProductId)
      )),
    ).then((results) => {
      if (!active) return;
      const publishedFoods = results.flatMap<NutritionFood>((result) => (
        result.status === "fulfilled" ? result.value : []
      ));
      const failures = results.filter((result) => result.status === "rejected");

      if (publishedFoods.length === 0 && failures.length > 0) {
        setError("영양 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      } else {
        const foodsById = new Map<string, NutritionFood>();
        for (const food of publishedFoods) {
          const current = foodsById.get(food.id);
          if (!current || food.revision > current.revision) foodsById.set(food.id, food);
        }
        setFoods([...foodsById.values()].sort((left, right) => (
          left.name.localeCompare(right.name, "ko-KR") || left.id.localeCompare(right.id)
        )));
        if (failures.length > 0) {
          setWarning("일부 공개 영양정보를 불러오지 못했습니다.");
        }
      }
      setLoading(false);
    });

    return () => { active = false; };
  }, [catalogProductIdsKey, normalizedCatalogProductIds, nutritionRepository, requestRevision]);

  return { foods, loading, error, warning, retry };
}
