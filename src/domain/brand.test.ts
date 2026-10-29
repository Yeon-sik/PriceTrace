import { describe, expect, it } from "vitest";
import { prepareBrandRegistration, productNameWithoutBrand } from "./brand";

describe("prepareBrandRegistration", () => {
  it("separates a leading canonical brand from the displayed product name", () => {
    expect(productNameWithoutBrand("CJ 햇반", "CJ")).toBe("햇반");
    expect(productNameWithoutBrand("햇반", "CJ")).toBe("햇반");
    expect(productNameWithoutBrand("오뚜기 진짜장", "오뚜기")).toBe("진짜장");
  });

  it("normalizes one standard brand and keeps the official source domain", () => {
    expect(prepareBrandRegistration({
      canonicalName: "  농심  ",
      officialSourceUrl: "https://www.nongshim.com/products/shin",
    })).toEqual({
      value: {
        canonicalName: "농심",
        officialSourceLabel: "nongshim.com",
      },
      error: null,
    });
  });

  it("requires the standard brand", () => {
    expect(prepareBrandRegistration({
      canonicalName: "   ",
      officialSourceUrl: "https://nongshim.com/products/shin",
    })).toEqual({
      value: null,
      error: "표준 브랜드명을 입력하세요.",
    });
  });
});
