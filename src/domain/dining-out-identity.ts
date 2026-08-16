import { z } from "zod";
import type { RestaurantMenu, RestaurantMenuReadEntry, RestaurantLocation } from "./restaurant-menu";

export const DINING_OUT_IDENTITY_SCHEMA_VERSION = "dining-out-identity.v1" as const;
export const DINING_OUT_IDENTITY_NAMESPACE = "pricetrace" as const;

export const DiningOutIdentityV1Schema = z.object({
  schemaVersion: z.literal(DINING_OUT_IDENTITY_SCHEMA_VERSION),
  namespace: z.literal(DINING_OUT_IDENTITY_NAMESPACE),
  restaurantId: z.string().uuid(),
  restaurantName: z.string().trim().min(1),
  restaurantLocationId: z.string().uuid(),
  branchName: z.string().trim().min(1).nullable(),
  restaurantMenuId: z.string().uuid(),
  menuName: z.string().trim().min(1),
  catalogProductId: z.string().uuid(),
}).strict();

export type DiningOutIdentityV1 = z.infer<typeof DiningOutIdentityV1Schema>;

export function diningOutIdentityFromSelection(
  entry: RestaurantMenuReadEntry,
  location: RestaurantLocation,
  menu: RestaurantMenu,
): DiningOutIdentityV1 {
  if (!entry.locations.some((candidate) => candidate.id === location.id)) {
    throw new Error("선택한 PriceTrace 지점이 식당에 속하지 않습니다.");
  }
  if (!entry.menus.some((candidate) => candidate.id === menu.id)) {
    throw new Error("선택한 PriceTrace 메뉴가 식당에 속하지 않습니다.");
  }
  return DiningOutIdentityV1Schema.parse({
    schemaVersion: DINING_OUT_IDENTITY_SCHEMA_VERSION,
    namespace: DINING_OUT_IDENTITY_NAMESPACE,
    restaurantId: entry.restaurant.id,
    restaurantName: entry.restaurant.brand,
    restaurantLocationId: location.id,
    branchName: location.locationLabel,
    restaurantMenuId: menu.id,
    menuName: menu.name,
    catalogProductId: menu.catalogProductId,
  });
}
