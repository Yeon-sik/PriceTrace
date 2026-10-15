import type { SupabaseClient } from "@supabase/supabase-js";
import { OwnerConfirmedRestaurantReadSchema, type OwnerConfirmedRestaurantRead } from "../domain/owner-confirmed-restaurant";

export class OwnerConfirmedRestaurantRepository {
  constructor(private readonly client: SupabaseClient) {}

  async load(): Promise<OwnerConfirmedRestaurantRead | null> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return null;
    const ownerId = data.user.id;
    let result = await this.client.rpc("get_my_owner_confirmed_restaurants_v2");
    if (result.error?.code === "PGRST202") result = await this.client.rpc("get_my_owner_confirmed_restaurants_v1");
    if (result.error) throw new Error("내 확인 식당을 불러오지 못했습니다. 다시 시도해 주세요.");
    const read = OwnerConfirmedRestaurantReadSchema.parse(result.data);
    if (read.ownerId !== ownerId) throw new Error("로그인 계정과 식당 기록의 소유자가 다릅니다.");
    return read;
  }
}
