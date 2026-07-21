import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SearchInput = { storeProductCode?: unknown; productName?: unknown; storeLabel?: unknown };
type BraveResult = { title?: string; url?: string; description?: string; profile?: { long_name?: string } };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "authentication_required" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !publishableKey) return json({ error: "supabase_configuration_missing" }, 500);
  const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } });
  const { data: userResult } = await userClient.auth.getUser();
  if (!userResult.user) return json({ error: "authentication_required" }, 401);

  const input = await request.json().catch(() => null) as SearchInput | null;
  const productName = typeof input?.productName === "string" ? input.productName.trim().slice(0, 160) : "";
  const storeProductCode = typeof input?.storeProductCode === "string" ? input.storeProductCode.trim().slice(0, 80) : "";
  if (!productName || !storeProductCode) return json({ error: "invalid_product_input" }, 400);

  const token = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!token) return json({ error: "search_provider_not_configured" }, 503);
  const query = `${productName} ${storeProductCode} 공식 상품`;
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", "5");
  endpoint.searchParams.set("safesearch", "strict");
  const response = await fetch(endpoint, { headers: { "Accept": "application/json", "X-Subscription-Token": token } });
  if (!response.ok) return json({ error: "search_provider_error" }, 502);
  const payload = await response.json() as { web?: { results?: BraveResult[] } };
  const results = (payload.web?.results ?? [])
    .filter((item) => typeof item.title === "string" && typeof item.url === "string" && item.url.startsWith("https://"))
    .map((item) => ({
      officialName: item.title!,
      officialUrl: item.url!,
      sourceName: item.profile?.long_name ?? new URL(item.url!).hostname,
      description: item.description,
    }));
  return json({ query, results });
});
