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
      profiles: { Row: { id:string; display_name:string|null; created_at:string }; Insert: { id:string; display_name?:string|null }; Update: { display_name?:string|null } };
      stores: { Row: { id:string; user_id:string; name:string; merchant_name:string|null; branch_name:string|null; business_kind:string; merchant_id:string|null; catalog_namespace:string|null; business_registration_number:string|null; address:string|null; phone:string|null; identity_fingerprint:string|null; created_at:string }; Insert: { id?:string; user_id:string; name:string; merchant_name?:string|null; branch_name?:string|null; business_kind?:string; merchant_id?:string|null; catalog_namespace?:string|null; business_registration_number?:string|null; address?:string|null; phone?:string|null; identity_fingerprint?:string|null }; Update: { name?:string; merchant_name?:string|null; branch_name?:string|null; business_kind?:string; merchant_id?:string|null; catalog_namespace?:string|null; business_registration_number?:string|null; address?:string|null; phone?:string|null; identity_fingerprint?:string|null } };
      catalog_categories: { Row: { id:string; purchase_type:string; parent_id:string|null; slug:string; display_name:string; depth:number }; Insert: { id?:string; purchase_type:string; parent_id?:string|null; slug:string; display_name:string; depth?:number }; Update: { parent_id?:string|null; display_name?:string; depth?:number } };
      brands: { Row: { id:string; canonical_name:string; normalized_name:string; logo_url:string|null; official_site_url:string|null; status:string; created_by:string|null; created_at:string; updated_at:string }; Insert: { id?:string; canonical_name:string; logo_url?:string|null; official_site_url?:string|null; status?:string; created_by?:string|null }; Update: { canonical_name?:string; logo_url?:string|null; official_site_url?:string|null; status?:string } };
      brand_aliases: { Row: { id:string; brand_id:string; alias_name:string; normalized_alias:string; locale:string|null; created_by:string|null; created_at:string }; Insert: { id?:string; brand_id:string; alias_name:string; locale?:string|null; created_by?:string|null }; Update: { brand_id?:string; alias_name?:string; locale?:string|null } };
      standard_products: { Row: { id:string; purchase_type:string; canonical_name:string; brand_id:string|null; brand:string|null; product_reference_url:string|null; category_id:string|null; status:string; verification_status:"verified"|"unverified"; created_by:string|null; created_at:string; updated_at:string }; Insert: { id?:string; purchase_type:string; canonical_name:string; brand_id?:string|null; product_reference_url?:string|null; category_id?:string|null; status?:string; verification_status?:"verified"|"unverified"; created_by?:string|null }; Update: { canonical_name?:string; brand_id?:string|null; product_reference_url?:string|null; category_id?:string|null; status?:string; verification_status?:"verified"|"unverified" } };
      standard_product_brand_evidence: { Row: { id:string; standard_product_id:string; catalog_product_id:string|null; brand_id:string; observed_name:string; normalized_observed_name:string; source_type:"receipt"|"official_store"|"manual"|"legacy_import"; source_label:string|null; source_product_code:string|null; source_url:string|null; observed_at:string; created_by:string|null; created_at:string }; Insert: { id?:string; standard_product_id:string; catalog_product_id?:string|null; brand_id:string; observed_name:string; source_type:"receipt"|"official_store"|"manual"|"legacy_import"; source_label?:string|null; source_product_code?:string|null; source_url?:string|null; observed_at?:string; created_by?:string|null }; Update: { brand_id?:string; observed_name?:string; source_type?:"receipt"|"official_store"|"manual"|"legacy_import"; source_label?:string|null; source_product_code?:string|null; source_url?:string|null; observed_at?:string } };
      standard_product_link_executions: { Row: { id:string; idempotency_key:string; case_id:string; input_fingerprint:string; target_fingerprint:string; status:"in_progress"|"applied"; standard_product_id:string|null; catalog_product_id:string|null; result:Json|null; request_payload:Json|null; proposal_input:Json|null; proposal_target:Json|null; created_by:string|null; created_at:string; applied_at:string|null }; Insert: { id?:string; idempotency_key:string; case_id:string; input_fingerprint:string; target_fingerprint:string; status?:"in_progress"|"applied"; standard_product_id?:string|null; catalog_product_id?:string|null; result?:Json|null; request_payload?:Json|null; proposal_input?:Json|null; proposal_target?:Json|null; created_by?:string|null; applied_at?:string|null }; Update: { status?:"in_progress"|"applied"; standard_product_id?:string|null; catalog_product_id?:string|null; result?:Json|null; request_payload?:Json|null; proposal_input?:Json|null; proposal_target?:Json|null; applied_at?:string|null } };
      standard_product_link_approvals: { Row: { id:string; case_id:string; input_fingerprint:string; target_fingerprint:string; approval_statement:string; user_approval_text:string|null; approval_policy:string; proposal_input:Json; proposal_target:Json; approved_by:string; approved_at:string; consumed_execution_id:string|null; consumed_at:string|null }; Insert: { id?:string; case_id:string; input_fingerprint:string; target_fingerprint:string; approval_statement:string; user_approval_text?:string|null; approval_policy:string; proposal_input:Json; proposal_target:Json; approved_by:string; approved_at?:string; consumed_execution_id?:string|null; consumed_at?:string|null }; Update: { user_approval_text?:string|null; consumed_execution_id?:string|null; consumed_at?:string|null } };
      standard_product_official_image_approvals: { Row: { id:string; idempotency_key:string; case_id:string; input_fingerprint:string; target_fingerprint:string; approval_statement:string; proposal:Json; standard_product_id:string; catalog_product_id:string; official_link_id:string; image_url:string; content_hash:string; media_type:"image/jpeg"|"image/png"|"image/webp"; byte_length:number; applied_action:"created"|"reused_exact"; result:Json; approved_by:string; approved_at:string }; Insert: { id?:string; idempotency_key:string; case_id:string; input_fingerprint:string; target_fingerprint:string; approval_statement:string; proposal:Json; standard_product_id:string; catalog_product_id:string; official_link_id:string; image_url:string; content_hash:string; media_type:"image/jpeg"|"image/png"|"image/webp"; byte_length:number; applied_action:"created"|"reused_exact"; result:Json; approved_by:string; approved_at?:string }; Update: Record<string, never> };
      standard_catalog_admin_actions: { Row: { id:string; action:string; target_id:string; payload:Json; confirmation:string; created_by:string; created_at:string }; Insert: { id?:string; action:string; target_id:string; payload:Json; confirmation:string; created_by:string; created_at?:string }; Update: Record<string, never> };
      standard_product_official_links: { Row: { id:string; channel_id:string; source_product_code_namespace:string; source_product_code:string; catalog_product_id:string; created_by:string|null; created_at:string }; Insert: { id?:string; channel_id:string; source_product_code_namespace:string; source_product_code:string; catalog_product_id:string; created_by?:string|null }; Update: { catalog_product_id?:string } };
      standard_product_official_link_evidence: { Row: { id:string; official_link_id:string; snapshot_id:string; snapshot_hash:string; source_name_raw:string; specification_text_raw:string; source_refs:Json; product_reference_url:string; link_execution_id:string; created_by:string|null; created_at:string }; Insert: { id?:string; official_link_id:string; snapshot_id:string; snapshot_hash:string; source_name_raw:string; specification_text_raw:string; source_refs:Json; product_reference_url:string; link_execution_id:string; created_by?:string|null }; Update: { snapshot_id?:string; snapshot_hash?:string; source_name_raw?:string; specification_text_raw?:string; source_refs?:Json; product_reference_url?:string } };
      standard_product_images: { Row: { standard_product_id:string; source_type:"upload"|"external_url"; image_url:string; storage_path:string|null; mime_type:string|null; file_size_bytes:number|null; width:number|null; height:number|null; created_by:string|null; created_at:string; updated_at:string }; Insert: { standard_product_id:string; source_type:"upload"|"external_url"; image_url:string; storage_path?:string|null; mime_type?:string|null; file_size_bytes?:number|null; width?:number|null; height?:number|null; created_by?:string|null; updated_at?:string }; Update: { source_type?:"upload"|"external_url"; image_url?:string; storage_path?:string|null; mime_type?:string|null; file_size_bytes?:number|null; width?:number|null; height?:number|null; created_by?:string|null; updated_at?:string } };
      catalog_products: { Row: { id:string; standard_product_id:string; purchase_type:string; canonical_name:string; brand:string|null; specification:string|null; specification_status:"verified"|"placeholder"; content_amount:number|null; content_unit:string|null; package_count:number; reference_unit:number; listing_reference_url:string|null; category_id:string|null; attributes:Json; status:string; verification_status:"verified"|"unverified"; created_by:string|null; created_at:string; updated_at:string }; Insert: { id?:string; standard_product_id:string; purchase_type:string; canonical_name:string; brand?:string|null; specification?:string|null; specification_status?:"verified"|"placeholder"; content_amount?:number|null; content_unit?:string|null; package_count?:number; reference_unit?:number; listing_reference_url?:string|null; category_id?:string|null; attributes?:Json; status?:string; verification_status?:"verified"|"unverified"; created_by?:string|null }; Update: { standard_product_id?:string; canonical_name?:string; brand?:string|null; specification?:string|null; specification_status?:"verified"|"placeholder"; content_amount?:number|null; content_unit?:string|null; package_count?:number; reference_unit?:number; listing_reference_url?:string|null; category_id?:string|null; attributes?:Json; status?:string; verification_status?:"verified"|"unverified" } };
      standard_product_coupang_prices: { Row: { id:string; standard_product_id:string; catalog_product_id:string|null; link_execution_id:string|null; product_url:string; listed_price_krw:number; quantity:number; content_amount:number|null; content_unit:string|null; max_bundle_quantity:number|null; max_bundle_listed_price_krw:number|null; observed_at:string; created_by:string|null; created_at:string }; Insert: { id?:string; standard_product_id:string; catalog_product_id?:string|null; link_execution_id?:string|null; product_url:string; listed_price_krw:number; quantity?:number; content_amount?:number|null; content_unit?:string|null; max_bundle_quantity?:number|null; max_bundle_listed_price_krw?:number|null; observed_at?:string; created_by?:string|null }; Update: { catalog_product_id?:string|null; link_execution_id?:string|null; product_url?:string; listed_price_krw?:number; quantity?:number; content_amount?:number|null; content_unit?:string|null; max_bundle_quantity?:number|null; max_bundle_listed_price_krw?:number|null; observed_at?:string; created_by?:string|null } };
      market_price_observations: { Row: { id:string; catalog_product_id:string; seller_name:string; source_product_code:string|null; product_url:string; listed_price_krw:number; shipping_fee_krw:number; minimum_order_quantity:number; observed_at:string; verification_status:"pending"|"verified"|"unverified"|"rejected"; verified_by:string|null; verified_at:string|null; created_at:string }; Insert: { id?:string; catalog_product_id:string; seller_name:string; source_product_code?:string|null; product_url:string; listed_price_krw:number; shipping_fee_krw?:number; minimum_order_quantity?:number; observed_at:string; verification_status?:"pending"|"verified"|"unverified"|"rejected"; verified_by?:string|null; verified_at?:string|null }; Update: { seller_name?:string; source_product_code?:string|null; product_url?:string; listed_price_krw?:number; shipping_fee_krw?:number; minimum_order_quantity?:number; observed_at?:string; verification_status?:"pending"|"verified"|"unverified"|"rejected"; verified_by?:string|null; verified_at?:string|null } };
      source_product_mappings: { Row: { id:string; source_label:string; source_product_code:string; catalog_product_id:string; matching_method:string; confidence:number; review_status:string; verification_status:"verified"|"unverified"; created_by:string|null; reviewed_by:string|null; reviewed_at:string|null; created_at:string; updated_at:string }; Insert: { id?:string; source_label:string; source_product_code:string; catalog_product_id:string; matching_method?:string; confidence?:number; review_status?:string; verification_status?:"verified"|"unverified"; created_by?:string|null; reviewed_by?:string|null; reviewed_at?:string|null }; Update: { source_label?:string; source_product_code?:string; catalog_product_id?:string; matching_method?:string; confidence?:number; review_status?:string; verification_status?:"verified"|"unverified"; reviewed_by?:string|null; reviewed_at?:string|null } };
      restaurant_categories: { Row: { id:string; parent_id:string|null; slug:string; display_name:string; depth:number; sort_order:number; created_at:string }; Insert: { id?:string; parent_id?:string|null; slug:string; display_name:string; depth?:number; sort_order?:number; created_at?:string }; Update: { parent_id?:string|null; display_name?:string; depth?:number; sort_order?:number } };
      restaurants: { Row: { id:string; canonical_name:string; brand_id:string|null; category_id:string|null; legal_name:string|null; cuisine_type:string|null; official_site_url:string|null; review_status:"pending"|"verified"|"rejected"; status:"active"|"archived"; verification_status:"verified"|"unverified"; created_by:string|null; reviewed_by:string|null; reviewed_at:string|null; created_at:string; updated_at:string }; Insert: { id?:string; canonical_name:string; brand_id?:string|null; category_id?:string|null; legal_name?:string|null; cuisine_type?:string|null; official_site_url?:string|null; review_status?:"pending"|"verified"|"rejected"; status?:"active"|"archived"; verification_status?:"verified"|"unverified"; created_by?:string|null; reviewed_by?:string|null; reviewed_at?:string|null }; Update: { canonical_name?:string; brand_id?:string|null; category_id?:string|null; legal_name?:string|null; cuisine_type?:string|null; official_site_url?:string|null; review_status?:"pending"|"verified"|"rejected"; status?:"active"|"archived"; verification_status?:"verified"|"unverified"; reviewed_by?:string|null; reviewed_at?:string|null; updated_at?:string } };
      restaurant_locations: { Row: { id:string; restaurant_id:string; source_namespace:string; source_location_code:string; location_label:string|null; official_url:string|null; business_registration_number:string|null; address:string|null; phone:string|null; profile_source_url:string|null; profile_verified_at:string|null; profile_updated_by:string|null; review_status:"pending"|"verified"|"rejected"; verification_status:"verified"|"unverified"; created_by:string|null; reviewed_by:string|null; reviewed_at:string|null; created_at:string }; Insert: { id?:string; restaurant_id:string; source_namespace:string; source_location_code:string; location_label?:string|null; official_url?:string|null; business_registration_number?:string|null; address?:string|null; phone?:string|null; profile_source_url?:string|null; profile_verified_at?:string|null; profile_updated_by?:string|null; review_status?:"pending"|"verified"|"rejected"; verification_status?:"verified"|"unverified"; created_by?:string|null; reviewed_by?:string|null; reviewed_at?:string|null }; Update: { location_label?:string|null; official_url?:string|null; business_registration_number?:string|null; address?:string|null; phone?:string|null; profile_source_url?:string|null; profile_verified_at?:string|null; profile_updated_by?:string|null; review_status?:"pending"|"verified"|"rejected"; verification_status?:"verified"|"unverified"; reviewed_by?:string|null; reviewed_at?:string|null } };
      restaurant_profile_update_audits: { Row: { id:string; restaurant_id:string; restaurant_location_id:string; source_url:string; before_snapshot:Json; after_snapshot:Json; updated_by:string; created_at:string }; Insert: { id?:string; restaurant_id:string; restaurant_location_id:string; source_url:string; before_snapshot:Json; after_snapshot:Json; updated_by:string; created_at?:string }; Update: Record<string, never> };
      restaurant_menus: { Row: { id:string; restaurant_id:string; catalog_product_id:string; canonical_name:string; category_label:string|null; serving_label:string; official_url:string|null; review_status:"pending"|"verified"|"rejected"; status:"active"|"archived"; verification_status:"verified"|"unverified"; created_by:string|null; reviewed_by:string|null; reviewed_at:string|null; created_at:string; updated_at:string }; Insert: { id?:string; restaurant_id:string; catalog_product_id:string; canonical_name:string; category_label?:string|null; serving_label?:string; official_url?:string|null; review_status?:"pending"|"verified"|"rejected"; status?:"active"|"archived"; verification_status?:"verified"|"unverified"; created_by?:string|null; reviewed_by?:string|null; reviewed_at?:string|null }; Update: { canonical_name?:string; category_label?:string|null; serving_label?:string; official_url?:string|null; review_status?:"pending"|"verified"|"rejected"; status?:"active"|"archived"; verification_status?:"verified"|"unverified"; reviewed_by?:string|null; reviewed_at?:string|null; updated_at?:string } };
      restaurant_menu_source_mappings: { Row: { id:string; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; source_product_code_namespace:string; source_product_code:string; evidence_fingerprint:string; review_status:"pending"|"verified"|"rejected"; verification_status:"verified"|"unverified"; created_by:string|null; reviewed_by:string|null; reviewed_at:string|null; created_at:string }; Insert: { id?:string; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; source_product_code_namespace:string; source_product_code:string; evidence_fingerprint:string; review_status?:"pending"|"verified"|"rejected"; verification_status?:"verified"|"unverified"; created_by?:string|null; reviewed_by?:string|null; reviewed_at?:string|null }; Update: { review_status?:"pending"|"verified"|"rejected"; verification_status?:"verified"|"unverified"; reviewed_by?:string|null; reviewed_at?:string|null } };
      restaurant_menu_receipt_observations: { Row: { id:string; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; source_menu_mapping_id:string|null; owner_user_id:string; price_observation_id:string; receipt_id:string; receipt_item_id:string; observed_on:string; time_precision:"date"; unit_price_krw:number; quantity:number; total_price_krw:number; source_type:"database_receipt"; evidence_snapshot:Json; evidence_fingerprint:string; verification_status:"verified"; verified_by:string; verified_at:string; created_at:string }; Insert: { id?:string; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; source_menu_mapping_id?:string|null; owner_user_id:string; price_observation_id:string; receipt_id:string; receipt_item_id:string; observed_on:string; time_precision?:"date"; unit_price_krw:number; quantity:number; total_price_krw:number; source_type?:"database_receipt"; evidence_snapshot:Json; evidence_fingerprint:string; verification_status?:"verified"; verified_by:string; verified_at?:string }; Update: Record<string, never> };
      restaurant_fulfillment_evidence: { Row: { id:string; restaurant_id:string; fulfillment_type:"delivery"|"takeout"|"dine_in"; evidence_type:"receipt"|"manual"; receipt_observation_id:string|null; created_by:string; verified_by:string; verified_at:string; created_at:string }; Insert: { id?:string; restaurant_id:string; fulfillment_type:"delivery"|"takeout"|"dine_in"; evidence_type:"receipt"|"manual"; receipt_observation_id?:string|null; created_by:string; verified_by:string; verified_at?:string }; Update: Record<string, never> };
      restaurant_menu_registration_executions: { Row: { id:string; idempotency_key:string; request_payload:Json; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; catalog_product_id:string; receipt_observation_id:string; created_by:string; created_at:string }; Insert: { id?:string; idempotency_key:string; request_payload:Json; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; catalog_product_id:string; receipt_observation_id:string; created_by:string }; Update: Record<string, never> };
      restaurant_menu_option_links: { Row: { id:string; restaurant_id:string; parent_menu_id:string; option_menu_id:string; link_source:"automatic"|"manual"; confidence:number; evidence_snapshot:Json; created_by:string; created_at:string; updated_at:string }; Insert: { id?:string; restaurant_id:string; parent_menu_id:string; option_menu_id:string; link_source:"automatic"|"manual"; confidence:number; evidence_snapshot?:Json; created_by:string; created_at?:string; updated_at?:string }; Update: { parent_menu_id?:string; link_source?:"automatic"|"manual"; confidence?:number; evidence_snapshot?:Json; updated_at?:string } };
      restaurant_menu_manual_observations: { Row: { id:string; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; observed_on:string; unit_price_krw:number; quantity:number; total_price_krw:number; source_url:string|null; note:string|null; source_snapshot:Json; verification_status:"unverified"|"verified"|"rejected"; created_by:string; created_at:string }; Insert: { id?:string; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; observed_on:string; unit_price_krw:number; quantity:number; total_price_krw:number; source_url?:string|null; note?:string|null; source_snapshot:Json; verification_status?:"unverified"|"verified"|"rejected"; created_by:string; created_at?:string }; Update: Record<string, never> };
      admin_unverified_product_sale_registrations: { Row: { id:string; idempotency_key:string; request_payload:Json; standard_product_id:string; catalog_product_id:string; market_price_observation_id:string; created_by:string; created_at:string }; Insert: { id?:string; idempotency_key:string; request_payload:Json; standard_product_id:string; catalog_product_id:string; market_price_observation_id:string; created_by:string; created_at?:string }; Update: Record<string, never> };
      restaurant_menu_manual_registration_executions: { Row: { id:string; idempotency_key:string; request_payload:Json; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; catalog_product_id:string; manual_observation_id:string; created_by:string; created_at:string }; Insert: { id?:string; idempotency_key:string; request_payload:Json; restaurant_id:string; restaurant_location_id:string; restaurant_menu_id:string; catalog_product_id:string; manual_observation_id:string; created_by:string; created_at?:string }; Update: Record<string, never> };
      verified_receipt_sources: { Row: { receipt_id:string; user_id:string; schema_version:"receipt.v2"; document_id:string|null; document_type:string; document_status:string; issued_on:string|null; issued_at:string|null; fulfillment_type:string; fulfillment_evidence:string; capture_method:string; transcription_status:"user_verified"; merchant_name:string; branch_name:string|null; business_kind:string; retail_channel:string; catalog_namespace:string|null; merchant_id:string|null; business_registration_number:string|null; address:string|null; phone:string|null; items_gross_amount_minor:number; discount_amount_minor:number; tax_amount_minor:number; fee_amount_minor:number; tip_amount_minor:number; rounding_amount_minor:number; grand_total_amount_minor:number; source_fingerprint:string; created_at:string }; Insert: Record<string, never>; Update: Record<string, never> };
      verified_receipt_source_lines: { Row: { receipt_id:string; user_id:string; source_line_id:string; line_type:string; description:string|null; source_line_references:string[]; merchant_sku:string|null; quantity_value:number|null; quantity_unit:string|null; unit_price_amount_minor:number|null; gross_amount_minor:number; discount_amount_minor:number; tax_amount_minor:number; net_amount_minor:number|null; tax_rate_percent:number|null; food_service_role:string|null; applies_to_source_line_id:string|null; created_at:string }; Insert: Record<string, never>; Update: Record<string, never> };
      verified_receipt_ingestion_requests: { Row: { user_id:string; idempotency_key:string; request_fingerprint:string; receipt_id:string; response:Json; created_at:string }; Insert: Record<string, never>; Update: Record<string, never> };
      merchant_identity_candidates: { Row: { id:string; user_id:string; origin:"receipt_ingestion"|"merchant_only"; source_fingerprint:string; merchant_name:string; branch_name:string|null; business_registration_number:string|null; address:string|null; phone:string|null; business_kind:string; source_namespace:string|null; source_code:string|null; idempotency_key:string|null; user_verified:true; review_status:"pending"|"accepted"|"rejected"; matched_restaurant_id:string|null; matched_restaurant_location_id:string|null; created_at:string; updated_at:string }; Insert: Record<string, never>; Update: Record<string, never> };
      products: { Row: { id:string; user_id:string; name:string; purchase_type:string; category_id:string|null; category_tags:string[]; created_at:string }; Insert: { id?:string; user_id:string; name:string; purchase_type?:string; category_id?:string|null; category_tags?:string[] }; Update: { name?:string; purchase_type?:string; category_id?:string|null; category_tags?:string[] } };
      store_products: { Row: { id:string; user_id:string; store_id:string; product_id:string; store_product_code:string|null }; Insert: { id?:string; user_id:string; store_id:string; product_id:string; store_product_code?:string|null }; Update: { store_product_code?:string|null } };
      receipts: { Row: { id:string; user_id:string; store_id:string; purchased_at:string; transaction_number:string; total_price_krw:number }; Insert: { id?:string; user_id:string; store_id:string; purchased_at:string; transaction_number:string; total_price_krw:number }; Update: { purchased_at?:string; transaction_number?:string; total_price_krw?:number } };
      receipt_items: { Row: { id:string; user_id:string; receipt_id:string; store_product_id:string; unit_price_krw:number; purchased_quantity:number; total_price_krw:number; purchase_numbers:number[] }; Insert: { id?:string; user_id:string; receipt_id:string; store_product_id:string; unit_price_krw:number; purchased_quantity:number; total_price_krw:number; purchase_numbers:number[] }; Update: { unit_price_krw?:number; purchased_quantity?:number; total_price_krw?:number; purchase_numbers?:number[] } };
      receipt_item_menu_option_sources: { Row: { option_receipt_item_id:string; user_id:string; receipt_id:string; parent_receipt_item_id:string; source:"receipt_v2"; created_at:string; updated_at:string }; Insert: { option_receipt_item_id:string; user_id:string; receipt_id:string; parent_receipt_item_id:string; source:"receipt_v2"; created_at?:string; updated_at?:string }; Update: { parent_receipt_item_id?:string; source?:"receipt_v2"; updated_at?:string } };
      price_observations: { Row: { id:string; user_id:string; store_product_id:string; receipt_item_id:string; catalog_product_id:string|null; observed_at:string; unit_price_krw:number; quantity:number; measurement_unit:string; location_label:string|null; attributes:Json; verification_status:"pending"|"verified"|"rejected"; verified_at:string|null }; Insert: { id?:string; user_id:string; store_product_id:string; receipt_item_id:string; catalog_product_id?:string|null; observed_at:string; unit_price_krw:number; quantity:number; measurement_unit?:string; location_label?:string|null; attributes?:Json; verification_status?:"pending"|"verified"|"rejected"; verified_at?:string|null }; Update: { catalog_product_id?:string|null; observed_at?:string; unit_price_krw?:number; quantity?:number; measurement_unit?:string; location_label?:string|null; attributes?:Json; verification_status?:"pending"|"verified"|"rejected"; verified_at?:string|null } };
      recipients: { Row: { id:string; user_id:string; name:string; created_at:string }; Insert: { id?:string; user_id:string; name:string }; Update: { name?:string } };
      allocations: { Row: { id:string; user_id:string; receipt_item_id:string; recipient_id:string; quantity:number; memo:string }; Insert: { id?:string; user_id:string; receipt_item_id:string; recipient_id:string; quantity:number; memo?:string }; Update: { quantity?:number; memo?:string } };
      settlement_statuses: { Row: { recipient_id:string; user_id:string; delivery_status:string; payment_status:string; paid_at:string|null }; Insert: { recipient_id:string; user_id:string; delivery_status:string; payment_status:string; paid_at?:string|null }; Update: { delivery_status?:string; payment_status?:string; paid_at?:string|null } };
    };
    Views: Record<string, never>;
    Functions: {
      admin_register_standard_product_link_only_v1: {
        Args: StandardProductLinkOnlyRegistrationArgs;
        Returns: StandardProductLinkRegistrationReturns;
      };
      approve_standard_product_official_image_v1: {
        Args: {
          p_idempotency_key:string;
          p_proposal_canonical_json:string;
          p_approval_statement:string;
          p_standard_product_id:string;
          p_catalog_product_id:string;
        };
        Returns: {
          approval_id:string;
          standard_product_id:string;
          catalog_product_id:string;
          replayed:boolean;
          applied_action:"created"|"reused_exact";
        }[];
      };
      admin_manage_standard_catalog: {
        Args: {
          p_action:string;
          p_target_id:string;
          p_payload:Json;
          p_confirmation:string;
        };
        Returns: string;
      };
      approve_and_register_standard_product_link_only_v1: {
        Args: {
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
        Returns: {
          execution_id:string;
          standard_product_id:string;
          catalog_product_id:string;
          replayed:boolean;
        }[];
      };
      approve_and_register_standard_product_link_strict_v4: {
        Args: {
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
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_quantity:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          execution_id:string;
          standard_product_id:string;
          catalog_product_id:string;
          replayed:boolean;
        }[];
      };
      approve_and_register_standard_product_link_strict_v5: {
        Args: {
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
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_quantity:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          execution_id:string;
          standard_product_id:string;
          catalog_product_id:string;
          replayed:boolean;
        }[];
      };
      approve_and_register_standard_product_link_strict_v6: {
        Args: {
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
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_quantity:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          execution_id:string;
          standard_product_id:string;
          catalog_product_id:string;
          replayed:boolean;
        }[];
      };
      admin_register_standard_product_link_strict_v1: {
        Args: StandardProductLinkStrictRegistrationArgs;
        Returns: StandardProductLinkRegistrationReturns;
      };
      register_standard_product_with_coupang_price: {
        Args: {
          p_standard_product_id:string|null;
          p_standard_name:string;
          p_product_reference_url:string;
          p_listing_name:string;
          p_specification_status:string;
          p_content_amount:number;
          p_content_unit:string;
          p_package_count:number;
          p_reference_unit:number;
          p_source_product_code:string;
          p_source_labels:string[];
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          standard_product_id:string;
          catalog_product_id:string;
        }[];
      };
      register_standard_product_with_coupang_offer: {
        Args: {
          p_standard_product_id:string|null;
          p_standard_name:string;
          p_product_reference_url:string;
          p_listing_name:string;
          p_specification_status:string;
          p_content_amount:number;
          p_content_unit:string;
          p_package_count:number;
          p_reference_unit:number;
          p_source_product_code:string;
          p_source_labels:string[];
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_quantity:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          standard_product_id:string;
          catalog_product_id:string;
        }[];
      };
      register_standard_product_with_brand_and_coupang_offer: {
        Args: {
          p_standard_product_id:string|null;
          p_standard_name:string;
          p_brand_name:string|null;
          p_receipt_brand_name:string|null;
          p_official_brand_name:string|null;
          p_official_brand_source_label:string|null;
          p_product_reference_url:string;
          p_listing_name:string;
          p_specification_status:string;
          p_content_amount:number;
          p_content_unit:string;
          p_package_count:number;
          p_reference_unit:number;
          p_source_product_code:string;
          p_source_labels:string[];
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_quantity:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          standard_product_id:string;
          catalog_product_id:string;
        }[];
      };
      register_standard_product_link_strict: {
        Args: {
          p_idempotency_key:string;
          p_case_id:string;
          p_input_fingerprint:string;
          p_target_fingerprint:string;
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
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_quantity:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          execution_id:string;
          standard_product_id:string;
          catalog_product_id:string;
          replayed:boolean;
        }[];
      };
      register_standard_product_link_strict_v2: {
        Args: {
          p_idempotency_key:string;
          p_case_id:string;
          p_input_fingerprint:string;
          p_target_fingerprint:string;
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
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_quantity:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          execution_id:string;
          standard_product_id:string;
          catalog_product_id:string;
          replayed:boolean;
        }[];
      };
      register_standard_product_link_strict_v3: {
        Args: {
          p_idempotency_key:string;
          p_case_id:string;
          p_input_fingerprint:string;
          p_target_fingerprint:string;
          p_input_canonical_json:string;
          p_target_canonical_json:string;
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
          p_coupang_product_url:string;
          p_coupang_listed_price_krw:number;
          p_coupang_quantity:number;
          p_coupang_content_amount:number;
          p_coupang_content_unit:string;
          p_coupang_max_bundle_quantity:number|null;
          p_coupang_max_bundle_listed_price_krw:number|null;
        };
        Returns: {
          execution_id:string;
          standard_product_id:string;
          catalog_product_id:string;
          replayed:boolean;
        }[];
      };
      get_product_read_v1: {
        Args: {
          p_catalog_product_id?:string|null;
          p_query?:string|null;
          p_limit?:number;
        };
        Returns: Json;
      };
      get_restaurant_directory_v1: {
        Args: {
          p_query?:string|null;
          p_limit?:number;
        };
        Returns: Json;
      };
      get_restaurant_directory_v2: {
        Args: {
          p_query?:string|null;
          p_limit?:number;
        };
        Returns: Json;
      };
      get_restaurant_detail_v1: {
        Args: {
          p_restaurant_id:string;
        };
        Returns: Json;
      };
      get_restaurant_detail_v2: {
        Args: {
          p_restaurant_id:string;
        };
        Returns: Json;
      };
      get_restaurant_menu_read_v1: {
        Args: {
          p_restaurant_id?:string|null;
          p_catalog_product_id?:string|null;
          p_query?:string|null;
          p_limit?:number;
        };
        Returns: Json;
      };
      get_admin_restaurant_menu_receipt_candidates_v1: {
        Args: Record<string, never>;
        Returns: {
          price_observation_id:string;
          store_id:string;
          store_name:string;
          location_label:string|null;
          store_product_id:string;
          store_product_code:string|null;
          product_name:string;
          receipt_id:string;
          receipt_item_id:string;
          observed_on:string;
          unit_price_krw:number;
          quantity:number;
          total_price_krw:number;
        }[];
      };
      submit_restaurant_receipt_v1: {
        Args: {
          p_idempotency_key:string;
          p_document_id:string;
          p_restaurant_name:string;
          p_branch_name:string|null;
          p_observed_on:string;
          p_total_price_krw:number;
          p_items:Json;
        };
        Returns: {
          receipt_id:string;
          replayed:boolean;
          item_count:number;
        }[];
      };
      submit_verified_receipt_v2: {
        Args: { p_idempotency_key:string; p_receipt:Json; };
        Returns: Json;
      };
      submit_merchant_identity_candidate_v1: {
        Args: { p_idempotency_key:string; p_merchant:Json; p_user_verified:boolean; };
        Returns: Json;
      };
      admin_resolve_merchant_identity_candidate_v1: {
        Args: { p_candidate_id:string; p_restaurant_id:string|null; p_restaurant_location_id:string|null; p_decision:string; };
        Returns: { candidate_id:string; review_status:string; restaurant_id:string|null; restaurant_location_id:string|null; }[];
      };
      admin_register_restaurant_from_merchant_candidate_v1: {
        Args: { p_candidate_id:string; };
        Returns: { candidate_id:string; restaurant_id:string; restaurant_location_id:string|null; review_status:string; }[];
      };
      admin_register_restaurant_menu_from_receipt_v1: {
        Args: {
          p_idempotency_key:string;
          p_price_observation_id:string;
          p_restaurant_id:string|null;
          p_restaurant_name:string;
          p_restaurant_legal_name:string|null;
          p_cuisine_type:string|null;
          p_restaurant_official_site_url:string|null;
          p_restaurant_source_namespace:string;
          p_restaurant_source_code:string;
          p_location_label:string|null;
          p_location_official_url:string|null;
          p_restaurant_menu_id:string|null;
          p_menu_name:string;
          p_menu_category_label:string|null;
          p_serving_label:string;
          p_menu_official_url:string|null;
        };
        Returns: {
          restaurant_id:string;
          restaurant_location_id:string;
          restaurant_menu_id:string;
          catalog_product_id:string;
          receipt_observation_id:string;
          replayed:boolean;
        }[];
      };
      admin_set_restaurant_category_v1: {
        Args: {
          p_restaurant_id:string;
          p_category_id:string|null;
        };
        Returns: {
          restaurant_id:string;
          category_id:string|null;
          category_slug:string|null;
          category_display_name:string|null;
        }[];
      };
      admin_confirm_restaurant_fulfillment_manual_v1: {
        Args: { p_restaurant_id:string; p_fulfillment_type:string; };
        Returns: { restaurant_id:string; fulfillment_type:"delivery"|"takeout"|"dine_in"; evidence_type:"receipt"|"manual"; replayed:boolean; }[];
      };
      admin_confirm_restaurant_fulfillment_from_receipt_v1: {
        Args: { p_restaurant_id:string; p_receipt_observation_id:string; p_fulfillment_type:string; };
        Returns: { restaurant_id:string; fulfillment_type:"delivery"|"takeout"|"dine_in"; evidence_type:"receipt"|"manual"; replayed:boolean; }[];
      };
      admin_list_restaurant_profile_editors_v1: {
        Args: Record<string, never>;
        Returns: Json;
      };
      admin_update_restaurant_profile_editor_v1: {
        Args: { p_restaurant_id:string; p_restaurant_location_id:string; p_canonical_name:string; p_legal_name:string|null; p_cuisine_type:string|null; p_official_site_url:string|null; p_location_label:string|null; p_location_official_url:string|null; p_business_registration_number:string|null; p_address:string|null; p_phone:string|null; p_source_url:string; };
        Returns: { restaurant_id:string; restaurant_location_id:string; updated_at:string; }[];
      };
      admin_auto_link_restaurant_menu_options_v1: {
        Args: {
          p_restaurant_id:string;
        };
        Returns: {
          id:string;
          restaurant_id:string;
          parent_menu_id:string;
          option_menu_id:string;
          link_source:"automatic"|"manual";
          confidence:number;
        }[];
      };
      admin_set_restaurant_menu_option_link_v1: {
        Args: {
          p_restaurant_id:string;
          p_parent_menu_id:string;
          p_option_menu_id:string;
        };
        Returns: {
          id:string;
          restaurant_id:string;
          parent_menu_id:string;
          option_menu_id:string;
          link_source:"automatic"|"manual";
          confidence:number;
        }[];
      };
      admin_clear_restaurant_menu_option_link_v1: {
        Args: {
          p_restaurant_id:string;
          p_option_menu_id:string;
        };
        Returns: {
          restaurant_id:string;
          option_menu_id:string;
          cleared:boolean;
        }[];
      };
      admin_register_unverified_product_sale_v1: {
        Args: {
          p_idempotency_key:string;
          p_catalog_product_id:string|null;
          p_standard_name:string|null;
          p_brand_name:string|null;
          p_listing_name:string|null;
          p_specification:string|null;
          p_content_amount:number|null;
          p_content_unit:string|null;
          p_package_count:number|null;
          p_reference_unit:number|null;
          p_listing_reference_url:string|null;
          p_seller_name:string;
          p_source_product_code:string|null;
          p_product_url:string;
          p_listed_price_krw:number;
          p_shipping_fee_krw:number;
          p_minimum_order_quantity:number;
          p_observed_at:string;
        };
        Returns: {
          standard_product_id:string;
          catalog_product_id:string;
          market_price_observation_id:string;
          verification_status:"unverified";
          replayed:boolean;
        }[];
      };
      admin_register_unverified_restaurant_menu_v1: {
        Args: {
          p_idempotency_key:string;
          p_restaurant_id:string|null;
          p_restaurant_name:string;
          p_restaurant_legal_name:string|null;
          p_cuisine_type:string|null;
          p_restaurant_official_site_url:string|null;
          p_source_namespace:string;
          p_source_location_code:string;
          p_location_label:string|null;
          p_location_official_url:string|null;
          p_restaurant_menu_id:string|null;
          p_menu_name:string;
          p_menu_category_label:string|null;
          p_serving_label:string;
          p_menu_official_url:string|null;
          p_unit_price_krw:number;
          p_quantity:number;
          p_observed_on:string;
          p_source_url:string|null;
          p_note:string|null;
        };
        Returns: {
          restaurant_id:string;
          restaurant_location_id:string;
          restaurant_menu_id:string;
          catalog_product_id:string;
          manual_observation_id:string;
          verification_status:"unverified";
          replayed:boolean;
        }[];
      };
      get_public_exact_standard_product_catalog_v2: {
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
          coupang_max_bundle_quantity:number|null;
          coupang_max_bundle_listed_price_krw:number|null;
          coupang_product_url:string|null;
          coupang_observed_at:string|null;
        }[];
      };
      get_public_exact_standard_product_catalog_v3: {
        Args: Record<string, never>;
        Returns: {
          source_label:string;
          source_product_code:string;
          catalog_product_id:string;
          standard_product_id:string;
          standard_name:string;
          brand_name:string|null;
          content_amount:number;
          content_unit:string;
          package_count:number;
          reference_unit:number;
          coupang_listed_price_krw:number|null;
          coupang_quantity:number|null;
          coupang_content_amount:number|null;
          coupang_content_unit:string|null;
          coupang_max_bundle_quantity:number|null;
          coupang_max_bundle_listed_price_krw:number|null;
          coupang_product_url:string|null;
          coupang_observed_at:string|null;
        }[];
      };
      get_public_exact_standard_product_catalog_v4: {
        Args: Record<string, never>;
        Returns: {
          source_label:string;
          source_product_code:string;
          catalog_product_id:string;
          standard_product_id:string;
          standard_name:string;
          brand_name:string|null;
          standard_category_id:string;
          standard_category_slug:string;
          standard_category_name:string;
          content_amount:number;
          content_unit:string;
          package_count:number;
          reference_unit:number;
          coupang_listed_price_krw:number|null;
          coupang_quantity:number|null;
          coupang_content_amount:number|null;
          coupang_content_unit:string|null;
          coupang_max_bundle_quantity:number|null;
          coupang_max_bundle_listed_price_krw:number|null;
          coupang_product_url:string|null;
          coupang_observed_at:string|null;
        }[];
      };
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
