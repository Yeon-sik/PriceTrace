# Product Candidate Brand Resolution V2

V2 permits two independently selected observed fields to resolve to one canonical Brand and reports current graph drift without rewriting historical selections. [V1](PRODUCT_CANDIDATE_BRAND_RESOLUTION_V1.md) and migration `20261023070322` remain deployed history with their original proper-descendant behavior.

## Public signatures of the private RPC contract

```sql
public.set_product_candidate_brand_resolution_v2(
  p_client_key text, p_source_field text, p_observed_value text,
  p_brand_id uuid, p_user_verified boolean
) RETURNS jsonb
```

Result keys: `product_client_key text`, `request_fingerprint text`, `source_field text`, `observed_value text`, `brand_id uuid/null`, `cleared boolean`. The mutation intentionally retains the six-key V1 result shape; relationship state comes from the V2 read.

```sql
public.get_product_candidate_brand_resolutions_v2(p_client_key text)
RETURNS TABLE (
  product_client_key text, request_fingerprint text,
  source_field text, observed_value text, brand_id uuid,
  canonical_name text, brand_active boolean,
  parent_brand_id uuid, parent_canonical_name text,
  created_at timestamptz, updated_at timestamptz,
  pair_relationship text, pair_relationship_valid boolean,
  requires_review boolean
)
```

The first eleven fields retain V1 order, types and meanings. Current inactive names remain withheld; their UUID and historical local snapshots survive. Parent names are public only when selected Brand and parent are active. Empty results are allowed for missing, unselected or another owner's authority.

## Current graph and historical selections

| Relationship | Meaning | Valid |
| --- | --- | --- |
| `single` | Only one observed field is selected | true |
| `same_brand` | Both explicitly selected UUIDs are equal | true |
| `descendant` | Different UUIDs; sub-brand is a proper descendant at any depth | true |
| `hierarchy_conflict` | Different UUIDs; current graph no longer has that descendant path | false |

`requires_review = NOT brand_active OR NOT pair_relationship_valid` for each row. Pair relationship is identical across both rows. Recursive traversal uses UNION to terminate even if a cycle is encountered. Reparenting and archival alter the derived read state, never delete or rewrite stored resolution evidence. No name/alias matching selects identity.

The mutation requires authentication, explicit user verification, an own current authority projection, `brand` or `sub_brand`, exact trimmed observed text and active nonnull UUID selection. Null explicitly clears. The shared hierarchy guard serializes writes and the authority row is locked. Distinct unrelated selections reject atomically with `23514 / brand_sub_brand_hierarchy_conflict`; equal UUIDs are allowed. `catalog_product_reused` works without a private candidate row because the authority projection owns this boundary.

## Security and identity

Both functions are SECURITY DEFINER with empty search_path, explicit auth.uid(), PUBLIC/anon execution revoked and authenticated execution granted. Existing table RLS and lack of direct anon/authenticated grants remain. Other owners' keys are indistinguishable from missing authority. This migration creates only the two V2 functions; no new master table or data rewrite.

`submit_product_candidate_v1`, immutable-key enforcement, Brand Catalog V1, Brands, aliases, standard/catalog product identity and public catalog functions remain unchanged. Brand evidence is private; it never verifies or connects a public Product.

OCR retains stable logical keys and canonical v1-v5. Candidate authority metadata is preserved per logical key plus exact source revision when a sibling changes, including proven successful legacy keys. Changed candidates derive the existing deterministic `ocrpc-r1-<sha256>` key. Android Room and Desktop session metadata carry the checkpoint; standalone, purchase-v4 and Brand V2 requests use the same accepted map.

## Delivery and verification

Forward migration: `20261023165231_product_candidate_brand_resolution_v2.sql`.

`npm.cmd run test:purchase-sql` replays all migrations and runs V1/V2, candidate ingest and Brand Catalog fixtures. It compares pg_get_functiondef for both V1 resolution RPCs and candidate ingest before/after V2. V2 fixtures execute same UUID, deep descendant, rejected unrelated pair, current reparent drift, archive review, owner/grants, catalog reuse and unchanged-business-payload authority count assertions inside rolled-back transactions.

Deploy this forward migration after local SQL succeeds. Read back signatures, security, migration ledger and V1/ingest hashes. Remote transaction/role probes and a real authenticated HTTP user smoke are distinct evidence states; neither local tests nor CLI deployment output alone proves live user behavior.
