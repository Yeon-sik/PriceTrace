import { describe, expect, it } from "vitest";
import { discoverOfficialProduct } from "./official-product";

describe("official product discovery", () => {
  it("automatically matches a verified store product code", () => {
    const result = discoverOfficialProduct({ sourceProductCode: "210059", productName: "하겐다즈 미니컵 스트로베리", storeLabel: "데모마트" });
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.record.matchMethod).toBe("auto_matched");
      expect(result.record.matchedBy).toBe("store_product_code");
      expect(result.record.confidence).toBe(1);
    }
  });

  it("does not turn an unknown receipt item into an official product", () => {
    expect(discoverOfficialProduct({ sourceProductCode: "unknown", productName: "임의 상품", storeLabel: "데모마트" }).status).toBe("unmatched");
  });
});
