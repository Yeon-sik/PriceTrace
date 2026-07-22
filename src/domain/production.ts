import type { Receipt } from "./types";

export type QualityFlagType="duplicate"|"anomaly"|"pii"|"reconciliation";
export type QualitySeverity="info"|"warning"|"critical";
export type QualityFlag={type:QualityFlagType;severity:QualitySeverity;details:Record<string,unknown>};

export function maskSensitive(value:string|null|undefined){if(!value)return value??null;const digits=value.replace(/\D/g,"");if(digits.length>=12)return `${digits.slice(0,4)}${"*".repeat(Math.max(4,digits.length-8))}${digits.slice(-4)}`;if(digits.length>=6)return `${digits.slice(0,2)}${"*".repeat(digits.length-4)}${digits.slice(-2)}`;return "***";}
export function receiptFingerprint(receipt:Receipt){const itemSignature=receipt.items.map(item=>`${item.sourceProductCode}:${item.unitPriceKrw}:${item.quantityValue}:${item.totalPriceKrw}`).sort().join("|");return `${receipt.storeLabel}|${receipt.purchasedAt}|${receipt.transactionNumber}|${receipt.totalPriceKrw}|${itemSignature}`;}
export function detectDuplicate(receipt:Receipt,knownFingerprints:Set<string>){const fingerprint=receiptFingerprint(receipt);return {fingerprint,isDuplicate:knownFingerprints.has(fingerprint)};}
export function median(values:number[]){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;}
export function detectPriceAnomaly(value:number,referenceValues:number[],ratio=2){const reference=median(referenceValues);if(reference===null||reference===0)return {isAnomaly:false,reference:null,ratio:null};const relativeRatio=value/reference;return {isAnomaly:relativeRatio>=ratio||relativeRatio<=1/ratio,reference,ratio:relativeRatio};}
