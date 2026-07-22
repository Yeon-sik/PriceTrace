import type { Receipt, SettlementState } from "@/domain/types";
import type { SettlementBackup } from "./settlement.repository";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type RemoteRecipient = { id:string; name:string; created_at:string };
type RemoteAllocation = { id:string; receipt_item_id:string; recipient_id:string; quantity:number; memo:string; created_at:string; updated_at:string };
type RemoteStatus = { recipient_id:string; delivery_status:SettlementState["settlementStatuses"][number]["deliveryStatus"]; payment_status:SettlementState["settlementStatuses"][number]["paymentStatus"]; paid_at:string|null };

export class SupabaseSettlementRepository {
  private client() { return getSupabaseBrowserClient(); }

  async currentUser() {
    const client=this.client(); if(!client) return null;
    const {data,error}=await client.auth.getUser(); if(error) throw error; return data.user;
  }

  async syncReceipt(receipt:Receipt) {
    const client=this.client(); const user=await this.currentUser(); if(!client||!user) return;
    const {data:store,error:storeError}=await client.from("stores").upsert({user_id:user.id,name:receipt.storeLabel},{onConflict:"user_id,name"}).select("id").single();
    if(storeError) throw storeError;
    const {data:remoteReceipt,error:receiptError}=await client.from("receipts").upsert({user_id:user.id,store_id:store.id,purchased_at:receipt.purchasedAt,transaction_number:receipt.transactionNumber,total_price_krw:receipt.totalPriceKrw,currency:"KRW"},{onConflict:"user_id,store_id,transaction_number"}).select("id").single();
    if(receiptError) throw receiptError;
    for(const item of receipt.items){
      const {data:existingStoreProduct}=await client.from("store_products").select("id,product_id").eq("user_id",user.id).eq("store_id",store.id).eq("store_product_code",item.sourceProductCode).maybeSingle();
      let storeProductId:string;
      if(existingStoreProduct){storeProductId=existingStoreProduct.id;}
      else {const {data:product,error:productError}=await client.from("products").insert({user_id:user.id,name:item.productName,purchase_type:"retail_product",category_tags:[]}).select("id").single();if(productError) throw productError;const {data:storeProduct,error:storeProductError}=await client.from("store_products").insert({user_id:user.id,store_id:store.id,product_id:product.id,store_product_code:item.sourceProductCode}).select("id").single();if(storeProductError) throw storeProductError;storeProductId=storeProduct.id;}
      const {error:itemError}=await client.from("receipt_items").upsert({id:item.id,user_id:user.id,receipt_id:remoteReceipt.id,store_product_id:storeProductId,unit_price_krw:item.unitPriceKrw,purchased_quantity:item.quantityValue,total_price_krw:item.totalPriceKrw,purchase_numbers:item.sourceLineReferences});
      if(itemError) throw itemError;
      const {data:mapping,error:mappingError}=await client.from("source_product_mappings").select("catalog_product_id").eq("source_label",receipt.storeLabel).eq("source_product_code",item.sourceProductCode).eq("review_status","verified").maybeSingle();
      if(mappingError) throw mappingError;
      const {error:observationError}=await client.from("price_observations").upsert({user_id:user.id,store_product_id:storeProductId,receipt_item_id:item.id,catalog_product_id:mapping?.catalog_product_id??null,observed_at:receipt.purchasedAt,unit_price_krw:item.unitPriceKrw,quantity:item.quantityValue,measurement_unit:"each",location_label:receipt.storeLabel,verification_status:"verified",verified_at:new Date().toISOString()},{onConflict:"user_id,receipt_item_id"});
      if(observationError) throw observationError;
    }
  }

  async load(receipt:Receipt):Promise<SettlementBackup|null>{
    const client=this.client(); const user=await this.currentUser(); if(!client||!user) return null;
    const {data:recipients,error:recipientError}=await client.from("recipients").select("id,name,created_at").eq("user_id",user.id);
    if(recipientError) throw recipientError;
    const itemIds=receipt.items.map(item=>item.id); const allocations=itemIds.length?(await client.from("allocations").select("id,receipt_item_id,recipient_id,quantity,memo,created_at,updated_at").eq("user_id",user.id).in("receipt_item_id",itemIds)).data??[]:[];
    const allocationError=itemIds.length?(await client.from("allocations").select("id").eq("user_id",user.id).in("receipt_item_id",itemIds)).error:null; if(allocationError) throw allocationError;
    const {data:statuses,error:statusError}=await client.from("settlement_statuses").select("recipient_id,delivery_status,payment_status,paid_at").eq("user_id",user.id); if(statusError) throw statusError;
    return {schemaVersion:1,exportedAt:new Date().toISOString(),sourceReceiptId:receipt.id,recipients:(recipients??[] as RemoteRecipient[]).map(r=>({id:r.id,name:r.name,createdAt:r.created_at})),allocations:(allocations as RemoteAllocation[]).map(a=>({id:a.id,receiptItemId:a.receipt_item_id,recipientId:a.recipient_id,quantity:a.quantity,memo:a.memo,createdAt:a.created_at,updatedAt:a.updated_at})),settlementStatuses:(statuses as RemoteStatus[]).map(s=>({recipientId:s.recipient_id,deliveryStatus:s.delivery_status,paymentStatus:s.payment_status,paidAt:s.paid_at}))};
  }

  async save(state:SettlementState, receipt:Receipt){
    const client=this.client(); const user=await this.currentUser(); if(!client||!user) return;
    if(state.recipients.length) { const {error}=await client.from("recipients").upsert(state.recipients.map(r=>({id:r.id,user_id:user.id,name:r.name,created_at:r.createdAt}))); if(error) throw error; }
    if(state.settlementStatuses.length) { const {error}=await client.from("settlement_statuses").upsert(state.settlementStatuses.map(s=>({recipient_id:s.recipientId,user_id:user.id,delivery_status:s.deliveryStatus,payment_status:s.paymentStatus,paid_at:s.paidAt}))); if(error) throw error; }
    if(state.allocations.length) { const {error}=await client.from("allocations").upsert(state.allocations.map(a=>({id:a.id,user_id:user.id,receipt_item_id:a.receiptItemId,recipient_id:a.recipientId,quantity:a.quantity,memo:a.memo,created_at:a.createdAt,updated_at:a.updatedAt}))); if(error) throw error; }
    const existingIds=state.allocations.map(a=>a.id); const itemIds=receipt.items.map(item=>item.id);
    if(itemIds.length){let query=client.from("allocations").delete().eq("user_id",user.id).in("receipt_item_id",itemIds);if(existingIds.length)query=query.not("id","in",`(${existingIds.join(",")})`);const {error}=await query;if(error)throw error;}
  }
}
