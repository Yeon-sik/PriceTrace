import { describe, expect, it } from "vitest";
import { OfficialProductSnapshotSchema } from "./official-product.repository";

describe("official product JSON snapshot", () => {
  it("accepts a versioned official product record", () => {
    expect(OfficialProductSnapshotSchema.parse({
      schemaVersion: 1,
      products: {
        "210059": {
          officialName: "공식 상품",
          officialUrl: "https://example.com/product",
          sourceName: "제조사 공식몰",
          matchMethod: "official_verified",
          confidence: 1,
          matchedBy: "store_product_code",
          updatedAt: "2026-07-22T00:00:00.000Z",
        },
      },
    }).products["210059"].officialName).toBe("공식 상품");
  });
});
