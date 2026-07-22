import { z } from "zod";

const CartSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  lines: z.record(z.string().min(1), z.number().int().positive()),
});

export type CartLines = Record<string, number>;
export type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class LocalStorageCartRepository {
  private readonly key = "price-trace-cart-v1";

  constructor(private readonly storage?: CartStorage) {}

  private getStorage() {
    return this.storage ?? (typeof window === "undefined" ? null : window.localStorage);
  }

  load(): CartLines {
    const storage = this.getStorage();
    if (!storage) return {};
    const raw = storage.getItem(this.key);
    if (!raw) return {};
    try {
      return CartSnapshotSchema.parse(JSON.parse(raw)).lines;
    } catch {
      return {};
    }
  }

  save(lines: CartLines) {
    this.getStorage()?.setItem(this.key, JSON.stringify({ schemaVersion: 1, lines }));
  }

  clear() {
    this.getStorage()?.removeItem(this.key);
  }
}
