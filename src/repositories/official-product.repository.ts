import { z } from "zod";
import type { OfficialProductRecord } from "@/domain/official-product";

const STORAGE_KEY = "price-tracker-official-products-v1";
const OfficialProductRecordSchema = z.object({
  officialName: z.string().trim().min(1),
  officialUrl: z.string().url().refine((value) => value.startsWith("https://"), "공식 URL은 HTTPS여야 합니다."),
  sourceName: z.string().trim().min(1),
  imageUrl: z.string().url().refine((value) => value.startsWith("https://"), "이미지 URL은 HTTPS여야 합니다.").optional(),
  matchMethod: z.literal("manual"),
  confidence: z.number().min(0).max(1).optional(),
  matchedBy: z.literal("manual").optional(),
  updatedAt: z.string().datetime(),
});

export class OfficialProductRepository {
  loadAll(): Record<string, OfficialProductRecord> {
    if (typeof window === "undefined") return {};
    try { return z.record(OfficialProductRecordSchema).parse(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")); } catch { return {}; }
  }
  save(storeProductCode: string, record: OfficialProductRecord) {
    const current = this.loadAll();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, [storeProductCode]: OfficialProductRecordSchema.parse(record) }));
  }
}
