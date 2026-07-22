export type Confidence = "high" | "medium" | "low" | "user_verified";
export type PurchaseType = "retail_product" | "menu_item" | "raw_material" | "property" | "service";
export type ReceiptLineType = "product" | "service" | "discount" | "fee" | "tax" | "tip" | "refund" | "rounding" | "other";
export type RetailChannel = "px" | "regular" | "unknown";
export interface ReceiptItem { id:string; receiptId:string; sourceLineReferences:string[]; productName:string; sourceProductCode:string; unitPriceKrw:number; quantityValue:number; totalPriceKrw:number; confidence:Confidence; }
export interface Receipt { id:string; storeLabel:string; retailChannel:RetailChannel; catalogNamespace:string|null; purchasedAt:string; transactionNumber:string; currency:"KRW"; totalPriceKrw:number; items:ReceiptItem[]; }
export interface Product { sourceProductCode:string; productName:string; purchaseType?:PurchaseType; categoryId?:string|null; categoryTags?:string[]; }
export interface PriceObservation { receiptId:string; sourceProductCode:string; productName:string; storeLabel:string; observedAt:string; unitPriceKrw:number; quantity:number; confidence:Confidence; }
export interface Recipient { id:string; name:string; createdAt:string; }
export interface Allocation { id:string; receiptItemId:string; recipientId:string; quantity:number; memo:string; createdAt:string; updatedAt:string; }
export type DeliveryStatus = "준비 중" | "전달 완료";
export type PaymentStatus = "미입금" | "입금 완료";
export interface SettlementStatus { recipientId:string; deliveryStatus:DeliveryStatus; paymentStatus:PaymentStatus; paidAt:string | null; }
export interface SettlementState { recipients:Recipient[]; allocations:Allocation[]; settlementStatuses:SettlementStatus[]; }
