import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { mapReceipt, ReceiptJsonSchema, type ReceiptJson } from "../receipt-contract/receipt";
import type { PublicReceiptSource } from "../receipt-contract/public-receipt";

export type PrivateReceiptPublicationSourceResult = {
  sources: PublicReceiptSource[];
  warnings: string[];
};

type Candidate = {
  file: string;
  modifiedAt: number;
  size: number;
};

type ValidatedPrivateReceiptSources = {
  signature: string;
  validSources: Array<{ candidate: Candidate; source: ReceiptJson }>;
  warnings: string[];
};

const privateDirectory = path.join(process.cwd(), "private-data");
let cachedValidatedSources: ValidatedPrivateReceiptSources | null = null;

function logicalFilename(file: string) {
  return file.replace(/\(\d+\)(?=\.json$)/i, "").toLowerCase();
}

function publicReceiptId(file: string) {
  const match = /^receipt_(\d{4}-\d{2}-\d{2}_\d{3})\.json$/i.exec(logicalFilename(file));
  if (!match) throw new Error(`공개 영수증 파일명은 receipt_YYYY-MM-DD_NNN.json 형식이어야 합니다: ${file}`);
  return match[1];
}

function safeError(error: unknown) {
  if (typeof error === "object" && error && "issues" in error && Array.isArray(error.issues)) {
    return error.issues.map((issue: { path?: Array<string | number>; message?: string }) =>
      `${issue.path?.join(".") || "JSON"}: ${issue.message || "invalid"}`).join(", ");
  }
  return error instanceof Error ? error.message : "알 수 없는 검증 오류";
}

async function loadValidatedPrivateReceiptSources(): Promise<ValidatedPrivateReceiptSources> {
  const candidates = await Promise.all(
    (await readdir(privateDirectory))
      .filter((file) => /^receipt_.+\.json$/i.test(file))
      .map(async (file): Promise<Candidate> => {
        const fileStat = await stat(path.join(privateDirectory, file));
        return { file, modifiedAt: fileStat.mtimeMs, size: fileStat.size };
      }),
  );

  const latestByLogicalName = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = logicalFilename(candidate.file);
    const current = latestByLogicalName.get(key);
    if (!current || candidate.modifiedAt > current.modifiedAt) latestByLogicalName.set(key, candidate);
  }

  const selected = [...latestByLogicalName.values()].sort((left, right) => left.file.localeCompare(right.file));
  const signature = selected.map(({ file, modifiedAt, size }) => `${file}:${modifiedAt}:${size}`).join("|");
  if (cachedValidatedSources?.signature === signature) return cachedValidatedSources;

  const warnings: string[] = [];
  const validSources: ValidatedPrivateReceiptSources["validSources"] = [];
  for (const candidate of selected) {
    try {
      const raw = await readFile(path.join(privateDirectory, candidate.file), "utf8");
      const source = ReceiptJsonSchema.parse(JSON.parse(raw));
      mapReceipt(source);
      publicReceiptId(candidate.file);
      validSources.push({ candidate, source });
    } catch (error) {
      warnings.push(`${candidate.file}: ${safeError(error)}`);
    }
  }

  const result = { signature, validSources, warnings };
  cachedValidatedSources = result;
  return result;
}

export async function loadPrivateReceiptPublicationSources(): Promise<PrivateReceiptPublicationSourceResult> {
  const result = await loadValidatedPrivateReceiptSources();
  return {
    sources: result.validSources.map(({ candidate, source }) => ({
      receiptId: publicReceiptId(candidate.file),
      source,
    })),
    warnings: [...result.warnings],
  };
}
