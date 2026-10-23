# Product Candidate Brand Resolution V1

PriceTrace owns canonical Brand identity and its graph. OCR-App owns observed facts and records explicit user selections.
This is private resolution evidence for one authenticated user's immutable candidate revision, not public product authority.
See [Brand Catalog V1](BRAND_CATALOG_V1.md) and [Product Candidate ingest V1](PRODUCT_CANDIDATE_INGEST_V1.md).

## Separate logical and authority keys

OCR `ProductCandidate.clientKey` remains the stable local relation key. Canonical OCR v1–v5 JSON, purchase/nutrition references and raw
brand/sub-brand/manufacturer facts retain their existing meaning. No PT IDs are added to source envelopes.

At the PT gateway only, the exact sanitized candidate payload (excluding outgoing `client_key`) and logical OCR key form canonical,
recursively key-sorted JSON revision material. Its UTF-8 SHA-256 is `sourceRevisionFingerprint`.
The opaque PT authority key is `ocrpc-r1-` plus that lowercase 64-hex fingerprint. It is deterministic and non-UUID, with no hash circularity.
One builder supplies both hashing and submission. Every field actually transmitted, including evidence/provenance, participates.
Changing a local canonical Brand selection does not alter this source revision.

PT receives the authority key as `p_candidate.client_key`; per-candidate idempotency is SHA-256 of
`projectionIdempotencyKey + "|candidate=" + authorityClientKey`. Existing accepted legacy keys remain valid and are reused only from
current successful source-revision metadata. Source edits invalidate that metadata through the existing artifact/projection mechanism.
The server still rejects a different payload under an already bound authority key with `23505`.

OCR validates echoed PT keys before translating response metadata back to logical keys, retaining `priceTraceAuthorityClientKey` separately.
PT-only standalone `product.product_client_key` and purchase-v4 `items[].product.client_key` references use the same effective mapping.
Canonical OCR, CashOS and Fitness JSON are not rewritten for this translation.

## Private table

`product_candidate_brand_resolutions` contains:

```text
user_id uuid
client_key text                         # PT authority key, not OCR logical key
request_fingerprint text                # current PT authority projection fingerprint
source_field text                      # brand | sub_brand
observed_value text
brand_id uuid -> brands.id
created_at timestamptz
updated_at timestamptz
PRIMARY KEY(user_id, client_key, request_fingerprint, source_field)
FOREIGN KEY(user_id, client_key) -> product_candidate_authority_projections
```

No source candidate row is updated. The server fingerprint is distinct from OCR's revision hash: the server retains its existing
fingerprint algorithm over the complete PT request. Both identify the exact immutable request in their own boundary.

## Mutation

```sql
public.set_product_candidate_brand_resolution_v1(
  p_client_key text, p_source_field text, p_observed_value text,
  p_brand_id uuid, p_user_verified boolean
) RETURNS jsonb
```

Requires `auth.uid()`, explicit `p_user_verified = true`, own existing authority projection, field `brand` or `sub_brand`,
and nonblank trimmed observed text equal to the current source payload field. Manufacturer and arbitrary paths are rejected.
A nonnull Brand ID must be active. Null explicitly clears that field's current resolution; absence of a command is not clear.
Replay/upsert is safe, changes update `updated_at`, and a clear is idempotent.

When both fields are selected, sub-brand must be a proper descendant of brand at any depth, using UUID graph traversal.
Invalid changes raise `23514 / brand_sub_brand_hierarchy_conflict`; the attempted statement rolls back and the previous valid selection remains.
The shared Brand hierarchy write guard serializes validation with concurrent hierarchy/selection writers.

Result object keys are `product_client_key`, `request_fingerprint`, `source_field`, `observed_value`, `brand_id` (nullable), `cleared`.
Errors include `authentication_required` (`42501`), `explicit_user_verification_required`, `invalid_brand_source_field`,
`invalid_candidate_client_key`, `stale_brand_observed_value` (`22023`), `candidate_authority_required` and `active_brand_required` (`23503`).
Other owners' keys are indistinguishable from missing keys.

## Read and recovery

```sql
public.get_product_candidate_brand_resolutions_v1(p_client_key text)
RETURNS TABLE (
  product_client_key text, request_fingerprint text, source_field text, observed_value text,
  brand_id uuid, canonical_name text, brand_active boolean,
  parent_brand_id uuid, parent_canonical_name text, created_at timestamptz, updated_at timestamptz
)
```

Only the authenticated owner's current authority fingerprint is returned. Recovery uses exact authority key, field and fingerprint,
never names or array order. Old fingerprint rows are excluded. The immutable authority key prevents a new payload from stealing old resolutions.
Archived selections keep their UUID and `brand_active=false`; canonical name is withheld. Stored parent ID remains present,
and parent name is public only when selected and parent brands are both active. A null parent name with a known ID is not root.

Both functions are `SECURITY DEFINER`, fixed empty search path, revoked PUBLIC/anon execution, authenticated execution granted,
and explicit `auth.uid()` enforcement. The table has RLS and no direct anon/authenticated grants, including writes.
Only these RPCs mutate private selections. No selection creates Brands/aliases, reparents Brands, verifies candidates,
or updates `standard_products.brand_id`, `catalog_products` or any public product identity.

## OCR workflow

Durable session sidecar distinguishes `UNSET`, `SELECTED`, `CLEAR`; display names are snapshots, not identity.
Editing observed brand/sub-brand drops the corresponding stale draft. Search is public with configured publishable key;
anonymous requests have no blank Bearer header. Exact/alias matches require explicit selection.

Submission order: unchanged fact-only ingest v1 with revision authority key → explicit clear/set intents → current-resolution read/validation
→ combined projection metadata. No-selection submissions issue only candidate ingest requests. Partial failures remain retryable where appropriate;
deterministic contract/hierarchy errors require review. Same source retries reuse the authority key; source edits derive a new key.
Current successful legacy keys are preserved; invalidated source metadata is never reused.

Android Room and Desktop session serialization persist the same sidecar outside source JSON. Old sessions default to an empty list.
Successful clear may remain as a durable explicit intent for safe replay; it is not confused with never-selected `UNSET`.

## Execution evidence

`npm.cmd run test:purchase-sql` executes the new Brand-resolution fixture, the existing Product Candidate ingest fixture and Brand Catalog regressions.
The harness additionally checks `pg_get_functiondef(submit_product_candidate_v1)` before/after the new migration.
The older ingest fixture now uses a current leaf category and required synthetic reference URL; production validation constraints are unchanged.
