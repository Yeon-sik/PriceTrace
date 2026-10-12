"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { RestaurantMenuRepository } from "../../repositories/restaurant-menu.repository";
import { AuthenticatedRestaurantObservationRepository, attachOwnerRestaurantLatest, attachOwnerRestaurantPrices } from "../../repositories/authenticated-restaurant-observation.repository";

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
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      setDirectory(null); setDetail(null); refresh();
    });
    window.addEventListener("focus", refresh);
    return () => { data.subscription.unsubscribe(); window.removeEventListener("focus", refresh); };
  }, [client, refresh]);

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
    void Promise.all([repository.readDirectory({ limit: 200 }),
      new AuthenticatedRestaurantObservationRepository(client!).load()]).then(([nextDirectory, rows]) => {
      if (active) setDirectory(attachOwnerRestaurantLatest(nextDirectory, rows));
    }).catch((reason: unknown) => {
      if (!active) return;
      setDirectory(null);
      setError(reason instanceof Error ? reason.message : "음식점 메뉴 정보를 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [client, reloadToken, repository]);

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
    void Promise.all([repository.readDetail(selectedRestaurant),
      new AuthenticatedRestaurantObservationRepository(client!).load(selectedRestaurant)]).then(([nextDetail, rows]) => {
      if (active) setDetail(attachOwnerRestaurantPrices(nextDetail, rows));
    }).catch((reason: unknown) => {
      if (!active) return;
      setDetail(null);
      setDetailError(reason instanceof Error ? reason.message : "음식점 상세 정보를 불러오지 못했습니다.");
    }).finally(() => {
      if (active) setDetailLoading(false);
    });

    return () => { active = false; };
  }, [client, reloadToken, repository, selectedRestaurant]);

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
