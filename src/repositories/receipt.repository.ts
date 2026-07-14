import type { Receipt } from "@/domain/types";
export interface ReceiptRepository { load(): Receipt; }
