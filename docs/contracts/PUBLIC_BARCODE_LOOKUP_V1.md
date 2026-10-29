# Public barcode lookup v1

PriceTrace owns exact product identity. The AR app may call this read-only RPC
without login using its PriceTrace publishable key. This endpoint does not
create a candidate, identifier, product, price, or Nutrition link.

## Request and security

```text
public.get_public_product_by_barcode_v1(p_barcode text) returns jsonb
POST /rest/v1/rpc/get_public_product_by_barcode_v1
Content-Type: application/json
apikey: <PriceTrace publishable key supplied at runtime>

{"p_barcode":"8801104671507"}
```

No user session or Authorization token is required for a modern publishable
key. Do not put a service-role/secret key in the AR app. This PriceTrace call
and the subsequent Nutrition call belong to separate databases; each uses its
own API URL and publishable key. Key values must not enter logs or this repo.

The function is `STABLE SECURITY DEFINER SET search_path = ''`, revokes EXECUTE
from PUBLIC, and grants it only to `anon` and `authenticated`. It does not grant
anon table SELECT or change `catalog_product_identifiers` RLS/policies.

## Normalization, matching, and statuses

Spaces (including tabs/newlines) and ASCII hyphens are removed. The resulting
value must contain exactly 13 ASCII digits and pass the EAN-13 checksum: the
sum of odd-position digits plus three times the even-position digits,
including the check digit at position 13, must be divisible by ten. Preserve
leading zeros. No numeric conversion of the whole barcode is permitted.
NULL becomes the empty string. 8/12/14-digit values and other characters are
`invalid`; they are not padded or converted to another barcode scheme.

Identity ambiguity uses the normalized identifier value, scheme `ean` or `gtin`,
and `verification_status = 'verified'`. Count **distinct catalog product IDs
before any active/public eligibility filter**. Archived or non-public identities
still block automatic selection when their identifier link is verified.

Only the response product objects use existing `get_product_read_v1` public
eligibility: active and verified retail family and exact variant, verified
specification, and complete positive package fields. Private/unverified products
never become public through this RPC. These corrected rules are implemented by
the forward migration `20261026155036_public_barcode_verified_conflicts.sql`;
the original applied migration is unchanged. See deployment status below.

| status | Meaning | matches |
| --- | --- | --- |
| `invalid` | Unsupported length/characters or checksum failure. No identity lookup. | `[]` |
| `not_linked` | Zero distinct verified links, or exactly one verified linked ID which is not publicly eligible. **Does not mean PT has no such product or identifier.** | `[]` |
| `matched` | Exactly one distinct verified linked catalog ID, and that exact variant is publicly eligible. | One public product |
| `conflict` | Two or more distinct verified linked catalog IDs, regardless of active/public state. Caller must not choose automatically or call Nutrition with an arbitrary ID. | All candidates ordered by catalog ID only when all are public; otherwise `[]` |

The same number under `ean` and `gtin` for one catalog ID is one match. Pending
and rejected identifiers do not participate. A redacted conflict never returns
one visible candidate, a private ID/name/brand/specification, or a private count.
The status itself signals ambiguity; no candidate may be selected from it.
`checkedAt` is the server statement
time in ISO 8601 with timezone; it is not a price observation time or version.

## Contract version and AR parser compatibility

Keep `contractVersion: "pricetrace-barcode-lookup.v1"` and the existing four
status values. A lone non-public verified link remains `not_linked` with `[]`;
no `private`, `inactive`, or other new enum value is introduced. A version bump
would make the current AR client's fixed-version check reject even the unchanged
demo matches, so this is a v1 safety correction with an explicit cardinality
compatibility caveat, **not a claim of full compatibility with the old parser**.

The AR source was inspected read-only at
`C:/Github/가상현실_중간/Assets/Scripts/Lookup/RemoteLookupClients.cs`:
`PtBarcodeClient.Parse` (lines 84-99) validates the fixed contract and throws
`FormatException("PT status/count mismatch")` for
`status == "conflict" && matches.Count < 2`. Thus:

| Corrected server response | Current AR parser |
| --- | --- |
| `matched` + one product | Compatible; both demo responses unchanged |
| `not_linked` / `invalid` + `[]` | Compatible, including a single private verified link |
| `conflict` + two public products | Compatible; existing ordering/validation retained |
| `conflict` + `[]` because any identity is non-public | Rejected as a format error until the AR parser is updated |

`ProductLookup.Lookup` in `Assets/Scripts/Lookup/ProductLookup.cs` (lines 49-59)
catches that parser exception and returns `PtUnavailable`; it does not select
a product, call Nutrition, or enter its OFF fallback for this error. This is
safe against a false match but does not show the intended Conflict state.

The required AR follow-up is to accept `conflict` with zero candidates as a
redacted conflict and return `PtBarcodeReply { Status = "conflict" }`, before
the existing count guard; keep rejecting one candidate, unknown statuses, and
bad envelopes. This PriceTrace-only task does not edit/build the AR repository.
There was no AR runtime/device validation. New server status values or fake
duplicate/public-placeholder rows must not be used to bypass its count guard.

## Response

Every response has exactly these five top-level fields. Product objects have
exactly the ten fields shown. Unknown brand/category/price is JSON null.

```json
{
  "contractVersion": "pricetrace-barcode-lookup.v1",
  "barcode": "8801104671507",
  "status": "matched",
  "checkedAt": "2026-10-26T15:24:54.41142+00:00",
  "matches": [{
    "catalogProductId": "1516c3eb-3dfb-4e11-8040-d23fadcdaad0",
    "standardProductId": "8510a217-fe6c-473b-8c14-2cba4a301e40",
    "name": "더단백 크런치바 초코",
    "brand": "빙그레",
    "contentAmount": 40,
    "contentUnit": "g",
    "packageCount": 1,
    "specificationLabel": "40g",
    "categoryName": "육포·단백질간식",
    "latestPublicPrice": null
  }]
}
```

This matched example is the actual post-deployment anon response captured on
2026-10-27 at 00:24:54 KST. All four verified responses, including the second
demo, are saved in [the sanitized HTTP result](examples/PUBLIC_BARCODE_LOOKUP_V1.verified.json).
`name` is the standard family name; identity for the next call is
`catalogProductId`. Amount/unit/count belong to that exact variant. The existing
product-browser package label rule is reused: `40g`, `40g x 2`, `1개 x 6`.
Free-text specification is not synthesized from a product name. A missing brand
is not inferred from physical-package provenance; the second demo may remain null.

A valid unlinked example (the fixture reserved here is not a claimed GS1 product):

```json
{
  "contractVersion": "pricetrace-barcode-lookup.v1",
  "barcode": "2000000000992",
  "status": "not_linked",
  "checkedAt": "2026-10-26T15:24:54.745426+00:00",
  "matches": []
}
```

## Public price and privacy boundary

`latestPublicPrice` reuses the first, newest verified market listing already
projected for this exact catalog ID by the anon-callable `get_product_read_v1`.
That public function resolves seller duplicates by newest observedAt, createdAt,
then observation ID; it orders the resulting listings by observation time,
seller, then ID. The wrapper preserves that ordering and projects only:

```json
{
  "amountKrw": 1200,
  "kind": "listed",
  "seller": "판매처",
  "observedAt": "2026-10-21T00:00:00+00:00",
  "sourceLabel": "verified-market-observation"
}
```

`amountKrw` is the integer unit listed price recorded in that public observation,
not checkout total; shipping and minimum order quantities are not included in
this compact projection. v1 emits only `listed`; `observed` is reserved for a
future explicitly public purchase-price path. No eligible listing means null.

v4's Coupang listings are owned by standard product family and carry independent
offer quantities. They cannot be assumed to price the scanned exact variant, so
this RPC does not reuse them. Private `price_observations`, original receipts,
owners/authors, provenance, review actor, image paths, raw OCR and receipt line
references are never returned. The existing public scope is not expanded.

## AR / Nutrition handoff and non-guarantees

On `matched`, call Nutrition's existing public function
`get_public_product_nutrition_v1(p_catalog_product_id)` with
`matches[0].catalogProductId`. A barcode match does not guarantee Nutrition
coverage, a Nutrition approval, dietary suitability, current price, stock,
specific branch availability, authenticity, or exhaustive barcode coverage.
Network/HTTP failures must remain separate from the four successful RPC statuses.
Never translate an HTTP failure into `not_linked`.

The AR repository is `C:/Github/가상현실_중간`; this document is its shared
response contract. This task does not change its client or the Nutrition DB.

## Demo registration and deployment

1. Run `npm.cmd run test:purchase-sql` locally. Fixtures roll back; Supabase
   Auth/Storage services are stubbed in the PGlite harness, while roles/RLS and
   PostgreSQL functions execute. HTTP key handling requires the remote smoke test.
2. Obtain user approval **immediately before any remote application**, naming
   the exact migration and the two-row operational SQL below. Product identity
   confirmation is a separate prerequisite and is not deployment approval.
3. Apply only `20261026150132_public_product_by_barcode_v1.sql`. The remote has
   previously applied migrations absent from current main; do not run bulk
   `db push` from that checkout, repair, delete, or replay unrelated history.
   A local ignored release directory at `supabase/.temp/barcode-release-v1`
   contains the 108 actually applied remote migrations plus this new migration.
   Remote history has eight versions absent from main; main also has six old
   versions absent from remote history. None of those six may be pushed as part
   of this task. The staged release dry-run passed and listed **only** this new
   migration. Recheck that exact scope before applying from the release directory.
   Neither repository migration history nor remote already-applied rows are
   rewritten by this staging procedure.
4. Execute `supabase/operations/register_ar_demo_barcodes_v1.sql` as the operator.
   It atomically registers only the two approved `ean` identifiers. A verified
   same-target `ean` is a no-op; same-target verified `gtin` is compatible. Any
   scheme with another target or pending/rejected review raises STOP and rolls
   back both rows. The table lock prevents a concurrent cross-scheme conflict.
   It also checks exact UUID, standard family, expected name, 40g/60g x 1, active
   state, and existing public eligibility before writing. No product edits.
5. Supply `PRICETRACE_URL` and `PRICETRACE_PUBLISHABLE_KEY` through runtime
   environment variables and run `node scripts/verify-public-barcode-lookup.mjs`.
   It calls both barcodes, `2000000000992` and an invalid checksum over HTTPS
   with **only** a publishable key and no user session. Expect
   matched/matched/not_linked/invalid; it also asserts anon direct table SELECT
   remains denied. Save only sanitized JSON results and test counts.
6. Record actual remote migration version, registration outcome, response samples
   and remaining limitations here after approval/application; never record keys.

| Barcode | Catalog ID | Physical-package confirmation |
| --- | --- | --- |
| `8801104671507` | `1516c3eb-3dfb-4e11-8040-d23fadcdaad0` | User-provided name, brand, 40g and printed barcode compared on 2026-10-23. |
| `8809375984692` | `18e83c5c-86a4-4e95-a131-411381789687` | Physical front/barcode evidence on 2026-10-26; user explicitly confirmed exact PT identity in this implementation conversation on 2026-10-27. Dr.Elizabeth's, 1,000mg x 60 tablets, total 60g. |

Provenance retains physical_package, evidence/confirmation dates, actor `user`,
and compared fields. No image or original file path is retained. `reviewed_at`
records actual database registration time; `reviewed_by` remains null because
no auth.users actor UUID was provided. Do not fabricate one.

Remote preflight verified: identifier count 0; anon table SELECT false; RLS true;
both exact products active, verified specification, 40g/60g x 1. New endpoint
was absent. Both exact products were also re-read through v4 over HTTPS using
only a publishable key, with no user Authorization header. This is a read-only
preflight, not deployment evidence.

Initial deployment status: **applied after explicit user approval; anon HTTPS
verification passed on 2026-10-27 (KST)**.

The approved source commit is `23a0d25`. The migration
`20261026150132_public_product_by_barcode_v1.sql` was applied alone from the
staged release directory using `supabase db push --linked --workdir
supabase/.temp/barcode-release-v1 --yes`. Remote migration history now has 109
rows, including version `20261026150132`, name `public_product_by_barcode_v1`.
No unrelated migration was applied or history repaired.

The approved operational SQL then committed exactly two `ean` / `verified`
identifiers at `2026-10-26T15:24:26.42865+00:00` (2026-10-27 00:24:26 KST).
Postflight confirmed identifier count 2, physical-package/user evidence on both
rows, RLS enabled, anon direct table SELECT false, both RPC execute grants true,
and SECURITY DEFINER with an empty search path.

`node scripts/verify-public-barcode-lookup.mjs` passed with a modern publishable
key supplied only in process memory and **no Authorization header/session**:

| Input | HTTP | status | Catalog result |
| --- | --- | --- | --- |
| `8801104671507` | 200 | `matched` | `1516c3eb-3dfb-4e11-8040-d23fadcdaad0`, 40g x 1, brand 빙그레 |
| `8809375984692` | 200 | `matched` | `18e83c5c-86a4-4e95-a131-411381789687`, 60g x 1, brand null |
| `2000000000992` | 200 | `not_linked` | Empty matches |
| `8801104671508` | 200 | `invalid` | Empty matches |
| Direct `catalog_product_identifiers` SELECT | 401 | Access denied | No table rows disclosed |

Both demos returned `latestPublicPrice: null`: no eligible exact-variant public
market listing was available in the reused public projection. Family-level
Coupang prices were not substituted. Key values are absent from committed
evidence, docs and logs.

Root cause rechecked on 2026-10-27: each demo has one publicly eligible product
but **zero total rows and zero verified rows in `market_price_observations` for
its catalog ID**, so `get_product_read_v1(..., null, 1).products[0].observations`
is empty and `latestPublicPrice` is null; no public scope was expanded.

The CLI reported a failed optional local pg-delta catalog cache because Docker
Desktop was unavailable. Remote migration history, identifier rows and real
HTTP calls were subsequently verified successfully; this warning did not
prevent deployment. No Docker installation or unrelated environment changes
were performed.

The post-apply security advisor reports the intentional public/signed-in
SECURITY DEFINER execute warnings
[0028](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
and [0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
for this function. These grants are the approved API contract; empty search path,
strict public projection, table privilege denial and RLS were verified above.
AR device behavior and Nutrition coverage remain unverified in this repository.

Initial release local validation: `npm.cmd run lint`, `npm.cmd run typecheck`,
`npm.cmd run test` (66 files / 589 tests), `npm.cmd run test:purchase-sql`
(107 migration bootstrap, 34 barcode SQL checks, 8 registration checks, and
10 existing SQL regression fixtures), and `npm.cmd run build` passed.
The harness documents two historical SQL bootstrap accommodations; it does
not edit applied migrations to hide those historical issues. No web UI or
Android client was changed; browser E2E/device/Nutrition handoff was not tested.

`npm.cmd run test:purchase-sql -- --barcode-public-read
supabase/.temp/barcode-public-read-snapshot.json` also passed: the same 34
barcode checks were repeated against a read-only snapshot of the currently
deployed `get_product_read_v1` definition, followed by the 8 registration checks.
`supabase db push --linked --dry-run --workdir
supabase/.temp/barcode-release-v1` listed only the new barcode migration.

## Conflict correction and merge order (2026-10-27)

Forward migration: `20261026155036_public_barcode_verified_conflicts.sql`
uses `create or replace`; the initial migration
`20261026150132_public_product_by_barcode_v1.sql` remains unchanged. It separates
all verified distinct identity counts from public product projection. Existing
public/public conflicts retain their two ordered candidates; any hidden
conflicting identity yields `conflict` with `matches: []`. The buggy prior
assertion that archived conflicts become matched was corrected. All other
existing checks remain, with new archived/private/fully hidden conflict and
single hidden-link coverage. The SQL harness first reproduces the old false
match before installing the repair, then runs the corrected fixture.

Correction deployment: **applied after fresh explicit user approval on
2026-10-27; post-correction anon HTTPS verification passed at 01:05:50-51 KST**.
The approved source is commit `d7c1d33`; migration version `20261026155036`, name
`public_barcode_verified_conflicts`, was applied alone with
`supabase db push --linked --workdir supabase/.temp/barcode-conflict-release-v1
--yes`. The earlier approval was not reused. This repair performed no
identifier/product/price writes; the remote identifier count remains 2.

`node scripts/verify-public-barcode-lookup.mjs` passed with a modern publishable
key supplied only in process memory, no Authorization header and no user session:

| Barcode / request | HTTP | Post-correction result |
| --- | --- | --- |
| `8801104671507` | 200 | `matched`, exact catalog `1516c3eb-3dfb-4e11-8040-d23fadcdaad0` |
| `8809375984692` | 200 | `matched`, exact catalog `18e83c5c-86a4-4e95-a131-411381789687` |
| `8801043014830` | 200 | `not_linked`, `matches: []` |
| `2000000000992` | 200 | `not_linked`, `matches: []` |
| `8801104671508` | 200 | `invalid`, `matches: []` |
| Direct identifier table SELECT | 401 | Access denied |

The complete sanitized results are preserved in
[the post-correction verified JSON](examples/PUBLIC_BARCODE_LOOKUP_V1.conflict-fix.verified.json).
The initial verified JSON remains historical. No keys were logged or committed.

Read-only postflight confirmed that the deployed `pg_proc.prosrc` body equals
the approved migration body after line-ending normalization; migration history
contains the repair, `anon` / `authenticated` EXECUTE remain true, PUBLIC EXECUTE
and anon direct table SELECT remain false, identifier RLS remains enabled, and
SECURITY DEFINER retains an empty search path. The CLI again reported the optional
Docker/pg-delta cache warning described above; remote history, function body and
actual HTTP responses independently confirmed successful application.

The dependency order is **brand-hall -> public-barcode-lookup**. The barcode
branch includes `cec0223`, `673a676`, `08b8b02` and reads
`standard_products.brand_id` plus `brands`. Those brand references predate the
hierarchy work, and hierarchy tables/metadata must still be present before this
branch's full migration and application changes are integrated.

Actual Git refs were refreshed with `git fetch origin` and verified with
`git ls-remote origin refs/heads/main refs/heads/feat/brand-hall`:

| Ref | Current commit | Migration files | Brand-hall prerequisite |
| --- | --- | --- | --- |
| Local `main` | `24f73ccca1167e484670266036c155b5d9f67393` | 104 | Missing the three commits; stale local ref |
| GitHub `main` / `origin/main` | `08b8b0273f3457eba4ad878f26a74e306b332411` | 106 | All three commits already in history |
| `feat/brand-hall` | `08b8b0273f3457eba4ad878f26a74e306b332411` | 106 | Same commit as GitHub main |
| `feat/public-barcode-lookup` before this repair | `835e281` | 107 | Descends from `08b8b02` |

Therefore the dependency order is already satisfied on the **current remote
main**. Do not present stale local `main` as GitHub's current branch or create a
duplicate brand PR. No local main reset/fast-forward, remote branch push, PR
creation, or merge was performed by this task. A read-only GitHub search found
no PR for `head:feat/public-barcode-lookup`; creating one still requires the
user's separate confirmation. Recheck refs at PR time; target main only after
the brand prerequisite is present if the remote changes again.

### Remote migration history vs main

The read-only remote inventory has **109 applied versions** before this repair.
Compared with GitHub `main` (`08b8b02`, 106 files), **nine remote versions are
absent from main**, and **six main versions are absent from remote history**.
This compares version identities, not an assertion of schema/body equivalence.

Remote-only versions relative to GitHub main:

| Applied version | Name |
| --- | --- |
| `20261011131743` | `purchase_price_runtime_compatibility` |
| `20261011131758` | `purchase_price_line_authority_response` |
| `20261011141817` | `purchase_restaurant_identity_recovery` |
| `20261012055345` | `owner_verified_restaurant_purchase_reads` |
| `20261018130323` | `shared_identity_connections` |
| `20261021115319` | `verified_receipt_preserve_product_on_sku_miss` |
| `20261023070322` | `product_candidate_brand_resolution` |
| `20261023165231` | `product_candidate_brand_resolution_v2` |
| `20261026150132` | `public_product_by_barcode_v1` (this feature's initial deployment) |

Main-only file versions relative to the applied remote history:

| Main file version | Name |
| --- | --- |
| `20261004134439` | `merchant_resolution_column_qualification` |
| `20261005010000` | `rejected_dining_proposal_resubmission` |
| `20261009040159` | `purchase_price_runtime_compatibility` |
| `20261009040200` | `purchase_price_line_authority_response` |
| `20261011140409` | `purchase_restaurant_identity_recovery` |
| `20261012055153` | `owner_verified_restaurant_purchase_reads` |

Against stale local `main` (`24f73cc`, 104 files), the remote-only list has two
additional applied versions: `20261022041929_brand_hierarchy_public_catalog`
and `20261022193355_preserve_archived_brand_parent_identity` (eleven remote-only
versions total); the same six local-only versions remain. These two brand
migrations are already in GitHub main.

After the approved repair, remote history has **110 versions**. Relative to the
same captured GitHub main (`08b8b02`), the remote-only list now has **ten** entries:
the nine listed above plus `20261026155036_public_barcode_verified_conflicts`.
The six main-only versions remain unchanged. No unrelated migration history
was repaired or replayed.

Several names recur under different timestamps. That alone does not establish
equivalence or justify repair/replay. Do not bulk push this checkout or
rewrite/squash/delete migration history. For this correction, stage copies of
the actual 109 remote migrations plus only the new forward migration in an
ignored release directory, verify the pending set contains exactly the repair,
and get user approval immediately before applying it. Migration-history
reconciliation remains separate work.

Correction validation (2026-10-27): `npm.cmd run lint`, `npm.cmd run typecheck`,
`npm.cmd run test` (66 files / 589 tests), and `npm.cmd run build` passed.
`npm.cmd run test:purchase-sql` passed with 108 migration files, old bug
reproduction, 40 barcode checks, 8 registration checks and 10 existing regression
fixtures. The same 40 barcode checks passed again against the read-only deployed
`get_product_read_v1` snapshot using `--barcode-public-read`. JavaScript syntax
and `git diff --check` passed. The original migration SHA-256 remains
`923a7b4b1a5327c8d47496a3a5439f7e5150746c5ef6e28b19b32e2b5621ee24`.

The ignored release directory `supabase/.temp/barcode-conflict-release-v1` was
prepared from the actual 109 remote applied migrations plus the repair.
`supabase db push --linked --dry-run --workdir
supabase/.temp/barcode-conflict-release-v1` passed and listed only
`20261026155036_public_barcode_verified_conflicts.sql`. Pre/post-apply advisors
report the same intentional execute-grant warnings 0028/0029 described above.
The actual remote application and HTTP results are recorded separately above.
Production conflict fixtures were not inserted: the archived/private conflict
cases were tested locally, and the deployed body was verified against that
tested migration. No web E2E, Android build or AR runtime test is claimed.
