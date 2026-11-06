"use client";
import { useEffect, useState } from "react";
import type { ProductObservationListing } from "@/domain/product-browser";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { PublicPriceObservationRepository } from "@/repositories/public-price-observation.repository";
export function usePublicPriceObservations(page: string) {
  const [observations, setObservations] = useState<ProductObservationListing[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true; let request = 0;
    const client = getSupabaseBrowserClient(); if (!client) return;
    const repository = new PublicPriceObservationRepository(client);
    const load = () => { const version = ++request; void repository.load().then(rows => { if (active && version === request) { setObservations(rows); setError(""); } })
      .catch(cause => { if (active && version === request) setError(cause instanceof Error ? cause.message : "공개 관측 불러오기 실패"); }); };
    load(); window.addEventListener("focus", load); window.addEventListener("pricetrace-information-applied", load);
    return () => { active = false; window.removeEventListener("focus", load); window.removeEventListener("pricetrace-information-applied", load); };
  }, [page]);
  return { observations, error };
}
