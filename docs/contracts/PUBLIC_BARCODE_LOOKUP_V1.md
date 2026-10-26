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

Lookup uses the normalized identifier value, scheme `ean` or `gtin`, and
`verification_status = 'verified'`. Both catalog and standard product must be
active. Existing `get_product_read_v1` public eligibility is preserved: verified
retail family, verified exact variant and specification, and complete positive
package fields. Private/unverified products never become public through this RPC.

| status | Meaning | matches |
| --- | --- | --- |
| `invalid` | Unsupported length/characters or checksum failure. No identity lookup. | `[]` |
| `not_linked` | No verified barcode link to an eligible public exact variant. **Does not mean PT has no such product.** | `[]` |
| `matched` | Exactly one distinct eligible catalog product ID. | One product |
| `conflict` | Two or more distinct eligible catalog product IDs. Caller must not choose automatically or call Nutrition with an arbitrary ID. | All candidates, ordered by catalog ID |

The same number under `ean` and `gtin` for one catalog ID is one match. Pending
and rejected identifiers do not participate. `checkedAt` is the server statement
time in ISO 8601 with timezone; it is not a price observation time or version.

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

Current deployment status: **applied after explicit user approval; anon HTTPS
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

Local validation: `npm.cmd run lint`, `npm.cmd run typecheck`,
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
