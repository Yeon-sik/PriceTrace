import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { RestaurantDetailV1Schema, RestaurantDirectoryV1Schema } from "../domain/restaurant-menu";
import { AuthenticatedRestaurantObservationRepository, attachOwnerRestaurantLatest, attachOwnerRestaurantPrices } from "./authenticated-restaurant-observation.repository";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const row = { id: id(1), created_by: id(2), restaurant_id: id(3), restaurant_location_id: id(4), restaurant_menu_id: id(5),
  unit_price_krw: 14900, quantity: 1, total_price_krw: null, observed_on: "2026-10-10",
  observed_at_exact: "2026-10-10T08:28:10+00:00", created_at: "2026-10-11T14:21:39+00:00",
  source_url: null, verification_status: "verified" as const, observation_kind: "standalone_purchase" as const };
const detail = () => RestaurantDetailV1Schema.parse({ schemaVersion: "restaurant-detail.v2", namespace: "pricetrace", revision: `sha256:${"a".repeat(64)}`,
  restaurant: { id: id(3), brandId: null, brand: "식당", legalName: null, cuisineType: null, officialSiteUrl: null, updatedAt: row.created_at },
  locations: [{ id: id(4), sourceLabel: "주문", sourceRestaurantCode: "exact-source", locationLabel: "영등포점", sourceUrl: null }],
  menus: [{ id: id(5), catalogProductId: id(6), standardProductId: id(7), name: "규동", categoryLabel: null, servingLabel: "1인분", officialUrl: null,
    updatedAt: row.created_at, revision: `sha256:${"b".repeat(64)}`, observations: [] }] });

test("loads verified purchases for the authenticated owner and exact restaurant", async () => {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: [row, { ...row, created_by: id(20) }, { ...row, restaurant_id: id(30) }], error: null });
  const client = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: id(2) } }, error: null }) }, from: vi.fn().mockReturnValue(query) };
  expect(await new AuthenticatedRestaurantObservationRepository(client as unknown as SupabaseClient).load(id(3))).toEqual([row]);
  expect(query.eq.mock.calls).toContainEqual(["created_by", id(2)]);
  expect(query.eq.mock.calls).toContainEqual(["verification_status", "verified"]);
  expect(query.eq.mock.calls).toContainEqual(["restaurant_id", id(3)]);
  client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  client.from.mockClear();
  expect(await new AuthenticatedRestaurantObservationRepository(client as unknown as SupabaseClient).load()).toEqual([]);
  expect(client.from).not.toHaveBeenCalled();
});

test("merges exact menu and location IDs, preserves public data and deduplicates existing observations", () => {
  const source = detail();
  const merged = attachOwnerRestaurantPrices(source, [row, { ...row, id: id(8), restaurant_location_id: id(40) }, { ...row, id: id(9), restaurant_menu_id: id(50) }]);
  expect(source.menus[0].observations).toEqual([]);
  expect(merged.menus[0].observations).toHaveLength(1);
  expect(merged.menus[0].observations[0]).toMatchObject({ id: row.id, unitPriceKrw: 14900, locationLabel: "영등포점", observedAt: row.observed_at_exact });
  expect(attachOwnerRestaurantPrices(merged, [row]).menus[0].observations).toHaveLength(1);
  const directory = RestaurantDirectoryV1Schema.parse({ schemaVersion: "restaurant-directory.v2", namespace: "pricetrace", revision: source.revision,
    restaurants: [{ revision: source.revision, restaurant: source.restaurant, locations: source.locations, menuCount: 1, latestObservedAt: null }] });
  expect(attachOwnerRestaurantLatest(directory, [row]).restaurants[0].latestObservedAt).toBe(row.observed_at_exact);
  expect(directory.restaurants[0].latestObservedAt).toBeNull();
});
