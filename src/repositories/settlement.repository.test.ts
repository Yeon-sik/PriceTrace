import { describe, expect, it } from "vitest";
import { createBackup, emptySettlement, SettlementBackupSchema } from "./settlement.repository";
describe("backup repository",()=>{it("exports and parses a versioned backup",()=>{const backup=createBackup(emptySettlement(),"receipt-1");expect(SettlementBackupSchema.parse(JSON.parse(JSON.stringify(backup))).sourceReceiptId).toBe("receipt-1");});it("rejects malformed imports",()=>expect(()=>SettlementBackupSchema.parse({schemaVersion:2})).toThrow());});
