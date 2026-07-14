import { z } from "zod";
import type { SettlementState } from "@/domain/types";
export const SettlementBackupSchema=z.object({schemaVersion:z.literal(1),exportedAt:z.string().datetime(),sourceReceiptId:z.string().min(1),recipients:z.array(z.object({id:z.string(),name:z.string().min(1),createdAt:z.string().datetime()})),allocations:z.array(z.object({id:z.string(),receiptItemId:z.string(),recipientId:z.string(),quantity:z.number().int().positive(),memo:z.string(),createdAt:z.string().datetime(),updatedAt:z.string().datetime()})),settlementStatuses:z.array(z.object({recipientId:z.string(),deliveryStatus:z.enum(["준비 중","전달 완료"]),paymentStatus:z.enum(["미입금","입금 완료"]),paidAt:z.string().datetime().nullable()}))});
export type SettlementBackup=z.infer<typeof SettlementBackupSchema>;
export const emptySettlement=():SettlementState=>({recipients:[],allocations:[],settlementStatuses:[]});
export function createBackup(state:SettlementState,sourceReceiptId:string):SettlementBackup { return {schemaVersion:1,exportedAt:new Date().toISOString(),sourceReceiptId,...state}; }
