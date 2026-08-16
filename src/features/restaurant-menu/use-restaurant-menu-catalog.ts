"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { RestaurantMenuRepository } from "../../repositories/restaurant-menu.repository";

export function useRestaurantMenuCatalog(selectedRestaurant: string | null = null) {
  const client = getSupabaseBrowserClient();
  const repository = useMemo(
    () => client ? new RestaurantMenuRepository(client) : null,
    [client],
  );
  const [directory, setDirectory] = useState<Awaited<ReturnType<RestaurantMenuRepository["readDirectory"]>> | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<RestaurantMenuRepository["readDetail"]>> | null>(null);
  const [loading, setLoading] = useState(Boolean(repository));
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const refresh = useCallback(() => setReloadToken((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    if (!repository) {
      setDirectory(null);
      setLoading(false);
      setError("");
      return () => { active = false; };
    }

    setLoading(true);
    setError("");
    void repository.readDirectory({ limit: 200 }).then((nextDirectory) => {
      if (active) setDirectory(nextDirectory);
    }).catch((reason: unknown) => {
      if (!active) return;
      setDirectory(null);
      setError(reason instanceof Error ? reason.message : "음식점 메뉴 정보를 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [reloadToken, repository]);

  useEffect(() => {
    let active = true;
    if (!repository || !selectedRestaurant) {
      setDetail(null);
      setDetailLoading(false);
      setDetailError("");
      return () => { active = false; };
    }

    setDetailLoading(true);
    setDetailError("");
    void repository.readDetail(selectedRestaurant).then((nextDetail) => {
      if (active) setDetail(nextDetail);
    }).catch((reason: unknown) => {
      if (!active) return;
      setDetail(null);
      setDetailError(reason instanceof Error ? reason.message : "음식점 상세 정보를 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setDetailLoading(false);
    });

    return () => { active = false; };
  }, [reloadToken, repository, selectedRestaurant]);

  return {
    configured: repository !== null,
    directory,
    detail,
    loading,
    detailLoading,
    error,
    detailError,
    refresh,
  };
}
