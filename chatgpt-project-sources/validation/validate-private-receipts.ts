import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { auditReceipt, mapReceipt, ReceiptJsonSchema } from "../receipt-contract/receipt";

const privateDirectory = path.join(process.cwd(), "private-data");

async function validatePrivateReceipts() {
  const requestedFiles = process.argv.slice(2);
  const files = requestedFiles.length > 0
    ? requestedFiles.map((file) => path.basename(file))
    : (await readdir(privateDirectory)).filter((file) => file.endsWith(".json")).sort();

  if (files.length === 0) throw new Error("검증할 private-data 영수증 JSON 파일이 없습니다.");

  let failed = false;
  for (const file of files) {
    try {
      const source = JSON.parse(await readFile(path.join(privateDirectory, file), "utf8"));
      const parsed = ReceiptJsonSchema.parse(source);
      const receipt = mapReceipt(parsed);
      const audit = auditReceipt(receipt, parsed);
      console.log(`${file}: 통과 · 배분 가능 품목 ${audit.itemCount}개 · 수량 ${audit.quantity}개`);
    } catch (error) {
      failed = true;
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`${file}: 실패 · ${detail}`);
    }
  }

  if (failed) process.exitCode = 1;
}

validatePrivateReceipts().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
