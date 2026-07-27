export const PRODUCT_IMAGE_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PRODUCT_IMAGE_MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_STORED_BYTES = 500 * 1024;
export const PRODUCT_IMAGE_MAX_EDGE = 768;

export type ProductImageSourceType = "upload" | "external_url";

export type ProductImageFileMetadata = {
  type: string;
  size: number;
};

export function validateProductImageFile(metadata: ProductImageFileMetadata): string | null {
  if (!PRODUCT_IMAGE_ACCEPTED_TYPES.includes(metadata.type as (typeof PRODUCT_IMAGE_ACCEPTED_TYPES)[number])) {
    return "JPG, PNG, WebP 이미지 파일만 업로드할 수 있습니다.";
  }
  if (metadata.size <= 0) return "비어 있는 이미지 파일은 업로드할 수 없습니다.";
  if (metadata.size > PRODUCT_IMAGE_MAX_SOURCE_BYTES) return "원본 이미지는 8MB 이하여야 합니다.";
  return null;
}

export function normalizeExternalProductImageUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
