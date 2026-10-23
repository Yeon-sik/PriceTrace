# Product Candidate Brand resolution validation — 2026-10-23

This records the initial delivery. See the [follow-up self-review and corrections](PRODUCT_CANDIDATE_BRAND_RESOLUTION_V1_REVIEW.md) for the subsequent OCR fixes and latest local test counts.

Scope: private PriceTrace Brand resolution and the OCR Android/Desktop consumer. Brand Hall was fast-forwarded to main at `08b8b0273f3457eba4ad878f26a74e306b332411`; these integration branches remain separate from main.

## PriceTrace local checks

Sequential commands completed:

| Command | Result |
| --- | --- |
| `npm.cmd run lint` | PASS |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd run test` | 66 files / 589 tests passed |
| `npm.cmd run build` | PASS, static export generated |
| `npm.cmd run test:purchase-sql` | 107 migrations / 12 SQL fixtures passed |
| `git diff --check` | PASS |

The SQL harness reports `PRODUCT_CANDIDATE_INGEST_V1_DEFINITION_UNCHANGED_PASS` and `BRAND_LEGACY_V1_V4_DEFINITIONS_UNCHANGED_PASS`. Existing public functions, strict v4 client schema and repository negotiation paths were not edited. Historical SQL bootstrap accommodations remain explicitly reported by the existing harness; they are not production migration rewrites.

The new SQL fixture proves authentication/ownership, required authority, observed-value/revision guards, explicit confirmation, active Brand validation, deep proper-descendant relationships, atomic conflict rejection, replay/change/clear, archive identity retention, private table denial, and unchanged source/public product data. The older ingest fixture needed a current leaf category and its required synthetic reference URL; production constraints were retained.

## OCR checks

The final production source passed `:core:test :app:testDebugUnitTest :desktop-app:test :app:assembleDebug :app:assembleDebugAndroidTest :receipt-scanner:assembleDebugAndroidTest lint`.

- Core: 362 tests, zero failures; one optional live smoke skipped without environment variables. The live smoke separately ran with the legitimate existing public connection and passed.
- App JVM: 145 tests passed.
- Desktop JVM: 98 tests, zero failures; three existing owner-approved remote/checkpoint tests skipped because their opt-in records were not provided. The new Desktop Brand UI class also ran explicitly: four passed.
- Emulator `emulator-5556`: `ProductBrandResolutionUiTest` plus existing `LinkedProductReviewUiTest`: 13 passed; Room sidecar and v1→v14 migration classes: two passed.
- UI fixture captures of Brand search and selection were visually inspected on Android and Desktop.
- Core has no Android/Compose/ML Kit imports. Canonical v1–v5 schema/codec files remain unchanged. Tests prove PT-only authority translation leaves canonical source JSON unchanged.

The Android app was absent on this emulator before validation. Only this emulator was installed/updated using `adb -s emulator-5556 install -r`; no uninstall or data-clear commands were used. The connected physical device was not changed.

The Korean parent path triggers Android plugin/JVM class-loading limitations. Checks used an ASCII temporary build copy, with every changed source checked by SHA-256. The temporary local path override was removed from the delivery branch. The existing ignored `.env` remained local and was not committed.

## Self-review corrections

- Candidate/catalog-reuse metadata preserves the same explicit logical-to-authority mapping across both response arrays.
- Present server authority-key echoes must be strings matching the transmitted key; null, numeric and mismatched echoes fail closed.
- Both source invalidation and canonical draft revision permanently discard stale Brand drafts. A regression proves undoing a raw edit cannot restore the discarded selection, and old accepted legacy authority metadata is cleared.
- Coroutine cancellation is propagated through the new submission/recovery path.
- The migration fixture now inserts an actual old ingestion session before checking its preserved source fingerprint and new empty sidecar default.

No unresolved blocking correctness or security finding remained in the reviewed paths. This is a self-review, not an independent external review.

## Remote Supabase

The existing authenticated CLI linkage was used for the PriceTrace project. Fetched remote history was kept in a temporary deployment directory. Dry-run listed only `20261023070322_product_candidate_brand_resolution.sql`; only that migration was pushed. Remote migration history and schema readback confirmed application.

Readback verified eight table columns, RLS enabled, authenticated-only execute on both private RPCs, no anon/authenticated direct table privileges, `SECURITY DEFINER` and empty `search_path` on private RPCs. Existing public Brand search remains invoker/public-read.

Before/after `pg_get_functiondef` MD5 values were identical for the installed candidate ingest, Brand search and exact catalog v2/v3/v4/v5 functions. The current remote catalog does not expose a separately suffixed exact-v1 function; local compatibility checks include all existing legacy names. The installed v4 hash was `b8609f6581f29363e938d2942059e0b8`; ingest v1 was `1d1524fb7fbd8e8922c2010f42bdd5e1`.

Actual table content hashes were unchanged across deployment:

| Table | MD5 of ordered JSON rows |
| --- | --- |
| `brands` | `ff4a8ae227000c56d049e254f5c062f1` |
| `standard_products` | `533839e43c048e2005a6cdb8f677a650` |
| `catalog_products` | `e66ffb29ea582c04e21a7678e4ea51e8` |

A management SQL transaction used role/claim simulation with an existing auth principal and existing active Brand. It created only a temporary private candidate, executed ingest→owner resolve/read, rejected cross-owner access and anon private RPC calls, then rolled everything back. No fake Brand or committed production candidate/resolution was created. Marker: `REMOTE_ROLLBACK_OWNER_INGEST_RESOLVE_READ_CROSS_OWNER_ANON_PASS`.

This proves deployed DB behavior under database role/claim simulation. It does not prove a real user's JWT/session path against an existing safe operational candidate.

## Live OCR smoke

The actual shared Core HTTPS client searched the deployed public RPC with the existing publishable key. Its strict parser accepted 41 rows. The same anonymous client received HTTP 401 for the private mutation. Marker: `PT_BRAND_LIVE_STRICT_PARSE_PASS rows=41; ANONYMOUS_MUTATION_DENIED=401`.

Authenticated real-data mutation remains **UNVERIFIED IN REAL DATA**: no safe user-owned production test candidate was selected. The rollback DB test is recorded separately. Real Brand/product data was not changed by the probes.

## Public/private signatures

```sql
get_public_brand_catalog_v1(
  p_query text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS TABLE (
  brand_id uuid, canonical_name text, parent_brand_id uuid, parent_canonical_name text,
  matched_name text, match_kind text, logo_url text, official_site_url text
);

set_product_candidate_brand_resolution_v1(
  p_client_key text, p_source_field text, p_observed_value text,
  p_brand_id uuid, p_user_verified boolean
) RETURNS jsonb;
-- JSON keys: product_client_key, request_fingerprint, source_field,
-- observed_value, brand_id (nullable), cleared.

get_product_candidate_brand_resolutions_v1(p_client_key text) RETURNS TABLE (
  product_client_key text, request_fingerprint text, source_field text, observed_value text,
  brand_id uuid, canonical_name text, brand_active boolean, parent_brand_id uuid,
  parent_canonical_name text, created_at timestamptz, updated_at timestamptz
);

-- Previously delivered Brand Hall contract; unchanged by this integration:
get_public_exact_standard_product_catalog_v5() RETURNS TABLE (
  source_label text, source_product_code text, catalog_product_id uuid,
  standard_product_id uuid, standard_name text, brand_name text,
  standard_category_id uuid, standard_category_slug text, standard_category_name text,
  content_amount numeric, content_unit text, package_count integer, reference_unit integer,
  coupang_listed_price_krw integer, coupang_quantity integer, coupang_content_amount numeric,
  coupang_content_unit text, coupang_max_bundle_quantity integer,
  coupang_max_bundle_listed_price_krw integer, coupang_product_url text,
  coupang_observed_at timestamptz, brand_id uuid, parent_brand_id uuid, parent_brand_name text
);
```

See [the private resolution contract](../contracts/PRODUCT_CANDIDATE_BRAND_RESOLUTION_V1.md) for ownership, exact failure behavior and retry rules. The new integration branches are pushed for review and are not merged to main.
