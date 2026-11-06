# PriceTrace private information inbox

This additive inbox implements [information-record.v1](../../contracts/information-record.v1.md). It accepts PriceTrace-owned payable offerings and observations that do not fit the existing retail or restaurant input contracts. The application exposes **내 정보** in desktop navigation and **상품·서비스 정보 보관함** above the product browser on mobile and desktop.

Users can create product, menu, place, service, raw-material, property or other offering records, add typed custom fields and source notes, import reviewed JSON files, inspect all source text and fields, change local review metadata and export the original JSON. Optional external references identify another application's record without copying its payload. The existing signed-in PriceTrace account owns every remote row; imported producer data never supplies an authentication principal.

## Source and ownership boundaries

- `pricetrace_information_inbox` is private review storage. It does not create catalog products, verified identities, published prices, receipt lines, payments, nutrition or health facts.
- Original JSON text is immutable. Exact decimal strings, arbitrary JSON numeric tokens, empty strings, false and JSON null survive reload/export. The parsed JavaScript projection is only for validation and display labels; it must never be serialized over the original text.
- Canonicalization sorts object keys, preserves array order and raw numeric token spelling, and normalizes JSON string escaping. Key order and insignificant whitespace are ignored for duplicate detection. `1`, `1.0`, and `1e0` remain distinct numeric representations.
- At most 1 MiB and 64 nested containers are accepted. Raw NaN/Infinity are invalid JSON. A valid arbitrary JSON numeric token such as `1e999999` is preserved as text without conversion to JavaScript or PostgreSQL numeric for storage or comparison.
- A repeated account/record ID with the same canonical source is a successful duplicate. Changed content is a conflict. Corrections use a new ID and can name `supersedes_record_id` in an imported record.
- `pending`, `reviewed`, `archived` and `received_at` are receiver metadata. Reviewing a record does not assert that sources, hashes or foreign references have been independently verified.
- Source URLs are not fetched; file bytes remain in the originating OCR archive. Source text is displayed as text, never executed.
- File import requires valid UTF-8; malformed bytes and a leading BOM are rejected instead of silently replacing or dropping source bytes.

## Android delivery

`npm run android:debug` builds a Capacitor static export, synchronizes Android assets, and produces `android/app/build/outputs/apk/debug/app-debug.apk`. A checkout must have the existing public Supabase URL/publishable-key build configuration before this command; a successful build without those values cannot sign in. Never embed service-role credentials.

Android export uses `InformationExportPlugin` and the system document picker. It writes the unchanged UTF-8 payload to the user-selected document, reports cancellation or write failure, and keeps browser downloads as the web fallback. The pending payload lives in app-private cache while the picker is open; only its temporary filename enters saved Activity state, avoiding Android's Binder transaction limit. Pending files are removed after completion or cancellation. The plugin adds no storage permission and does not perform network requests.

On 2026-11-06, emulator `emulator-5584` exercised the actual APK's export control and Android Save/Back controls. The saved 1,331-byte JSON matched the original SHA-256 `443cad059a9a4a13fe84c90fce53e3507107ca51716828efa238eaa81523796b`; cancellation appeared in the UI without an export-success message, and temporary files were cleared. The WebView test intercepted nonlocal network requests with fixtures, so this proves native file handoff rather than hosted authentication or ingestion. The physical device was not installed or changed.

## Database and API

Migration: `supabase/migrations/20261106122747_pricetrace_information_inbox.sql`.

`ingest_pricetrace_information_record_v1(p_payload_text text, p_expected_user_id uuid)` runs as the caller and checks the expected signed-in identity before inserting. This closes an account-switch race between client preparation and submission. Ownership still comes from `auth.uid()`; the expected ID cannot grant access.

RLS limits reads/inserts/state updates to `auth.uid() = user_id`. Anonymous and PUBLIC roles have no grants. Authenticated users can insert only `user_id`, `record_id`, `payload_text`, update only `state`, and cannot delete or replace a payload. CHECK validation applies even to direct table inserts. There are no `SECURITY DEFINER` functions in this migration.

The repository explicitly scopes reads and state changes, validates returned records, and discards results after the signed-in account changes. List loading uses 50-row pages. UI generation guards prevent late responses from restoring the previous account's information.

## Existing coverage and remaining work

The existing `PurchaseType` has retail/menu/raw-material/property/service values, but native price submission requires confirmed catalog/store identity and KRW values. The v4 purchase ingest preserves `other`/`unknown` source records but creates price observations only for retail/restaurant. This inbox supplies usable storage and review for the missing kinds without weakening those authority contracts.

Future native projections should be separate reviewed commands: service price bases (duration, area, tier), non-KRW currency semantics and conversions, structured contracts/renewal periods, and versioned property/offer identities. An arbitrary field name cannot prove semantic ownership; receiver owner tags and foreign namespace rejection are structural enforcement, while human review remains necessary.

Fitness remains the existing Nutrition and Meal Record owner. PriceTrace consumes its versioned read/link contracts and owns product identity. No migration of nutrition truth is included.

## Validation and deployment

Application conformance uses the shared accepted/rejected fixtures. `scripts/verify-information-inbox.mjs` runs inside the complete PGlite migration harness and checks receiver ownership, RLS for two accounts, anonymous denial, immutable payload/owner, state updates, duplicates, conflicts, precision and unchanged native counts. Auth/Storage services are stubbed by that harness; it does not establish real JWT or deployed service behavior.

Run sequentially: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run test:purchase-sql`, and `npm run test:e2e -- e2e/information-inbox.spec.ts`.

Read-only hosted preflight on 2026-11-06 used the existing linked checkout's `node_modules/.bin/supabase.cmd db query --linked`. It reported migration version `20261106121138`, 114 history entries, 113 catalog products, 3 price observations, 6 purchase sources, 2 product candidates, and no inbox table. Several historical local versions are absent or differently versioned in hosted history. Do not bulk-push local migrations to deliver this inbox. Apply only the reviewed additive migration with its history entry, verify grants/RLS/functions, and recheck these native counts. Hosted application and deployment are separate from source and local validation.
