import type { PriceObservation, Product, Receipt } from "./types";

export function productsFromReceipts(receipts:Receipt[]):Product[] {
  const products = new Map<string, Product>();
  receipts.flatMap(r=>r.items).forEach(item=>products.set(item.storeProductCode, {storeProductCode:item.storeProductCode, productName:item.productName}));
  return [...products.values()].sort((a,b)=>a.productName.localeCompare(b.productName));
}

export function observationsForProduct(receipts:Receipt[], code:string):PriceObservation[] {
  return receipts.flatMap(receipt=>receipt.items.filter(item=>item.storeProductCode===code).map(item=>({receiptId:receipt.id,storeProductCode:code,productName:item.productName,storeLabel:receipt.storeLabel,observedAt:receipt.purchasedAt,unitPriceKrw:item.unitPriceKrw,quantity:item.purchasedQuantity,confidence:item.confidence}))).sort((a,b)=>b.observedAt.localeCompare(a.observedAt));
}

export function priceSummary(observations:PriceObservation[]) {
  const prices=observations.map(o=>o.unitPriceKrw);
  return {count:observations.length, latest:prices[0]??null, previous:prices[1]??null, minimum:prices.length?Math.min(...prices):null, maximum:prices.length?Math.max(...prices):null, changeKrw:prices.length>1?prices[0]-prices[1]:null, lastObservedAt:observations[0]?.observedAt??null};
}
