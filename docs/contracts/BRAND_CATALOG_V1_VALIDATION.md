# Brand Catalog V1 closure evidence

Run date: 2026-10-23 (Asia/Seoul). Repository: `Yeon-sik/PriceTrace`.
Main baseline: `ad49d0f09647c659d6394e4447c2425f2fcdb9eb`.
Starting feature HEAD: `673a676c1aaf46917fcd2cd731264993c327639e`, branch `feat/brand-hall`.
All results below were executed during closure, not copied from implementation-time runs.

## Changes and reproduced defects

- Added the [canonical cross-system contract](BRAND_CATALOG_V1.md).
- A published product's anonymous Brand Hall click previously navigated into authenticated private identity detail.
  The strengthened browser assertion failed before the fix. Public exact-specification details now expand inside Brand Hall,
  using already validated public data. Desktop/mobile assertions check displayed identity and absence of private detail requests.
- An archived directly assigned brand lost its actual parent ID in v5 because the direct-brand join filtered active status.
  The new SQL assertion failed with `v5 archived brand became a root` before the repair.
  Forward migration `20261022193355_preserve_archived_brand_parent_identity.sql` preserves the stored parent ID while retaining name visibility rules.
  It changes no response shape and does not edit historical migrations.
- Added archive/null, complete v4/v5 common-projection and upper/default pagination-bound assertions to the existing SQL fixture.
  Existing E2E tests were strengthened rather than duplicated.

## Fresh local execution

| Command | Result |
| --- | --- |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run lint` | PASS |
| `npm.cmd run test` | PASS: 66 files, 589 tests |
| `npm.cmd run build` | PASS: Next.js static export, `/PriceTrace` |
| `git diff --check` | PASS |
| `npm.cmd run test:purchase-sql` | PASS: 106 migrations, 10 SQL fixtures |
| `npx.cmd playwright test e2e/brand-hall.spec.ts --workers=1` | PASS: 4 tests, 23.4 seconds |

PGlite printed `BRAND_LEGACY_V1_V4_DEFINITIONS_UNCHANGED_PASS` and
`BRAND_HIERARCHY_SEARCH_V5_COMPATIBILITY_RLS_PASS`.
The harness's older unrelated SQL bootstrap accommodations remain documented in the harness; original migrations are untouched.

The executed Brand SQL fixture proves self/indirect/multi-row cycle rejection, valid re-parenting, parent delete restriction,
ID/shadow preservation, canonical rename propagation, canonical/alias resolution, ranking, deduplication, active filtering,
pagination bounds, exact common projection of v5 with v4, immediate-parent behavior, archive/null distinctions,
anonymous reads, nonadmin rejection, successful admin mutations/audit and revoked direct client writes.

The four executed Brand Hall E2E tests assert public browse, canonical/alias search, root-to-child navigation,
three-level breadcrumb, direct products only, anonymous product details, back/forward, invalid UUID,
missing ID, empty results, failure/retry, loading, stale search protection, desktop/mobile behavior,
admin re-parenting, self/descendant parent exclusion, alias add/delete and horizontal overflow.
The new expanded product detail's mobile capture was visually inspected. Browser data is synthetic fixture data.

The legacy strict v4 schema, established product `load()` version negotiation and v4 type block are unchanged.
No OCR-App/Fitness source, original dirty checkout work, private data or `.serena/` metadata is included in the closure commit.

## Actual Supabase deployment

Project `PriceTrace`, ref `bpyvvcmdvgpwjrprkmtq`, was verified through existing authenticated CLI project access
and the original checkout's existing linked configuration. No project, credential or real hierarchy relationship was created.
The connected MCP project's listing did not include this project; CLI access provided the verified fallback.

Remote migration history differs from the repository's older history. The safe deployment process used a separate temporary folder:

1. Reused the existing linked project/IPv4 connection configuration.
2. Fetched actual remote migration history with `supabase migration fetch --linked` into that folder.
3. Copied only `20261022041929_brand_hierarchy_public_catalog.sql` and
   `20261022193355_preserve_archived_brand_parent_identity.sql` from this branch.
4. Ran `supabase db push --linked --dry-run`: exactly those two pending migrations.
5. Ran `supabase db push --linked --yes` and read both versions back from `supabase_migrations.schema_migrations`.

An initial automatic approval rejection was resolved by presenting the user's attached explicit deployment instruction (§7, lines 449–460).
The same deployment command was then approved and completed. The post-push Docker catalog-cache warning affected local caching;
remote history/schema/RPC readback independently confirmed application. No reset/history repair or historical migration rewrite was used.

Readback confirmed nullable UUID `brands.parent_brand_id`, its self-check and `ON DELETE RESTRICT` FK,
RLS on brand/alias/guard/audit tables, and all five RPC signatures matching the canonical document.
Both public RPCs grant anon/authenticated execution. Admin RPCs deny anon execution and grant authenticated execution,
then enforce the admin check internally. Direct authenticated brand/alias writes remain revoked.

## Deployed compatibility and API evidence

Before/after hashes of `pg_get_functiondef()` matched for every existing public catalog function:

| Existing RPC | Unchanged definition MD5 |
| --- | --- |
| `get_public_standard_product_catalog()` | `dd2aa29ef294416be818b8cf0b4293dd` |
| `get_public_exact_standard_product_catalog()` (original exact catalog / v1) | `1aa2743ce082849a82c33310afa90795` |
| `get_public_exact_standard_product_catalog_v2()` | `23c8023aaa5ec399bba29f05646dd899` |
| `get_public_exact_standard_product_catalog_v3()` | `11df8a53d77d660fe1d799535510d997` |
| `get_public_exact_standard_product_catalog_v4()` | `b8609f6581f29363e938d2942059e0b8` |

There is no separately named `_v1()` exact-catalog function; the original unversioned function is preserved.
Brand ID/canonical-name and standard product ID/brand-ID/legacy-shadow aggregate hashes also matched before/after.
The deployed full `v5 - {brand_id,parent_brand_id,parent_brand_name}` projection equalled v4 using bidirectional `EXCEPT ALL`.

Actual anonymous HTTP requests returned 200 for browse, canonical search and v5 product read.
The v5 response included all new identity and existing category fields. An anonymous admin-save request returned 401.
An additional live read through the actual repositories/strict v5 parser passed for all **41 public brands and 107 v5 mapping rows**.
There was no public alias sample in production; alias resolution is proved by the executed SQL/E2E fixtures, not by fabricated real data.

Deployed SQL-role probes passed for anonymous reads, all three nonadmin admin-RPC rejections,
admin authorization of all three RPCs, and revoked direct client writes.
Admin probes deliberately targeted nonexistent IDs and reached the expected missing-target error after authorization.
Every probe was enclosed in a transaction ending in `ROLLBACK`; no real brand/alias/audit changes were retained.
Successful admin writes are executed by the local PGlite regression, not claimed as real production changes.

## Security advisors and boundaries

The before/after security-advisor comparison added five WARN entries:
v5 is intentionally executable as `SECURITY DEFINER` by anon and authenticated, and the three admin RPCs are intentionally
executable by authenticated roles. Public v5 is restricted to v4's public product projection; admin RPCs check `auth.uid()` and
trusted `app_metadata.role`. All use fixed empty search paths. No new ERROR was returned.
These are [public-definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
and [authenticated-definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
exposure advisories, not a claim of zero security advisories across the existing project.

Real signed-in nonadmin/admin JWT sessions were not acquired or impersonated. Their live UI/session flows remain unverified;
SQL-role/claim probes and fixture authentication must not be described as end-to-end production JWT verification.
Hosted frontend deployment, remote CI, physical mobile device behavior and OCR-App/Fitness integration are outside this evidence.

## Readiness

Canonical ID, explicit immediate-parent ID, optional public parent name, alias match metadata, no-brand/root/sub-brand
and publicly unresolved-parent distinctions are documented and executed in contract regressions.
Public RPC deployment, anonymous API access and actual strict parsing are confirmed.

**PT BRAND CONTRACT: READY FOR CONSUMERS.** This declares the PriceTrace read contract ready;
it does not claim OCR-App/Fitness adoption or verified real hierarchy curation.
