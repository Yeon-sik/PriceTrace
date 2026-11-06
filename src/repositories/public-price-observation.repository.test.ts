import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { groupProductObservations, mergeOfficialProductGroups } from "@/domain/product-browser";
import { publicPriceListings, PublicPriceObservationRepository } from "./public-price-observation.repository";
const row = { observation_id: "99000000-0000-4000-8000-000000000001", catalog_product_id: "99000000-0000-4000-8000-000000000002", product_name: "동일 이름", store_id: "99000000-0000-4000-8000-000000000003", store_name: "정확 판매처", location_label: "확인 지점", observed_on: "2026-11-06", unit_price_krw: 1200 };
describe("native public price reader", () => {
  it("deduplicates native ids and preserves public provenance without expense records", () => {
    const result = publicPriceListings([row, row]); expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source: "public", catalogNamespace: "public-price", catalogProductId: row.catalog_product_id, observedAt: row.observed_on, storeLabel: "정확 판매처 · 확인 지점", item: { unitPriceKrw: 1200, sourceLineReferences: [] } });
  });
  it("keeps same-name different canonical products and private receipts separate", () => {
    const publicRows = publicPriceListings([row, { ...row, observation_id: "99000000-0000-4000-8000-000000000004", catalog_product_id: "99000000-0000-4000-8000-000000000005" }]);
    const privateRow = { ...publicRows[0], id: "private", source: "receipt" as const, catalogNamespace: "pricetrace", sellerKey: "private-store", item: { ...publicRows[0].item, id: "private", receiptId: "receipt" } };
    const grouped = groupProductObservations([...publicRows, privateRow]); expect(grouped).toHaveLength(3);
    expect(mergeOfficialProductGroups(grouped)).toHaveLength(3);
  });
  it("rejects malformed money rather than silently coercing", () => { expect(() => publicPriceListings([{ ...row, unit_price_krw: 1.5 }])).toThrow(); });
  it("reads the RPC and fails visibly when unavailable", async () => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: [row], error: null }).mockResolvedValueOnce({ data: null, error: { code: "network" } }) };
    const repo = new PublicPriceObservationRepository(client as unknown as SupabaseClient); expect(await repo.load()).toHaveLength(1);
    expect(client.rpc).toHaveBeenCalledWith("get_information_public_prices_v1", { p_offset: 0, p_limit: 500 }); await expect(repo.load()).rejects.toThrow("불러오지");
  });
});
