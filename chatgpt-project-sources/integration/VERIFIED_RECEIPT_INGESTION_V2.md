# PriceTrace verified receipt ingestion v2

PriceTrace owns the canonical receipt source contract and all catalog UUIDs. The ChatGPT Project returns an unverified `receipt.v2` draft; the OCR App compares it with the original image, applies user corrections, removes private evidence, sets `document.source.transcription_status` to `user_verified`, and only then calls the RPC.

## RPC

Call the authenticated Supabase RPC:

```text
submit_verified_receipt_v2(
  p_idempotency_key: string,
  p_receipt: receipt.v2 JSON object
)
```

The payload must have `schema_version: "receipt.v2"`, complete KRW totals, an issued date or offset timestamp, and `user_verified` transcription status. `source_images` must be `[]`, `raw_text` must be `null`, and every payment `reference` must be `null`. Only printed `merchant_sku` identifiers are accepted. Unknown SKU, menu, restaurant, or catalog identity remains null; the server never accepts a client-created UUID.

The server stores a sanitized source projection and line semantics. It does not store source images, raw OCR text, payment objects, payment references, or the local receipt JSON. Product/service rows that are `each` quantities with a non-negative net amount divisible by quantity become the existing user-owned receipt/observation chain. Other semantic rows remain in the source-line projection and are not silently converted into products.

Totals are reconciled as:

```text
grand = items_gross - discount + tax + fee + tip + rounding + sum(refund.net)
```

Discount, fee, tax, tip, refund, and rounding rows are kept as their original line types. This is additive to `submit_restaurant_receipt_v1`; v1 is not changed or removed.

## Resolution and response

The response is a JSON object with `schemaVersion: "verified-receipt-ingestion.v2"`, `receiptId`, `storeId`, optional `restaurantId` and `restaurantLocationId`, `merchantResolutionStatus`, optional `merchantCandidateId`, `observationIds`, and a `lines` array. Each line reports `receiptItemId`, `observationId`, `restaurantObservationId`, `restaurantMenuId`, `catalogProductId`, and `resolutionStatus` when applicable. These IDs are server-owned outputs.

Restaurant identity resolves only from one exact verified active location: source namespace + source location code, normalized business registration number, or exact merchant/branch plus supplied contact facts. A same-name different-branch receipt is not merged. Exact existing menu resolution uses a verified restaurant menu mapping or one exact canonical menu name within the resolved restaurant. Similar names and ambiguous options are left unresolved. Exact menu observations use the existing `restaurant_menu_receipt_observations` chain and `receipt_item_menu_option_sources` / `restaurant_menu_option_links` flow.

Retries with the same user and idempotency key return the original response. The same canonical payload sent under another key is also deduplicated. Reusing a key for another payload fails.

## Merchant-only workflow

For a verified merchant fact set without a receipt, call:

```text
submit_merchant_identity_candidate_v1(
  p_idempotency_key: string,
  p_merchant: merchant-only facts JSON,
  p_user_verified: true
)
```

This creates a sanitized pending candidate only after explicit user verification; it never creates a canonical restaurant automatically. An administrator can attach the candidate to an exact existing restaurant/location with `admin_resolve_merchant_identity_candidate_v1`, or create a pending restaurant/location through `admin_register_restaurant_from_merchant_candidate_v1` for a genuinely new food-service identity. A location source namespace/code is required before a new `restaurant_location` can be created because that table intentionally has no name-only identity.
