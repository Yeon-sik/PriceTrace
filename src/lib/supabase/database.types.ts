export type Json = string | number | boolean | null | { [key:string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: { Row: { id:string; display_name:string|null; created_at:string }; Insert: { id:string; display_name?:string|null }; Update: { display_name?:string|null } };
      stores: { Row: { id:string; user_id:string; name:string; created_at:string }; Insert: { id?:string; user_id:string; name:string }; Update: { name?:string } };
      catalog_categories: { Row: { id:string; purchase_type:string; parent_id:string|null; slug:string; display_name:string; depth:number }; Insert: { id?:string; purchase_type:string; parent_id?:string|null; slug:string; display_name:string; depth?:number }; Update: { parent_id?:string|null; display_name?:string; depth?:number } };
      standard_products: { Row: { id:string; purchase_type:string; canonical_name:string; brand:string|null; product_reference_url:string|null; category_id:string|null; status:string; created_by:string|null; created_at:string; updated_at:string }; Insert: { id?:string; purchase_type:string; canonical_name:string; brand?:string|null; product_reference_url?:string|null; category_id?:string|null; status?:string; created_by?:string|null }; Update: { canonical_name?:string; brand?:string|null; product_reference_url?:string|null; category_id?:string|null; status?:string } };
      standard_product_images: { Row: { standard_product_id:string; source_type:"upload"|"external_url"; image_url:string; storage_path:string|null; mime_type:string|null; file_size_bytes:number|null; width:number|null; height:number|null; created_by:string|null; created_at:string; updated_at:string }; Insert: { standard_product_id:string; source_type:"upload"|"external_url"; image_url:string; storage_path?:string|null; mime_type?:string|null; file_size_bytes?:number|null; width?:number|null; height?:number|null; created_by?:string|null; updated_at?:string }; Update: { source_type?:"upload"|"external_url"; image_url?:string; storage_path?:string|null; mime_type?:string|null; file_size_bytes?:number|null; width?:number|null; height?:number|null; created_by?:string|null; updated_at?:string } };
      catalog_products: { Row: { id:string; standard_product_id:string; purchase_type:string; canonical_name:string; brand:string|null; specification:string|null; specification_status:"verified"|"placeholder"; content_amount:number|null; content_unit:string|null; package_count:number; reference_unit:number; listing_reference_url:string|null; category_id:string|null; attributes:Json; status:string; created_by:string|null; created_at:string; updated_at:string }; Insert: { id?:string; standard_product_id:string; purchase_type:string; canonical_name:string; brand?:string|null; specification?:string|null; specification_status?:"verified"|"placeholder"; content_amount?:number|null; content_unit?:string|null; package_count?:number; reference_unit?:number; listing_reference_url?:string|null; category_id?:string|null; attributes?:Json; status?:string; created_by?:string|null }; Update: { standard_product_id?:string; canonical_name?:string; brand?:string|null; specification?:string|null; specification_status?:"verified"|"placeholder"; content_amount?:number|null; content_unit?:string|null; package_count?:number; reference_unit?:number; listing_reference_url?:string|null; category_id?:string|null; attributes?:Json; status?:string } };
      standard_product_coupang_prices: { Row: { id:string; standard_product_id:string; product_url:string; listed_price_krw:number; quantity:number; content_amount:number|null; content_unit:string|null; observed_at:string; created_by:string|null; created_at:string }; Insert: { id?:string; standard_product_id:string; product_url:string; listed_price_krw:number; quantity?:number; content_amount?:number|null; content_unit?:string|null; observed_at?:string; created_by?:string|null }; Update: { product_url?:string; listed_price_krw?:number; quantity?:number; content_amount?:number|null; content_unit?:string|null; observed_at?:string; created_by?:string|null } };
      market_price_observations: { Row: { id:string; catalog_product_id:string; seller_name:string; product_url:string; listed_price_krw:number; shipping_fee_krw:number; minimum_order_quantity:number; observed_at:string; verification_status:string; verified_by:string|null; verified_at:string|null; created_at:string }; Insert: { id?:string; catalog_product_id:string; seller_name:string; product_url:string; listed_price_krw:number; shipping_fee_krw?:number; minimum_order_quantity?:number; observed_at:string; verification_status?:string; verified_by?:string|null; verified_at?:string|null }; Update: { seller_name?:string; product_url?:string; listed_price_krw?:number; shipping_fee_krw?:number; minimum_order_quantity?:number; observed_at?:string; verification_status?:string; verified_by?:string|null; verified_at?:string|null } };
      source_product_mappings: { Row: { id:string; source_label:string; source_product_code:string; catalog_product_id:string; matching_method:string; confidence:number; review_status:string; created_by:string|null; reviewed_by:string|null; reviewed_at:string|null; created_at:string; updated_at:string }; Insert: { id?:string; source_label:string; source_product_code:string; catalog_product_id:string; matching_method?:string; confidence?:number; review_status?:string; created_by?:string|null; reviewed_by?:string|null; reviewed_at?:string|null }; Update: { source_label?:string; source_product_code?:string; catalog_product_id?:string; matching_method?:string; confidence?:number; review_status?:string; reviewed_by?:string|null; reviewed_at?:string|null } };
      products: { Row: { id:string; user_id:string; name:string; purchase_type:string; category_id:string|null; category_tags:string[]; created_at:string }; Insert: { id?:string; user_id:string; name:string; purchase_type?:string; category_id?:string|null; category_tags?:string[] }; Update: { name?:string; purchase_type?:string; category_id?:string|null; category_tags?:string[] } };
      store_products: { Row: { id:string; user_id:string; store_id:string; product_id:string; store_product_code:string }; Insert: { id?:string; user_id:string; store_id:string; product_id:string; store_product_code:string }; Update: { store_product_code?:string } };
      receipts: { Row: { id:string; user_id:string; store_id:string; purchased_at:string; transaction_number:string; total_price_krw:number }; Insert: { id?:string; user_id:string; store_id:string; purchased_at:string; transaction_number:string; total_price_krw:number }; Update: { purchased_at?:string; transaction_number?:string; total_price_krw?:number } };
      receipt_items: { Row: { id:string; user_id:string; receipt_id:string; store_product_id:string; unit_price_krw:number; purchased_quantity:number; total_price_krw:number; purchase_numbers:number[] }; Insert: { id?:string; user_id:string; receipt_id:string; store_product_id:string; unit_price_krw:number; purchased_quantity:number; total_price_krw:number; purchase_numbers:number[] }; Update: { unit_price_krw?:number; purchased_quantity?:number; total_price_krw?:number; purchase_numbers?:number[] } };
      price_observations: { Row: { id:string; user_id:string; store_product_id:string; receipt_item_id:string; catalog_product_id:string|null; observed_at:string; unit_price_krw:number; measurement_unit:string; location_label:string|null; attributes:Json }; Insert: { id?:string; user_id:string; store_product_id:string; receipt_item_id:string; catalog_product_id?:string|null; observed_at:string; unit_price_krw:number; measurement_unit?:string; location_label?:string|null; attributes?:Json }; Update: { catalog_product_id?:string|null; observed_at?:string; unit_price_krw?:number; measurement_unit?:string; location_label?:string|null; attributes?:Json } };
      recipients: { Row: { id:string; user_id:string; name:string; created_at:string }; Insert: { id?:string; user_id:string; name:string }; Update: { name?:string } };
      allocations: { Row: { id:string; user_id:string; receipt_item_id:string; recipient_id:string; quantity:number; memo:string }; Insert: { id?:string; user_id:string; receipt_item_id:string; recipient_id:string; quantity:number; memo?:string }; Update: { quantity?:number; memo?:string } };
      settlement_statuses: { Row: { recipient_id:string; user_id:string; delivery_status:string; payment_status:string; paid_at:string|null }; Insert: { recipient_id:string; user_id:string; delivery_status:string; payment_status:string; paid_at?:string|null }; Update: { delivery_status?:string; payment_status?:string; paid_at?:string|null } };
    };
    Views: Record<string, never>;
    Functions: {
      get_public_exact_standard_product_catalog: {
        Args: Record<string, never>;
        Returns: {
          source_label:string;
          source_product_code:string;
          catalog_product_id:string;
          standard_product_id:string;
          standard_name:string;
          content_amount:number;
          content_unit:string;
          package_count:number;
          reference_unit:number;
          coupang_listed_price_krw:number|null;
          coupang_quantity:number|null;
          coupang_content_amount:number|null;
          coupang_content_unit:string|null;
          coupang_product_url:string|null;
          coupang_observed_at:string|null;
        }[];
      };
      get_public_standard_product_catalog: {
        Args: Record<string, never>;
        Returns: {
          source_product_code:string;
          catalog_product_id:string;
          standard_product_id:string;
          standard_name:string;
          content_amount:number;
          content_unit:string;
          package_count:number;
          reference_unit:number;
          coupang_listed_price_krw:number|null;
          coupang_quantity:number|null;
          coupang_content_amount:number|null;
          coupang_content_unit:string|null;
          coupang_product_url:string|null;
          coupang_observed_at:string|null;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
