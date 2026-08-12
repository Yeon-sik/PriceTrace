"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RestaurantMenuReadV1 } from "../../domain/restaurant-menu";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { RestaurantMenuRepository } from "../../repositories/restaurant-menu.repository";

export function useRestaurantMenuCatalog() {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(
    () => client ? new RestaurantMenuRepository(client) : null,
    [client],
  );
  const [payload, setPayload] = useState<RestaurantMenuReadV1 | null>(null);
  const [loading, setLoading] = useState(Boolean(repository));
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    if (!repository) {
      setPayload(null);
      setLoading(false);
      setError("");
      return () => { active = false; };
    }

    setLoading(true);
    setError("");
    void repository.read({ limit: 200 }).then((nextPayload) => {
      if (active) setPayload(nextPayload);
    }).catch((reason: unknown) => {
      if (!active) return;
      setPayload(null);
      setError(reason instanceof Error ? reason.message : "음식점 메뉴 정보를 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [reloadToken, repository]);

  return {
    configured: repository !== null,
    payload,
    loading,
    error,
    refresh,
  };
}
