import rawReceipt from "../../data/demo/receipt.sample.json";
import receipt001 from "../../data/demo/receipt_001.json";
import { mapReceipt } from "../domain/receipt";
import type { MultiReceiptRepository, ReceiptRepository } from "./receipt.repository";
export class JsonReceiptRepository implements ReceiptRepository, MultiReceiptRepository {
  load() { return mapReceipt(rawReceipt); }
  loadAll() { return [rawReceipt, receipt001].map(mapReceipt); }
}
