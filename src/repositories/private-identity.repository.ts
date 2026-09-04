import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PrivateIdentityReadSchema,
  type PrivateIdentityRead,
  type PrivateIdentitySelector,
} from "../domain/private-identity-read";

function errorMessage(error: { message?: string } | null) {
  return error?.message?.trim() || "PriceTrace private identity 정보를 불러오지 못했습니다.";
}

export class PrivateIdentityRepository {
  constructor(private readonly client: SupabaseClient) {}

  async read(selector: PrivateIdentitySelector): Promise<PrivateIdentityRead> {
    const { data, error } = await this.client.rpc("get_authenticated_identity_detail_v1", {
      p_store_id: selector.type === "store" ? selector.id : null,
      p_store_product_id: selector.type === "store_product" ? selector.id : null,
      p_restaurant_menu_id: selector.type === "restaurant_menu" ? selector.id : null,
      p_catalog_product_id: selector.type === "catalog_product" ? selector.id : null,
    });
    if (error) throw new Error(errorMessage(error));

    const payload = PrivateIdentityReadSchema.parse(data);
    if (payload.selector.type !== selector.type || payload.selector.id !== selector.id) {
      throw new Error("private identity RPC가 요청하지 않은 identity를 반환했습니다.");
    }
    return payload;
  }
}
