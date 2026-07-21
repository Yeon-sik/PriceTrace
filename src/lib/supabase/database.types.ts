export type Json = string | number | boolean | null | { [key:string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: { Row: { id:string; display_name:string|null; created_at:string }; Insert: { id:string; display_name?:string|null }; Update: { display_name?:string|null } };
      stores: { Row: { id:string; user_id:string; name:string; created_at:string }; Insert: { id?:string; user_id:string; name:string }; Update: { name?:string } };
      products: { Row: { id:string; name:string; created_at:string }; Insert: { id?:string; name:string }; Update: { name?:string } };
      store_products: { Row: { id:string; user_id:string; store_id:string; product_id:string; store_product_code:string }; Insert: { id?:string; user_id:string; store_id:string; product_id:string; store_product_code:string }; Update: { store_product_code?:string } };
      receipts: { Row: { id:string; user_id:string; store_id:string; purchased_at:string; transaction_number:string; total_price_krw:number }; Insert: { id?:string; user_id:string; store_id:string; purchased_at:string; transaction_number:string; total_price_krw:number }; Update: { purchased_at?:string; transaction_number?:string; total_price_krw?:number } };
      receipt_items: { Row: { id:string; user_id:string; receipt_id:string; store_product_id:string; unit_price_krw:number; purchased_quantity:number; total_price_krw:number; purchase_numbers:number[] }; Insert: { id?:string; user_id:string; receipt_id:string; store_product_id:string; unit_price_krw:number; purchased_quantity:number; total_price_krw:number; purchase_numbers:number[] }; Update: { unit_price_krw?:number; purchased_quantity?:number; total_price_krw?:number; purchase_numbers?:number[] } };
      price_observations: { Row: { id:string; user_id:string; store_product_id:string; receipt_item_id:string; observed_at:string; unit_price_krw:number }; Insert: { id?:string; user_id:string; store_product_id:string; receipt_item_id:string; observed_at:string; unit_price_krw:number }; Update: { observed_at?:string; unit_price_krw?:number } };
      recipients: { Row: { id:string; user_id:string; name:string; created_at:string }; Insert: { id?:string; user_id:string; name:string }; Update: { name?:string } };
      allocations: { Row: { id:string; user_id:string; receipt_item_id:string; recipient_id:string; quantity:number; memo:string }; Insert: { id?:string; user_id:string; receipt_item_id:string; recipient_id:string; quantity:number; memo?:string }; Update: { quantity?:number; memo?:string } };
      settlement_statuses: { Row: { recipient_id:string; user_id:string; delivery_status:string; payment_status:string; paid_at:string|null }; Insert: { recipient_id:string; user_id:string; delivery_status:string; payment_status:string; paid_at?:string|null }; Update: { delivery_status?:string; payment_status?:string; paid_at?:string|null } };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
