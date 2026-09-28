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
- at least one observed price fact among `gross_price`, `discount`,
  `net_price`, and `unit_price`

`quantity` is optional. `gross_price`, `discount`, `net_price`, `unit_price`,
and `quantity` may be omitted or explicitly `null` when they were not
established. A final-payment-only observation is valid with only
`net_price`. Unknown discount is stored as `NULL`; it is never converted to
zero.

The server rejects UUID-shaped values and PriceTrace identity fields in the
external JSON. It also rejects arithmetic mismatches; it never silently adjusts
amounts. Relationships are checked only when all operands needed for that
relationship are known: `gross_price - discount = net_price` when all three are
known, `gross_price >= net_price` when both are known, and
`quantity * unit_price = net_price` when all three are known.

Date precision is preserved. `observed_on` only stores the submitted calendar
date and leaves `observed_at_exact` `NULL`. An explicit ISO `observed_at` is
stored as the exact instant; if both fields are present, their written calendar
dates must agree. The comparison uses the date written in the explicit offset,
not the UTC-converted date.

Retail payloads contain `merchant` and `product` facts. The retail product must
include the `product_client_key` returned by the preceding Product Candidate
request. PriceTrace looks up its private authority projection and accepts the
observation only when that projection says one active, verified catalog
identity was reused. No external UUID is accepted, and the standalone RPC does
not resolve a catalog identity directly from a name or barcode. `merchant_sku`
is optional and is stored only when it is a real observed merchant SKU; the
Product Candidate `client_key` is never used as one. PriceTrace then creates
the server-owned store/product/store-product and price-observation rows.

Restaurant payloads contain `merchant` and `item` source facts. The authenticated
OCR App has already completed source review (`transcription_status: user_verified`);
PriceTrace still validates Restaurant / Location / Menu / Catalog identity and
issues or reuses every canonical UUID. It does not request another human
approval for the same reviewed source evidence.

Restaurant/Location resolution requires one exact active, verified source
identity: a source namespace plus source location code, a valid normalized
business registration number, or an exact branch/address/phone set tied to the
merchant name. Name alone and name plus branch name do not establish identity.
If no matching location exists and one of those strong source identities is
present, the server creates a verified Restaurant and Location. It never joins
same-name locations without matching source identity. Conflicting or ambiguous
signals return `needs_ocr_resolution` without publication IDs.

Menu resolution runs only inside that exact Restaurant. One active verified
RestaurantMenu with the exact item identity is reused. If none exists, reviewed
item name plus the exact Restaurant scope may create a verified
`standard_product`, `catalog_product`, and `restaurant_menu`; a source mapping
is added only for a printed source menu code and namespace. Multiple same-name
Menu candidates, unverified rows, or conflicting mappings remain unresolved.
No global Menu name matching is performed.

An exact restaurant response always contains explicit authority statuses and
all four publication IDs. Restaurant/Location/Menu/Catalog IDs are returned
only when every identity is exact and active/verified and an observation was
recorded. An unresolved response has `observationId: null`, all canonical IDs
null, and a server-issued `ocrResolution.resolutionId`:

```json
{
  "schemaVersion": "receipt-independent-price-observation.v3",
  "kind": "restaurant_purchase",
  "observationId": null,
  "replayed": false,
  "authorityStatus": "needs_ocr_resolution",
  "merchantResolutionStatus": "exact",
  "menuResolutionStatus": "needs_ocr_resolution",
  "authoritativeIds": {
    "restaurantId": null,
    "restaurantLocationId": null,
    "restaurantMenuId": null,
    "catalogProductId": null,
    "standardProductId": null
  },
  "ocrResolution": {
    "schemaVersion": "ocr-resolution.v1",
    "status": "needs_ocr_resolution",
    "resolutionId": "server-issued-uuid",
    "reasonCode": "menu_identity_ambiguous",
    "requiredSourceFacts": ["exact_menu_serving_label_or_source_menu_code"]
  }
}
```

An exact restaurant response has this authority shape (the UUIDs below are
illustrative server outputs):

```json
{
  "schemaVersion": "receipt-independent-price-observation.v3",
  "kind": "restaurant_purchase",
  "observationId": "server-observation-uuid",
  "replayed": false,
  "authorityStatus": "exact",
  "merchantResolutionStatus": "exact",
  "menuResolutionStatus": "exact",
  "ocrResolution": null,
  "authoritativeIds": {
    "restaurantId": "server-restaurant-uuid",
    "restaurantLocationId": "server-location-uuid",
    "restaurantMenuId": "server-menu-uuid",
    "catalogProductId": "server-catalog-uuid",
    "standardProductId": "server-standard-uuid"
  }
}
```

The OCR App may resolve the server-issued token with the authenticated
`resolve_ocr_standalone_restaurant_menu_v1(p_resolution_id, p_merchant, p_item,
p_user_verified)` RPC. It sends only newly reviewed merchant/menu source facts;
PriceTrace verifies candidate ownership and creates any canonical IDs. It must
not send client-created or copied PriceTrace UUIDs. Replaying the original
idempotency key after resolution returns the same exact IDs and observation.
Restaurant standalone identity remains separate from the retail Product
Candidate prerequisite.

The response contains `observationId`, `kind`, `replayed`, and
`authoritativeIds`. A successful retail request has this shape (all IDs are
server-generated response values and must not be copied into a later request):

```json
{
  "schemaVersion": "receipt-independent-price-observation.v3",
  "kind": "retail_purchase",
  "observationId": "server-uuid",
  "replayed": false,
  "authoritativeIds": {
    "storeId": "server-uuid",
    "productId": "server-uuid",
    "storeProductId": "server-uuid",
    "catalogProductId": "server-uuid",
    "standardProductId": "server-uuid"
  },
  "productClientKey": "product-1"
}
```

Retail `observationId` is the user-owned price observation; restaurant
`observationId` is the restaurant manual observation. Neither path stores
`receipt_id` or `receipt_item_id`.

Restaurant responses use `authorityStatus`, `merchantResolutionStatus`, and
`menuResolutionStatus`, each with only `exact` or `needs_ocr_resolution` values.
Exact requires all Restaurant, Location, Menu, and Catalog IDs plus a recorded
observation. `pending`, `unverified`, or a missing legacy status never means
exact. Retail responses keep the existing product candidate contract.

The same idempotency key and same canonical JSON payload replays the original
response. Reusing the key with any changed merchant, product, SKU, price,
date, or other payload fact returns a conflict. The fingerprint covers the
complete submitted JSON payload, not only the price fields.

The legacy verified receipt RPCs retain their existing receipt-item contract
and remain independent of standalone ingestion. Standalone ingestion does not
submit anything to CashOS or another project's database.
