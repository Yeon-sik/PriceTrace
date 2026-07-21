import {describe,expect,it} from "vitest";
import {detectPriceAnomaly,detectDuplicate,maskSensitive,receiptFingerprint} from "./production";
import {mapReceipt} from "./receipt";
const receipt=mapReceipt({receipt_metadata:{store_name:"매장",date:"2026-07-18",transaction_number:"T1",currency:"KRW",receipt_total_krw:1000,item_count:1},items:[{purchase_numbers:[1],product_name:"상품",store_product_code:"P1",unit_price_krw:1000,quantity:1,total_price_krw:1000,name_confidence:"high"}]});
describe("production controls",()=>{it("민감값을 마스킹하고 중복 fingerprint를 만든다",()=>{expect(maskSensitive("1234-5678-9012-3456")).toBe("1234********3456");const fingerprint=receiptFingerprint(receipt);expect(detectDuplicate(receipt,new Set([fingerprint])).isDuplicate).toBe(true);});it("기준 중앙값 대비 이상 가격을 탐지한다",()=>expect(detectPriceAnomaly(5000,[1000,1100,1200]).isAnomaly).toBe(true));});
