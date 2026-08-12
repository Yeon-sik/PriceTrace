# Price observation submission v1

This contract is the first server boundary for OCR-App price observations. It
does not upload a receipt, an OCR document, or a private purchase history.

## Contract

The client sends only:

```json
{
  "schema_version": "price-observation-submit.v1",
  "store_id": "approved-public-store-uuid",
  "observed_on": "YYYY-MM-DD",
  "catalog_product_id": "exact-catalog-product-uuid",
  "unit_price_krw": 12900,
  "idempotency_key": "opaque-client-generated-key"
}
```

The `submit_price_observation_v1` RPC returns:

```json
{
  "observation_id": "public-observation-uuid",
  "replayed": false,
  "applied_action": "created"
}
```

`applied_action` is `created` for a new observation, `deduplicated` when the
natural observation key already exists, and `replayed` when the same
idempotency key is submitted again.

## Deliberate decisions

- `price_observation_sources` is a separate, admin-curated seller/location
  registry. It must not reuse the user-owned `stores` table.
- An unknown store is not auto-created. The OCR-App keeps the item local until
  an approved `store_id` is available.
- `catalog_product_id` is required and must point to an active retail catalog
  variant. Names, OCR guesses, and standard-product IDs are not accepted as a
  fallback.
- A missing or ambiguous catalog link remains local `needs_review` data. This
  contract does not create or approve catalog links.
- The natural duplicate key is
  `store_id + observed_on + catalog_product_id + unit_price_krw`.
- Authentication is required for submission, but the public observation and
  idempotency tables do not store the submitter user ID. The RPC is the only
  write surface; direct table writes are revoked from `anon` and
  `authenticated`.
- Public reads expose source context and the exact catalog ID, but no receipt
  ID, receipt-item ID, transaction/payment value, OCR text, image, or user
  identity.

The submitted observation is labelled `user_verified`; that label means the
OCR-App user confirmed the local receipt before submission. It is not a claim
that PriceTrace independently verified the physical receipt. Product linking
and any later moderation remain separate workflows.

## Not proven by this change

The migration and local tests do not prove a linked production Supabase
project, deployed RPC/RLS behavior, rate-limit configuration, or Android
network/device behavior. Those checks require an approved isolated remote
environment and a real signed-in device test.
