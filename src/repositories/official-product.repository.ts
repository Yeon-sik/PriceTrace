import { z } from "zod";
import type { OfficialProductRecord } from "@/domain/official-product";

const STORAGE_KEY = "price-tracker-official-products-v1";
export const OfficialProductRecordSchema = z.object({
  officialName: z.string().trim().min(1),
  officialUrl: z.string().url().refine((value) => value.startsWith("https://"), "공식 URL은 HTTPS여야 합니다."),
  sourceName: z.string().trim().min(1),
  imageUrl: z.string().url().refine((value) => value.startsWith("https://"), "이미지 URL은 HTTPS여야 합니다.").optional(),
  matchMethod: z.enum(["official_verified", "auto_matched", "manual"]),
  confidence: z.number().min(0).max(1).optional(),
  matchedBy: z.enum(["store_product_code", "receipt_name", "manual"]).optional(),
  updatedAt: z.string().datetime(),
});

export const OfficialProductSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  products: z.record(OfficialProductRecordSchema),
});

export class OfficialProductRepository {
  loadAll(): Record<string, OfficialProductRecord> {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return OfficialProductSnapshotSchema.safeParse(parsed).data?.products
        ?? z.record(OfficialProductRecordSchema).parse(parsed);
    } catch { return {}; }
  }
  save(sourceProductCode: string, record: OfficialProductRecord) {
    const current = this.loadAll();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, products: { ...current, [sourceProductCode]: OfficialProductRecordSchema.parse(record) } }));
  }
}
