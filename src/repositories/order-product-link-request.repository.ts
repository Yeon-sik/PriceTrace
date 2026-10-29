import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  OrderProductLinkRequestRowSchema,
  type OrderProductLinkRequestRow,
} from "../domain/order-product-link-request";
import {
  OrderProductLinkRequestInputSchema,
  type OrderProductLinkRequestInput,
} from "../domain/order-capture";

const adminReviewResultSchema = z.object({
  request_id: z.string().uuid(),
  request_status: z.enum(["approved", "rejected"]),
  catalog_product_id: z.string().uuid().nullable(),
}).strict();

function singleRow(value: unknown) {
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function errorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message?.trim() || fallback;
}

export class OrderProductLinkRequestRepository {
  constructor(private readonly client: SupabaseClient) {}

  private async currentUserId() {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) throw new Error("관리자 검토 요청은 로그인 후 보낼 수 있습니다.");
    return data.user.id;
  }

  async submit(input: OrderProductLinkRequestInput) {
    const request = OrderProductLinkRequestInputSchema.parse(input);
    const userId = await this.currentUserId();
    const insertRow = {
      user_id: userId,
      client_request_id: request.clientRequestId,
      request_fingerprint: request.requestFingerprint,
      request_kind: request.requestKind,
      platform: request.platform,
      source_label: request.sourceLabel,
      seller_label: request.sellerLabel,
      source_product_code: request.sourceProductCode,
      product_name: request.productName,
      option_text: request.optionText,
      suggested_standard_product_id: request.suggestedStandardProductId,
      suggested_catalog_product_id: request.suggestedCatalogProductId,
    };
    const result = await this.client
      .from("order_product_link_requests")
      .insert(insertRow)
      .select("*")
      .single();
    if (!result.error) return OrderProductLinkRequestRowSchema.parse(result.data);

    if (result.error.code === "23505") {
      const existing = await this.client
        .from("order_product_link_requests")
        .select("*")
        .eq("user_id", userId)
        .eq("request_fingerprint", request.requestFingerprint)
        .single();
      if (!existing.error) return OrderProductLinkRequestRowSchema.parse(existing.data);
    }
    throw new Error(errorMessage(result.error, "상품 연결 검토 요청을 보내지 못했습니다."));
  }

  async loadMine(): Promise<OrderProductLinkRequestRow[]> {
    await this.currentUserId();
    const { data, error } = await this.client
      .from("order_product_link_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(errorMessage(error, "상품 연결 요청 내역을 불러오지 못했습니다."));
    return z.array(OrderProductLinkRequestRowSchema).parse(data ?? []);
  }

  async withdraw(id: string) {
    const { data, error } = await this.client
      .from("order_product_link_requests")
      .update({ status: "withdrawn" })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .single();
    if (error) throw new Error(errorMessage(error, "검토 요청을 철회하지 못했습니다."));
    return OrderProductLinkRequestRowSchema.parse(data);
  }

  async loadPendingForAdmin(): Promise<OrderProductLinkRequestRow[]> {
    const { data, error } = await this.client
      .from("order_product_link_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw new Error(errorMessage(error, "관리자 상품 연결 요청함을 불러오지 못했습니다."));
    return z.array(OrderProductLinkRequestRowSchema).parse(data ?? []);
  }

  async review({
    requestId,
    decision,
    resolvedCatalogProductId,
    reviewNote,
  }: {
    requestId: string;
    decision: "approved" | "rejected";
    resolvedCatalogProductId: string | null;
    reviewNote: string | null;
  }) {
    const { data, error } = await this.client.rpc("admin_review_order_product_link_request_v1", {
      p_request_id: requestId,
      p_decision: decision,
      p_resolved_catalog_product_id: resolvedCatalogProductId,
      p_review_note: reviewNote,
    });
    if (error) throw new Error(errorMessage(error, "상품 연결 요청을 검토하지 못했습니다."));
    return adminReviewResultSchema.parse(singleRow(data));
  }
}
