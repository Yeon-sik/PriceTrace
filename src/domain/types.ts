export type Confidence = "high" | "medium" | "low" | "user_verified";
export interface ReceiptItem { id:string; receiptId:string; purchaseNumbers:number[]; productName:string; storeProductCode:string; unitPriceKrw:number; purchasedQuantity:number; totalPriceKrw:number; confidence:Confidence; }
export interface Receipt { id:string; storeLabel:string; purchasedAt:string; transactionNumber:string; currency:"KRW"; totalPriceKrw:number; items:ReceiptItem[]; }
export interface Product { storeProductCode:string; productName:string; }
export interface PriceObservation { receiptId:string; storeProductCode:string; productName:string; storeLabel:string; observedAt:string; unitPriceKrw:number; quantity:number; confidence:Confidence; }
export interface Recipient { id:string; name:string; createdAt:string; }
export interface Allocation { id:string; receiptItemId:string; recipientId:string; quantity:number; memo:string; createdAt:string; updatedAt:string; }
export type DeliveryStatus = "준비 중" | "전달 완료";
export type PaymentStatus = "미입금" | "입금 완료";
export interface SettlementStatus { recipientId:string; deliveryStatus:DeliveryStatus; paymentStatus:PaymentStatus; paidAt:string | null; }
export interface SettlementState { recipients:Recipient[]; allocations:Allocation[]; settlementStatuses:SettlementStatus[]; }
