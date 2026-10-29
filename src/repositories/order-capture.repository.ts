import { z } from "zod";
import {
  SanitizedOrderCaptureSchema,
  type SanitizedOrderCapture,
} from "../domain/order-capture";

export const ORDER_CAPTURE_STORAGE_KEY = "price-trace-sanitized-order-captures-v1";

const OrderCaptureSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  captures: z.array(SanitizedOrderCaptureSchema).max(100),
}).strict();

export type OrderCaptureStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class OrderCaptureRepository {
  constructor(private readonly storage?: OrderCaptureStorage) {}

  private getStorage() {
    return this.storage ?? (typeof window === "undefined" ? null : window.localStorage);
  }

  load() {
    const raw = this.getStorage()?.getItem(ORDER_CAPTURE_STORAGE_KEY);
    if (!raw) return [];
    try {
      const snapshot = OrderCaptureSnapshotSchema.parse(JSON.parse(raw));
      return [...snapshot.captures].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    } catch {
      return [];
    }
  }

  save(captures: SanitizedOrderCapture[]) {
    const storage = this.getStorage();
    if (!storage) return [];
    const snapshot = OrderCaptureSnapshotSchema.parse({
      schemaVersion: 1,
      captures: captures
        .map((capture) => SanitizedOrderCaptureSchema.parse(capture))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 100),
    });
    if (snapshot.captures.length === 0) {
      storage.removeItem(ORDER_CAPTURE_STORAGE_KEY);
      return [];
    }
    storage.setItem(ORDER_CAPTURE_STORAGE_KEY, JSON.stringify(snapshot));
    return snapshot.captures;
  }

  upsert(capture: SanitizedOrderCapture) {
    const parsed = SanitizedOrderCaptureSchema.parse(capture);
    const captures = this.load().filter((stored) => stored.id !== parsed.id);
    return this.save([parsed, ...captures]);
  }

  remove(id: string) {
    return this.save(this.load().filter((capture) => capture.id !== id));
  }
}
