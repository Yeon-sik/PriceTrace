import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AdminUnverifiedProductSaleRequestSchema,
  AdminUnverifiedRestaurantMenuRequestSchema,
  adminUnverifiedProductSaleResultFromRpc,
  adminUnverifiedRestaurantMenuResultFromRpc,
  type AdminUnverifiedProductSaleRequest,
  type AdminUnverifiedProductSaleResult,
  type AdminUnverifiedRestaurantMenuRequest,
  type AdminUnverifiedRestaurantMenuResult,
  type AdminUnverifiedRetailCatalogOption,
} from "../domain/admin-unverified-registration";

const catalogRowSchema = z.object({
  id: z.string().uuid(),
  standard_product_id: z.string().uuid(),
  canonical_name: z.string(),
  specification: z.string().nullable(),
  content_amount: z.number().nullable(),
  content_unit: z.enum(["g", "ml", "each"]).nullable(),
  package_count: z.number().int(),
  reference_unit: z.union([z.literal(10), z.literal(100), z.literal(1000)]),
  listing_reference_url: z.string().nullable(),
  verification_status: z.enum(["verified", "unverified"]),
}).strict();

const standardRowSchema = z.object({
  id: z.string().uuid(),
  canonical_name: z.string(),
  brand: z.string().nullable(),
  verification_status: z.enum(["verified", "unverified"]),
}).strict();

function unwrapSingleRow(data: unknown) {
  return Array.isArray(data) && data.length === 1 ? data[0] : data;
}

function remoteErrorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

export class AdminUnverifiedRegistrationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async loadRetailCatalog(): Promise<AdminUnverifiedRetailCatalogOption[]> {
    const [catalogResult, standardResult] = await Promise.all([
      this.client.from("catalog_products")
        .select("id,standard_product_id,canonical_name,specification,content_amount,content_unit,package_count,reference_unit,listing_reference_url,verification_status")
        .eq("status", "active")
        .eq("purchase_type", "retail_product")
        .order("canonical_name"),
      this.client.from("standard_products")
        .select("id,canonical_name,brand,verification_status")
        .eq("status", "active")
        .eq("purchase_type", "retail_product"),
    ]);
    if (catalogResult.error || standardResult.error) {
      throw new Error(catalogResult.error?.message ?? standardResult.error?.message ?? "상품 목록을 불러오지 못했습니다.");
    }
    const catalogRows = z.array(catalogRowSchema).parse(catalogResult.data ?? []);
    const standardRows = z.array(standardRowSchema).parse(standardResult.data ?? []);
    const standardById = new Map(standardRows.map((standard) => [standard.id, standard]));
    return catalogRows.map((catalog) => {
      const standard = standardById.get(catalog.standard_product_id);
      return {
        ...catalog,
        standard_name: standard?.canonical_name ?? catalog.canonical_name,
        brand: standard?.brand ?? null,
      };
    });
  }

  async registerProductSale(
    input: AdminUnverifiedProductSaleRequest,
  ): Promise<AdminUnverifiedProductSaleResult> {
    const request = AdminUnverifiedProductSaleRequestSchema.parse(input);
    const { data, error } = await this.client.rpc("admin_register_unverified_product_sale_v1", {
      p_idempotency_key: request.idempotencyKey,
      p_catalog_product_id: request.catalogProductId,
      p_standard_name: request.standardName || null,
      p_brand_name: request.brandName,
      p_listing_name: request.listingName || null,
      p_specification: request.specification,
      p_content_amount: request.contentAmount,
      p_content_unit: request.contentUnit,
      p_package_count: request.packageCount,
      p_reference_unit: request.referenceUnit,
      p_listing_reference_url: request.listingReferenceUrl,
      p_seller_name: request.sellerName,
      p_source_product_code: request.sourceProductCode,
      p_product_url: request.productUrl,
      p_listed_price_krw: request.listedPriceKrw,
      p_shipping_fee_krw: request.shippingFeeKrw,
      p_minimum_order_quantity: request.minimumOrderQuantity,
      p_observed_at: request.observedAt,
    });
    if (error) {
      throw new Error(remoteErrorMessage(error, "미인증 상품 판매 정보를 등록하지 못했습니다."));
    }
    return adminUnverifiedProductSaleResultFromRpc(unwrapSingleRow(data));
  }

  async registerRestaurantMenu(
    input: AdminUnverifiedRestaurantMenuRequest,
  ): Promise<AdminUnverifiedRestaurantMenuResult> {
    const request = AdminUnverifiedRestaurantMenuRequestSchema.parse(input);
    const { data, error } = await this.client.rpc("admin_register_unverified_restaurant_menu_v1", {
      p_idempotency_key: request.idempotencyKey,
      p_restaurant_id: request.restaurantId,
      p_restaurant_name: request.restaurantName,
      p_restaurant_legal_name: request.restaurantLegalName,
      p_cuisine_type: request.cuisineType,
      p_restaurant_official_site_url: request.restaurantOfficialSiteUrl,
      p_source_namespace: request.sourceNamespace,
      p_source_location_code: request.sourceLocationCode,
      p_location_label: request.locationLabel,
      p_location_official_url: request.locationOfficialUrl,
      p_restaurant_menu_id: request.restaurantMenuId,
      p_menu_name: request.menuName,
      p_menu_category_label: request.menuCategoryLabel,
      p_serving_label: request.servingLabel,
      p_menu_official_url: request.menuOfficialUrl,
      p_unit_price_krw: request.unitPriceKrw,
      p_quantity: request.quantity,
      p_observed_on: request.observedOn,
      p_source_url: request.sourceUrl,
      p_note: request.note,
    });
    if (error) {
      throw new Error(remoteErrorMessage(error, "미인증 음식점 메뉴를 등록하지 못했습니다."));
    }
    return adminUnverifiedRestaurantMenuResultFromRpc(unwrapSingleRow(data));
  }
}
