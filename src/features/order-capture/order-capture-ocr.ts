import {
  buildSanitizedOrderCapture,
  mergeOrderCaptureExtractions,
  parseOrderCaptureText,
} from "../../domain/order-capture";

export type OrderCaptureOcrProgress = {
  fileIndex: number;
  fileCount: number;
  progress: number;
  status: string;
};

export async function hashOrderCaptureFile(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const hexadecimal = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hexadecimal}`;
}

export async function recognizeOrderCaptureFiles({
  files,
  onProgress,
  signal,
}: {
  files: File[];
  onProgress?: (progress: OrderCaptureOcrProgress) => void;
  signal?: AbortSignal;
}) {
  if (files.length === 0 || files.length > 20) {
    throw new Error("주문 캡처는 한 번에 1~20장만 처리할 수 있습니다.");
  }
  if (files.some((file) => !file.type.startsWith("image/"))) {
    throw new Error("이미지 파일만 주문 캡처로 처리할 수 있습니다.");
  }

  const { createWorker, OEM, PSM } = await import("tesseract.js");
  let activeFileIndex = 0;
  const worker = await createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
    logger(message) {
      onProgress?.({
        fileIndex: activeFileIndex,
        fileCount: files.length,
        progress: typeof message.progress === "number" ? message.progress : 0,
        status: message.status,
      });
    },
  });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    });
    const extractions = [];
    const captureHashes: string[] = [];
    for (const [index, file] of files.entries()) {
      if (signal?.aborted) throw new DOMException("OCR cancelled", "AbortError");
      activeFileIndex = index;
      onProgress?.({ fileIndex: index, fileCount: files.length, progress: 0, status: "recognizing" });
      const [hash, recognition] = await Promise.all([
        hashOrderCaptureFile(file),
        worker.recognize(file),
      ]);
      captureHashes.push(hash);
      extractions.push(parseOrderCaptureText(recognition.data.text));
    }

    return buildSanitizedOrderCapture({
      id: crypto.randomUUID(),
      extraction: mergeOrderCaptureExtractions(extractions),
      captureHashes,
    });
  } finally {
    await worker.terminate();
  }
}
