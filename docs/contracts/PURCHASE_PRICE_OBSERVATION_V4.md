# Purchase price observation v4

PriceTrace accepts a user-verified order or payment history as a private,
sanitized source projection. The source may come from Coupang, Naver Shopping,
or a delivery application. The platform is provenance metadata; it is never a
seller, store, or product identity.

## RPC

Authenticated callers use:

```text
ingest_verified_purchase_price_observation_v1(
  p_idempotency_key text,
  p_purchase jsonb
)
```

The payload must use `schema_version` `purchase-price-observation.v4`,
`contract_version` `purchase-price.v4`, `source_app`
`pricetrace_ocr_app`, and `transcription_status` `user_verified`.
`verification_basis` is `source_evidence` or `manual_canonical_review`.
`kind` is `retail_purchase` or `restaurant_purchase`.

```json
{
  "schema_version": "purchase-price-observation.v4",
  "contract_version": "purchase-price.v4",
  "source_app": "pricetrace_ocr_app",
  "source_version": "order-capture-1",
  "kind": "retail_purchase",
  "verification_basis": "source_evidence",
  "transcription_status": "user_verified",
  "platform": { "name": "쿠팡", "code": "coupang" },
  "seller": {
    "seller_name": "확인된 판매자",
    "branch_name": null,
    "source_namespace": "coupang-seller",
    "source_code": "seller-123",
    "business_kind": "retail"
  },
  "order": {
    "order_reference": "order-123",
    "status": "paid",
    "currency": "KRW",
    "ordered_on": "2026-09-11",
    "ordered_at": "2026-09-11T23:30:00+09:00"
  },
  "payment": {
    "status": "paid",
    "method": "card",
    "paid_on": "2026-09-12",
    "paid_at": "2026-09-12T00:05:00+09:00",
    "total_price": 1100,
    "items_subtotal": 1100,
    "shipping_fee": 0,
    "discount": null
  },
  "items": [
    {
      "line_key": "line-1",
      "product": {
        "client_key": "candidate-1",
        "product_name": "검증된 상품",
        "merchant_sku": "real-sku-1"
      },
      "option_text": null,
      "price_status": "itemized",
      "quantity": 2,
      "unit_price": 550,
      "gross_price": 1100,
      "discount": null,
      "net_price": 1100
    }
  ]
}
```

For retail lines, the OCR App sends the Product Candidate's opaque `client_key`
(the V4 wire name). For compatibility with the V3 product fact shape,
`product_client_key` is accepted as an alias when `client_key` is absent. It
does not send `catalog_product_id`, `standard_product_id`, `store_id`,
`store_product_id`, `price_observation_id`, or any other PriceTrace UUID. The
RPC rejects UUID-shaped values and identity-like keys before source or
authority rows are written. `merchant_sku` remains an observed seller SKU and
is never filled from `client_key`.

## Source and observation rules

The migration adds four append-only, user-scoped tables:

- `purchase_price_sources` stores the validated order/payment source facts.
- `purchase_price_source_lines` stores each item line and whether it produced an
  observation.
- `purchase_price_observation_ingestion_contents` deduplicates the complete
  canonical JSON payload.
- `purchase_price_observation_ingestion_requests` binds an idempotency key to
  that fingerprint and source.

`ordered_on`/`ordered_at_exact` and `paid_on`/`paid_at_exact` are independent.
Date-only input leaves the exact timestamp `NULL`; an explicit timestamp is
stored as an instant while its written offset date remains the calendar date
used for validation. If order date is known it is the observation date; payment
date is the fallback only when order date is unknown.

An item creates an observation only when all of these are true:

- the line price is `itemized` and at least one item price fact is known;
- the seller is explicitly confirmed;
- an order or payment date is known;
- a retail line has a Product Candidate `product_client_key`;
- a verified, active authority can be resolved.

Payment totals are source facts only. An omitted, `null`, or empty `items` value
creates no observation. A line marked `ambiguous`, a line with no product price, or a line
whose seller/date/product authority is unresolved is retained as a
`not_created` source line with a reason and never creates a fake store or
PriceTrace observation. Unknown discount stays `NULL`; it is not converted to
zero.

The `seller` object may be omitted, `null`, or an all-null object when the
seller is unknown. Partial seller identity is rejected.

For `retail_purchase`, the Product Candidate authority projection must resolve
one active verified retail catalog/standard identity. PriceTrace then reuses or
creates the existing user-owned store/product/store-product identity and writes
the existing `price_observations` shape with `observation_kind =
'standalone_purchase'`. The store fingerprint uses confirmed seller facts only;
`platform` is excluded.

For `restaurant_purchase`, the source must carry an exact existing, verified
`restaurant_locations` source namespace/code and an active, verified matching
`restaurant_menus` authority. A menu line is matched by the confirmed seller,
source location code, menu name, and serving label; a Product Candidate UUID or
name-only candidate is never used as the menu identity. The line is written
through the existing `restaurant_menu_manual_observations` structure. No
restaurant/menu is created from an unconfirmed seller or a name-only match.

## Compatibility

This migration is additive. The V3 receipt RPCs and
`ingest_verified_standalone_price_observation_v1` remain unchanged. V4 uses its
own source, line, replay, and content-dedup tables and does not rewrite V3
records.

The same idempotency key with the same payload replays the stored response. The
same payload with another key is content-deduplicated to the original source and
observations. Reusing a key with a different payload returns a unique-violation
conflict.
