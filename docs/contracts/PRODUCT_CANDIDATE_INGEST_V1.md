# PriceTrace Product Candidate ingest v1

`PRICETRACE_PRODUCT_CANDIDATE` is the canonical boundary from the
PriceTrace OCR App to PriceTrace. PriceTrace is the only owner of PriceTrace
product identity. OCR and GPT provide observed facts and evidence; they do not
create or confirm a public `standard_products` row, `catalog_products` row,
`restaurant_menus` row, or Nutrition link.

The canonical retail sequence is:

```text
Product Candidate facts
  -> PriceTrace authority resolution
  -> standalone price observation
```

The candidate's `client_key` is an opaque, user-scoped OCR-App reference. It
is not a merchant SKU, a store product code, a source mapping value, or a
PriceTrace UUID; UUID-shaped values are rejected at the boundary. PriceTrace
stores the reference only so a later standalone request can name the
already-resolved candidate without sending a server ID.

## RPC

Authenticated clients call:

```text
submit_product_candidate_v1(
  p_idempotency_key text,
  p_candidate jsonb
) returns jsonb
```

`p_idempotency_key` is owned by the caller and is scoped to the authenticated
PriceTrace user. The server also fingerprints the complete JSON payload. The
same key with another payload fails; another key with the same payload returns
the original result with `deduplicated: true`.

## Request contract

The JSON object uses snake_case because it crosses the OCR-App boundary:

```json
{
  "schema_version": "PRICETRACE_PRODUCT_CANDIDATE",
  "contract_version": "product-candidate.v1",
  "source_app": "pricetrace_ocr_app",
  "source_version": "0.0.0",
  "candidate_type": "retail_product",
  "client_key": "product-1",
  "product_name": "관측된 상품명",
  "brand": "관측된 브랜드 또는 null",
  "sub_brand": "관측된 서브브랜드 또는 null",
  "manufacturer": "관측된 제조사 또는 null",
  "specification": "관측된 규격 표현 또는 null",
  "content_amount": 500,
  "content_unit": "g",
  "package_count": 1,
  "variant": "관측된 맛·색상·모델·구성 변형 또는 null",
  "identifiers": [
    { "scheme": "ean", "value": "8800000000000" }
  ],
  "evidence": [
    {
      "source_type": "product_photo",
      "source_ref": "capture:local-review-001",
      "field": "product_name",
      "observed_value": "관측된 상품명",
      "content_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }
  ],
  "provenance": {
    "capture_id": "capture:local-review-001",
    "capture_content_hash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "extraction_method": "gpt_vision",
    "extractor": "ocr-app",
    "extractor_version": "0.0.0",
    "observed_at": "2026-09-06T00:00:00Z",
    "source_revision": "prompt-or-model-revision"
  },
  "nutrition_food_id": null
}
```

For the canonical v3 retail flow, `client_key` is required if the candidate
will later be referenced by a standalone retail observation. The RPC keeps
accepting requests without it for existing v1 callers, but such a request
cannot satisfy the standalone retail prerequisite. `brand`, `sub_brand`,
`manufacturer`, `specification`, `content_amount`, `content_unit`,
`package_count`, `variant`, and `nutrition_food_id` may be `null` or omitted
when unknown. These are source facts and are retained as provided; in
particular, `sub_brand` is not collapsed into `brand` or used as a catalog
identity by itself. A content amount and unit are all-or-nothing.
`package_count`, when present, is a positive integer. `identifiers` may be
empty, but each identifier must be a digit-only EAN, UPC, or GTIN value after
spaces/hyphens are removed. `evidence` must contain at least one sanitized
source fact.

`evidence[].source_type` also accepts `order_history` for facts actually
observed in a marketplace or delivery-app order history. For this source the
`field` must describe a product fact such as `product_name`, `option_text`,
`merchant_sku`, `variant`, `brand`, `manufacturer`, `specification`, or
content/package measurements, and `observed_value` must be a non-empty string
for that fact. Platform, seller, store, payment, authority, and other identity
fields are not Product Candidate facts. The evidence keeps only the sanitized
reference/fact value; raw screenshots, raw OCR, image paths/binary,
authentication material, and PriceTrace UUIDs remain forbidden.

`client_key` must not be copied into `merchant_sku`. A Product Candidate does
not accept `merchant_sku`; a real printed/listed merchant SKU belongs only in
the later standalone observation, and only when it was actually observed.

Evidence references are opaque source references, not local file paths or
binary data. The request rejects raw OCR text, image paths/URIs/base64,
access/refresh tokens, `user_verified`, and client-supplied PriceTrace or
Nutrition UUID fields. The server assigns every PriceTrace UUID.

The accepted `candidate_type` values are:

- `retail_product`: a photographed or otherwise observed retail product
  identity candidate.
- `complimentary_side`: a meal/receipt semantic that is not itself a retail
  product identity.
- `meal_component_estimate`: an estimated meal component without a source
  product identity.

The last two values are retained only as private review evidence. This RPC
never turns them into a `RestaurantMenu` candidate. Restaurant menu identity
requires the existing receipt/menu flow and exact PriceTrace-owned records.

## Response contract

Every successful call returns `schemaVersion: "product-candidate.v1"` and one
of exactly these outcomes:

| `outcome` | Meaning |
| --- | --- |
| `catalog_product_reused` | One active, verified exact catalog identity was found by a verified barcode/GTIN or a complete exact identity. No public row was created. |
| `private_unverified_candidate_created` | No unique exact catalog identity was found. A private `product_identity_candidates` row was created with `verificationStatus: "unverified"`. |
| `review_required` | The facts are semantically non-retail, conflict with a verified identifier, or match more than one catalog identity. A private review candidate was created. |

The response contains these server-owned fields. `clientKey` and
`productClientKey` echo the opaque local reference for correlation; they are
not server identities and must not be converted into UUIDs or SKUs:

```json
{
  "schemaVersion": "product-candidate.v1",
  "contract": "PRICETRACE_PRODUCT_CANDIDATE",
  "outcome": "catalog_product_reused",
  "catalogProductId": "server-uuid-or-null",
  "standardProductId": "server-uuid-or-null",
  "candidateId": "server-uuid-or-null",
  "verificationStatus": "verified",
  "reviewStatus": "not_required",
  "reviewReasons": [],
  "possibleCatalogProductIds": [],
  "clientKey": "product-1",
  "productClientKey": "product-1",
  "restaurantMenuCandidateCreated": false,
  "nutritionHandoff": {
    "status": "awaiting_nutrition_food_id",
    "namespace": "pricetrace",
    "catalogProductId": "server-uuid-or-null",
    "nutritionFoodId": null,
    "proposalRpc": "propose_product_nutrition_link_v1",
    "requiresProductReadRevision": true
  },
  "replayed": false,
  "deduplicated": false
}
```

`catalog_product_reused` is reuse of an already verified PriceTrace identity;
it is not public verification of OCR/GPT output. A name-only, incomplete, or
ambiguous match does not reuse a catalog product.

Only a `catalog_product_reused` result creates an eligible private authority
projection for standalone retail. `private_unverified_candidate_created` and
`review_required` retain the candidate as private/review evidence and must not
be used to submit a retail standalone observation. The next request passes
`product_client_key: "product-1"`, not `catalogProductId`, `standardProductId`,
or another externally supplied PriceTrace UUID.

## Nutrition handoff

PriceTrace does not create a Nutrition table, copy Nutrition rows, or call the
Fitness database from this RPC. When the response has a
`catalogProductId` and the caller has a `nutritionFoodId`, the caller continues
the existing Nutrition flow:

1. read the exact product through `get_product_read_v1` and retain its
   `product-read.v1` revision;
2. combine `namespace + catalogProductId + nutritionFoodId` with the Nutrition
   source/revision evidence; and
3. call Fitness Nutrition's `propose_product_nutrition_link_v1`.

The proposal remains `pending` until Nutrition approval. PriceTrace remains the
owner of product identity; Fitness remains the owner of Nutrition and Meal
Record data.

## Persistence and public-read boundary

New unresolved candidates are stored in `product_identity_candidates` with
`verification_status = 'unverified'` and `visibility = 'private'`, scoped to
the authenticated user. They are not inserted into `standard_products` or
`catalog_products`. A `product_candidate_authority_projections` row binds a
user's opaque `client_key` to the resolution result; only a verified catalog
reuse is eligible for standalone retail. `get_product_read_v1` is unchanged
and continues to expose only active, verified catalog variants. The ingestion
replay tables contain the sanitized request fingerprint, server result, and
private candidate/projection reference. No CashOS submission or other project
database write occurs.
