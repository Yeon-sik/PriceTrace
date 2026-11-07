export type Json = string | number | boolean | null | { [key:string]: Json | undefined } | Json[];

type StandardProductLinkRegistrationReturns = {
  execution_id:string;
  standard_product_id:string;
  catalog_product_id:string;
  replayed:boolean;
}[];

type StandardProductLinkOnlyRegistrationArgs = {
  p_idempotency_key:string;
  p_case_id:string;
  p_input_fingerprint:string;
  p_target_fingerprint:string;
  p_input_canonical_json:string;
  p_target_canonical_json:string;
  p_approval_statement:string;
  p_receipt_id:string;
  p_receipt_item_id:string;
  p_receipt_observed_at:string;
  p_standard_product_id:string|null;
  p_catalog_product_id:string|null;
  p_standard_name:string;
  p_brand_name:string|null;
  p_receipt_brand_name:string|null;
  p_official_brand_name:string|null;
  p_official_brand_source_label:string|null;
  p_product_reference_url:string;
  p_listing_name:string;
  p_receipt_product_name:string;
  p_specification_status:string;
  p_content_amount:number;
  p_content_unit:string;
  p_package_count:number;
  p_reference_unit:number;
  p_source_product_code:string;
  p_source_labels:string[];
  p_specification:string;
  p_apparel_size:Json|null;
};

type StandardProductLinkStrictRegistrationArgs = Omit<
  StandardProductLinkOnlyRegistrationArgs,
  "p_specification" | "p_apparel_size"
> & {
  p_coupang_product_url:string;
  p_coupang_listed_price_krw:number;
  p_coupang_quantity:number;
  p_coupang_content_amount:number;
  p_coupang_content_unit:string;
  p_coupang_max_bundle_quantity:number|null;
  p_coupang_max_bundle_listed_price_krw:number|null;
};

export interface Database {
  public: {
    Tables: {
      owner_identity_connections: {
        Row: { user_id: string; entity: "brand" | "store" | "restaurant"; source_id: string; target_id: string; observed_name: string; target_name: string; created_at: string };
        Insert: Record<string, never>;
        Update: Record<string, never>;
      };
