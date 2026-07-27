import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PRODUCT_IMAGE_MAX_EDGE,
  PRODUCT_IMAGE_MAX_STORED_BYTES,
  normalizeExternalProductImageUrl,
  validateProductImageFile,
} from "@/domain/standard-product-image";

const BUCKET = "product-images";

export type StandardProductImageRecord = {
  standard_product_id: string;
  source_type: "upload" | "external_url";
  image_url: string;
  storage_path: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
};

export type StandardProductImageDraft =
  | { sourceType: "upload"; file: File }
  | { sourceType: "external_url"; url: string };

type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
};

async function loadImage(file: File) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap as CanvasImageSource,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  await image.decode();
  return {
    source: image as CanvasImageSource,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("이미지를 WebP로 변환하지 못했습니다.")),
      "image/webp",
      quality,
    );
  });
}

export async function prepareStandardProductImage(file: File): Promise<PreparedImage> {
  const validationError = validateProductImageFile(file);
  if (validationError) throw new Error(validationError);

  const loaded = await loadImage(file);
  try {
    if (loaded.width <= 0 || loaded.height <= 0) throw new Error("이미지 크기를 확인하지 못했습니다.");

    let smallest: PreparedImage | null = null;
    for (const maxEdge of [PRODUCT_IMAGE_MAX_EDGE, 640, 512]) {
      const scale = Math.min(1, maxEdge / Math.max(loaded.width, loaded.height));
      const width = Math.max(1, Math.round(loaded.width * scale));
      const height = Math.max(1, Math.round(loaded.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("이미지 처리 기능을 사용할 수 없습니다.");
      context.drawImage(loaded.source, 0, 0, width, height);

      for (const quality of [0.82, 0.72, 0.62]) {
        const blob = await canvasToWebp(canvas, quality);
        smallest = !smallest || blob.size < smallest.blob.size ? { blob, width, height } : smallest;
        if (blob.size <= PRODUCT_IMAGE_MAX_STORED_BYTES) return { blob, width, height };
      }
    }

    if (!smallest || smallest.blob.size > PRODUCT_IMAGE_MAX_STORED_BYTES) {
      throw new Error("이미지를 500KB 이하로 최적화하지 못했습니다. 더 단순하거나 작은 이미지를 선택하세요.");
    }
    return smallest;
  } finally {
    loaded.dispose();
  }
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function verifyExternalImage(url: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image();
    let timeout = 0;
    const finish = (callback: () => void) => {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      callback();
    };
    timeout = window.setTimeout(() => finish(() => reject(new Error("이미지 링크 확인 시간이 초과됐습니다."))), 10_000);
    image.referrerPolicy = "no-referrer";
    image.onload = () => finish(resolve);
    image.onerror = () => finish(() => reject(new Error("링크에서 이미지를 불러오지 못했습니다.")));
    image.src = url;
  });
}

export class StandardProductImageRepository {
  constructor(private readonly client: SupabaseClient) {}

  async save(standardProductId: string, userId: string, draft: StandardProductImageDraft): Promise<StandardProductImageRecord> {
    const { data: existing, error: existingError } = await this.client
      .from("standard_product_images")
      .select("standard_product_id,source_type,image_url,storage_path,mime_type,file_size_bytes,width,height")
      .eq("standard_product_id", standardProductId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    let uploadedPath: string | null = null;
    let next: StandardProductImageRecord;

    if (draft.sourceType === "upload") {
      const prepared = await prepareStandardProductImage(draft.file);
      const digest = await sha256(prepared.blob);
      uploadedPath = `${standardProductId}/${digest}.webp`;
      const { error: uploadError } = await this.client.storage.from(BUCKET).upload(uploadedPath, prepared.blob, {
        cacheControl: "31536000",
        contentType: "image/webp",
        upsert: true,
      });
      if (uploadError) throw new Error(uploadError.message);
      const { data: publicUrl } = this.client.storage.from(BUCKET).getPublicUrl(uploadedPath);
      next = {
        standard_product_id: standardProductId,
        source_type: "upload",
        image_url: publicUrl.publicUrl,
        storage_path: uploadedPath,
        mime_type: "image/webp",
        file_size_bytes: prepared.blob.size,
        width: prepared.width,
        height: prepared.height,
      };
    } else {
      const url = normalizeExternalProductImageUrl(draft.url);
      if (!url) throw new Error("HTTPS 이미지 링크를 입력하세요.");
      await verifyExternalImage(url);
      next = {
        standard_product_id: standardProductId,
        source_type: "external_url",
        image_url: url,
        storage_path: null,
        mime_type: null,
        file_size_bytes: null,
        width: null,
        height: null,
      };
    }

    const { error: saveError } = await this.client.from("standard_product_images").upsert({
      ...next,
      created_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "standard_product_id" });

    if (saveError) {
      if (uploadedPath && uploadedPath !== existing?.storage_path) {
        await this.client.storage.from(BUCKET).remove([uploadedPath]);
      }
      throw new Error(saveError.message);
    }

    if (existing?.storage_path && existing.storage_path !== uploadedPath) {
      const { error: cleanupError } = await this.client.storage.from(BUCKET).remove([existing.storage_path]);
      if (cleanupError) {
        console.warn(`새 이미지는 저장했지만 이전 이미지 정리에 실패했습니다: ${cleanupError.message}`);
      }
    }

    return next;
  }
}
