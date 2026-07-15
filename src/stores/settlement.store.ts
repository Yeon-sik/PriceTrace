"use client";
import { create } from "zustand";
import type { Allocation, DeliveryStatus, PaymentStatus, Recipient, SettlementState } from "@/domain/types";
import { assertAllocation, assertRecipientDeletable } from "@/domain/settlement";
import { createBackup, emptySettlement, SettlementBackupSchema } from "@/repositories/settlement.repository";
import type { Receipt } from "@/domain/types";
import { LocalStorageSettlementRepository } from "@/repositories/local-storage-settlement.repository";
import { SupabaseSettlementRepository } from "@/repositories/supabase-settlement.repository";
const uuid=()=>globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const now=()=>new Date().toISOString();
interface Store extends SettlementState { hydrated:boolean; remoteHydrated:boolean; error:string|null; hydrate:(receipt:Receipt)=>void; addRecipient:(name:string)=>void; renameRecipient:(id:string,name:string)=>void; deleteRecipient:(id:string)=>void; saveAllocation:(receipt:Receipt,input:{id?:string;receiptItemId:string;recipientId:string;quantity:number;memo:string})=>void; deleteAllocation:(id:string)=>void; setStatus:(id:string,field:"deliveryStatus"|"paymentStatus",value:DeliveryStatus|PaymentStatus)=>void; exportBackup:(receiptId:string)=>string; importBackup:(input:string,receipt:Receipt)=>void; reset:()=>void; }
const repo=new LocalStorageSettlementRepository(); const remoteRepo=new SupabaseSettlementRepository();
export const useSettlementStore=create<Store>((set,get)=>({ ...emptySettlement(), hydrated:false,remoteHydrated:false,error:null,
 hydrate:async(receipt)=>{const backup=repo.load(receipt.id); set(backup?{...backup,hydrated:true,remoteHydrated:false,error:null}:{...emptySettlement(),hydrated:true,remoteHydrated:false,error:null}); try {if(await remoteRepo.currentUser()){await remoteRepo.syncReceipt(receipt);const remoteBackup=await remoteRepo.load(receipt);if(remoteBackup)set({...remoteBackup,hydrated:true,remoteHydrated:true,error:null});else {await remoteRepo.save(get(),receipt);set({remoteHydrated:true});}}else set({remoteHydrated:true});}catch(error){set({remoteHydrated:true,error:error instanceof Error?`Supabase 동기화 실패: ${error.message}`:"Supabase 동기화 실패"});}},
 addRecipient:(name)=>{const trimmed=name.trim(); if(!trimmed) throw new Error("수령자 이름을 입력하세요."); const recipient:Recipient={id:uuid(),name:trimmed,createdAt:now()}; set(s=>({recipients:[...s.recipients,recipient],settlementStatuses:[...s.settlementStatuses,{recipientId:recipient.id,deliveryStatus:"준비 중",paymentStatus:"미입금",paidAt:null}]}));},
 renameRecipient:(id,name)=>{const trimmed=name.trim(); if(!trimmed) throw new Error("수령자 이름을 입력하세요."); set(s=>({recipients:s.recipients.map(r=>r.id===id?{...r,name:trimmed}:r)}));},
 deleteRecipient:(id)=>{assertRecipientDeletable(id,get().allocations); set(s=>({recipients:s.recipients.filter(r=>r.id!==id),settlementStatuses:s.settlementStatuses.filter(x=>x.recipientId!==id)}));},
 saveAllocation:(receipt,input)=>{assertAllocation(receipt,get().allocations,input.receiptItemId,input.quantity,input.id); const stamp=now(); set(s=>{const allocation:Allocation={id:input.id??uuid(),receiptItemId:input.receiptItemId,recipientId:input.recipientId,quantity:input.quantity,memo:input.memo,createdAt:input.id?s.allocations.find(a=>a.id===input.id)?.createdAt??stamp:stamp,updatedAt:stamp}; return {allocations:input.id?s.allocations.map(a=>a.id===input.id?allocation:a):[...s.allocations,allocation]};});},
 deleteAllocation:(id)=>set(s=>({allocations:s.allocations.filter(a=>a.id!==id)})),
 setStatus:(id,field,value)=>set(s=>({settlementStatuses:s.settlementStatuses.map(status=>status.recipientId===id?{...status,[field]:value,paidAt:field==="paymentStatus"&&value==="입금 완료"?now():field==="paymentStatus"?null:status.paidAt}:status)})),
 exportBackup:(receiptId)=>JSON.stringify(createBackup(get(),receiptId),null,2),
 importBackup:(input,receipt)=>{const parsed=SettlementBackupSchema.parse(JSON.parse(input)); if(parsed.sourceReceiptId!==receipt.id) throw new Error("다른 영수증의 백업입니다."); parsed.allocations.forEach(a=>assertAllocation(receipt,parsed.allocations.filter(x=>x.id!==a.id),a.receiptItemId,a.quantity)); set({...parsed,error:null});},
 reset:()=>{repo.clear(); set({...emptySettlement(),hydrated:true,remoteHydrated:false,error:null});}
}));
export async function persistSettlement(receipt:Receipt) { const state=useSettlementStore.getState(); if(!state.hydrated||!state.remoteHydrated)return; repo.save(createBackup(state,receipt.id)); try {if(await remoteRepo.currentUser())await remoteRepo.save(state,receipt);}catch(error){useSettlementStore.setState({error:error instanceof Error?`Supabase 저장 실패: ${error.message}`:"Supabase 저장 실패"});} }
