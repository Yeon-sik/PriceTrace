import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AdminBrandRepository, BrandInputSchema } from "./admin-brand.repository";

const id = "11111111-1111-4111-8111-111111111111";
const aliasId = "22222222-2222-4222-8222-222222222222";
function repository(fetcher: typeof fetch) {
  return new AdminBrandRepository(createClient("https://brand-admin.example.invalid", "fixture-key", {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
}

describe("admin brand repository", () => {
  it("saves only the explicit brand fields and retains the canonical identity", async () => {
    const writes: { url: string; method: string; body: unknown }[] = [];
    const repo = repository(async (input, init) => {
      const req = new Request(input, init);
      writes.push({ url: req.url, method: req.method, body: await req.json() });
      return new Response(JSON.stringify(id));
    });
    expect(await repo.save(id, { canonicalName: " 이름 변경 ", parentBrandId: aliasId, logoUrl: null, officialSiteUrl: "https://brand.example.invalid" })).toBe(id);
    expect(writes[0].method).toBe("POST");
    expect(writes[0].url).toContain("/rpc/admin_save_brand_v1");
    expect(writes[0].body).toEqual({ p_brand_id: id, p_canonical_name: "이름 변경", p_parent_brand_id: aliasId, p_logo_url: null, p_official_site_url: "https://brand.example.invalid" });
    expect(BrandInputSchema.safeParse({ canonicalName: "a", parentBrandId: null, logoUrl: "javascript:bad", officialSiteUrl: null }).success).toBe(false);
  });
  it("scopes alias deletion to both alias and canonical brand, and surfaces RLS failures", async () => {
    let body: unknown;
    const repo = repository(async (input, init) => { body = await new Request(input, init).json(); return new Response(JSON.stringify(aliasId)); });
    await repo.removeAlias(id, aliasId);
    expect(body).toEqual({ p_brand_id: id, p_alias_id: aliasId });
    const denied = repository(async () => new Response(JSON.stringify({ code: "42501", message: "row policy denied" }), { status: 403 }));
    await expect(denied.addAlias(id, "별칭")).rejects.toThrow("관리자 권한");
  });
  it("reports canonical/alias identity collisions without silently creating a replacement", async () => {
    const repo = repository(async () => new Response(JSON.stringify({ code: "23505", message: "duplicate" }), { status: 409 }));
    await expect(repo.addAlias(id, "기존 이름")).rejects.toThrow("중복");
  });
});
