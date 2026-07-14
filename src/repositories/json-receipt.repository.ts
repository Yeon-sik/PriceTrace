import rawReceipt from "../../data/demo/receipt.sample.json";
import { mapReceipt } from "@/domain/receipt";
import type { ReceiptRepository } from "./receipt.repository";
export class JsonReceiptRepository implements ReceiptRepository { load() { return mapReceipt(rawReceipt); } }
