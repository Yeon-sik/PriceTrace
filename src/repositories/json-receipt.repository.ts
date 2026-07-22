import rawReceipt from "../../data/demo/receipt.sample.json";
import { mapReceipt } from "@/domain/receipt";
import type { MultiReceiptRepository, ReceiptRepository } from "./receipt.repository";
export class JsonReceiptRepository implements ReceiptRepository, MultiReceiptRepository {
  load() { return mapReceipt(rawReceipt); }
  loadAll() { return [mapReceipt(rawReceipt)]; }
}
