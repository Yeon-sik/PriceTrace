import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RestaurantDetailV1Schema,
  RestaurantDirectoryV1Schema,
  RestaurantCategoryAssignmentRpcRowSchema,
  RestaurantCategoryNodeRowSchema,
  RestaurantMenuReadV1Schema,
  RestaurantMenuReceiptCandidateSchema,
  RestaurantMenuRegistrationRequestSchema,
  restaurantMenuOptionLinkFromRpc,
  restaurantMenuRegistrationResultFromRpc,
  type RestaurantMenuReadV1,
  type RestaurantMenuReceiptCandidate,
  type RestaurantMenuRegistrationRequest,
  type RestaurantMenuRegistrationResult,
  type RestaurantMenuOptionLink,
  type RestaurantDetailV1,
  type RestaurantDirectoryV1,
  type RestaurantCategoryAssignmentResult,
  type RestaurantCategoryNodeRow,
} from "../domain/restaurant-menu";

function remoteErrorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

function isMissingFunctionError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "PGRST202" || message.includes("could not find the function");
}

function isMissingRelationError(error: { code?: string; message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "PGRST205"
    || error?.code === "42P01"
    || message.includes("could not find the table")
    || (message.includes("relation") && message.includes("does not exist"));
}

function unwrapSingleRow(data: unknown) {
  return Array.isArray(data) && data.length === 1 ? data[0] : data;
}

export class RestaurantMenuRepository {
  constructor(private readonly client: SupabaseClient) {}

  async readDirectory({
    query = null,
    limit = 100,
  }: {
    query?: string | null;
    limit?: number;
  } = {}): Promise<RestaurantDirectoryV1> {
    const v2Result = await this.client.rpc("get_restaurant_directory_v2", {
      p_query: query?.trim() || null,
      p_limit: Math.max(1, Math.min(Math.trunc(limit), 200)),
    });
    const result = v2Result.error && isMissingFunctionError(v2Result.error)
      ? await this.client.rpc("get_restaurant_directory_v1", {
          p_query: query?.trim() || null,
          p_limit: Math.max(1, Math.min(Math.trunc(limit), 200)),
        })
      : v2Result;
    const { data, error } = result;
    if (error) {
      if (isMissingFunctionError(error)) {
        const legacyPayload = await this.read({ query, limit });
        return RestaurantDirectoryV1Schema.parse({
          schemaVersion: "restaurant-directory.v2",
          namespace: "pricetrace",
          revision: legacyPayload.revision,
          restaurants: legacyPayload.restaurants.map((entry) => ({
            revision: entry.revision,
            restaurant: entry.restaurant,
            locations: entry.locations,
            menuCount: entry.menus.length,
            latestObservedAt: entry.menus
              .flatMap((menu) => menu.observations)
              .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || right.id.localeCompare(left.id))[0]
              ?.observedAt ?? null,
          })),
        });
      }
      throw new Error(remoteErrorMessage(error, "음식점 목록을 불러오지 못했습니다."));
    }
    const parsed = RestaurantDirectoryV1Schema.parse(data);
    return parsed.schemaVersion === "restaurant-directory.v2"
      ? parsed
      : RestaurantDirectoryV1Schema.parse({ ...parsed, schemaVersion: "restaurant-directory.v2" });
  }

  async readDetail(restaurantId: string): Promise<RestaurantDetailV1> {
    const v2Result = await this.client.rpc("get_restaurant_detail_v2", {
      p_restaurant_id: restaurantId,
    });
    const result = v2Result.error && isMissingFunctionError(v2Result.error)
      ? await this.client.rpc("get_restaurant_detail_v1", {
          p_restaurant_id: restaurantId,
        })
      : v2Result;
    const { data, error } = result;
    if (error) {
      if (isMissingFunctionError(error)) {
        const legacyPayload = await this.read({ restaurantId, limit: 200 });
        const entry = legacyPayload.restaurants.find((candidate) => candidate.restaurant.id === restaurantId);
        if (!entry) {
          throw new Error("공개된 음식점 identity를 찾을 수 없습니다.");
        }
        return RestaurantDetailV1Schema.parse({
          schemaVersion: "restaurant-detail.v2",
          namespace: "pricetrace",
          revision: legacyPayload.revision,
          restaurant: entry.restaurant,
          locations: entry.locations,
          menus: entry.menus,
        });
      }
      throw new Error(remoteErrorMessage(error, "음식점 상세 정보를 불러오지 못했습니다."));
    }
    const parsed = RestaurantDetailV1Schema.parse(data);
    const detail = parsed.schemaVersion === "restaurant-detail.v2"
      ? parsed
      : RestaurantDetailV1Schema.parse({ ...parsed, schemaVersion: "restaurant-detail.v2" });
    if (detail.restaurant.id !== restaurantId) {
      throw new Error("음식점 상세 RPC가 요청하지 않은 음식점 identity를 반환했습니다.");
    }
    return detail;
  }

  async readCategories(): Promise<RestaurantCategoryNodeRow[]> {
    const { data, error } = await this.client
      .from("restaurant_categories")
      .select("id,parent_id,slug,display_name,depth,sort_order")
      .order("depth")
      .order("sort_order")
      .order("display_name");
    if (error) {
      if (isMissingRelationError(error)) return [];
      throw new Error(remoteErrorMessage(error, "음식점 카테고리를 불러오지 못했습니다."));
    }
    return (data ?? []).map((row) => RestaurantCategoryNodeRowSchema.parse(row));
  }

  async setRestaurantCategory(
    restaurantId: string,
    categoryId: string | null,
  ): Promise<RestaurantCategoryAssignmentResult> {
    const { data, error } = await this.client.rpc("admin_set_restaurant_category_v1", {
      p_restaurant_id: restaurantId,
      p_category_id: categoryId,
    });
    if (error) {
      throw new Error(remoteErrorMessage(error, "음식점 카테고리를 연결하지 못했습니다."));
    }
    return RestaurantCategoryAssignmentRpcRowSchema.parse(unwrapSingleRow(data));
  }

  async read({
    restaurantId = null,
    catalogProductId = null,
    query = null,
    limit = 100,
  }: {
    restaurantId?: string | null;
    catalogProductId?: string | null;
    query?: string | null;
    limit?: number;
  } = {}): Promise<RestaurantMenuReadV1> {
    const { data, error } = await this.client.rpc("get_restaurant_menu_read_v1", {
      p_restaurant_id: restaurantId,
      p_catalog_product_id: catalogProductId,
      p_query: query?.trim() || null,
      p_limit: Math.max(1, Math.min(Math.trunc(limit), 200)),
    });
    if (error) {
      throw new Error(remoteErrorMessage(error, "음식점과 메뉴 가격 기록을 불러오지 못했습니다."));
    }

    const payload = RestaurantMenuReadV1Schema.parse(data);
    if (restaurantId && payload.restaurants.some((entry) => entry.restaurant.id !== restaurantId)) {
      throw new Error("음식점 조회 RPC가 요청하지 않은 음식점 identity를 반환했습니다.");
    }
    if (catalogProductId && payload.restaurants.some((entry) => (
      entry.menus.some((menu) => menu.catalogProductId !== catalogProductId)
    ))) {
      throw new Error("음식점 조회 RPC가 요청하지 않은 정확 메뉴 identity를 반환했습니다.");
    }
    return payload;
  }

  async registerReceiptObservation(
    requestInput: RestaurantMenuRegistrationRequest,
  ): Promise<RestaurantMenuRegistrationResult> {
    const request = RestaurantMenuRegistrationRequestSchema.parse(requestInput);
    const { data, error } = await this.client.rpc(
      "admin_register_restaurant_menu_from_receipt_v1",
      {
        p_idempotency_key: request.idempotencyKey,
        p_price_observation_id: request.priceObservationId,
        p_restaurant_id: request.restaurantId,
        p_restaurant_name: request.restaurantName,
        p_restaurant_legal_name: request.restaurantLegalName,
        p_cuisine_type: request.cuisineType,
        p_restaurant_official_site_url: request.restaurantOfficialSiteUrl,
        p_restaurant_source_namespace: request.restaurantSourceNamespace,
        p_restaurant_source_code: request.restaurantSourceCode,
        p_location_label: request.locationLabel,
        p_location_official_url: request.locationOfficialUrl,
        p_restaurant_menu_id: request.restaurantMenuId,
        p_menu_name: request.menuName,
        p_menu_category_label: request.menuCategoryLabel,
        p_serving_label: request.servingLabel,
        p_menu_official_url: request.menuOfficialUrl,
      },
    );
    if (error) {
      throw new Error(remoteErrorMessage(error, "음식점 메뉴 영수증 관측을 등록하지 못했습니다."));
    }

    const result = restaurantMenuRegistrationResultFromRpc(unwrapSingleRow(data));
    if (request.restaurantId && result.restaurantId !== request.restaurantId) {
      throw new Error("등록 RPC가 선택한 음식점과 다른 identity를 반환했습니다.");
    }
    if (request.restaurantMenuId && result.restaurantMenuId !== request.restaurantMenuId) {
      throw new Error("등록 RPC가 선택한 메뉴와 다른 identity를 반환했습니다.");
    }
    return result;
  }

  async readAdminReceiptCandidates(): Promise<RestaurantMenuReceiptCandidate[]> {
    const { data, error } = await this.client.rpc(
      "get_admin_restaurant_menu_receipt_candidates_v1",
    );
    if (error) {
      throw new Error(remoteErrorMessage(error, "등록 가능한 음식점 메뉴 영수증을 불러오지 못했습니다."));
    }
    if (!Array.isArray(data)) {
      throw new Error("음식점 메뉴 영수증 후보 RPC가 배열 계약을 반환하지 않았습니다.");
    }
    return data.map((row) => RestaurantMenuReceiptCandidateSchema.parse(row));
  }

  async autoLinkRestaurantMenuOptions(restaurantId: string): Promise<RestaurantMenuOptionLink[]> {
    const { data, error } = await this.client.rpc(
      "admin_auto_link_restaurant_menu_options_v1",
      { p_restaurant_id: restaurantId },
    );
    if (error) {
      throw new Error(remoteErrorMessage(error, "음식점 메뉴 옵션 자동 인식에 실패했습니다."));
    }
    if (!Array.isArray(data)) {
      throw new Error("음식점 메뉴 옵션 자동 인식 RPC가 배열 계약을 반환하지 않았습니다.");
    }
    return data.map((row) => restaurantMenuOptionLinkFromRpc(row));
  }

  async setRestaurantMenuOptionLink(
    restaurantId: string,
    parentMenuId: string,
    optionMenuId: string,
  ): Promise<RestaurantMenuOptionLink> {
    const { data, error } = await this.client.rpc(
      "admin_set_restaurant_menu_option_link_v1",
      {
        p_restaurant_id: restaurantId,
        p_parent_menu_id: parentMenuId,
        p_option_menu_id: optionMenuId,
      },
    );
    if (error) {
      throw new Error(remoteErrorMessage(error, "음식점 메뉴 옵션을 연결하지 못했습니다."));
    }
    return restaurantMenuOptionLinkFromRpc(unwrapSingleRow(data));
  }

  async clearRestaurantMenuOptionLink(
    restaurantId: string,
    optionMenuId: string,
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc(
      "admin_clear_restaurant_menu_option_link_v1",
      {
        p_restaurant_id: restaurantId,
        p_option_menu_id: optionMenuId,
      },
    );
    if (error) {
      throw new Error(remoteErrorMessage(error, "음식점 메뉴 옵션 연결을 해제하지 못했습니다."));
    }
    const row = unwrapSingleRow(data);
    if (!row || typeof row !== "object" || typeof (row as { cleared?: unknown }).cleared !== "boolean") {
      throw new Error("음식점 메뉴 옵션 연결 해제 RPC가 올바른 결과를 반환하지 않았습니다.");
    }
    return (row as { cleared: boolean }).cleared;
  }

}
