# PriceTrace verified receipt ingestion v2

PriceTrace owns the canonical receipt source contract and all catalog UUIDs. ChatGPT first returns a `yeonsik-ocr.v1` canonical envelope. The envelope's nested `receipt` is an unverified `receipt.v2` draft; the OCR App compares it with the original image, owns the user-verification gate, extracts and sanitizes the internal PriceTrace `receipt.v2` projection, sets `document.source.transcription_status` to `user_verified`, and only then calls the RPC.

**Human source review is owned by OCR-App. PriceTrace remains the downstream domain validation and identity authority; OCR-reviewed ingestion does not require a second human approval for the same source evidence.** PriceTrace continues to reject invalid facts, resolve only exact verified identities, prevent duplicates, and issue or reuse authoritative UUIDs.

Human source review는 OCR-App이 소유한다. PriceTrace는 downstream domain validation/identity authority이며 OCR-reviewed ingestion에 동일 source evidence에 대한 두 번째 human approval을 요구하지 않는다. PriceTrace의 Restaurant / Location / Menu / Catalog 검증, 중복 방지, exact match, 무결성 검증, authoritative UUID 생성·재사용 책임은 그대로 유지한다.

`receipt.v2.document.id` is a nullable source-document fact, not a required PriceTrace identity. A nested receipt with `document.id: null` is valid. The OCR App may create a `localDocumentId` for its own device storage and review workflow, but that local ID is outside `receipt.v2`, is never submitted as a PriceTrace UUID, and is not used as a catalog identity. The server creates `receiptId` only after verified ingestion.

`receipt.v2` retains only observed receipt facts inside the envelope. The ChatGPT stage does not normalize products, infer brands, create catalog links, or emit PriceTrace IDs. A printed and readable merchant name, branch name, business registration number, address, or phone may remain as merchant source fact in the envelope; none may be inferred. Payment identifiers, raw OCR text, and source image/path/binary are removed before the PriceTrace projection. `projection_targets` is only a routing hint and never authority over source facts or verification. Restaurant `main` / `option` / `side` and fulfillment are recorded only when the source or an explicit user statement supplies the required evidence; otherwise those fields remain `null` or `unknown`.

For a food-service product line, `food_service` is the strict object `{ role, applies_to_line_id, benefit_kind }`. `role` remains `main`, `option`, or `side`; `benefit_kind` is `null`, `included`, `complimentary`, `review_event`, `promotion`, or `other`. Older payloads may omit `benefit_kind` and are normalized to `null`, while unknown keys are rejected. `benefit_kind` is an explicit source fact only: it is never created or inferred because a price is zero, small, or nominal.

## RPC

Call the authenticated Supabase RPC:

```text
submit_verified_receipt_v2(
  p_idempotency_key: string,
  p_receipt: receipt.v2 JSON object
)
```

The payload must have `schema_version: "receipt.v2"`, complete KRW totals, an issued date or offset timestamp, and `user_verified` transcription status. `source_images` must be `[]`, `raw_text` must be `null`, and every payment `reference` must be `null`. Only printed `merchant_sku` identifiers are accepted. Unsupported client identity fields (for example catalog, menu, restaurant, store, or PriceTrace UUIDs) are rejected. Unknown SKU, menu, restaurant, or catalog identity remains null; the server never accepts a client-created UUID.

The server stores a sanitized source projection and line semantics. It does not store source images, raw OCR text, payment objects, payment references, or the local receipt JSON. Every described `product` or `service` row receives a server-owned user `productId` and seller-specific `storeProductId`, even when quantity or amount data is insufficient for a price observation. Rows with `each` quantities, a non-negative net amount, and a net amount divisible by quantity additionally become the existing user-owned receipt/observation chain. A restaurant product line with a non-null `benefit_kind` keeps its source monetary fields, receipt item, option relationship, and optional menu identity, but creates neither a normal `price_observations` row nor a restaurant menu receipt observation. `review_event` is source-only in this contract and is not converted into a promotional price observation. Regular sibling lines in the same receipt continue through the normal observation path. Other semantic rows remain in the source-line projection and are not silently converted into products.

Before any product/service row is projected, the server requires complete numeric amounts and rejects the row unless `gross_amount_minor - discount_amount_minor + tax_amount_minor = net_amount_minor`. This is an ingestion invariant; the OCR App must not repair a mismatch by inventing a value.

Totals are reconciled as:

```text
grand = items_gross - discount + tax + fee + tip + rounding + sum(refund.net)
```

Discount, fee, tax, tip, refund, and rounding rows are kept as their original line types. This is additive to `submit_restaurant_receipt_v1`; v1 is not changed or removed.

## Resolution and response

The response is a JSON object with `schemaVersion: "verified-receipt-ingestion.v2"`, `receiptId`, **always-present `storeId`**, nullable `restaurantId` and `restaurantLocationId`, `merchantResolutionStatus`, nullable `merchantCandidateId`, nullable `ocrResolution`, `observationIds`, and a `lines` array. Each line is returned in the original source order with a one-based server-assigned `lineOrdinal`. For `product` and `service` lines, the line reports every available PriceTrace identity: `productId`, `storeProductId`, `catalogProductId`, and `restaurantMenuId`, plus `receiptItemId`, `observationId`, `restaurantObservationId`, `benefitKind`, `resolutionStatus`, and nullable line-level `ocrResolution`. Unavailable identities remain `null`. These IDs and the ordinal are server-owned outputs; OCR and ChatGPT never create them.

## Identity deep links and authenticated reads

### OCR checkpoint recovery

An authenticated receipt owner can recover the current saved server response
without submitting the receipt again:

```text
get_verified_receipt_ingestion_response_v1(p_receipt_id: uuid) -> JSON object
```

The selector must be the `receiptId` previously returned by PriceTrace. The
read-only RPC checks both receipt ownership and the owner-scoped ingestion
content record, then returns that record's sanitized response unchanged,
including current merchant/menu statuses, exact IDs, and server-issued
`ocrResolution` tokens. Another owner's receipt and a missing response both
fail with `P0002`; a missing authenticated user fails with `42501`. Multiple
content records for the same owner and receipt fail closed with `21000`.
Private ingestion tables keep their existing RLS and grants.

OCR should refresh an old checkpoint with this read before attempting identity
resolution or downstream publication. After a merchant-resolution response is
lost, the saved response can already be exact: resume from that response rather
than invoking resolution or receipt ingestion again. Reconstructing a legacy
receipt with a newer codec can change its full JSON fingerprint (for example,
an added nullable field), so re-ingestion is not a recovery read. This RPC does
not create identity, observations, or a new idempotency binding and does not
grant publication intent. OCR still requires its final human review and exact
authority gates before completing Fitness publication.

After deployment, `supabase/tests/ocr_verified_receipt_checkpoint_read.sql`
provides an administrator-run, read-only database smoke using an existing
receipt. It checks the unchanged saved response, owner isolation, missing auth,
and anonymous execution denial without writing fixture data. Role/claim
simulation in SQL is separate from a real authenticated HTTP check.

The application accepts stable exact-identity links while preserving the existing public pages:

```text
?view=markets&storeId=<server storeId>
?view=products&storeProductId=<server storeProductId>
?view=products&catalogProductId=<server catalogProductId>
?view=restaurants&restaurantMenuId=<server restaurantMenuId>
```

`storeId` opens the authenticated seller detail. `storeProductId`, `catalogProductId`, and `restaurantMenuId` open the corresponding exact identity screen. After login, that screen calls the authenticated, owner-scoped `get_authenticated_identity_detail_v1` RPC with exactly one selector and shows the related private receipt, source-line, product, seller-product, and price-observation rows. Shared catalog/menu metadata is returned only from active verified rows. A private read never broadens ownership by trusting a UUID from OCR or by matching a name alone.

Restaurant identity resolves only from one exact verified active location: source namespace + source location code, normalized business registration number, or an exact merchant/branch/address/phone match. When no identity exists, PriceTrace may create a verified Restaurant/Location only from a source namespace/location code, a business registration number, or a complete exact branch/address/phone identity; it never creates or merges one from a name alone. Server-generated namespace/code keys make those source facts idempotent. Same-name branches with different source identities remain separate.

An exact existing RestaurantMenu is reused only when the Restaurant and Location are exact and verified and exactly one active verified Menu/Catalog/Standard chain matches in that Restaurant. For an OCR-reviewed, non-benefit food-service product line, PriceTrace may create a verified `standard_product`, `catalog_product`, and Restaurant-scoped `restaurant_menu` only when no same-name Menu exists in that exact Restaurant. It may also create a source mapping when the receipt contains a real merchant SKU and namespace. The line then returns both `restaurantMenuId` and `catalogProductId` with `resolutionStatus: "resolved"`. Global menu-name matching is never used.

If a Restaurant has multiple same-name Menu candidates, an unverified candidate, a conflicting source mapping, or insufficient line evidence, the line returns `resolutionStatus: "needs_ocr_resolution"`, null Menu/Catalog IDs, and a line-level `ocrResolution` with a server-issued `resolutionId`, `reasonCode`, and required source facts. The OCR App may complete that review with authenticated `resolve_ocr_receipt_menu_identity_v1`, sending the server-issued resolution ID and user-verified menu source facts such as an exact serving label or printed source menu code. The RPC verifies receipt ownership and returns the authoritative IDs; clients never send PriceTrace Restaurant, Location, Menu, or Catalog UUIDs.

An unresolved food-service merchant returns `merchantResolutionStatus: "needs_ocr_resolution"` and a top-level `ocrResolution` object with `status`, server-issued `resolutionId`, `reasonCode`, and required source facts. The OCR App may complete that review with the authenticated `resolve_ocr_merchant_identity_v1` RPC by sending the server-issued resolution ID, newly user-verified merchant source facts, and no PriceTrace Restaurant/Location UUID. The RPC verifies ownership and re-runs the same Menu resolver. A food-service benefit, complimentary, or review-event line remains source semantics (`semantic_only`) and is not promoted to a normal main-menu Nutrition publication identity.

Exact menu observations use the existing `restaurant_menu_receipt_observations` chain and `receipt_item_menu_option_sources` / `restaurant_menu_option_links` flow.

Merchant resolution and receipt enrichment share one guarded observation writer.
After explicit `merchantResolutionStatus: "exact"` and line
`resolutionStatus: "resolved"`, it connects the source line to the server's exact
receipt-item/price-observation mapping. An existing immutable receipt Menu
observation is reused only when its owner, receipt, item, price observation,
Restaurant/Location/Menu authority, date, quantity, and prices all agree. Its
original evidence snapshot and fingerprint are preserved. A legacy snapshot
without `sourceLineId` can be reused only when the stored server response and
the original server receipt-item derivation prove that exact source line;
an explicit different `sourceLineId` is rejected. A different fingerprint alone
does not require a second observation.

A contradictory existing observation fails the whole resolution transaction
with `23514` and an OCR source-review error. It is never reassigned, deleted,
silently ignored, or paired with a different response identity. Ownership
failures remain `42501`; duplicate owner-scoped saved responses fail with
`21000`. There is no current-date fallback for an absent verified receipt date.
The private helper remains unavailable to API roles; only the authenticated
owner resolution RPC is exposed. This behavior is covered by executable
PostgreSQL tests in
`src/domain/ocr-receipt-menu-observation-reuse.test.ts`, including immutable
legacy reuse, retry, conflicts, owner isolation, and exact multi-line mapping.

For legacy observations bound to a `pricetrace-db-store` Location, owner OCR
resolution may restore previously missing identity facts before running the
normal strong-signal resolver. The Location is selected only by its exact
server store UUID and the existing immutable owner/receipt/item/price-observation
bindings. Its creator and verified authority must match the authenticated owner,
and the newly approved facts must match the original user-verified receipt
source and source fingerprint. Names and nullable branch labels are consistency
checks, never UUID selectors. A normalized business number must match the
original source exactly and contain ten digits; otherwise a complete exact
branch/address/phone signal is required.

Only missing address, phone, and business-number facts are restored. Existing
nonblank values, source namespace/code, UUIDs, and immutable observations are
preserved; an absent branch remains `null`. A contradictory existing fact,
missing server binding, or another Location matching a supplied strong signal
fails closed with `23514` and rolls back the resolution. This recovery is
private to the already authenticated, explicitly human-approved merchant RPC;
clients cannot supply a target Location UUID or write those fields directly.
Deploy the recovery migration `20261004063208` followed by the forward schema
compatibility repair `20261004064719`. The deployed `restaurant_locations`
table has no `updated_at` column; the repair keeps the write limited to the
missing verified source facts without adding columns or weakening RLS. Engine
fixtures mirror that table shape and exercise repeated application of both
migrations before the owner resolution RPC.

Retries with the same user and idempotency key return the original response. The same canonical payload sent under another key is content-deduplicated but still creates a separate per-key binding, so every caller key is recorded. Reusing a key for another payload fails. Content fingerprints and idempotency keys are separate server-owned records.

## Merchant-only workflow

The receipt-free `submit_merchant_identity_candidate_v1` workflow remains available for its existing administrator/manual review path. It is not used by OCR-reviewed receipt ingestion. For a verified merchant fact set without a receipt, call:

```text
submit_merchant_identity_candidate_v1(
  p_idempotency_key: string,
  p_merchant: merchant-only facts JSON,
  p_user_verified: true
)
```

This creates a sanitized pending candidate only after explicit user verification; it never creates a canonical restaurant automatically. The canonical draft shape is [`merchant-profile.v1`](./MERCHANT_PROFILE_V1.md). An administrator can attach the candidate to an exact existing restaurant/location with `admin_resolve_merchant_identity_candidate_v1`, or create a pending restaurant/location through `admin_register_restaurant_from_merchant_candidate_v1` for a genuinely new food-service identity. A location source namespace/code is required before a new `restaurant_location` can be created because that table intentionally has no name-only identity.
