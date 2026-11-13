import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { carePlaceInputSchema, carePlaceSchema, type CarePlaceInput } from "@/domain/care-place";

export class CarePlaceRepository {
  constructor(private readonly client: SupabaseClient) {}
  async search(query = "", category?: string, limit = 30) {
    const { data, error } = await this.client.rpc("search_care_places_v1", {
      p_query: query.trim(), p_category: category || null, p_limit: limit,
    });
    if (error) throw new Error("병원·약국을 불러오지 못했습니다. 잠시 후 다시 시도하세요.");
    return z.array(carePlaceSchema).parse(data);
  }
  async register(requestId: string, input: CarePlaceInput, confirmed: boolean) {
    if (!confirmed) throw new Error("공유할 기관 정보를 확인하세요.");
    const { data: auth, error: authError } = await this.client.auth.getUser();
    if (authError || !auth.user) throw new Error("기관 등록에는 로그인이 필요합니다.");
    const owner = auth.user.id;
    const { data, error } = await this.client.rpc("register_care_place_v1", {
      p_request_id: requestId, p_place: carePlaceInputSchema.parse(input), p_public_confirmed: confirmed,
    });
    if (error) throw new Error("기관을 등록하지 못했습니다. 입력을 유지했으니 다시 시도하세요.");
    const current = await this.client.auth.getSession();
    if (current.data.session?.user.id !== owner) throw new Error("계정이 바뀌었습니다. 다시 로그인해 목록을 확인하세요.");
    return z.object({ place: carePlaceSchema, duplicate: z.boolean() }).parse(data);
  }
}
