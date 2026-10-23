# PriceTrace Brand Catalog V1

Private OCR fact selections use the separate [Product Candidate Brand Resolution V1](PRODUCT_CANDIDATE_BRAND_RESOLUTION_V1.md) command; public Brand Catalog remains unchanged.

This is the canonical cross-system Brand Identity contract implemented by PriceTrace.
It describes the current database and public wire contracts, not planned OCR-App or Fitness integrations.

## Ownership and identity

PriceTrace owns canonical Brand Identity. OCR-App and Fitness must not maintain duplicate canonical Brand masters.

`public.brands.id` (UUID) is the identity key. `canonical_name`, an alias, manufacturer and display strings are not identity.
An alias match resolves to the same canonical Brand ID; it does not create another brand.
Consumers may keep their own observed/display snapshot strings alongside the canonical ID.
An observed string or a search result alone is not authority to automatically establish a product's identity.

## Hierarchy and products

`brands.parent_brand_id` is an explicit administrator-managed reference to `brands.id`.
`parent_brand_id = null` means root. A known parent ID whose public name is unavailable is not root.
Arbitrary depth is supported. Self-cycles, indirect cycles and multi-row cycles are rejected by the database;
parent hard-delete is restricted. A write guard serializes brand identity/hierarchy writes.
No relationship is inferred from a name, alias or manufacturer. Manufacturer is a separate concept.

`standard_products.brand_id` references the most specific canonical brand directly associated with the standard product.
For example, **if an administrator has explicitly established** `빙그레 → 더단백`, a 더단백 product points to the 더단백 ID.
The parent ID is not also stored on the product. These names are model examples, not production data curation.
Public product rows return only the immediate parent, without flattening all ancestors.
Parent brand pages list their own direct products and provide child-brand navigation separately.

`standard_products.brand` remains the compatibility/display shadow for older consumers.
Existing brand synchronization and canonical rename propagation are retained. The shadow is not canonical identity.
`brand_aliases` supports discovery and evidence; names and aliases retain the existing normalization and collision rules.

## Public brand search

```sql
public.get_public_brand_catalog_v1(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  brand_id uuid,
  canonical_name text,
  parent_brand_id uuid,
  parent_canonical_name text,
  matched_name text,
  match_kind text,
  logo_url text,
  official_site_url text
)
```

Anonymous and authenticated callers may execute this `SECURITY INVOKER` function.
It returns active brands only, including when the caller is an administrator.
It reuses `normalize_brand_name()`; no fuzzy-search extension is involved.

For null/empty normalized query, browse active brands in canonical-name (`COLLATE "C"`) order with UUID as tie-breaker.
`matched_name = canonical_name` and `match_kind = 'canonical'` in browse mode.
For nonempty query, matches rank as follows:

1. Canonical exact
2. Alias exact
3. Canonical prefix
4. Alias prefix
5. Canonical contains
6. Alias contains

Each canonical ID appears once. The best match wins, with matched text (`COLLATE "C"`) breaking same-brand ties.
Results sort by rank, canonical name (`COLLATE "C"`), then UUID.
`match_kind` is `canonical` or `alias`; `matched_name` is the text that matched, while `canonical_name` is always the canonical label.

Null limit/offset use defaults. Limit is clamped to 1..200 and offset to 0..1,000,000.
Callers page using these RPC arguments. Pages are separate snapshots; on concurrent changes, restart a browse rather than assuming atomic pagination.
The application repository rejects repeated canonical IDs across pages.

`parent_brand_id`, `parent_canonical_name`, `logo_url` and `official_site_url` are nullable.
An archived parent retains its referenced ID while its canonical name is withheld.
Logos/sites are optional metadata; their existence does not verify product identity or stock availability.

## Public product contract

```sql
public.get_public_exact_standard_product_catalog_v5()
RETURNS TABLE (
  source_label text,
  source_product_code text,
  catalog_product_id uuid,
  standard_product_id uuid,
  standard_name text,
  brand_name text,
  standard_category_id uuid,
  standard_category_slug text,
  standard_category_name text,
  content_amount numeric,
  content_unit text,
  package_count integer,
  reference_unit integer,
  coupang_listed_price_krw integer,
  coupang_quantity integer,
  coupang_content_amount numeric,
  coupang_content_unit text,
  coupang_max_bundle_quantity integer,
  coupang_max_bundle_listed_price_krw integer,
  coupang_product_url text,
  coupang_observed_at timestamptz,
  brand_id uuid,
  parent_brand_id uuid,
  parent_brand_name text
)
```

This is the immutable existing v4 contract, including all category and commercial fields, plus exactly three nullable fields:
`brand_id`, `parent_brand_id`, `parent_brand_name`. Existing `brand_name` retains v4 semantics.
The common projection equals v4; no extra internal or unverified product is published.
This read-only `SECURITY DEFINER` function has an empty fixed search path and grants execution to anon/authenticated.
It calls v4 for public eligibility, then joins identity metadata. It is not a product-registration endpoint.

`brand_id = standard_products.brand_id`. `parent_brand_id` is that canonical brand's immediate stored parent ID,
even if the direct brand has been archived. Parent name is publicly resolved only when both the direct brand and parent are active.
No ancestor list is returned. v4 retains sole authority over all its original output fields, including `brand_name`.

The response is a set of seller mappings: multiple rows can reference one `catalog_product_id`.
`standard_product_id` identifies the product family; `catalog_product_id` identifies the exact selling specification.
Neither is a Brand ID. Source-product identity remains `source_label + source_product_code`.
The application repository orders/paginates by source label, source product code and exact catalog ID, validates the separate strict v5 schema,
and deduplicates exact product IDs for Brand Hall display. It does not parse v5 responses with the v4 schema.
Coupang prices remain dated observations, not current prices, inventory or proof of purchase.

## Null and archive semantics

| State | Meaning |
| --- | --- |
| Product `brand_id = null` | No canonical Brand identity assigned. Do not infer one from `brand_name`. |
| Known `brand_id`, `parent_brand_id = null` | Root canonical brand. |
| Known `parent_brand_id`, nonnull parent name | Sub-brand with publicly resolvable immediate parent. |
| Known `parent_brand_id`, null parent name | Parent identity exists but is not publicly resolvable in this projection, for example an archived parent. Never convert it to root. |
| Search `match_kind = 'alias'` | Alias discovery resolved to `brand_id`; `matched_name` records the alias. |
| A Brand ID is absent from public search | Public resolution is unavailable (for example archive); do not discard an already known ID or create a replacement master. |

When no canonical brand is assigned, the product parent fields are also null; this does not imply a root brand exists.
Public search omits archived brands. v5 preserves assigned identities and parent IDs while withholding archived names according to the rules above.
Missing public ancestors are represented as missing information, not rewritten as roots.

## Administration and authorization

Hierarchy and brand/alias mutations belong to administrators. Client table writes remain revoked.
The authenticated RPCs are:

```sql
public.admin_save_brand_v1(p_brand_id uuid, p_canonical_name text, p_parent_brand_id uuid,
                          p_logo_url text, p_official_site_url text) RETURNS uuid
public.admin_add_brand_alias_v1(p_brand_id uuid, p_alias_name text) RETURNS uuid
public.admin_delete_brand_alias_v1(p_brand_id uuid, p_alias_id uuid) RETURNS uuid
```

Each checks nonnull `auth.uid()` and trusted JWT `app_metadata.role = 'admin'` on the server.
UI visibility is not authorization. Successful mutations append audit records; failed changes roll back.
No new archive/hard-delete UX or automatic hierarchy backfill is introduced.
External consumers use the public read contracts; these admin RPCs do not grant them registration authority.

## Consumer and versioning rules

- Use `brand_id` as canonical identity; keep observed/display strings separately if needed.
- Resolve canonical names and aliases through PriceTrace; do not build another canonical master.
- Do not infer an identity, a parent or a manufacturer relationship solely from a string.
- Traverse parents explicitly; distinguish direct products from descendant products.
- Preserve null/archival distinctions and handle public resolution failure explicitly.
- Treat all existing versioned RPC response shapes as immutable wire contracts. Shape additions require a new version.

The existing public catalog v1/v2/v3/v4 signatures, function definitions, return shapes and strict v4 client parser are unchanged.
The established product repository `load()` negotiation is retained; hierarchy-aware consumers use its separate `loadHierarchyRows()` v5 parser.

## Sources and repeatable validation

- Schema, search and admin endpoints: [`20261022041929_brand_hierarchy_public_catalog.sql`](../../supabase/migrations/20261022041929_brand_hierarchy_public_catalog.sql)
- Archived direct-brand parent identity repair (no shape change): [`20261022193355_preserve_archived_brand_parent_identity.sql`](../../supabase/migrations/20261022193355_preserve_archived_brand_parent_identity.sql)
- Strict response schemas: [`brand-hierarchy.ts`](../../src/domain/brand-hierarchy.ts), [`public-standard-catalog-v5.ts`](../../src/domain/public-standard-catalog-v5.ts)
- Compatibility and authorization execution: [`brand_hierarchy_public_catalog.sql`](../../supabase/tests/brand_hierarchy_public_catalog.sql), [`test-purchase-price-sql.mjs`](../../scripts/test-purchase-price-sql.mjs)
- Browser assertions: [`brand-hall.spec.ts`](../../e2e/brand-hall.spec.ts)

From the repository root on Windows, execute sequentially:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
git diff --check
npm.cmd run test:purchase-sql
npx.cmd playwright test e2e/brand-hall.spec.ts --workers=1
```

The PGlite harness compares all legacy public catalog function definitions and existing identity/shadow values before and after forward migrations.
It executes hierarchy, search ordering/deduplication/paging, full v5-minus-three-fields equivalence with v4,
archive/null and SQL-role authorization regressions. Its documented bootstrap accommodations for older unrelated SQL are not production migration edits.
Browser fixtures validate application behavior, not a production JWT. Deployment/readback and real JWT evidence must be reported separately.

The closure run and deployed-contract evidence are recorded in [`BRAND_CATALOG_V1_VALIDATION.md`](BRAND_CATALOG_V1_VALIDATION.md).
