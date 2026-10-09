# OCR V5 restaurant purchase: PriceTrace V4 line authority

## Decision and scope

**PriceTrace source change is necessary:** current V4 `lineResults` already
correlates `lineKey` with observation outcome/ID, but does not return Restaurant,
Location or Menu IDs. The receipt checkpoint/resolution APIs cannot resolve a
`purchaseSourceId`. Restaurant manual observations are not owner-readable
through the existing admin-only table policy. An ordinary OCR owner cannot
recover that authority safely by joining exposed tables.

PriceTrace continues to accept only `purchase-price-observation.v4` /
`purchase-price.v4`. OCR projects `yeonsik-ocr.v5 restaurant_purchase`
`purchase_records` into that existing request. PriceTrace does not parse V5,
nutrition artifacts or purchase/nutrition links. No server UUID enters canonical
source JSON. Existing retail/restaurant observation writes, monetary gates,
signature, idempotency keys and source/replay append-only triggers remain intact.

Base investigated: `origin/main df8bd63` (2026-10-09). Current remote function
definition was inspected read-only. It has no purchase getter or restaurant
authority fields and retains seven unsupported `min(uuid)` expressions.
Its CASE condition already has parentheses, unlike the historical repo file.
Remote migrations through `20261004064719` were present; the later menu
candidate migrations in main were not deployed at inspection.

## Existing boundaries

| Contract | Selector | Applicability |
| --- | --- | --- |
| `ingest_verified_purchase_price_observation_v1(text,jsonb)` | owner + key/fingerprint | V4 purchase source/lines, retail observations or restaurant manual observations |
| `get_verified_receipt_ingestion_response_v1(uuid)` | owner + receipt ID | receipt.v2 checkpoint only |
| `resolve_ocr_merchant_identity_v1(uuid,jsonb,boolean)` | owner + server merchant resolution ID | receipt-backed merchant review, verified source facts |
| `resolve_ocr_receipt_menu_identity_v1(uuid,jsonb,boolean)` | owner + server menu resolution ID | receipt line menu review |
| `resolve_ocr_standalone_restaurant_menu_v1(uuid,jsonb,jsonb,boolean)` | owner + server standalone resolution ID | standalone V3 ingestion request, not V4 purchase |
| `submit_merchant_identity_candidate_v1` / owner candidate read | owner + source facts | existing separate merchant proposal/review |
| `submit_restaurant_menu_candidate_v1` / owner candidate read | owner + server-issued merchant or restaurant context | existing separate menu proposal; admin approves exact identity |

Receipt/standalone tokens cannot be fabricated from purchase/line IDs.
The receipt merchant resolver may register verified source-backed identities;
calling it with a made-up receipt would cross the source boundary. It is not
reused as a purchase writer. V4 only reuses verified existing restaurant/location
and menu authorities.

## Additive diff

- `20261009040159_purchase_price_runtime_compatibility.sql`: replaces seven
  `min(uuid)` calls with `min(uuid::text)::uuid`, preserving count/ambiguity gates.
  The unparenthesized historical CASE form is corrected when present.
- `20261009040200_purchase_price_line_authority_response.sql`: adds private
  metadata enrichment and one owner getter. Patches the V4 writer at one checked
  anchor, immediately before its existing response checkpoint insert.
- No new tables, source columns, RLS policies, financial writes or source facts.
- Original migrations remain unchanged.
- Existing response keys remain. The additive response is stored once in the
  same append-only request/content checkpoint rows. Same-key replay and content
  dedup return the same source, IDs and line results; only replay/dedup flags vary.

The database helper reads the exact persisted source-line observation reference
and validates the observation owner plus snapshot purchase ID, line ordinal,
Catalog and Standard IDs. It returns Restaurant/Location/Menu IDs from the
observation, never from caller input or array position.

## Wire response

Top-level additions:

```json
{
  "sourceSaved": true,
  "sourceAcceptanceStatus": "accepted",
  "lineAuthorityVersion": "purchase-line-authority.v1"
}
```

Every retained line keeps its existing `lineOrdinal`, `lineKey`, `seller`,
`sellerConfirmed`, `observationCreated`, and its existing success
`observationId`/`observationType` or failure `reason`. It also receives:

| Field | Meaning |
| --- | --- |
| `kind` | existing normalized `restaurant_purchase` or other V4 kind |
| `sourceSaved` | `true`: the source line was accepted |
| `sourceAcceptanceStatus` | `accepted`; an RPC validation error accepts no partial source |
| `observationStatus` | `created` or `not_created` |
| `reasonCode` | `null` for exact success; otherwise observation/authority block |
| `authorityStatus` | `exact`, `needs_review`, or `unresolved` |
| `merchantResolutionStatus` | merchant authority status; independent of observation outcome |
| `menuResolutionStatus` | menu authority status; independent of observation outcome |
| `authoritativeIds` | exact server identities or `null` |

Exact restaurant line example (synthetic IDs):

```json
{
  "lineOrdinal": 2,
  "lineKey": "menu-a",
  "seller": "Verified restaurant",
  "sellerConfirmed": true,
  "observationCreated": true,
  "observationId": "00000000-0000-4000-8000-000000000105",
  "observationType": "restaurant_menu_manual_observation",
  "kind": "restaurant_purchase",
  "sourceSaved": true,
  "sourceAcceptanceStatus": "accepted",
  "observationStatus": "created",
  "reasonCode": null,
  "authorityStatus": "exact",
  "merchantResolutionStatus": "exact",
  "menuResolutionStatus": "exact",
  "authoritativeIds": {
    "restaurantId": "00000000-0000-4000-8000-000000000101",
    "restaurantLocationId": "00000000-0000-4000-8000-000000000102",
    "restaurantMenuId": "00000000-0000-4000-8000-000000000103",
    "catalogProductId": "00000000-0000-4000-8000-000000000104",
    "standardProductId": "00000000-0000-4000-8000-000000000106"
  }
}
```

Successful retail lines return their existing Product, StoreProduct, Catalog
and Standard IDs as metadata; restaurant decoder must still check `kind`.
`observationIds` is an aggregate convenience list, never a positional mapping.

## Owner checkpoint recovery

```text
get_purchase_price_ingestion_response_v1(p_purchase_source_id uuid) -> jsonb
```

POST `/rest/v1/rpc/get_purchase_price_ingestion_response_v1` with the owner's
authenticated session and `{"p_purchase_source_id":"<accepted purchaseSourceId>"}`.
The UUID is a server-issued response selector, not source authority input.

The getter returns the full saved response for that source. OCR selects its
exact `lineKey` from `lineResults`; no separate line RPC is necessary.
Anonymous execution is revoked. Missing auth is `42501`; null selector is
`22023`; missing/foreign source is `P0002`; nonunique checkpoint is `21000`;
contradictory observation/provenance is `23514`. Source and checkpoint reads
are scoped explicitly by `auth.uid()`; table RLS is unchanged. The private
helper has no PUBLIC/anon/authenticated execution privilege.

Old immutable checkpoints may lack `lineAuthorityVersion`. The getter enriches
them read-only from their original persisted observations, without rewriting
source or checkpoint tables or re-ingesting facts. Old ingest replays retain
their old stored response; OCR calls the getter when metadata is absent.
Old source-only outcomes remain source-only. Legacy ambiguity classification
is conservative and can reflect currently available candidates; it never
creates observations or assigns a name-based exact identity.

## Exact OCR result mapping

1. Retain an OCR-local mapping from each `purchaseRecordClientKey` to its V4
   request/idempotency key and returned `purchaseSourceId`.
2. Retain each submitted `purchaseLineKey` unchanged in V4 `items[].line_key`.
   The V5 gateway already attaches `purchaseRecordClientKey` to each object
   in checkpoint metadata `sources[]`.
3. Select exactly one `sources[]` entry matching the Nutrition link's
   `purchaseRecordClientKey`, then exactly one `lineResults[]` matching
   `purchaseLineKey`. Check the returned key set equals the submitted key set.
   Reject missing, duplicate, blank, unexpected, or cross-record keys.
4. Require `sourceAcceptanceStatus=accepted`, `observationCreated=true`,
   `observationStatus=created`, `kind=restaurant_purchase`,
   `authorityStatus=exact`, and both merchant/menu statuses `exact`.
   Require a valid line `observationId`, its expected observation type, and
   Restaurant/Location/Menu/Catalog UUIDs. Standard ID is separate metadata.
5. Store those IDs only in response/checkpoint/downstream metadata. Link to
   the Nutrition artifact through the original local record+line link.
   Do not write them into V5 canonical or future V4 source requests.

OCR's existing `PurchaseNutritionIdentity.exact` and
`PriceTraceIdentityJson.exactRestaurantMenuFromStandaloneResponse` can decode
the new per-line identity shape. Legacy recovery needs a getter call in the
OCR adapter. This PriceTrace task does not change the OCR repository.

## Review and source-only outcomes

| Situation | Observation | Authority / reason |
| --- | --- | --- |
| exact verified source location + unique verified menu + explicit serving | created | `exact`, IDs returned |
| multiple merchant/location candidates without exact source identity | not_created | `needs_review` / `restaurant_authority_ambiguous` |
| multiple menus at exact restaurant/serving | not_created | `needs_review` / `restaurant_menu_authority_ambiguous` |
| conflicting existing source identity/branch | V4 outcome preserved | `needs_review` / `restaurant_source_identity_conflict`, no IDs |
| unknown seller | not_created | `unresolved` / `seller_unknown` |
| single name candidate without source namespace/code | not_created | `unresolved`, never promoted to exact |
| unknown menu | not_created | `unresolved` / `restaurant_menu_authority_unresolved` |
| serving omitted but legacy default produces observation | created | `unresolved` / `restaurant_menu_serving_label_missing`, no IDs |
| ambiguous/unknown product price, unsettled state or missing date | not_created | `unresolved`, existing gate reason |
| duplicate line keys in legacy-compatible V4 input | V4 outcome preserved | `needs_review` / `duplicate_line_key`, no IDs |
| payment-only purchase | none | accepted source, empty `lineResults` |

Use the existing merchant/menu candidate review workflow for unresolved
catalogue identities. Only verified source namespace/code and explicit menu
serving facts can support a later exact submission. Candidate approval does
not mutate the accepted purchase source, its observation outcome, or replay.
This patch adds no purchase resolution write RPC and does not retroactively
create observations. OCR must keep pending Nutrition linkage pending until
server-issued exact metadata is available; name matching is not a substitute.
A later review/recovery writer, if requested, would need its own source-bound
append-only audit/idempotency contract, rather than edited purchase facts.

## Verification and limits

Run sequential app checks and the executable PostgreSQL fixtures:

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
node scripts/test-purchase-price-sql.mjs <path-to-@electric-sql/pglite>
npm.cmd run build
```

The optional SQL harness uses an externally installed test-only PGlite runtime,
not a production dependency. It creates a fresh database with synthetic
Supabase Auth/Storage bootstrap definitions. SQL role/ACL/RLS tests use actual
PostgreSQL execution; HTTP JWT verification and live Supabase deployment
remain separate checks.

The historical migration bootstrap logs two explicit accommodations: Windows
line endings become LF; the old qualified POSITION expression is unqualified
only in the in-memory bootstrap. The invalid historical V4 CASE body is first
installed with function-body checking off, then corrected by the new forward
migration with checking restored. These are not claims that all historical
migrations can replay unmodified on a fresh Supabase database.

The original V4 SQL fixture needed two missing UUID variable declarations to
be executable; its existing behavior assertions remain. Fixtures cover exact,
ambiguous merchant/menu, unknown seller, source-only, multiline mapping,
same-key/content replay, foreign owner/anonymous access, UUID injection,
source immutability, legacy recovery, branch conflicts, insufficient serving,
duplicate keys and existing V4 retail/restaurant/V3 behavior.

No remote migration deployment, real OCR-to-Nutrition HTTP flow, or Android
device behavior is asserted by these local checks.


## Current OCR projection prerequisite

The inspected `PurchaseEvidenceV4Models.kt` forwards the record's
`sellerSourceNamespace`/`sellerSourceCode` at the top level, but
`priceTraceLineJson` always emits line `seller`:

- no `sellerOverride` becomes explicit `seller: null`;
- an override becomes a name-only seller object with null branch, namespace,
  code and business kind.

V4 intentionally distinguishes omission from explicit null. **Omitting the
line seller inherits the top-level confirmed seller; explicit null marks that
line's seller unknown.** The SQL fixture exercises both paths. Therefore, the
current OCR serializer can produce `seller_unknown` even when the record has
an exact seller, or `restaurant_source_identity_missing` for name-only
overrides. This backend patch cannot make those facts exact safely.

Required OCR adapter handoff:

1. With the same seller as the record, omit the per-line `seller` key so V4
   inherits its verified source namespace/code and branch facts.
2. Keep explicit null when the actual line seller is unknown.
3. For a different line seller, send only its independently user-verified
   source facts. Do not copy the platform or another seller's namespace/code.
4. Retain the exact serving in `option_text`; do not synthesize a default.
5. Add an owner getter call for old checkpoint metadata and validate the full
   returned key set before replacing local response metadata.

These are OCR adapter requirements, not changes to the V5 canonical schema
or V4 server source contract. Current PriceTrace/OCR production end-to-end
linkage remains unverified until migration deployment and those adapter
requirements are satisfied.

## Recorded local validation (2026-10-09)

| Check | Result |
| --- | --- |
| `npm.cmd run lint` | PASS |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run test` | 52 files, 517 tests PASS |
| existing `purchase_price_observation_v4.sql` | PostgreSQL fixture PASS; retail/restaurant and V3 assertions retained |
| `purchase_price_line_authority_response.sql` | PostgreSQL fixture PASS for every required case and extra safety/recovery cases |
| same two fixtures after patching the read-only remote function-definition snapshot locally | PASS; deployed `min(uuid)` error first reproduced |
| `npm.cmd run build` | static export PASS |
| `git diff --check` | PASS |
| real Supabase migration deployment / HTTP JWT / OCR-to-Nutrition / device execution | UNVERIFIED |

SQL run used:
```text
node scripts/test-purchase-price-sql.mjs C:/Users/nwhck/AppData/Local/Temp/pt-pglite-engine-runtime/node_modules/@electric-sql/pglite C:/Users/nwhck/AppData/Local/Temp/pt-purchase-contract-read.json
```

The third argument is optional. It is the CLI's read-only JSON response with
`rows[0].purchase_function`, not source purchase data. Without it the same
fixtures run against the repository bootstrap. The snapshot stays outside Git.
UI flows and Android sources were unchanged, so E2E/device checks were not run.

Generated `database.types.ts` was not manually amended: automatic approval
review rejected that edit under the repository generated-file rule. No
PriceTrace frontend calls the new getter; OCR uses the documented JSON RPC.
