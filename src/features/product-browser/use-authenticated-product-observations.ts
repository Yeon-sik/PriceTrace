"use client";
import { useEffect, useState } from "react";
import type { ProductObservationListing } from "../../domain/product-browser";
import { getSupabaseBrowserClient } from "../../lib/supabase/client";
import { AuthenticatedProductObservationRepository } from "../../repositories/authenticated-product-observation.repository";

export function useAuthenticatedProductObservations(authRevision: number, page: string) {
  const [observations, setObservations] = useState<ProductObservationListing[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const client = getSupabaseBrowserClient();
    setObservations([]);
    setError("");
    if (!client) return;
    const repository = new AuthenticatedProductObservationRepository(client);
    let requestId = 0;
    const load = () => { const current = ++requestId; void repository.load().then((rows) => {
      if (active && current === requestId) { setObservations(rows); setError(""); }
    }).catch((cause: unknown) => {
      if (active && current === requestId) setError(cause instanceof Error ? cause.message : "내 구매 상품을 불러오지 못했습니다.");
    }); };
    load();
    window.addEventListener("focus", load);
    return () => { active = false; window.removeEventListener("focus", load); };
  }, [authRevision, page]);
  return { observations, error };
}
