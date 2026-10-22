import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { brandHttpUrlSchema, compareBrands, type Brand } from "../domain/brand-hierarchy";
import { fetchCatalogPages } from "./product-catalog.repository";

const BrandRowSchema = z.object({
  id: z.string().uuid(), canonical_name: z.string().min(1), parent_brand_id: z.string().uuid().nullable(),
  logo_url: brandHttpUrlSchema.nullable(), official_site_url: brandHttpUrlSchema.nullable(),
  status: z.enum(["active", "archived"]),
});
const AliasRowSchema = z.object({ id: z.string().uuid(), brand_id: z.string().uuid(), alias_name: z.string().min(1) });
export type AdminBrand = Brand & { status: "active" | "archived"; aliases: { id: string; name: string }[] };
export const BrandInputSchema = z.object({
  canonicalName: z.string().trim().min(1, "브랜드명을 입력하세요."),
  parentBrandId: z.string().uuid().nullable(),
  logoUrl: brandHttpUrlSchema.nullable(), officialSiteUrl: brandHttpUrlSchema.nullable(),
});
export type BrandInput = z.infer<typeof BrandInputSchema>;

function mutationError(code: string | undefined) {
  if (code === "23505") return new Error("다른 브랜드명 또는 별칭과 중복됩니다.");
  if (code === "23514") return new Error("상위 브랜드를 확인하세요. 순환 관계나 잘못된 값은 저장할 수 없습니다.");
  if (code === "42501") return new Error("브랜드 변경에는 관리자 권한이 필요합니다.");
  return new Error("변경을 저장하지 못했습니다. 새로고침 후 다시 시도하세요.");
}

export class AdminBrandRepository {
  constructor(private readonly client: SupabaseClient) {}

  async load(signal: AbortSignal): Promise<AdminBrand[]> {
    const [brandData, aliasData] = await Promise.all([
      fetchCatalogPages<{ id: string }>((from, to) => this.client.from("brands")
        .select("id,canonical_name,parent_brand_id,logo_url,official_site_url,status", { count: "exact" })
        .order("id").range(from, to).abortSignal(signal), (row) => row.id, signal),
      fetchCatalogPages<{ id: string }>((from, to) => this.client.from("brand_aliases")
        .select("id,brand_id,alias_name", { count: "exact" }).order("id")
        .range(from, to).abortSignal(signal), (row) => row.id, signal),
    ]);
    const rows = z.array(BrandRowSchema).parse(brandData);
    const aliases = z.array(AliasRowSchema).parse(aliasData);
    return rows.map((row) => ({ id: row.id, canonicalName: row.canonical_name, parentBrandId: row.parent_brand_id,
      parentCanonicalName: rows.find((parent) => parent.id === row.parent_brand_id)?.canonical_name ?? null,
      logoUrl: row.logo_url, officialSiteUrl: row.official_site_url, status: row.status,
      aliases: aliases.filter((alias) => alias.brand_id === row.id)
        .map((alias) => ({ id: alias.id, name: alias.alias_name })).sort((a, b) => a.name.localeCompare(b.name, "ko")),
    })).sort(compareBrands);
  }

  async save(id: string | null, input: BrandInput) {
    const value = BrandInputSchema.parse(input);
    const { data, error } = await this.client.rpc("admin_save_brand_v1", {
      p_brand_id: id ? z.string().uuid().parse(id) : null, p_canonical_name: value.canonicalName,
      p_parent_brand_id: value.parentBrandId, p_logo_url: value.logoUrl, p_official_site_url: value.officialSiteUrl,
    });
    if (error) throw mutationError(error.code);
    return z.string().uuid().parse(data);
  }

  async addAlias(brandId: string, name: string) {
    const { data, error } = await this.client.rpc("admin_add_brand_alias_v1", {
      p_brand_id: z.string().uuid().parse(brandId), p_alias_name: z.string().trim().min(1).parse(name),
    });
    if (error) throw mutationError(error.code);
    z.string().uuid().parse(data);
  }

  async removeAlias(brandId: string, aliasId: string) {
    const { data, error } = await this.client.rpc("admin_delete_brand_alias_v1", {
      p_brand_id: z.string().uuid().parse(brandId), p_alias_id: z.string().uuid().parse(aliasId),
    });
    if (error || !data) throw mutationError(error?.code);
    z.string().uuid().parse(data);
  }
}
