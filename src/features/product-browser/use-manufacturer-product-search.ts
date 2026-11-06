import { useEffect, useState } from "react";
import { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const resultSchema = z.array(z.object({
  catalog_product_id: z.string().uuid(),
  product_name: z.string().min(1),
  brand_name: z.string().nullable(),
  specification: z.string().min(1),
  manufacturer_sku: z.string().min(1),
  manufacturer_url: z.string().url().startsWith("https://"),
}));
export type ManufacturerCatalogProduct = z.infer<typeof resultSchema>[number];

type SearchResult = {
  key: string;
  status: "ready" | "error";
  products: ManufacturerCatalogProduct[];
};

export function useManufacturerProductSearch(query: string) {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const key = `${retryRevision}:${query}`;

  useEffect(() => {
    if (!query) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    const search = async () => {
      const { data, error } = await client.rpc("search_public_manufacturer_products_v1", {
        p_query: query, p_limit: 20,
      }).abortSignal(signal);
      if (signal.aborted) return;
      if (error) throw error;
      setResult({ key, status: "ready", products: resultSchema.parse(data) });
    };
    const timer = window.setTimeout(() => {
      void search().catch(() => {
        if (!signal.aborted) setResult({ key, status: "error", products: [] });
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, key]);

  return {
    result: result?.key === key ? result : null,
    retry: () => setRetryRevision((revision) => revision + 1),
  };
}
