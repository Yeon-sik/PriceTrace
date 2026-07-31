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

One proposal covers exactly one receipt item and one official-channel listing.
Raw inputs must be frozen before investigation. A change to either input makes
the proposal stale.

The schema version is `pricetrace-link-proposal.v2`.

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

### Same-channel exact-name rule

One narrow name-based rule is allowed when the receipt merchant is proven to
belong to the same catalog channel as the official listing:

1. `receipt.sourceCatalogNamespace` must be present and exactly equal
   `officialListing.channelId`.
2. Compare `receipt.sourceNameRaw` and `officialListing.sourceNameRaw` after
   removing Unicode whitespace only.
3. Do not remove punctuation, change spelling, translate, stem, case-fold, or
   use fuzzy similarity.
4. Exact normalized equality permits
   `sameChannelNameRule.outcome = apply_official_identity`.
5. A non-whitespace character mismatch requires
   `sameChannelNameRule.outcome = discovery_only`. Similar candidates may be
   reported, but no link, mapping, catalog creation/reuse, or registration
   effect may be planned for the mismatching candidate.

When the exact-name rule applies, copy the official brand, content amount, and
content unit into `normalizedIdentity`. Copy package count or GTIN only when
primary official evidence states the value at the exact sellable-package level.
Price equality is never part of this rule.

## 3. Proposal fields

### Top level

- `schemaVersion`: fixed schema version.
- `caseId`: durable local case identifier.
- `status`: workflow state.
- `inputFingerprint`: SHA-256 fingerprint of frozen inputs.
- `receipt`: immutable receipt observation.
- `officialListing`: immutable official listing snapshot.
- `sameChannelNameRule`: audited evaluation of the same-channel exact-name
  rule.
- `normalizedIdentity`: extracted product attributes.
- `decision`: proposed family and variant action.
- `coupangOffer`: optional exact-option price observation.
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

`snapshotHash` represents the immutable raw snapshot stored elsewhere. A URL is
not an immutable snapshot by itself.

### Same-channel name rule

Required fields are:

- `sameChannel`
- `normalization`
- `normalizedReceiptName`
- `normalizedOfficialName`
- `exactNameMatch`
- `outcome`
- `importedOfficialFields`

`normalization` is fixed to `remove_unicode_whitespace_only`.

`sameChannel` is true only when the frozen non-null
`receipt.sourceCatalogNamespace` exactly equals `officialListing.channelId`.
The normalized names must be the validator-computed values, and
`exactNameMatch` must reflect their exact equality.

Allowed outcomes are:

- `apply_official_identity`: same channel and exact normalized name;
- `discovery_only`: same channel but at least one non-whitespace character
  differs;
- `not_applicable`: receipt catalog namespace is unknown or differs from the
  official channel.

Allowed imported fields are `brand`, `contentAmount`, `contentUnit`,
`packageCount`, and `gtin`. `apply_official_identity` requires `brand`,
`contentAmount`, and `contentUnit`. Any imported field must be non-null in
`normalizedIdentity`. `discovery_only` and `not_applicable` require an empty
import list.

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

For a same-channel name mismatch, only `insufficient_evidence` or `reject` is
allowed. The proposal must remain outside approval/execution states, contain no
planned effects, and keep approval unrequested.

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
official attributes being imported. When the outcome is `discovery_only`,
review may list similar candidates but may not approve a link.

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

`targetFingerprint` is SHA-256 over canonical JSON containing:

- `caseId`
- `inputFingerprint`
- `sameChannelNameRule`
- `normalizedIdentity`
- `decision`
- `coupangOffer`
- `plannedEffects`

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
- `execution.status = not_started`;
- validation and both fingerprints pass.

The user-facing approval block must be short and fixed in this order:

1. `영수증 기록`
2. `공식 상품 기록`
3. `적용 상품`
4. `쿠팡가` only when a Coupang effect is planned
5. `연결 작업`
6. `승인 대상`
7. one copy-ready `승인 문구`

The full source codes and full target fingerprint are never abbreviated.
Research details remain in the proposal artifact and are expanded only on
request. A non-ready case is reported as one concise `제안 불가:` line and
must not include an approval phrase.

## 7. Execution rules

Execution fields are:

- `status`: `not_started`, `applied`, `failed`, or `unknown`
- `idempotencyKey`
- `appliedAt`
- `result`

The executor must:

1. Revalidate the proposal and fingerprints.
2. Re-read current mappings and candidates.
3. Stop on stale inputs or unapproved effects.
4. Use a verified atomic write path.
5. Use the idempotency key.
6. Re-read state before retrying an unknown result.
7. Verify applied effects after the write.

No automatic next-item execution is permitted.

## 8. Status transitions

Normal transitions are:

`draft` -> `insufficient_evidence`

`draft` -> `rejected`

`draft` -> `approval_requested` -> `approved` -> `applied`

An approved execution can end as `failed` or `unknown`. Any frozen-input or
target change requires a new fingerprint and new approval.
