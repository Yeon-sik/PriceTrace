# Brand Resolution V2 repair validation

Executed 2026-10-24 KST on `feat/ocr-brand-resolution`, starting at `d1ffffe9a88bf2aa1378c2d59c3605ce14d2bcb9`. Remote main remained `08b8b0273f3457eba4ad878f26a74e306b332411` at delivery preparation. No merge was performed.

## Locally executed

| Command | Result |
| --- | --- |
| `npm.cmd run lint` | PASS |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run test` | 66 files / 589 tests PASS |
| `npm.cmd run test:purchase-sql` | 108 migrations / 13 fixture files PASS |
| `npm.cmd run build` | PASS, Next.js static export |
| `git diff --check` | PASS |

The SQL harness uses PGlite with Auth/Storage bootstrap stubs and its pre-existing documented historical migration accommodations. Role grants, RLS and PL/pgSQL are executed; this is not JWT or full Supabase service emulation.

Executable V2 assertions cover explicit same Brand, arbitrary-depth descendant, atomic rejection of unrelated Brands, dynamic reparent drift, archived selected UUID retention, stale-fingerprint exclusion, owner/missing authority equivalence, anonymous/unauthenticated rejection, direct-table denial and `catalog_product_reused` without a required private candidate ID.

The multi-candidate SQL regression creates accepted A and B, replays unchanged A, adds revised B and retries both. Exactly three authority keys remain (A, old B, new B); unchanged A's business payload has one authority row and new B's business payload has one authority row. Existing immutable-key rejection still raises 23505.

`pg_get_functiondef` is compared before/after V2 for both Brand-resolution V1 functions and `submit_product_candidate_v1`. Existing Brand catalog/public v1-v4 function compatibility assertions also pass. The deployed V1 migration and V1 documentation bytes are unchanged. New migration normalized SHA-256: `b0ca5133ffc11cf98ab70c3688bb94433992090c3e8d69ac2eeaca7a6c878b03`.

## Independently read remote DB

Authorized CLI connection: PriceTrace project `bpyvvcmdvgpwjrprkmtq`. Inspected migration history first; isolated dry-run listed only `20261023165231_product_candidate_brand_resolution_v2.sql`. Applied that one forward migration, with no history repair. The local Docker cache warning did not prevent deployment; independent database readback confirmed the new ledger row and both V2 RPC definitions.

| Function | Before/after definition MD5 |
| --- | --- |
| `get_product_candidate_brand_resolutions_v1(text)` | `a0ded4d6368adf4249d2876867a4b3bd` |
| `set_product_candidate_brand_resolution_v1(text,text,text,uuid,boolean)` | `231770160bd1c9c0d0f34e67b386399a` |
| `submit_product_candidate_v1(text,jsonb)` | `1d1524fb7fbd8e8922c2010f42bdd5e1` |
| `get_public_brand_catalog_v1(text,integer,integer)` | `1a2b4701e1cb0de88d50c6423a23f7d7` |

All these hashes matched before and after. Existing exact-standard catalog v2-v5 hashes also matched. Aggregate hashes of Brands, standard_products and catalog_products were identical. This deployment creates only V2 RPCs, leaving those data identities intact.

Remote readback confirmed the exact signatures and 14-column result documented in [V2](PRODUCT_CANDIDATE_BRAND_RESOLUTION_V2.md). Both private versions have SECURITY DEFINER, empty search_path, anon execute false, authenticated execute true. The private table still has RLS, the same eight columns, and no direct anon/authenticated SELECT/INSERT/UPDATE/DELETE grants.

A remote rolled-back transaction created only a randomly keyed fixture candidate under an existing authenticated claim, selected the same existing active Brand for both fields, read same_brand, explicitly cleared one field, read single, and checked cross-owner and anonymous denial. It did not alter existing user candidate/resolution rows or Brand masters. Evidence marker: `REMOTE_V2_ROLLBACK_OWNER_SAME_BRAND_CLEAR_CROSS_OWNER_ANON_PASS`. This is SQL role/claim evidence, not an authenticated HTTP user smoke.

OCR's real HTTP smoke passed strict public Brand parsing (41 rows) and V2 anonymous mutation denial (HTTP 401). Authenticated production HTTP mutation was not executed: no designated safe user-owned live HTTP fixture was selected.

## Delivery boundaries

No web UI behavior changed, so browser E2E and PriceTrace Android packaging were not run for this RPC repair. OCR Android/desktop/core lifecycle evidence is recorded in OCR-App's `docs/PRICETRACE_PRODUCT_BRAND_RESOLUTION_V2_VALIDATION.md`. Local and remote verification are separate from GitHub CI, which must be checked on the pushed commit. Both branches remain unmerged for independent SOL review.
