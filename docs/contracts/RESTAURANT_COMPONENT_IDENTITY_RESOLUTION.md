# OCR restaurant component / identity review

Base main: `d04cb5cc249b9211a0b72ec88a2821ee20ed8148` (#62 and merged integration #63).
When the final fetch found the newer main, its observation UI, candidate views and owner read
paths were re-investigated and this feature was rebased. The E2E conflict preserves main's initial
owner response synchronization and the component assertions. The existing icon work in the
primary checkout is preserved. All new database changes are in the forward migration
`20261014091055_restaurant_component_identity_resolution.sql`; no prior migration was edited.

## Existing resolver extension

The four/five-argument `resolve_user_confirmed_purchase_restaurant_line_v1` APIs retain their
legacy behavior. The new overload adds `p_owner_menu_id` and `p_resolution_action` (`review`,
`select_restaurant`, `create_restaurant`, `select_menu`, `create_menu`, plus internal `legacy`).
It uses the same source lock, owner lock, reviewed merchant candidate, restaurant/source binding,
menu fingerprint/source binding and immutable price observation. A new client must explicitly
choose or create an unresolved identity; an empty review does not create a second restaurant/menu.

`search_purchase_owner_identity_v1` uses an owned persisted source/line, entity and query. Search
normalizes whitespace and requires all query words in the displayed label, so `한성대 학식당` can
suggest `한성대학교 학식당`. Suggestions never grant authority or select a candidate. Owner sources
already explicitly bound to another spelling are reusable aliases; conflicting branch/source pairs,
rejected candidates and different serving/option facts remain excluded. No restaurant/menu alias
table duplicates #62's immutable source bindings.

Public verified locations/menus are distinguishable `global_verified` suggestions.
`resolve_purchase_global_identity_v1` creates/reuses an owner mapping through the same private
writer, using separate registry anchor and observed-source candidates. It records nullable existing
`resolved_*` references, leaves canonical/source strings unchanged and emits `owner_confirmed`
metadata with null `authoritativeIds`. It does not create new global restaurants, menus or global
price observations, nor does it authorize public Nutrition publication. Existing source-pair exact
authority remains on the pre-existing verified path.

## Components and platforms

- `purchase_owner_menu_components`: an owner-private name/role beneath one existing owner menu or
  exact global parent menu. Allowed roles: side, complimentary_side, sauce, beverage, other.
- `purchase_owner_menu_component_sources`: immutable parent line, local nutrition key, food-photo
  evidence refs and canonical revision fingerprint. The same revision/key cannot move or change
  facts; a new revision appends evidence history. Replay reuses the component relation.
  The identity key is `(user_id, purchase_source_id, canonical_fingerprint, nutrition_client_key)`.
  Independent purchase sources may reuse the same fingerprint/local key; they retain independent
  evidence rows. Within one source/revision/key, changed parent or facts is an immutable conflict.
  The OCR adapter sends
  at most 100 missing components per call and recovers committed partial batches by owner read.
- `register_purchase_menu_components_v1`: obtains the parent menu from persisted server line
  results and accepts reviewed local component facts. No caller-issued Restaurant/Menu UUID is
  accepted. The component tables contain no price columns and create no purchase line/observation.
- `purchase_owner_platforms` / `purchase_owner_platform_sources`: private platform name/code and
  immutable purchase source bindings. `resolve_purchase_owner_platform_v1` supports explicit
  choice/create and unambiguous previously confirmed alias reuse. It never uses platform as seller.

The response getter includes `menuComponents` and `platformIdentity` runtime metadata. V1 owner
restaurant reads are unchanged. `get_my_owner_confirmed_restaurants_v2` adds per-menu component
lists for both `owner_menu_id` and the owner menu's `resolved_restaurant_menu_id` mapping to an
exact/global parent. The component remains owner-private; mapping does not grant global authority.
The query aggregates component rows once, independently of evidence revisions. The TypeScript repository falls back to V1 only for `PGRST202`. The private restaurant screen
shows the component as `가격 미관측`, without manufacturing a zero price.
Its private view uses the existing theme variables so price history stays readable on main's
dark surface; the final screenshot exposed the previous fixed light-theme colors.

All four new tables have owner SELECT RLS, no anonymous SELECT, no direct authenticated write grants,
and immutable triggers. Public RPCs require auth.uid(), restrict execution to authenticated and use
an empty search_path with explicit owned source/line/identity predicates. Internal helpers cannot
be called by public/anon/authenticated. Mutation lock order remains source → owner → candidate.

## Verification and deployment scope

Local `npm run test:purchase-sql` executes the full migration chain plus old purchase/authority/#62
fixtures and the new `restaurant_component_identity_resolution.sql` and
`purchase_public_identity_search.sql` fixtures. They cover A–H, source preservation, aliases,
free versus paid sides, branch/source/serving conflicts, ambiguous choices, replay, foreign-owner
search and selection on owned sources, anonymous ACL, and public/private authority separation.
The harness retains its documented historical POSITION/CASE installation accommodations;
it is not an unmodified empty-database bootstrap claim. It uses local PGlite only.

On the final main, lint/typecheck, 62 Vitest files / 573 tests, the production static build and
102 local migrations plus eight SQL fixtures pass. OCR/GUI results and the complete change list
are recorded in the [OCR implementation report](https://github.com/Yeon-sik/OCR-App/blob/feat/restaurant-component-identity-resolution/docs/RESTAURANT_COMPONENT_IDENTITY_IMPLEMENTATION.md).
SQL role/claims fixtures do not validate real HTTP JWT signatures.
The five component/owner/public/logout browser tests pass after waiting for both the RPC and
current loading state. The broader 36-test run initially passed 30; catalog retries passed later,
but two unchanged public restaurant/product view timeout cases remain. The report records these
failures; this is not a claim that the whole browser suite is green.
No remote migration application, production mutation, real CashOS write or device installation
is performed. Merge PriceTrace first; deploy the reviewed forward migration in a separate approved
operation before enabling the new OCR resolver. Then merge OCR and align the producer contract.

RLS and function grants follow the official [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
and [database functions guide](https://supabase.com/docs/guides/database/functions).

## 2026-10-15 finalization

Fetched baseline: main `d04cb5cc249b9211a0b72ec88a2821ee20ed8148`, feature
`3c22485f125c853639b68a5aaf4871a6dda366c5`; merge-base is main. Primary checkouts and unrelated work are preserved.
Forward migrations only:

- `20261014161626_restaurant_component_parent_reads.sql`: V2-only private component read repair. V1 function/response unchanged.
- `20261014161627_restaurant_component_source_scope.sql`: drops only the owner-wide fingerprint/key unique; source-bound PK, FKs, immutable triggers and RPC checks remain.

Failure reproduced before fixes: `EXACT_GLOBAL_COMPONENT_PRIVATE_READ_MISSING`, followed by
`23505 purchase_owner_menu_component_user_id_canonical_fingerprint_key` for an independent purchase.
The new read fixture covers owner/exact parents, cross-owner isolation, no duplicates, no component
prices/observations, source preservation, V1 equality and direct write/anonymous denial. The updated
identity fixture covers independent purchases, identical replay, parent/facts conflict, new revision
history and independent owners. SQL roles/claims are local; production HTTP and schema cache remain unverified.

Identity correction is a follow-up: current restaurant/menu/platform source bindings are immutable,
and selectors return the existing resolved binding. No demonstrated supersession path exists.
Keep the original selection/evidence, append an owner-authorized correction event with predecessor,
reason and timestamp, compute effective identity separately and retain audit history. Do not update
or delete source bindings/price rows. This is not a blocker for this component contract and is not implemented here.
