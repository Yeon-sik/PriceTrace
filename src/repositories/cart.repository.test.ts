import { describe, expect, it } from "vitest";
import { LocalStorageCartRepository } from "./cart.repository";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe("LocalStorageCartRepository", () => {
  it("round trips positive integer quantities", () => {
    const repository = new LocalStorageCartRepository(new MemoryStorage());
    repository.save({ "마트:A1": 3 });
    expect(repository.load()).toEqual({ "마트:A1": 3 });
  });

  it("preserves an empty cart when persisted data is invalid", () => {
    const storage = new MemoryStorage();
    storage.setItem("price-trace-cart-v1", JSON.stringify({ schemaVersion: 1, lines: { bad: 0 } }));
    expect(new LocalStorageCartRepository(storage).load()).toEqual({});
  });
});
