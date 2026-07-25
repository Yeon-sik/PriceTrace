import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPublicObservationBundle,
  PublicObservationBundleSchema,
} from "../src/domain/public-observation";
import { loadPrivateReceiptProjections } from "./private-receipt-source";

const outputPath = path.join(process.cwd(), "data", "public", "product-observations.v1.json");
const checkOnly = process.argv.includes("--check");

async function readCurrentOutput() {
  try {
    return await readFile(outputPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function checkPublicObservations() {
  const current = await readCurrentOutput();
  if (current === null) throw new Error("공개 관측 파일이 없습니다. sync:public-observations를 먼저 실행하세요.");
  const bundle = PublicObservationBundleSchema.parse(JSON.parse(current));
  console.log(`공개 관측 검증 통과 · ${bundle.observations.length}건 · revision ${bundle.revision}`);
}

async function syncPublicObservations() {
  const source = await loadPrivateReceiptProjections();
  if (source.warnings.length > 0) {
    throw new Error(`private 영수증 경고 ${source.warnings.length}건이 있어 공개 파일 생성을 중단했습니다.`);
  }
  if (source.receipts.length === 0) throw new Error("공개 관측으로 변환할 private 영수증이 없습니다.");

  const bundle = buildPublicObservationBundle(source.receipts);
  const next = `${JSON.stringify(bundle, null, 2)}\n`;
  const current = await readCurrentOutput();
  if (current === next) {
    console.log(`공개 관측 변경 없음 · ${bundle.observations.length}건 · revision ${bundle.revision}`);
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, next, "utf8");
  console.log(`공개 관측 갱신 완료 · ${bundle.observations.length}건 · revision ${bundle.revision}`);
}

(checkOnly ? checkPublicObservations() : syncPublicObservations()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
