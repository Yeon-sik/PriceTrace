import { z } from "zod";
import {
  OrderProductLinkRequestInputSchema,
  type OrderProductLinkRequestInput,
} from "./order-capture";
import type { ProductReadProduct } from "./product-read";

const requestStatusSchema = z.enum(["pending", "approved", "rejected", "withdrawn"]);

export const OrderProductLinkRequestRowSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  client_request_id: z.string().uuid(),
  request_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  request_kind: z.enum(["link_existing", "create_variant", "register_new"]),
  platform: z.enum(["coupang", "iherb", "myprotein", "naver"]),
  source_label: z.string(),
  seller_label: z.string().nullable(),
  source_product_code: z.string().nullable(),
  product_name: z.string(),
  option_text: z.string().nullable(),
  suggested_standard_product_id: z.string().uuid().nullable(),
  suggested_catalog_product_id: z.string().uuid().nullable(),
  status: requestStatusSchema,
  resolved_catalog_product_id: z.string().uuid().nullable(),
  review_note: z.string().nullable(),
  reviewed_by: z.string().uuid().nullable(),
  reviewed_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();

export type OrderProductLinkRequestRow = z.infer<typeof OrderProductLinkRequestRowSchema>;

export type OrderCaptureCatalogCandidate = {
  standardProductId: string;
  standardName: string;
  brand: string | null;
  catalogProductId: string;
  catalogName: string;
  specificationText: string | null;
  exactSourceMapping: boolean;
};

export function orderCaptureCatalogCandidates({
  products,
  sourceLabel,
  sourceProductCode,
}: {
  products: ProductReadProduct[];
  sourceLabel: string;
  sourceProductCode: string | null;
}): OrderCaptureCatalogCandidate[] {
  return products.map((product) => ({
    standardProductId: product.standardProduct.id,
    standardName: product.standardProduct.name,
    brand: product.standardProduct.brand,
    catalogProductId: product.catalogProduct.id,
    catalogName: product.catalogProduct.name,
    specificationText: product.catalogProduct.specificationText,
    exactSourceMapping: sourceProductCode !== null && product.sellerProducts.some((sellerProduct) => (
      sellerProduct.sellerLabel === sourceLabel
      && sellerProduct.sourceProductCode === sourceProductCode
    )),
  }));
}

function canonicalRequestIdentity(request: Omit<OrderProductLinkRequestInput, "clientRequestId" | "requestFingerprint">) {
  return JSON.stringify({
    requestKind: request.requestKind,
    platform: request.platform,
    sourceLabel: request.sourceLabel,
    sellerLabel: request.sellerLabel,
    sourceProductCode: request.sourceProductCode,
    productName: request.productName,
    optionText: request.optionText,
    suggestedStandardProductId: request.suggestedStandardProductId,
    suggestedCatalogProductId: request.suggestedCatalogProductId,
  });
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function buildOrderProductLinkRequestInput(
  request: Omit<OrderProductLinkRequestInput, "clientRequestId" | "requestFingerprint">,
) {
  return OrderProductLinkRequestInputSchema.parse({
    ...request,
    clientRequestId: crypto.randomUUID(),
    requestFingerprint: await sha256Text(canonicalRequestIdentity(request)),
  });
}
