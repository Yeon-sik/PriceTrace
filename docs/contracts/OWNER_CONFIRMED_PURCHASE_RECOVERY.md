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

## Reusable owner-confirmed design (2026-10-13)

Status: **implementation and permanent deployment complete; accepted for merge by the user on 2026-10-13**. All three migrations are applied, live rollback fixtures pass, and anonymous HTTP execution is denied. The earlier deployment rejection and missing-RPC state are resolved. Agent-observed verification limits remain recorded below; user acceptance does not relabel unperformed checks as passing.

The first feature commit (`PriceTrace feb458b`, `OCR-App e97af18`) tied restaurant identity to purchase source + merchant candidate, tied menu identity to a source line, and made observation.menu_id unique. That would duplicate a restaurant/menu across independent purchases and prevent a useful shared price history. The undeployed feature migration was revised after verifying that neither its DDL nor its history row existed in the live database. Previously applied/main migrations were not edited.

| Table | Identity / evidence boundary |
| --- | --- |
| purchase_owner_restaurants | Reusable private restaurant and location UUID pair; unique owner + merchant candidate |
| purchase_owner_restaurant_sources | Each purchase source + observed candidate bound to the selected private restaurant |
| purchase_owner_menus | Reusable menu within one owner restaurant; exact menu-name + option/serving fingerprint |
| purchase_owner_menu_sources | Each persisted source line bound to its owner menu and restaurant evidence binding |
| purchase_owner_price_observations | One immutable row per source line; many dated rows per menu |

`submit_merchant_identity_candidate_v1` already fingerprints seller name, branch, business kind, actual source pair and actual contact/registration facts, with uniqueness by owner + origin + fingerprint. Different purchase request keys therefore reuse the same merchant candidate for the same owner/facts. Rejected candidates cannot be used. Candidate relations and nullable resolved Restaurant/Location/Menu/Catalog mappings preserve a future reviewed consolidation path. No automatic promotion is implemented, and mappings do not confer publication authority.

Menu proposal keys now use `owner-menu:<owner restaurant UUID>:<menu facts SHA256>`. The proposal's merchant anchor comes from the selected owner restaurant, while the purchase source binding keeps its actual observed candidate. This distinction is necessary when an explicit user choice links incomplete seller facts to an existing richer private identity. The full serving/option text remains part of the menu fingerprint; different names or serving facts create different menus.

## Reuse and ambiguity rules

1. The existing real source-pair/global verified path remains available. Receipt V2, standalone and the Matdan branch/contact path retain their existing contracts.
2. Private reuse is restricted to the same authenticated owner. Exact existing candidate/facts may reuse one compatible owner restaurant after the current canonical review.
3. Explicitly different branches/source pairs are separated. Missing facts may produce suggestions but cannot silently choose a richer/different anchor.
4. Multiple compatible physical-place candidates return `needs_review`, `owner_restaurant_selection_required`, and runtime `ownerRestaurantChoices`. No observation is created before selection.
5. An explicit selection must be one of the server's compatible owner choices. It is accepted through the five-argument RPC overload. The existing four-argument API is preserved.
6. A previously confirmed source-facts alias can be reused when exactly one compatible owner identity exists; multiple possibilities still require selection.

The server locks source -> owner advisory lock -> candidate/selected anchor. This orders cross-purchase creation and avoids holding a candidate while waiting for the owner lock. Unique constraints and immutable evidence bindings preserve idempotency. Prices, quantity, dates and menu facts are read from saved owner source lines, not caller-supplied observation payloads.

`authorityStatus=exact` and `authoritativeIds` retain their existing global meaning. Private results always use `authorityStatus=owner_confirmed`, `authoritativeIds=null`, and `ownerConfirmedIds`. No global Restaurant/Location/Menu/catalogue row is created by private confirmation. All five tables have owner SELECT RLS and no client write grants; private write RPCs check ownership and facts explicitly. Evidence/price rows are immutable; identity facts are immutable while future privileged resolved-mapping updates remain possible.

## PriceTrace product read path

`get_my_owner_confirmed_restaurants_v1()` is a separate SECURITY INVOKER, owner-filtered read RPC. It returns `owner-restaurant-read.v1`, owner ID, private restaurants/locations, menus and price histories. It does not change the public directory or the existing globally verified observation repository.

New files:

- `src/domain/owner-confirmed-restaurant.ts`: strict private Zod read model and latest/history selectors, without public catalogue ID semantics.
- `src/repositories/owner-confirmed-restaurant.repository.ts`: authenticated owner check, dedicated RPC, response-owner validation.
- `src/features/restaurant-menu/use-owner-confirmed-restaurants.ts`: clears data immediately on auth changes and discards stale responses.
- `src/app/OwnerConfirmedRestaurants.tsx` and its CSS Module: existing 음식점 screen's **내 확인 식당** scope, restaurant/menu search, latest observed price/date and expandable price history.
- `src/app/RestaurantBrowser.tsx`: switch between the existing public view and private projection.

The private projection is not merged into RestaurantDirectory/global RestaurantMenu types. The new owner UI/read tests verify two menus and both price histories, other-owner isolation, no anonymous private RPC, no public directory leakage and logout clearing. Desktop/mobile captures use synthetic owner accounts and the user-specified Hansung fixture, not real private records.

## OCR-App, Fitness and CashOS

The V5 flow remains: import -> save PT source -> current canonical fingerprint review -> submit/reuse merchant candidate -> resolve owner restaurant/menu -> immutable price observation -> private Fitness link. Android and Desktop's existing review screens now expose compatible owner restaurant choices. Selection is runtime metadata only and cannot put PT UUIDs or invented seller namespace/code into canonical.

Fitness reuses the original canonical import/food. Four independent A/B nutrition artifacts can reference the same private restaurant/location and the same two menus. Artifact values, visibility, public product links and canonical evidence remain independent and unchanged. No public Nutrition publication RPC is called for owner-confirmed identities.

A missing `link_private_ocr_purchase_nutrition_v1` (`404 / PGRST202`) leaves imported artifact selectors in durable pending metadata with `fitness_private_purchase_link_not_deployed`. It is retryable after deployment without requiring another nutrient import or CashOS transaction. Other contract/auth/conflict errors retain their separate behavior.

CashOS checkpoints and request keys are unchanged. Two genuine purchases produce two transactions; identity recovery, retry, process restart and same-bundle reopening do not resend a successful transaction.

## Cross-purchase acceptance evidence

Hansung A: 2026-10-13, 돼지불백덮밥 5700, 어묵우동 3800.
Hansung B: 2026-11-10, 돼지불백덮밥 6000, 어묵우동 4000.

`supabase/tests/owner_confirmed_cross_purchase.sql` verifies restaurant=1, location=1, menus=2, observations=4; histories 5700 -> 6000 and 3800 -> 4000; immutable source snapshots; stable merchant/menu candidate IDs; replay; branch separation; ambiguous-name selection; previously chosen alias reuse; different serving; rejected merchant/menu candidates; foreign-owner denial; anonymous denial; owner read/history/latest; no public directory contamination. The fixture and its temporary auth users roll back.

OCR's `OwnerConfirmedPurchaseRecoveryTest` verifies two reviewed canonical inputs, shared private IDs, four independent Fitness artifact/food references, two genuine CashOS calls, unavailable-RPC pending/resume, explicit selection of a non-first line, review/selector rejection, malformed IDs, lost responses, restart and unchanged canonical. `integrations/fitness/test-private-purchase-link.mjs` independently verifies four artifacts / one restaurant / two menus / two purchase sources and RLS/replay/conflict boundaries.

## Migration targets and order

| Order | Project | Migration | Current live state |
| --- | --- | --- | --- |
| 1 | PriceTrace bpyvvcmdvgpwjrprkmtq | 20261004131440_restaurant_menu_identity_candidates.sql | Applied; DDL and version row verified |
| 2 | PriceTrace bpyvvcmdvgpwjrprkmtq | 20261013095911_user_confirmed_purchase_restaurants.sql | Applied; DDL and version row verified |
| 3 | Fitness Nutrition eytwkufdesbarxusifzt | 20261013100505_private_ocr_purchase_nutrition_link.sql | Applied; DDL and version row verified |

**haxbzkwvybiebpogaouv is OCR Evidence, not Fitness Nutrition.** The Nutrition target was verified against OCR's runtime NUTRITION_SUPABASE_URL and its persisted import schema. Do not use OCR's linked Evidence project for this migration.

Live PriceTrace history uses different timestamp versions for some older migrations. The prepared deployment scripts fetch the actual remote SQL/history into a fresh temporary project, copy only these missing feature prerequisites, and push the resulting reviewed set. They never insert fake history rows or call `migration repair`. Dry runs confirmed exactly two PT migrations and one Fitness migration, with no seeds/roles/vault changes.

Reproducible commands (default is dry-run; `-Apply` is the permanent write requiring approval):

```powershell
# In PriceTrace; use the installed CLI path or another reviewed compatible CLI.
./scripts/deploy-owner-purchase.ps1 -SupabaseCli C:/Github/PriceTrace_OCR_APP/node_modules/.bin/supabase.cmd
# In OCR-App, independently against Nutrition:
./integrations/fitness/deploy-private-link.ps1 -SupabaseCli ./node_modules/.bin/supabase.cmd
# After approved permanent application:
# repeat each command with -Apply, verify real migration rows + objects, then:
node C:/Github/창팡맨/scripts/smoke-owner-purchase-http.mjs C:/Github/PriceTrace_OCR_APP/.env
```

Keep the deployment package/versioned migration in the Fitness migration process. All three migrations were permanently applied in the order above on 2026-10-13 after explicit user approval. Future changes require new forward migrations. The official CLI generated a deployed PriceTrace schema snapshot containing the new tables and RPC overloads. The existing application DB types are a curated contract and differ substantially from the complete live schema, so they were not replaced wholesale. New private TypeScript I/O uses the existing untyped SupabaseClient boundary, with a strict dedicated domain parser.

## Validation (2026-10-13)

- OCR: `:core:test` 313 passed; `:app:testDebugUnitTest` 142 passed; `:desktop-app:test` 54 total / 3 existing skips / 0 failures. Debug APK and Desktop JAR built.
- PT: lint, typecheck, 568 Vitest tests and production static build passed. The existing nutrition float assertion now uses 12-decimal tolerance for 14.000000000000002 versus 14; production nutrient arithmetic was not changed.
- Purchase SQL: V4 retail/seller-unknown, verified exact authority, legacy recovery, Hansung private recovery, cross-purchase/read/RLS and receipt V2 fixtures passed. The in-memory bootstrap retains its two documented historical syntax accommodations; this is not an unmodified empty-DB bootstrap claim.
- Fitness local SQL: four independent artifacts with reused restaurant/menu references, owner/anonymous ACL, replay/conflict and unchanged nutrients/visibility passed.
- PT post-deployment live rollback: cross-purchase/read/RLS fixture passed against permanently deployed objects. Fixture data and temporary auth users rolled back; deployed schema and history remain present.
- Fitness post-deployment live rollback: two actual existing imports linked/replayed in a transaction; unchanged food rows and owner isolation passed. Temporary links rolled back; deployed schema and history remain present.
- New owner UI Playwright: 4/4 passed, including desktop/mobile history rendering and logout; mechanical UI detector returned no findings.
- Expanded existing Playwright: 21/27 passed, 6 failures. All six scenarios also failed with RestaurantBrowser restored temporarily to the preceding `feb458b` source (1 worker), with the feature file restored afterward to its exact prior hash. These cover official/public cart, initial shared URL, public restaurant reload, seller navigation and the stale `100serving` assertion (current UI says `1회분`). They are not reported as passing, and the control comparison did not identify a new private UI regression. The broader existing E2E baseline remains failing.
- Post-deployment HTTP probes: both new RPCs returned 401/42501 (`ANONYMOUS_EXECUTE_DENIED`); `HTTP_PRIVATE_RPC_ANONYMOUS_ACL_PASS`. The earlier 404/PGRST202 deployment blocker is resolved. Signed-owner PostgREST/JWT success remains unverified.
- Live privileges: all six new PT tables and the Fitness link table have RLS, authenticated SELECT, no anonymous SELECT and no direct authenticated INSERT. New public owner RPCs allow authenticated execution and deny anonymous execution.
- Security advisors: the only findings matching new objects are intentional authenticated `SECURITY DEFINER` execution for the PT writer and Fitness link writer. Both use an empty search path, explicit owner checks and restricted grants; foreign-owner and anonymous rejection passed. Other project advisor findings were not remediated by this feature.
- `git diff --check`: passed in both repos.

## Remaining release blockers and limits

Explicit user approval resolved the earlier automatic approval rejection. Both deployment scripts applied exactly the three reviewed migrations, with no fabricated history rows, seeds, roles or vault changes. Actual executable DB deployment and anonymous HTTP ACL checks are complete. On 2026-10-13 the user accepted the user-confirmed work as passed and requested both repositories be merged. Signed-owner HTTP/session E2E and the broader failing Playwright baseline are limits of the recorded agent verification, not newly claimed test passes.

No real CashOS mutation, APK/device installation, Desktop GUI identity selection, or signed-owner JWT/session E2E is claimed. SQL role/claims rollback validation and deterministic HTTP adapter/UI fixtures prove the specified code/database contracts; they do not prove production session signatures or a released product using the deployed RPCs.

RLS and RPC privileges follow the [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [function privilege](https://supabase.com/docs/guides/database/functions) guidance. The feature's actual boundaries are verified by the fixtures and explicit limitations above.
