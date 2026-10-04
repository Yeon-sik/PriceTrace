"use client";

import { useCallback, useEffect, useState } from "react";
import { seededOfficialProducts, type OfficialProductRecord } from "../../domain/official-product";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { OfficialProductRepository } from "../../repositories/official-product.repository";
import {
  emptyProductCatalog,
  ProductCatalogRepository,
  type ProductCatalogSnapshot,
} from "../../repositories/product-catalog.repository";

const officialProductRepository = new OfficialProductRepository();

type CatalogState = {
  publicCatalog: ProductCatalogSnapshot;
  catalog: ProductCatalogSnapshot;
  ownerId: string | null;
  authRevision: number;
  status: "loading" | "ready" | "error";
};

export function useProductCatalog(authRevision: number) {
  const client = getSupabaseBrowserClient();
  const [officialProducts, setOfficialProducts] = useState<Record<string, OfficialProductRecord>>(seededOfficialProducts);
  const [retryRevision, setRetryRevision] = useState(0);
  const [state, setState] = useState<CatalogState>(() => {
    const publicCatalog = emptyProductCatalog();
    return { publicCatalog, catalog: publicCatalog, ownerId: null, authRevision, status: "loading" };
  });
  const retryCatalog = useCallback(() => setRetryRevision((revision) => revision + 1), []);

  useEffect(() => {
    setOfficialProducts({ ...seededOfficialProducts, ...officialProductRepository.loadAll() });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let ownerId: string | null | undefined;
    setState((previous) => ({ ...previous, status: "loading" }));
    if (!client) {
      setState((previous) => ({ ...previous, authRevision, catalog: previous.publicCatalog, status: "error" }));
      return () => controller.abort();
    }

    const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
      const nextOwnerId = session?.user.id ?? null;
      if (event === "INITIAL_SESSION" && ownerId === undefined) {
        ownerId = nextOwnerId;
        return;
      }
      if (nextOwnerId === ownerId) return;
      // Discard signed-in enrichment immediately, even before the caller updates authRevision.
      controller.abort();
      setState((previous) => ({
        ...previous, catalog: previous.publicCatalog, ownerId: nextOwnerId, status: "loading",
      }));
      retryCatalog();
    });

    const load = async () => {
      try {
        const { data, error } = await client.auth.getUser();
        signal.throwIfAborted();
        if (error && error.name !== "AuthSessionMissingError") throw error;
        const authenticatedOwnerId = data.user?.id ?? null;
        if (ownerId !== undefined && ownerId !== authenticatedOwnerId) {
          controller.abort();
          retryCatalog();
          return;
        }
        ownerId = authenticatedOwnerId;
        setState((previous) => ({
          ...previous, authRevision, ownerId: authenticatedOwnerId,
          catalog: previous.ownerId === authenticatedOwnerId ? previous.catalog : previous.publicCatalog,
          status: "loading",
        }));
        const result = await new ProductCatalogRepository(client).load(authenticatedOwnerId, signal);
        signal.throwIfAborted();
        setState({ ...result, ownerId: authenticatedOwnerId, authRevision, status: "ready" });
      } catch {
        if (signal.aborted) return;
        // No partial snapshot is published; a same-account retry keeps all last good data.
        setState((previous) => ({
          ...previous, authRevision,
          catalog: previous.authRevision === authRevision ? previous.catalog : previous.publicCatalog,
          status: "error",
        }));
        controller.abort();
      }
    };
    void load();
    return () => {
      controller.abort();
      authListener.subscription.unsubscribe();
    };
  }, [authRevision, client, retryRevision, retryCatalog]);

  const currentRevision = state.authRevision === authRevision;
  return {
    officialProducts,
    ...(currentRevision ? state.catalog : state.publicCatalog),
    catalogLoading: !currentRevision || state.status === "loading",
    catalogNotice: currentRevision && state.status === "error"
      ? "상품 카탈로그를 모두 불러오지 못했습니다. 다시 불러와 주세요."
      : "",
    retryCatalog,
  };
}
