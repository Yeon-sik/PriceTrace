import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type Product = Pick<Database["public"]["Tables"]["product_identity_candidates"]["Row"],
  "id" | "client_key" | "product_name" | "brand" | "specification">;

type SearchResult = {
  key: string;
  status: "loading" | "ready" | "error";
  products: Product[];
};

export function useOwnerOcrProductSearch(query: string, authRevision: number) {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const key = `${authRevision}:${retryRevision}:${query}`;

  useEffect(() => {
    if (!query) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;

    const controller = new AbortController();
    const { signal } = controller;
    const search = async () => {
      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session || signal.aborted) return;

      setResult({ key, status: "loading", products: [] });
      const { data, error } = await client.from("product_identity_candidates")
        .select("id,client_key,product_name,brand,specification")
        .eq("user_id", session.user.id)
        .eq("candidate_type", "retail_product")
        .neq("review_status", "rejected")
        .ilike("product_name", `%${query}%`)
        .order("created_at", { ascending: false })
        .limit(20)
        .abortSignal(signal);
      if (error) throw error;
      if (!signal.aborted) setResult({ key, status: "ready", products: data ?? [] });
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
