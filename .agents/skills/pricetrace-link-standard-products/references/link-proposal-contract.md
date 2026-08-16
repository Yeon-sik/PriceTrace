# LinkProposal Contract

## Contents

1. Purpose and trust boundary
2. Identity boundaries
3. Proposal fields
4. Decision actions
5. Evidence and review gates
6. Approval and fingerprints
7. Execution rules
8. Status transitions

## 1. Purpose and trust boundary

`LinkProposal` is the handoff artifact between read-only investigation, human
approval, and the restricted write executor. It is not itself a database record
and does not authorize a write.

An execution-ready proposal may be stored in the administrator browser's local
approval queue. Queue presence is not approval. The proposal is removed only
after the signed-in administrator modal verifies a successful atomic write.

One proposal covers exactly one receipt item and one official-channel listing.
Raw inputs must be frozen before investigation. A change to either input makes
the proposal stale.

The schema version is `pricetrace-link-proposal.v3`.

## 2. Identity boundaries

Keep these identities distinct:

- Receipt identity: `sourceLabel + sourceProductCode`.
- Official identity:
  `channelId + sourceProductCodeNamespace + sourceProductCode`.
- Standard family: one `standard_products` record.
- Exact variant: one `catalog_products` record.
- Coupang offer: an observation attached to the exact variant.

Never infer a shared namespace from equal-looking source codes. Product names
and prices can support discovery but normally cannot establish identity.
Variant identity requires compatible specification fields such as formulation
or model, content amount, unit, package count, and GTIN where available.

### Same-channel exact or verified-name rule

One narrow name-based rule is allowed when the receipt merchant is proven to
belong to the same catalog channel as the official listing:

1. `receipt.sourceCatalogNamespace` must be present and exactly equal
   `officialListing.channelId`.
2. Compare `receipt.sourceNameRaw` and `officialListing.sourceNameRaw` after
   removing Unicode whitespace only.
3. Do not alter either frozen source value. Candidate discovery may ignore one
   leading parenthesized numeric receipt classification code and compare the
   remaining normalized receipt name against contiguous official-name windows
   at an 85% threshold. This tolerant comparison cannot itself prove identity.
4. Exact normalized equality permits
   `sameChannelNameRule.outcome = apply_official_identity`.
5. A non-whitespace character mismatch defaults to
   `sameChannelNameRule.outcome = discovery_only`.
6. A mismatch may use `apply_verified_name_equivalence` with
   `single_unicode_code_point_substitution_v1` only when the two normalized
   names have equal length and exactly one Unicode code point differs. The
   proof is limited to one frozen receipt item and one frozen official listing
   and must cite matching official-channel primary evidence, separate
   manufacturer or brand primary evidence, and a sufficient conflict-free
   independent approval. User assertion, price equality, similarity score, or
   a global spelling replacement is not sufficient.
7. A mismatch may use `apply_verified_name_equivalence` with
   `single_unicode_code_point_insertion_deletion_v1` only when the two
   whitespace-normalized names differ by exactly one Unicode code-point
   insertion or deletion at one unambiguous index. The proof freezes the edit
   direction, index, code point, both code-point lengths, normalized discovery
   similarity of at least 90%, and `uniqueOfficialCandidate = true`. It also
   requires matching official-channel primary evidence, separate manufacturer
   or brand primary evidence, and a sufficient conflict-free independent
   approval. The similarity score discovers the candidate and never proves
   identity by itself.
8. A receipt label truncated inside a longer official name may use
   `official_name_contains_receipt_name_v1` only when the normalized receipt
   name is at least six Unicode code points, covers at least 60% of the official
   name, and occurs exactly once. Across the complete frozen official snapshot,
   the name-only candidate set must contain exactly one listing before price is
   considered. The frozen official price must then equal the receipt unit
   price. Price is corroboration and never disambiguates multiple name matches.
   The proof must cite the frozen transactional receipt row, matching primary
   official-channel name and price evidence, and a sufficient conflict-free
   independent approval.
9. An item-specific user choice may be frozen as
   `executionTarget.userSelectedOfficialVariant`. It must bind one receipt row,
   one official namespace/code, the raw official specification, and the source
   reference plus SHA-256 of the user's selection. This can resolve a selected
   same-name variant or authorize `explicit_user_selected_frozen_pair_v1` for a
   compound typo/truncation only when primary official and manufacturer/brand
  evidence and an independent conflict-free approval establish the exact
  sellable variant. It does not relax the automatic 85% candidate-discovery
  threshold.

When an apply branch passes, copy the official brand, content amount, and
content unit into `normalizedIdentity`. Copy package count or GTIN only when
primary official evidence states the value at the exact sellable-package level.
Price equality is not identity evidence. It is required only as a corroborating
gate for the verified containment branch described above.
Heterogeneous razor kits use `officialSpecificationCheck.kind = composite_kit`,
retain typed handle and blade component counts, and normalize the sellable
catalog quantity as `1 each` instead of summing unlike components.
Official wiper listings may use `officialSpecificationCheck.kind =
wiper_blade_fitment` only when the official name contains `와이퍼` and the raw
specification is a bounded `250mm`-to-`800mm` value. The blade length is stored
as typed `normalizedIdentity.wiperBladeFitment.lengthMm`; commercial quantity
remains `1 each`.

## 3. Proposal fields

### Top level

- `schemaVersion`: fixed schema version.
- `caseId`: durable local case identifier.
- `status`: workflow state.
- `inputFingerprint`: SHA-256 fingerprint of frozen inputs.
- `receipt`: immutable receipt observation.
- `officialListing`: immutable official listing snapshot.
- `sameChannelNameRule`: audited evaluation of the same-channel exact or
  verified-name rule.
- `normalizedIdentity`: extracted product attributes.
- `decision`: proposed family and variant action.
- `coupangOffer`: optional exact-option price observation.
- `representativeImage`: official image proposed for the standard family.
- `executionTarget`: the exact canonical target consumed by the current
  `strict_v6` RPC; nullable only before an approval-ready positive decision.
- `evidence`: provenance-bearing evidence list.
- `review`: independent review result.
- `plannedEffects`: exact effect allowlist.
- `approval`: human approval record and target fingerprint.
- `execution`: idempotency and write result.

### Receipt

Required fields are:

- `receiptId`
- `receiptItemId`
- `receiptRevision`
- `sourceCatalogNamespace`
- `sourceLabel`
- `sourceProductCode`
- `sourceNameRaw`
- `observedAt`
- `unitPriceKrw`
- `quantity`

`sourceCatalogNamespace` is the receipt merchant's proven catalog channel and
is distinct from the merchant SKU namespace. It may be `null` when unknown, in
which case the same-channel rule is not applicable. `unitPriceKrw` is a
non-negative KRW integer. `quantity` is a positive integer.

### Official listing

Required fields are:

- `channelId`
- `sourceProductCodeNamespace`
- `sourceProductCode`
- `snapshotId`
- `snapshotHash`
- `sourceNameRaw`
- `specificationTextRaw`
- `sourceRefs`
- `image`

`officialPrice` is an optional frozen object containing non-negative integer
`amountKrw`, original `sourceText`, and ISO 8601 `observedAt`. It is required by
the verified containment branch and remains immutable with the official input.

`snapshotHash` represents the immutable raw snapshot stored elsewhere. A URL is
not an immutable snapshot by itself.

`image` is nullable while research is incomplete. An approval-ready positive
proposal requires the official listing's HTTPS image `url`, SHA-256
`contentHash`, allowed image `mediaType`, and positive `byteLength`. Missing
official image metadata is insufficient evidence for the strict linking path.

### Same-channel name rule

Required fields are:

- `sameChannel`
- `normalization`
- `normalizedReceiptName`
- `normalizedOfficialName`
- `exactNameMatch`
- `outcome`
- `importedOfficialFields`
- optional `verifiedEquivalence`, required only for the verified mismatch
  branch

`normalization` is fixed to `remove_unicode_whitespace_only`.

`sameChannel` is true only when the frozen non-null
`receipt.sourceCatalogNamespace` exactly equals `officialListing.channelId`.
The normalized names must be the validator-computed values, and
`exactNameMatch` must reflect their exact equality.

Allowed outcomes are:

- `apply_official_identity`: same channel and exact normalized name;
- `apply_verified_name_equivalence`: same channel, unequal normalized raw
  names, and a complete item-specific proof;
- `discovery_only`: same channel but at least one non-whitespace character
  differs;
- `not_applicable`: receipt catalog namespace is unknown or differs from the
  official channel.

Allowed imported fields are `brand`, `contentAmount`, `contentUnit`,
`packageCount`, and `gtin`. `apply_official_identity` requires `brand`,
`contentAmount`, and `contentUnit`. Any imported field must be non-null in
`normalizedIdentity`. `apply_verified_name_equivalence` has the same required
official imports, while `discovery_only` and `not_applicable` require an empty
import list.

`verifiedEquivalence` contains one of three audited methods.

For `single_unicode_code_point_substitution_v1`:

- fixed `method = single_unicode_code_point_substitution_v1` and
  `scope = frozen_receipt_official_pair_only`;
- `zeroBasedCodePointIndex`, `receiptCodePoint`, and `officialCodePoint`, all
  recomputed from the frozen normalized names;
- at least two unique `supportingEvidenceSourceIds` and two unique
  `supportingSourceRefs`;
- fixed `reviewerAgent = pricetrace_independent_reviewer`;
- ISO 8601 `reviewedAt` with an explicit UTC offset;
- fixed `conclusion = same_exact_sellable_variant`.

For `single_unicode_code_point_insertion_deletion_v1`:

- fixed `scope = frozen_receipt_official_pair_only`;
- `editDirection` is either `insert_official_code_point_into_receipt` or
  `delete_receipt_code_point`;
- `zeroBasedEditIndex`, `editedCodePoint`, `receiptCodePointLength`, and
  `officialCodePointLength`, all recomputed from the frozen whitespace-normalized
  names;
- integer `discoverySimilarityBasisPoints` from the lower-cased names after
  removing non-alphanumeric characters, with a minimum of `9000`;
- fixed `uniqueOfficialCandidate = true`, verified against the complete frozen
  official snapshot before the proof is approved;
- the same fixed reviewer, review timestamp, conclusion, unique evidence ID and
  ref requirements as the substitution method.

For `official_name_contains_receipt_name_v1`:

- fixed `scope = frozen_receipt_official_pair_only`;
- `zeroBasedOfficialCodePointIndex`, receipt and official code-point lengths,
  and the exact normalized `officialPrefix` and `officialSuffix`;
- `officialDisplayedPriceKrw` and `officialPriceObservedAt`, equal to the frozen
  receipt unit price and `officialListing.officialPrice` tuple;
- fixed `uniqueOfficialCandidate = true`, which the independent reviewer must
  verify against the complete frozen official snapshot before comparing price;
- the same fixed reviewer, review timestamp, conclusion, and unique evidence ID
  and ref requirements.

The cited evidence IDs and refs must exist in the proposal. The substitution
and insertion/deletion methods require the frozen official listing's primary
evidence and separate manufacturer or brand primary evidence. The containment
method requires the frozen transactional receipt row and the matching primary
official-channel name and price evidence. The proof remains inside the
canonical execution target and therefore changes the target fingerprint when
edited.

### Normalized identity

Fields are `brand`, `productFamilyName`, `variantName`, `contentAmount`,
`contentUnit`, `packageCount`, and `gtin`. Unknown fields remain `null`; do not
guess them.

Allowed content units are `g`, `ml`, and `each`.

### Decision

The decision includes:

- `action`
- `standardProductId`
- `catalogProductId`
- `proposedStandardName`
- `proposedVariantName`
- `confidence`
- `matchedFields`
- `conflictingFields`
- `missingFields`

Confidence is `high`, `medium`, or `low`. It does not replace evidence.

## 4. Decision actions

`reuse_variant` requires both existing family and exact-variant IDs.

`create_variant` requires an existing family ID, no exact-variant ID, and a
proposed exact-variant name.

`create_family_and_variant` requires no existing IDs and proposed names for both
the family and exact variant.

`insufficient_evidence` means no write may be planned.

`reject` means the candidate relationship is wrong and no write may be planned.

For an unverified same-channel name mismatch, only `insufficient_evidence` or
`reject` is allowed. A fully verified mismatch may use a positive action only
when the proof and independent-review gates pass.

Allowed planned effects are:

- `reuse_standard_family`
- `create_standard_family`
- `reuse_catalog_variant`
- `create_catalog_variant`
- `link_official_listing`
- `verify_receipt_mapping`
- `register_coupang_offer`
- `update_representative_image`

The effect list is an allowlist, not a description. The executor may perform
only listed effects.

### Representative image

The approved image is family-scoped because `standard_product_images` has one
row per standard product family. Required fields are:

- `scope`: fixed to `standard_product_family`;
- `action`: `create` or `reuse_exact`;
- `sourceType`: fixed to `external_url`;
- `imageUrl`, `contentHash`, `mediaType`, and `byteLength` copied exactly from
  `officialListing.image`;
- `expectedCurrent`: `null` for create, or the exact current external URL for
  reuse.

The strict link path never overwrites a different external URL or an uploaded
image. Such a collision invalidates the proposal and requires a separate image
replacement approval path.

### Strict execution target

An approval-ready positive proposal freezes one non-null `executionTarget`.
This object is the single canonical target for review, fingerprinting, UI
comparison, idempotency, and the `p_target_canonical_json` RPC parameter. An
unchanged approval sends it unchanged. An allowed administrator edit must
produce a new complete in-memory proposal target, fingerprint, idempotency key,
and validated proposal summary before execution. Never send a reduced or
unvalidated form-only target.

It contains the current write-contract fields:

- `caseId` and `inputFingerprint`;
- `executionMode`: omitted/`strict_v6` for the existing Coupang-backed path,
  or `link_only_v1` for a reviewed official/receipt-only link;
- fixed `approvalPolicy` values;
- `sameChannelNameRule`;
- `officialSpecificationCheck`;
- the full `normalizedIdentity`, including `specificationStatus` and
  `referenceUnit`;
- `brandEvidence`;
- `decision`;
- the RPC-shaped exact `coupangOffer`, or `null` for `link_only_v1`;
- `representativeImage`;
- `evidence`, `review`, and ordered `plannedEffects`.

The human-readable top-level identity, decision, Coupang observation, image,
evidence, review, and effect fields remain the investigation summary. The
validator requires every duplicated value to equal `executionTarget` exactly.
For `strict_v6`, an approval-ready target includes the ordered family action,
variant action, official link, receipt mapping, Coupang offer, and
representative-image effects. `link_only_v1` uses the same order without the
Coupang effect. It is valid only when no Coupang observation is claimed.

An apparel link keeps commercial quantity separate from garment size:

- `contentAmount = 1`, `contentUnit = each`, `packageCount = 1`,
  `referenceUnit = 100`;
- `officialSpecificationCheck.kind = apparel_size` and preserves the official
  numeric specification;
- `normalizedIdentity.apparelSize` is exactly one of `S(90)`, `M(95)`,
  `L(100)`, `XL(105)`, `XXL(110)`, or `XXXL(115)`;
- `105` must never be converted to `105 each`, grams, or milliliters.

Reviewed structured official specifications use
`officialSpecificationCheck.kind = structured_content`. This branch is
limited to deterministic source-native formats and is independently rebuilt by
the app validator and registration RPC:

- `5매` becomes `1 each × 5`;
- `134g*4개입` and separator variants become `134g × 4`;
- `1.5g x 20개입` becomes `1.5g × 20`;
- `140g*2개/280g` becomes `140g × 2` only when the stated total equals the
  per-item amount times the count;
- `360g/30매입` becomes `12g × 30`, with the frozen total `360g` retained;
- a numeric-only specification such as `424.8` may borrow `g`, `kg`, or `ml`
  only when the official name contains exactly one matching `424.8g`-style
  fragment.

The parser never treats `360g/30매입` as `360g × 30`, never accepts an
unlabelled apparel size as content, and never guesses a unit from a different
number. Explicit counts must appear in `importedOfficialFields`; a default
count of one must not.

## 5. Evidence and review gates

Every evidence item declares:

- `sourceType`
- `sourceId`
- `authority`
- `url`
- `capturedAt`
- `claims`
- `sourceRefs`

Allowed source types are `receipt`, `official_channel`, `manufacturer`, `brand`,
`retailer`, `coupang`, and `database`. Authority is `primary`, `secondary`, or
`transactional`.

A positive linking decision requires receipt evidence and official-channel
evidence. A Coupang effect also requires a complete exact-option price
observation and Coupang evidence.

When `sameChannelNameRule.outcome` is `apply_official_identity`, evidence must
prove the receipt catalog namespace, official channel, both raw names, and the
official attributes being imported. `apply_verified_name_equivalence` also
requires the cited official and manufacturer or brand primary evidence and the
independent reviewer binding described above. When the outcome is
`discovery_only`, review may list similar candidates but may not approve a
link.

Independent review returns:

- `verdict`: `approve`, `needs_more_evidence`, or `reject`
- `reviewerAgent`
- `counterCandidates`
- `conflicts`
- `evidenceQuality`: `sufficient`, `partial`, or `insufficient`
- `notes`

`approve` requires sufficient evidence and no unresolved identity conflicts.
Blocking missing fields must be empty before the proposal can enter
`approval_requested`. Optional unavailable attributes belong in `review.notes`,
not `decision.missingFields`.

## 6. Approval and fingerprints

`inputFingerprint` is SHA-256 over canonical JSON containing `receipt` and
`officialListing`.

`targetFingerprint` is SHA-256 over the canonical JSON of the complete
`executionTarget`. This is the exact same JSON sent as
`p_target_canonical_json`; evidence, independent review, approval policy,
official specification checks, and brand evidence are therefore covered by
the user's approval fingerprint.

Canonical JSON recursively sorts object keys and preserves array order.

Approval fields are:

- `status`: `not_requested`, `requested`, `approved`, or `expired`
- `approvalRef`
- `userApprovalText`
- `approvedAt`
- `targetFingerprint`

Approved state requires all approval metadata. The user approval must identify
the item, source codes, chosen family and exact variant, and every planned
effect. A fingerprint mismatch invalidates approval.

An approval request is presentation-ready only when:

- the decision is positive;
- `review.verdict = approve` and `evidenceQuality = sufficient`;
- decision and review conflicts are empty;
- `decision.missingFields` is empty;
- `plannedEffects` is non-empty and exactly matches the verified write path;
- `executionTarget` is present, equals every reviewed summary field, and its
  canonical hash equals `approval.targetFingerprint`;
- a positive link includes a frozen official image, the family-scoped
  `representativeImage`, and `update_representative_image`;
- `execution.status = not_started`;
- validation and both fingerprints pass.

When details are requested, the user-facing approval summary stays short and
fixed in this order:

1. `영수증 기록`
2. `공식 상품 기록`
3. `적용 상품`
4. `쿠팡가` only when a Coupang effect is planned
5. `대표 이미지`
6. `연결 작업`
7. `승인 대상`
8. one generated `승인 문구` for the RPC and audit record; the user does not
   copy it into chat

The local queue card itself shows only the representative image and standard
family name. The full source codes, exact target, evidence, and effects are
shown inside the modal before the item-specific `연결 승인` or `수정 후 승인`
action. Research details remain in the proposal artifact. A non-ready case is
reported as one concise `제안 불가:` line and is not queued.

## 7. Execution rules

Execution fields are:

- `status`: `not_started`, `applied`, `failed`, or `unknown`
- `idempotencyKey`
- `appliedAt`
- `result`

The signed-in admin modal or restricted executor must:

1. Revalidate the proposal and fingerprints.
2. Send the validated current canonical `executionTarget` unchanged. An admin
   edit must first rebuild and validate the complete proposal and fingerprint.
3. Re-read current mappings and candidates.
4. Stop on stale inputs or unapproved effects.
5. Use a verified atomic write path.
6. Use `standard-product-link:<target fingerprint hex>` as the idempotency key.
7. Re-read state before retrying an unknown result.
8. Verify applied effects after the write.

For `update_representative_image`, the executor inserts a new HTTPS external
image or verifies an exact existing URL in the same transaction as the core
link. It does not overwrite. Any image collision or replay drift rolls back the
whole transaction.

No automatic next-item execution is permitted.

After a verified successful write, delete the matching local queue entry. On
failure or unknown outcome, keep it available for inspection and do not delete
it automatically.

## 8. Status transitions

Normal transitions are:

`draft` -> `insufficient_evidence`

`draft` -> `rejected`

`draft` -> `approval_requested` -> `approved` -> `applied`

An approved execution can end as `failed` or `unknown`. Any frozen-input or
target change requires a new fingerprint and new approval.
