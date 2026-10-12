import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { RestaurantDetailV1Schema, type RestaurantDetailV1, type RestaurantDirectoryV1 } from "../domain/restaurant-menu";

const rowSchema = z.object({
  id: z.string().uuid(), created_by: z.string().uuid(), restaurant_id: z.string().uuid(),
  restaurant_location_id: z.string().uuid(), restaurant_menu_id: z.string().uuid(),
  unit_price_krw: z.number().int().nonnegative(), quantity: z.number().int().positive(),
  total_price_krw: z.number().int().nonnegative().nullable(), observed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observed_at_exact: z.string().datetime({ offset: true }).nullable(), created_at: z.string().datetime({ offset: true }),
  source_url: z.string().url().nullable(), verification_status: z.literal("verified"),
  observation_kind: z.literal("standalone_purchase"),
});
type OwnerObservation = z.infer<typeof rowSchema>;
const observedAt = (row: OwnerObservation) => row.observed_at_exact ?? `${row.observed_on}T00:00:00+00:00`;

export class AuthenticatedRestaurantObservationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async load(restaurantId?: string): Promise<OwnerObservation[]> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return [];
    let query = this.client.from("restaurant_menu_manual_observations")
      .select("id,created_by,restaurant_id,restaurant_location_id,restaurant_menu_id,unit_price_krw,quantity,total_price_krw,observed_on,observed_at_exact,created_at,source_url,verification_status,observation_kind")
      .eq("created_by", data.user.id).eq("verification_status", "verified").eq("observation_kind", "standalone_purchase");
    if (restaurantId) query = query.eq("restaurant_id", restaurantId);
    const result = await query.order("observed_on", { ascending: false }).limit(1000);
    if (result.error) throw new Error(result.error.message);
    return z.array(rowSchema).parse(result.data ?? []).filter((row) => row.created_by === data.user!.id &&
      (!restaurantId || row.restaurant_id === restaurantId));
  }
}

export function attachOwnerRestaurantPrices(detail: RestaurantDetailV1, rows: readonly OwnerObservation[]): RestaurantDetailV1 {
  return RestaurantDetailV1Schema.parse({ ...detail, menus: detail.menus.map((menu) => {
    const publicIds = new Set(menu.observations.map((observation) => observation.id));
    const own = rows.filter((row) => row.restaurant_id === detail.restaurant.id && row.restaurant_menu_id === menu.id &&
      detail.locations.some((location) => location.id === row.restaurant_location_id) && !publicIds.has(row.id));
    return { ...menu, observations: [...menu.observations, ...own.map((row) => ({
      id: row.id, restaurantSourceId: row.restaurant_location_id,
      locationLabel: detail.locations.find((location) => location.id === row.restaurant_location_id)!.locationLabel,
      unitPriceKrw: row.unit_price_krw, quantity: row.quantity,
      totalPriceKrw: row.total_price_krw ?? row.unit_price_krw * row.quantity,
      observedAt: observedAt(row), sourceType: "manual_review", receiptReference: null,
      sourceUrl: row.source_url, verifiedAt: row.created_at,
    }))] };
  }) });
}

export function attachOwnerRestaurantLatest(directory: RestaurantDirectoryV1, rows: readonly OwnerObservation[]): RestaurantDirectoryV1 {
  return { ...directory, restaurants: directory.restaurants.map((entry) => {
    const latest = rows.filter((row) => row.restaurant_id === entry.restaurant.id &&
      entry.locations.some((location) => location.id === row.restaurant_location_id))
      .map(observedAt).sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    return latest && (!entry.latestObservedAt || Date.parse(latest) > Date.parse(entry.latestObservedAt))
      ? { ...entry, latestObservedAt: latest } : entry;
  }) };
}
