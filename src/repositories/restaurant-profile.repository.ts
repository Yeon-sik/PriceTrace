import type { SupabaseClient } from "@supabase/supabase-js";

function remoteErrorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

export class RestaurantProfileRepository {
  constructor(private readonly client: SupabaseClient) {}

  async read(): Promise<unknown> {
    const { data, error } = await this.client.rpc("get_restaurant_profile_v1");
    if (error) {
      if (error.message?.toLowerCase().includes("jwt issued at future")) {
        throw new Error("시스템 시간이 Supabase 서버보다 느려 인증 토큰이 아직 미래로 인식되었습니다. FitnessApp의 식당·메뉴 공개 상태 문제는 아닙니다.");
      }
      throw new Error(remoteErrorMessage(error, "음식점 프로필을 불러오지 못했습니다."));
    }
    return data;
  }
}
