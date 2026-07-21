import rawReceipt from "../../data/demo/receipt.sample.json";
import rawReceiptSecond from "../../data/demo/receipt.sample-2.json";
import { mapReceipt } from "@/domain/receipt";
import type { MultiReceiptRepository, ReceiptRepository } from "./receipt.repository";
export class JsonReceiptRepository implements ReceiptRepository, MultiReceiptRepository {
  load() { return mapReceipt(rawReceipt); }
  loadAll() { return [rawReceipt, rawReceiptSecond].map(mapReceipt).sort((a,b)=>a.purchasedAt.localeCompare(b.purchasedAt)); }
}
