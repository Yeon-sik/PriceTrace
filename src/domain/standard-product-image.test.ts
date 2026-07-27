import { describe, expect, it } from "vitest";
import {
  PRODUCT_IMAGE_MAX_SOURCE_BYTES,
  normalizeExternalProductImageUrl,
  validateProductImageFile,
} from "./standard-product-image";

describe("standard product image input", () => {
  it("accepts supported image files within the source limit", () => {
    expect(validateProductImageFile({ type: "image/jpeg", size: 2_000_000 })).toBeNull();
    expect(validateProductImageFile({ type: "image/png", size: 1 })).toBeNull();
    expect(validateProductImageFile({ type: "image/webp", size: 200_000 })).toBeNull();
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(validateProductImageFile({ type: "image/gif", size: 100 })).toContain("JPG");
    expect(validateProductImageFile({ type: "image/png", size: 0 })).toContain("비어");
    expect(validateProductImageFile({ type: "image/png", size: PRODUCT_IMAGE_MAX_SOURCE_BYTES + 1 })).toContain("8MB");
  });

  it("normalizes only HTTPS external image links", () => {
    expect(normalizeExternalProductImageUrl(" https://images.example.com/product.jpg ")).toBe("https://images.example.com/product.jpg");
    expect(normalizeExternalProductImageUrl("http://images.example.com/product.jpg")).toBeNull();
    expect(normalizeExternalProductImageUrl("not-a-url")).toBeNull();
  });
});
