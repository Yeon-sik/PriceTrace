import { useEffect, useState } from "react";
import { z } from "zod";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const amount = z.number().int().nonnegative().nullable();
const purchaseSchema = z.object({
  purchase_source_line_id: z.string().uuid(),
  catalog_product_id: z.string().uuid().nullable(),
  product_client_key: z.string().nullable(),
  product_name: z.string(),
  option_text: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  platform_name: z.string(),
  seller_name: z.string().nullable(),
  ordered_on: z.string().nullable(),
  paid_on: z.string().nullable(),
  unit_price_krw: amount,
  item_net_price_krw: amount,
  order_total_krw: amount,
  order_line_count: z.number().int().positive(),
  owner_connected: z.boolean(),
});
export type CatalogPurchaseContext = z.infer<typeof purchaseSchema>;

type PurchaseResult = {
  key: string;
  status: "guest" | "ready" | "error";
  rows: CatalogPurchaseContext[];
};

export function useCatalogPurchaseContext(catalogIds: readonly string[], query: string | null, authRevision: number) {
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const ids = catalogIds.join(",");
  const key = JSON.stringify([ids, query, authRevision]);

  useEffect(() => {
    if (!ids || query === "") return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const controller = new AbortController();
    const { signal } = controller;
    const load = async () => {
      const { data: auth, error: authError } = await client.auth.getSession();
      if (signal.aborted) return;
      if (authError) throw authError;
      if (!auth.session) {
        setResult({ key, status: "guest", rows: [] });
        return;
      }
      const { data, error } = await client.rpc("get_my_catalog_purchase_context_v1", {
        p_catalog_product_ids: ids.split(","), p_query: query,
      }).abortSignal(signal);
      if (signal.aborted) return;
      if (error) throw error;
      setResult({ key, status: "ready", rows: purchaseSchema.array().parse(data) });
    };
    const timer = window.setTimeout(() => {
      void load().catch(() => {
        if (!signal.aborted) setResult({ key, status: "error", rows: [] });
      });
    }, query === null ? 0 : 250);
    const refresh = () => setRetryRevision((revision) => revision + 1);
    if (query === null) window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ids, key, query, retryRevision]);

  return {
    result: result?.key === key ? result : null,
    retry: () => setRetryRevision((revision) => revision + 1),
  };
}

export async function setCatalogPurchaseLink(catalogId: string, lineId: string, connected: boolean) {
  const client = getSupabaseBrowserClient();
  if (!client) throw new Error("PriceTrace 연결 설정이 필요합니다.");
  const { data, error } = await client.rpc("set_my_catalog_purchase_link_v1", {
    p_catalog_product_id: catalogId, p_purchase_source_line_id: lineId, p_connected: connected,
  });
  if (error || data !== connected) {
    throw new Error(error?.code === "23505" ? "이미 다른 상품에 연결된 구매입니다." : "구매 연결을 저장하지 못했습니다.");
  }
}
