import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { latestOwnerMenuPrice, ownerMenuPriceHistory } from "../domain/owner-confirmed-restaurant";
import { OwnerConfirmedRestaurantRepository } from "./owner-confirmed-restaurant.repository";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const price = (n: number, observedOn: string, amount: number) => ({ id: id(n), purchaseSourceLineId: id(n + 100), observedOn,
  createdAt: `${observedOn}T10:00:00Z`, quantity: 1, unitPriceKrw: amount, grossPriceKrw: amount, discountPriceKrw: null, netPriceKrw: amount });
const projection = () => ({ schemaVersion: "owner-restaurant-read.v1", ownerId: id(11), restaurants: [{
  id: id(1), locationId: id(2), name: "한성대학교 학생식당", branchName: null, authorityStatus: "owner_confirmed",
  menus: [
    { id: id(3), name: "돼지불백덮밥", servingLabel: null, priceHistory: [price(5, "2026-10-13", 5700), price(6, "2026-11-10", 6000)] },
    { id: id(4), name: "어묵우동", servingLabel: null, priceHistory: [price(7, "2026-10-13", 3800), price(8, "2026-11-10", 4000)] },
  ],
}] });
const client = (ownerId: string | null, data: unknown = projection()) => ({
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: ownerId ? { id: ownerId } : null }, error: null }) },
  rpc: vi.fn().mockResolvedValue({ data, error: null }), from: vi.fn(),
});
const repository = (mock: ReturnType<typeof client>) => new OwnerConfirmedRestaurantRepository(mock as unknown as SupabaseClient);

test("owner repository reads both menus and independent price history without public catalogue I/O", async () => {
  const mock = client(id(11));
  const read = (await repository(mock).load())!;
  expect(read.restaurants).toHaveLength(1);
  expect(read.restaurants[0].menus).toHaveLength(2);
  expect(read.restaurants[0].authorityStatus).toBe("owner_confirmed");
  expect(ownerMenuPriceHistory(read.restaurants[0].menus[0]).map(row => row.unitPriceKrw)).toEqual([6000, 5700]);
  expect(latestOwnerMenuPrice(read.restaurants[0].menus[1])).toMatchObject({ observedOn: "2026-11-10", unitPriceKrw: 4000 });
  expect(mock.rpc).toHaveBeenCalledWith("get_my_owner_confirmed_restaurants_v3");
  expect(mock.from).not.toHaveBeenCalled();
});
test("anonymous does not query private or public rows", async () => {
  const mock = client(null);
  expect(await repository(mock).load()).toBeNull();
  expect(mock.rpc).not.toHaveBeenCalled();
});
test("other authenticated owner cannot consume the first owner's projection", async () => {
  await expect(repository(client(id(22))).load()).rejects.toThrow("소유자");
  expect(await repository(client(id(22), { ...projection(), ownerId: id(22), restaurants: [] })).load())
    .toMatchObject({ ownerId: id(22), restaurants: [] });
});
test("global exact, malformed UUIDs and public catalogue metadata are rejected by the private read model", async () => {
  const wrong = projection(); wrong.restaurants[0].authorityStatus = "exact";
  await expect(repository(client(id(11), wrong)).load()).rejects.toThrow();
  const malformed = projection(); malformed.restaurants[0].menus[0].id = "not-a-uuid";
  await expect(repository(client(id(11), malformed)).load()).rejects.toThrow();
  const extra = { ...projection(), authoritativeIds: { restaurantId: id(1) } };
  await expect(repository(client(id(11), extra)).load()).rejects.toThrow();
});
test("RPC errors are surfaced instead of reporting an empty successful registration", async () => {
  const mock = client(id(11)); mock.rpc.mockResolvedValue({ data: null, error: { message: "not deployed" } } as never);
  await expect(repository(mock).load()).rejects.toThrow("다시 시도");
});

test("component read has no invented price and older deployments fall back only for missing v2 RPC", async () => {
  const mock = client(id(11));
  const extended = projection();
  const data = { ...extended, schemaVersion: "owner-restaurant-read.v2", restaurants: [{ ...extended.restaurants[0],
    menus: extended.restaurants[0].menus.map(menu => ({ ...menu, components: [{ id: id(50), name: "국물", role: "complimentary_side" }] })),
  }] };
  mock.rpc.mockResolvedValue({ data, error: null });
  const read = (await repository(mock).load())!;
  expect(read.restaurants[0].menus[0].components).toEqual([{ id: id(50), name: "국물", role: "complimentary_side" }]);
  expect(read.restaurants[0].menus[0].priceHistory).toHaveLength(2);
  mock.rpc.mockReset().mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } } as never)
    .mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } } as never)
    .mockResolvedValueOnce({ data: extended, error: null });
  expect((await repository(mock).load())?.schemaVersion).toBe("owner-restaurant-read.v1");
  expect(mock.rpc).toHaveBeenLastCalledWith("get_my_owner_confirmed_restaurants_v1");
});
