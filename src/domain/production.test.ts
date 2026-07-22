import { describe, expect, it } from "vitest";
import { detectPriceAnomaly, detectDuplicate, maskSensitive, receiptFingerprint } from "./production";
import { mapReceipt } from "./receipt";
import { createUniversalReceipt } from "./receipt.fixture";

const receipt = mapReceipt(createUniversalReceipt("매장", "2026-07-18", "T1", 1000));
describe("production controls", () => { it("masks sensitive data and creates a duplicate fingerprint", () => { expect(maskSensitive("1234-5678-9012-3456")).toBe("1234********3456"); const fingerprint = receiptFingerprint(receipt); expect(detectDuplicate(receipt, new Set([fingerprint])).isDuplicate).toBe(true); }); it("detects a price anomaly", () => expect(detectPriceAnomaly(5000, [1000, 1100, 1200]).isAnomaly).toBe(true)); });
