import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createAppReceiptProjection } from "../src/domain/app-receipt-projection";
import { ReceiptJsonSchema, type ReceiptJson } from "../src/domain/receipt";
import type { Receipt } from "../src/domain/types";

export type PrivateReceiptSourceResult = {
  revision: string;
  receipts: Receipt[];
  warnings: string[];
};

const privateDirectory = path.join(process.cwd(), "private-data");
let cachedSource: { signature: string; result: PrivateReceiptSourceResult } | null = null;

function logicalFilename(file: string) {
  return file.replace(/\(\d+\)(?=\.json$)/i, "").toLowerCase();
}

function opaqueId(file: string) {
  return createHash("sha256").update(logicalFilename(file)).digest("hex").slice(0, 24);
}

function sourceStoreLabel(source: ReceiptJson) {
  const name = source.merchant.name ?? "알 수 없는 판매처";
  return source.merchant.branch_name ? `${name} ${source.merchant.branch_name}` : name;
}

function privateMerchantIdentity(source: ReceiptJson, file: string) {
  const { business_registration_number: registration, address, phone } = source.merchant;
  if (address && (registration || phone)) {
    return createHash("sha256").update(JSON.stringify({ registration, address, phone })).digest("hex");
  }
  return `receipt:${logicalFilename(file)}`;
}

function safeError(error: unknown) {
  if (typeof error === "object" && error && "issues" in error && Array.isArray(error.issues)) {
    return error.issues.map((issue: { path?: Array<string | number>; message?: string }) => `${issue.path?.join(".") || "JSON"}: ${issue.message || "invalid"}`).join(", ");
  }
  return error instanceof Error ? error.message : "알 수 없는 검증 오류";
}

export async function loadPrivateReceiptProjections(): Promise<PrivateReceiptSourceResult> {
  const candidates = await Promise.all(
    (await readdir(privateDirectory))
      .filter((file) => /^receipt_.+\.json$/i.test(file))
      .map(async (file) => {
        const fileStat = await stat(path.join(privateDirectory, file));
        return { file, modifiedAt: fileStat.mtimeMs, size: fileStat.size };
      }),
  );

  const latestByLogicalName = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const key = logicalFilename(candidate.file);
    const current = latestByLogicalName.get(key);
    if (!current || candidate.modifiedAt > current.modifiedAt) latestByLogicalName.set(key, candidate);
  }

  const selected = [...latestByLogicalName.values()].sort((left, right) => left.file.localeCompare(right.file));
  const signature = selected.map(({ file, modifiedAt, size }) => `${file}:${modifiedAt}:${size}`).join("|");
  if (cachedSource?.signature === signature) return cachedSource.result;

  const warnings: string[] = [];
  const validSources: Array<{ candidate: (typeof selected)[number]; source: ReceiptJson }> = [];

  for (const candidate of selected) {
    try {
      const raw = await readFile(path.join(privateDirectory, candidate.file), "utf8");
      validSources.push({ candidate, source: ReceiptJsonSchema.parse(JSON.parse(raw)) });
    } catch (error) {
      warnings.push(`${candidate.file}: ${safeError(error)}`);
    }
  }

  const preferredStoreLabels = new Map<string, string>();
  for (const { candidate, source } of validSources) {
    const identity = privateMerchantIdentity(source, candidate.file);
    const label = sourceStoreLabel(source);
    const current = preferredStoreLabels.get(identity);
    if (!current || label.length > current.length) preferredStoreLabels.set(identity, label);
  }

  const receipts = validSources.map(({ candidate, source }) => {
    const identity = privateMerchantIdentity(source, candidate.file);
    return createAppReceiptProjection(source, opaqueId(candidate.file), preferredStoreLabels.get(identity));
  });

  receipts.sort((left, right) => right.purchasedAt.localeCompare(left.purchasedAt));
  const revision = createHash("sha256").update(signature).digest("hex").slice(0, 16);
  const result = { revision, receipts, warnings };
  cachedSource = { signature, result };
  return result;
}
