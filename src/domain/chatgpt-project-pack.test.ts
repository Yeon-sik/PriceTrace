import { inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import merchantProfileTemplate from "../../docs/templates/MERCHANT_PROFILE_V1_TEMPLATE.json";
import receiptTemplate from "../../docs/templates/RECEIPT_V2_TEMPLATE.json";
import { MerchantProfileV1Schema } from "./merchant-profile";
import { ReceiptJsonSchema } from "./receipt";
import { MerchantProfileV1Schema as PackMerchantProfileV1Schema } from "../../chatgpt-project-sources/merchant-profile/merchant-profile";
import { ReceiptJsonSchema as PackReceiptJsonSchema } from "../../chatgpt-project-sources/receipt-contract/receipt";

type ZipEntries = Map<string, Buffer>;

function findEndOfCentralDirectory(archive: Buffer) {
  const minimumOffset = Math.max(0, archive.length - 22 - 0xffff);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end-of-central-directory record was not found");
}

function readProjectPackZip(zipPath: string): ZipEntries {
  const archive = readFileSync(zipPath);
  const endOfCentralDirectory = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(endOfCentralDirectory + 10);
  let centralDirectoryOffset = archive.readUInt32LE(endOfCentralDirectory + 16);
  const entries: ZipEntries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralDirectoryOffset) !== 0x02014b50) {
      throw new Error(`ZIP central-directory entry ${index} is invalid`);
    }
    const compressionMethod = archive.readUInt16LE(centralDirectoryOffset + 10);
    const compressedSize = archive.readUInt32LE(centralDirectoryOffset + 20);
    const uncompressedSize = archive.readUInt32LE(centralDirectoryOffset + 24);
    const fileNameLength = archive.readUInt16LE(centralDirectoryOffset + 28);
    const extraLength = archive.readUInt16LE(centralDirectoryOffset + 30);
    const commentLength = archive.readUInt16LE(centralDirectoryOffset + 32);
    const localHeaderOffset = archive.readUInt32LE(centralDirectoryOffset + 42);
    const fileName = archive.subarray(
      centralDirectoryOffset + 46,
      centralDirectoryOffset + 46 + fileNameLength,
    ).toString("utf8").replaceAll("\\", "/");
    centralDirectoryOffset += 46 + fileNameLength + extraLength + commentLength;
    if (fileName.endsWith("/")) continue;

    if (archive.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`ZIP local header for ${fileName} is invalid`);
    }
    const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const content = compressionMethod === 0
      ? Buffer.from(compressed)
      : compressionMethod === 8
        ? inflateRawSync(compressed)
        : (() => { throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${fileName}`); })();
    if (content.length !== uncompressedSize) {
      throw new Error(`ZIP size mismatch for ${fileName}`);
    }
    entries.set(fileName, content);
  }

  return entries;
}

function manifestMappings(manifest: string) {
  return [...manifest.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)]
    .map((match) => ({ packPath: match[1], sourcePath: match[2] }));
}

function expectedPackText(root: string, sourcePath: string, packPath: string) {
  let content = readFileSync(path.join(root, sourcePath), "utf8");
  if (packPath === "merchant-profile/merchant-profile.ts") {
    content = content.replace('from "./receipt";', 'from "../receipt-contract/receipt";');
  }
  if (packPath === "validation/validate-private-receipts.ts") {
    content = content.replace('from "../src/domain/receipt";', 'from "../receipt-contract/receipt";');
  }
  if (packPath === "validation/private-receipt-source.ts") {
    content = content.replace('from "../src/domain/receipt";', 'from "../receipt-contract/receipt";');
    content = content.replace('from "../src/domain/public-receipt";', 'from "../receipt-contract/public-receipt";');
  }
  return content;
}

function relativeImports(source: string) {
  const imports = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith(".")) imports.add(match[1]);
    }
  }
  return [...imports];
}

function resolveRelativeImport(importer: string, specifier: string, entries: ZipEntries) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  const candidates = new Set([
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]);
  if (base.endsWith(".js")) candidates.add(`${base.slice(0, -3)}.ts`);
  if (base.endsWith(".jsx")) candidates.add(`${base.slice(0, -4)}.tsx`);
  return [...candidates].find((candidate) => entries.has(candidate)) ?? null;
}

const repositoryRoot = process.cwd();
const packRoot = path.join(repositoryRoot, "chatgpt-project-sources");
const zipPath = path.join(repositoryRoot, "chatgpt-receipt-project-sources.zip");

describe("ChatGPT Project source pack", () => {
  it("keeps the manifest, generated directory, and ZIP in sync", () => {
    const mappings = manifestMappings(readFileSync(path.join(packRoot, "SOURCE_MANIFEST.md"), "utf8"));
    expect(mappings.length).toBeGreaterThan(0);
    const zipEntries = readProjectPackZip(zipPath);

    for (const { packPath: relativePackPath, sourcePath } of mappings) {
      const packFilePath = path.join(packRoot, relativePackPath);
      expect(readFileSync(packFilePath, "utf8"), relativePackPath).toBe(expectedPackText(repositoryRoot, sourcePath, relativePackPath));
      expect(zipEntries.get(relativePackPath), `ZIP entry ${relativePackPath}`).toEqual(readFileSync(packFilePath));
    }

    for (const requiredFile of ["PROJECT_INSTRUCTIONS.md", "PASTE_TO_PROJECT_SETTINGS.md", "SOURCE_MANIFEST.md"]) {
      expect(zipEntries.has(requiredFile), `ZIP entry ${requiredFile}`).toBe(true);
    }
  });

  it("resolves every relative TypeScript import from the generated ZIP", () => {
    const zipEntries = readProjectPackZip(zipPath);
    const unresolved: string[] = [];

    for (const [fileName, content] of zipEntries) {
      if (!fileName.endsWith(".ts") && !fileName.endsWith(".tsx")) continue;
      for (const specifier of relativeImports(content.toString("utf8"))) {
        if (!resolveRelativeImport(fileName, specifier, zipEntries)) {
          unresolved.push(`${fileName} -> ${specifier}`);
        }
      }
    }

    expect(unresolved).toEqual([]);
  });

  it("keeps the source schemas, templates, contracts, and project instructions aligned", () => {
    const receipt = ReceiptJsonSchema.parse(receiptTemplate);
    expect(PackReceiptJsonSchema.parse(JSON.parse(readFileSync(path.join(packRoot, "receipt-contract/RECEIPT_V2_TEMPLATE.json"), "utf8")))).toEqual(receipt);
    expect(receipt.document.id).toBeNull();
    expect(receipt.document.source.source_images).toEqual([]);
    expect(receipt.document.source.raw_text).toBeNull();
    expect(receipt.payments.every((payment) => payment.reference === null)).toBe(true);

    const merchant = MerchantProfileV1Schema.parse(merchantProfileTemplate);
    expect(PackMerchantProfileV1Schema.parse(JSON.parse(readFileSync(path.join(packRoot, "merchant-profile/MERCHANT_PROFILE_V1_TEMPLATE.json"), "utf8")))).toEqual(merchant);
    expect(merchant.merchant.business_kind).toBe("unknown");
    expect(merchant.merchant.source_namespace).toBeNull();
    expect(merchant.merchant.source_location_code).toBeNull();

    const instructions = readFileSync(path.join(packRoot, "PROJECT_INSTRUCTIONS.md"), "utf8");
    const settings = readFileSync(path.join(packRoot, "PASTE_TO_PROJECT_SETTINGS.md"), "utf8");
    const ingestionContract = readFileSync(path.join(repositoryRoot, "docs/contracts/VERIFIED_RECEIPT_INGESTION_V2.md"), "utf8");
    const merchantContract = readFileSync(path.join(repositoryRoot, "docs/contracts/MERCHANT_PROFILE_V1.md"), "utf8");

    for (const marker of ["yeonsik-ocr.v1", "receipt.v2.document.id", "localDocumentId", "source_images", "raw_text", "submit_verified_receipt_v2", "user_verified", "projection_targets", "merchant-profile.v1"]) {
      expect(instructions, `PROJECT_INSTRUCTIONS.md: ${marker}`).toContain(marker);
      expect(settings, `PASTE_TO_PROJECT_SETTINGS.md: ${marker}`).toContain(marker);
    }
    for (const marker of ["source-document fact", "server-owned", "submit_merchant_identity_candidate_v1", "idempotency", "merchant_sku"]) {
      expect(ingestionContract, `VERIFIED_RECEIPT_INGESTION_V2.md: ${marker}`).toContain(marker);
    }
    for (const marker of ["검증 전 판매처 source fact 초안", "merchant-profile.v1", "submit_merchant_identity_candidate_v1", "PriceTrace UUID", "SKU", "브랜드"]) {
      expect(merchantContract, `MERCHANT_PROFILE_V1.md: ${marker}`).toContain(marker);
    }
    expect(instructions).toContain("최상위에 `receipt.v2`를 직접 반환하지 않는다");
    expect(settings).toContain("최상위에 `receipt.v2`를 직접 반환하지 않는다");
    expect(settings).toContain("business_registration_number");
    expect(settings).toContain("payment reference");
    expect(settings).toContain("사용자 검증 gate");
    expect(settings).toContain("needs_recapture");
    expect(settings).not.toContain("반드시 C만 반환한다");
    expect(settings).not.toContain("카드번호, 승인번호, 주소, 전화번호, 사업자등록번호, 현금영수증 번호, 바코드 전체값, raw_text는 반환하지 않는다.");
    expect(settings).not.toContain("반드시 B만 반환한다");
  });
});
