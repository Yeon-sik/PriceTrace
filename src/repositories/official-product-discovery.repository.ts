import type { OfficialProductCandidate, OfficialSearchResult } from "@/domain/official-product";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type RemoteDiscoveryResponse =
  | { status: "configured"; results: OfficialSearchResult[] }
  | { status: "unavailable"; message: string };

export class OfficialProductDiscoveryRepository {
  async search(candidate: OfficialProductCandidate): Promise<RemoteDiscoveryResponse> {
    const client = getSupabaseBrowserClient();
    if (!client) return { status: "unavailable", message: "공식 검색 서비스가 아직 설정되지 않았습니다." };
    const { data: userResult, error: userError } = await client.auth.getUser();
    if (userError || !userResult.user) return { status: "unavailable", message: "공식 상품 자동 탐색은 로그인 후 사용할 수 있습니다." };
    const { data, error } = await client.functions.invoke("official-product-search", { body: candidate });
    if (error) return { status: "unavailable", message: "공식 상품 검색 서비스를 불러오지 못했습니다." };
    const parsed = data as { results?: OfficialSearchResult[] } | null;
    return { status: "configured", results: Array.isArray(parsed?.results) ? parsed.results : [] };
  }
}
