# Receipt-independent price observation v3

PriceTrace accepts one verified purchase/price observation without a receipt. The
OCR App submits only after its user review is complete; it sends observable facts,
not PriceTrace UUIDs. CashOS and receipt ingestion are separate contracts.

## RPC

Call the authenticated RPC:

```text
ingest_verified_standalone_price_observation_v1(
  p_idempotency_key text,
  p_observation jsonb
)
```

The payload uses `schema_version`
`receipt-independent-price-observation.v3` and `contract_version`
`price-observation.v3`.

Required common fields:

- `kind`: `retail_purchase` or `restaurant_purchase`
- `verification_basis`: `source_evidence` or `manual_canonical_review`
- `transcription_status`: `user_verified`
- `currency`: `KRW`
- `observed_on` or `observed_at`
- `gross_price`, `net_price`, `quantity`, and `unit_price`
- `discount`: an integer or JSON `null`; `null` means the discount was not established

The server rejects UUID-shaped values and PriceTrace identity fields in the
external JSON. It also rejects arithmetic mismatches; it never silently adjusts
amounts. When `discount` is known, `gross_price - discount = net_price` must hold,
and `quantity * unit_price = net_price` always must hold.

Retail payloads contain `merchant` and `product` facts. PriceTrace resolves or
creates the user's private store/product/store-product identity and resolves a
canonical catalog product only from an existing verified identifier or source
mapping. Restaurant payloads contain `merchant` and `item` facts. PriceTrace
resolves or creates the pending restaurant/location/menu identity and records the
observation through the existing manual-observation structure. Ambiguous matches
are rejected.

The response contains `observationId`, `kind`, `replayed`, and
`authoritativeIds`. Retail `observationId` is the user-owned price observation;
restaurant `observationId` is the restaurant manual observation. Neither path
stores `receipt_id` or `receipt_item_id`.
