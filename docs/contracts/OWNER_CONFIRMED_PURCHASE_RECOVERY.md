# Owner-confirmed purchase restaurant recovery

Validated on 2026-10-13. This is a downstream runtime contract; `.yeonsik` and producer schemas are unchanged.

## Baseline and cause

Fetched both remotes before implementation. OCR-App `origin/main` was `97fb78b`; the existing checkout at `a81b354` already contained it and `git merge --ff-only origin/main` reported up to date. PriceTrace starts at current `origin/main` `2f41060`. Both changes use `feat/user-confirmed-purchase-restaurants`. Existing OCR README/icon changes and other dirty worktrees are preserved. Open PR inspection found only OCR nutrition-label semantics PR #26, unrelated to this work. The older authority-recovery branches were investigated; their PriceTrace changes are already merged in #60 (`68710e9`).

The original V4 writer (`20260911140000_purchase_price_observation_v4.sql`) requires real restaurant source namespace/code. The owner response reader was added in `0007dc9`; the purchase recovery writer in `1224732` / `20261011140409_purchase_restaurant_identity_recovery.sql`. Therefore the earlier document statement that no purchase resolution writer exists is historical, not the latest-main contract.

That writer calls `private_resolve_ocr_standalone_restaurant_v1`, introduced by `1b8038c` / `20260928041336_ocr_v5_standalone_and_menu_authority.sql`. It requires a source pair, business registration number, or branch + address + phone. It cannot resolve a name-only purchase; additionally the old menu writer requires an explicit serving/option. The old administrator candidate registration gate remains unchanged.

## Matdan evidence

Git commits `7d78ec3` and `c62e030` contain Matdan seller/branch projection tests, which alone do not establish a successful live registration.

Read-only queries against the linked PriceTrace database established:

- Restaurant 1, Location 1, Menu 1, manual price observation 1, receipt observation 0, merchant candidate 0.
- Registration date 2026-10-11; restaurant is globally verified.
- Location namespace `pricetrace-ocr-verified-branch-contact-v1`; address and phone are present; business registration number is absent. Contact values were neither exported nor committed.
- Observation kind `standalone_purchase`, snapshot schema `purchase-price-observation.v4`, with a purchase source binding.
- One matching `purchase_restaurant_line_resolutions` row exists.
- The original purchase namespace and code are both NULL. Its saved `reviewed_merchant` has branch, address and phone, with no supplied source namespace. The old runtime resolver derived the branch-contact identity from those additional reviewed facts; it did not require producer-generated UUIDs or canonical source changes.

Thus Matdan really passed purchase recovery and registration; it was not merely a saved candidate. Its branch/contact evidence took the old verified registration path. Hansung's null/null source and absent branch/contact cannot take that path. This is a missing owner-confirmation capability under the existing contract, not evidence that a working name-only registration path regressed.

## New PriceTrace contract

Migration: `20261013095911_user_confirmed_purchase_restaurants.sql`.

`resolve_user_confirmed_purchase_restaurant_line_v1(p_purchase_source_id uuid, p_line_key text, p_merchant_candidate_id uuid, p_user_verified boolean) -> jsonb`

The caller must own the saved source, line and candidate. The candidate must be user-confirmed food service and its name, branch, namespace and code must exactly match the persisted line seller facts. V4 currently has no seller address/phone/BNR fields, so the new writer rejects candidates carrying those extra facts. The client cannot submit prices, menu text, dates or restaurant UUIDs. All observation values come from the saved source and line. Unknown sellers, unsettled purchases and non-itemized prices are rejected.

The existing verified source path remains available. Pending candidate name/branch suggestions do not grant authority. Otherwise the server creates:

- `purchase_owner_restaurants`: server restaurant/location UUID pair, bound to owner + purchase source + merchant candidate.
- `purchase_owner_menus`: private menu UUID per persisted source line, with an existing `restaurant_menu_identity_candidates` proposal.
- `purchase_owner_price_observations`: one immutable observation per persisted source line.

These tables have owner-only SELECT RLS, no client write grants, and mutation rejection triggers. No global restaurant, location, menu, standard product or catalogue product is created by private confirmation. The private restaurant/location pair is scoped to this purchase evidence; later independent purchases are not merged by name. A future cross-purchase/global consolidation requires a separate reviewed mapping.

The saved response reader overlays resolved lines using:

```json
{
  "authorityStatus": "owner_confirmed",
  "merchantResolutionStatus": "owner_confirmed",
  "menuResolutionStatus": "owner_confirmed",
  "authoritativeIds": null,
  "ownerConfirmedIds": {
    "restaurantId": "server UUID",
    "restaurantLocationId": "server UUID",
    "restaurantMenuId": "server UUID",
    "menuCandidateId": "server UUID"
  },
  "observationType": "purchase_owner_price_observation",
  "observationStatus": "created"
}
```

`exact` and `authoritativeIds` retain their global verified meaning. Old clients therefore cannot mistake these private identities for publishable catalogue authority. The old purchase resolver is wrapped to return an existing private resolution instead of producing a second observation; merchant overrides after private resolution are rejected. Receipt V2 and standalone resolvers are unchanged.

## OCR-App call path and files

All paths below are relative to OCR-App.

| File | Change |
| --- | --- |
| `core/src/main/java/com/pricetrace/receiptscanner/ingestion/IngestionOrchestrator.kt` | Current fingerprint review gate, fact-only merchant request, multi-line recovery progress, private identity completion |
| `core/src/main/java/com/pricetrace/receiptocr/pricetrace/PriceTraceCanonicalGateway.kt` | Existing merchant candidate RPC followed by the new purchase-bound resolver; candidate response itself grants no authority |
| `core/src/main/java/com/pricetrace/receiptscanner/ingestion/PurchaseNutritionIdentity.kt` | Separate strict `ownerConfirmed` decoder; `exact()` remains unchanged |
| `core/src/main/java/com/pricetrace/receiptocr/fitness/FitnessCanonicalProjectionSubmitter.kt` | Reuse canonical import and route owner-confirmed identity to a private link instead of public publication |
| `core/src/main/java/com/pricetrace/receiptocr/fitness/NutritionSupabaseGateway.kt` | Authenticated private-link RPC, refresh/retry and response validation |
| `core/src/main/java/com/pricetrace/receiptocr/fitness/NutritionPrivatePurchaseLink.kt` | Private-link payload and strict private response contract |
| `core/src/test/java/com/pricetrace/receiptscanner/ingestion/OwnerConfirmedPurchaseRecoveryTest.kt` | Review, two-line recovery, dropped response, service recreation and same-bundle reopening |
| `core/src/test/resources/hansung-restaurant-purchase.v5.json` | User-specified purchase facts; nutrition values are explicitly synthetic test data |
| `integrations/fitness/` | Independently deployable Fitness migration and local/remote rollback test harness |

The existing current-fingerprint review must be present before merchant submission. For an already accepted pending purchase, the existing review/retry action reads the same server source ID and resolves pending lines. Each successful line advances the loop; an unresolved selector stops without an infinite retry. `seller_override=null` continues to inherit record seller facts. Canonical is not rewritten with IDs, verification flags or fabricated source identifiers.

## Fitness and CashOS

Existing `publish_verified_ocr_dining_out_nutrition_v1` publishes globally; it is intentionally not used for `owner_confirmed`.

OCR-App ships a separate Fitness-target migration, `integrations/fitness/supabase/migrations/20261013100505_private_ocr_purchase_nutrition_link.sql`. Its `link_private_ocr_purchase_nutrition_v1` binds an existing owner canonical import/food to `purchase_record_client_key + purchase_line_key + nutrition_client_key`, validating those keys against persisted import provenance. It stores the server runtime purchase/restaurant/location/menu references in `nutrition_private_purchase_links`. Nutrients, source canonical, visibility and public product links are untouched.

Fitness and PriceTrace use independent databases. External PT IDs in this owner-only table are opaque private references, not a cryptographically attested grant of global authority. This private linkage cannot authorize publication or expose another user's nutrition. OCR obtains the IDs through its authenticated PT response; a caller submitting arbitrary external IDs can only describe their own private reference, not take over a global identity.

CashOS is never invoked by the identity resolver. Already-uploaded sink checkpoints, original request keys and accepted purchase source IDs are retained. Fitness imports replay their original keys (or use the existing owner import-audit recovery path for legacy keys), and the new link is unique by canonical import ID with conflict detection. No new nutrient estimation occurs.

## Concurrency and retry

Both new and legacy purchase writers lock the owner source before resolution. Unique source/candidate and source-line constraints prevent duplicate restaurant pairs, menus and observations. Line/source records remain immutable. Reimporting the same source content returns the existing purchase source. The Fitness writer locks the canonical import; identical link replay returns the same link, changed IDs or provenance conflict. Lost responses are safe to retry.

## Validation and deployment state

- OCR core: 310 tests; Android: 142; Desktop: 54 including 3 pre-existing skips. No failures. Android debug APK and Desktop JAR built. A final core run also checks private review completion and same-bundle reopen.
- PriceTrace lint, typecheck, build: pass.
- PriceTrace Vitest: 562 pass / 1 existing main failure. `nutrition-presentation.test.ts` expects `fatGrams: 14` but receives `14.000000000000002`; the tested feature files are unchanged from `2f41060`.
- `npm.cmd run test:purchase-sql`: V4 retail/seller-unknown, global exact authority, legacy purchase recovery, Hansung private identity/RLS/ACL/replay and receipt V2 resolver SQL fixtures pass.
- The local SQL runner executes 100 migrations with its two documented pre-existing historical syntax bootstrap accommodations; it is not proof of a clean unmodified empty-database bootstrap.
- Fitness local SQL: existing 2 foods/imports remain unchanged; 2 private links; replay, mismatch, foreign owner, anonymous and no direct write checks pass.
- PriceTrace live SQL rollback: `REMOTE_OWNER_PURCHASE_ROLLBACK_PASS`; new DDL and dependency rolled back, confirmed absent afterward.
- Fitness live SQL rollback: 2 existing persisted imports linked/replayed without changing food rows; owner isolation passed; `REMOTE_FITNESS_PRIVATE_LINK_ROLLBACK_PASS`; DDL rolled back.
- `git diff --check`: pass in both repositories.

Live PriceTrace lacked the already-committed `20261004131440_restaurant_menu_identity_candidates.sql` prerequisite. The live rollback test included it before the new migration. Permanent deployment must reconcile that prerequisite and existing migration history, then apply the new PT migration and the separate Fitness migration to their respective projects. Do not blindly replay unrelated missing migrations.

No permanent migration deployment, application installation, real CashOS mutation, physical-device/Desktop GUI E2E, or HTTP PostgREST/JWT test was performed. SQL role/claims tests establish database boundaries, not JWT signature/session behavior.

`src/lib/supabase/database.types.ts` was not hand-edited: this change is SQL + Kotlin JSON RPC, with no new TypeScript table consumer. After deployment, refresh it using the official `supabase gen types --linked --schema public --lang typescript` workflow against the reviewed target schema. Generating against the current undeployed schema would omit these new tables/RPCs.

PriceTrace changed files: the new migration and fixture, `scripts/test-purchase-price-sql.mjs`, `package.json` (reproducible SQL test command), this report, and the V5 contract cross-reference.

Database boundaries follow the [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [function privilege](https://supabase.com/docs/guides/database/functions) guidance; the actual authorization behavior is verified by the SQL tests above.
