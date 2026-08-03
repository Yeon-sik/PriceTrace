---
name: pricetrace-link-standard-products
description: Coordinate a project-scoped PriceTrace workflow that investigates one receipt item and one official-channel listing, delegates identity, evidence, and adversarial review to custom subagents, produces and validates a LinkProposal, requires item-specific user approval, and optionally applies approved standard-family, exact-variant, official-link, receipt-mapping, and Coupang-offer effects. Use for PriceTrace official-product or receipt-to-standard-product research, proposal review, and approved registration.
---

# PriceTrace Standard Product Linking

## Operating model

The primary Codex task is the orchestrator. Do not create another orchestrator.
Work on exactly one receipt item and one official listing per case, and never
continue automatically to the next item.

Read [references/link-proposal-contract.md](references/link-proposal-contract.md)
before starting. Use
[assets/link-proposal.template.json](assets/link-proposal.template.json) as the
proposal shape and validate every proposal with
[scripts/validate-link-proposal.mjs](scripts/validate-link-proposal.mjs).

This skill authorizes project-scoped delegation to the custom agents named
below. Tell the user when agents are started or when this workflow pauses.

## Workflow

### 1. Freeze the case

First read `.agents/registered-receipt-product-names.json` and compare the
receipt `sourceNameRaw` with `names` by exact string equality. If present,
report that the receipt product name is already registered and stop before
starting investigation agents. This is a duplicate-work shortcut only:
absence does not prove identity or authorize a write.

Capture immutable receipt and official-listing inputs, including their distinct
source namespaces, revision or snapshot identifiers, and snapshot hash. Assign
one `caseId`. Do not infer that receipt and official codes share a namespace.
Also capture the receipt merchant's catalog namespace separately from its
merchant SKU namespace. A same-channel rule may be evaluated only when that
catalog namespace is explicitly proven and exactly equals the official
listing's `channelId`.

If raw inputs cannot be frozen, stop with `insufficient_evidence`.

### 2. Run read-only investigation

Start these two custom agents in parallel and give each the raw case artifacts
and the relevant contract fields:

- `pricetrace_product_identifier`
- `pricetrace_evidence_researcher`

After both finish, assemble their candidate records and source evidence without
including a preferred conclusion or advocacy. Then start
`pricetrace_independent_reviewer` with the frozen raw inputs, candidate records,
and evidence so it can re-derive the result and search for counter-candidates.

Call `pricetrace_data_code_guardian` only when the current schema, RPC, RLS,
migration, or write-path contract is uncertain. It is not part of every case.

Wait for all required read-only agents. Missing or conflicting outputs are not
silently repaired by the orchestrator; record them as missing or conflicting
evidence.

### 3. Build and validate the proposal

Assemble one `LinkProposal`. Keep `standard_products` as the family and
`catalog_products` as the exact sellable variant. Treat these as separate
relationships:

- official listing to catalog variant;
- receipt source identity to catalog variant;
- catalog variant to Coupang price observation.

Product-name or price similarity is not identity proof. The only name-based
exception is the audited same-channel exact-name rule:

1. Prove `receipt.sourceCatalogNamespace === officialListing.channelId`.
2. Normalize both raw names by removing Unicode whitespace only. Do not remove
   punctuation, change spelling, fold words, translate, stem, or use fuzzy
   similarity.
3. If the normalized names are exactly equal, record
   `sameChannelNameRule.outcome = "apply_official_identity"` and import the
   official brand, content amount, and content unit into `normalizedIdentity`.
   Import package count or GTIN only when the official primary evidence states
   them at the exact sellable-package level.
4. If any non-whitespace character differs, record
   `sameChannelNameRule.outcome = "discovery_only"`. Similar products may be
   returned as candidates, but the proposal must not plan any link, mapping, or
   registration effect for that candidate.

Every new proposal must include the frozen receipt catalog namespace and a
`sameChannelNameRule` evaluation, even when the outcome is `not_applicable`.
For an approval-ready positive link, retrieve the frozen official HTTPS image
metadata, propose it as the standard-family representative image, and include
`update_representative_image`. Never overwrite a different or uploaded image;
report that collision instead.

An approval-ready positive proposal must also freeze one non-null
`executionTarget` whose shape exactly matches the current `strict_v6`
canonical target: approval policy, same-channel rule, official specification
check, full normalized identity, brand evidence, decision, RPC-shaped Coupang
offer, representative image, evidence, independent review, and ordered six
effects. `approval.targetFingerprint` is the SHA-256 hash of this exact object.
The UI and executor must compare or send this object unchanged; they must not
rebuild a second target from form values or a reduced proposal summary.

Run:

```powershell
node .agents/skills/pricetrace-link-standard-products/scripts/validate-link-proposal.mjs <proposal.json>
```

If fingerprints need to be calculated, run:

```powershell
node .agents/skills/pricetrace-link-standard-products/scripts/validate-link-proposal.mjs <proposal.json> --show-fingerprints
```

Update the proposal through the normal file-editing workflow, then validate
again. For an approval-ready positive proposal, also prove that the application
builder produces the identical strict target:

```powershell
npx.cmd vite-node scripts/verify-link-proposal-execution-target.ts <proposal.json>
```

Never ask for approval unless both checks pass.

If review is `needs_more_evidence` or `reject`, stop and report the exact missing
or conflicting fields in one short `제안 불가:` line. Do not show an approval
phrase and do not invoke the write agent.

### 4. Request item-specific approval

Show an approval proposal only when the validated proposal is already
execution-ready: positive decision, independent `approve` verdict, sufficient
evidence, no conflicts, no blocking missing fields, a non-empty exact effect
allowlist, verified write path, current collision check, and
`execution.status = not_started`.

Present it as one compact block. Do not repeat the investigation narrative:

```text
영수증 기록: {sourceNameRaw} · {sourceLabel}/{sourceProductCode} · {receiptId}/{receiptItemId} · {observedDate}
공식 상품 기록: {sourceNameRaw} · {channelId}/{sourceProductCodeNamespace}:{sourceProductCode} · {specificationTextRaw}
적용 상품: {brand} · {productFamilyName} · {variantName}
쿠팡가: {totalPriceKrw}원/{quantity}개 · {observedDate} | 미등록
대표 이미지: {action} · {full official image URL} · 표준 상품군
연결 작업: {plannedEffects in Korean, comma-separated}
승인 대상: {caseId} · {targetFingerprint}
승인 문구: 위 영수증·공식 코드·적용 상품·연결 작업을 승인합니다.
```

Omit `쿠팡가` only when no Coupang effect is planned. Keep the full receipt and
official source codes and the full `targetFingerprint`; compactness must not
make the approval ambiguous. The evidence bundle and `inputFingerprint` stay
in the proposal artifact and are shown only when the user asks for details.

Approval must clearly refer to this item, these codes, this target, and these
effects. A general instruction such as "register the products" is not approval.

Record the exact approval text, a durable approval reference, and timestamp.
If any frozen input, target, evidence conclusion, or planned effect changes,
mark the proposal stale and request approval again.

### 5. Apply only an approved proposal

Only after valid item-specific approval, start
`pricetrace_registration_executor` with the approved proposal and the verified
write-path contract. The executor must re-read current state, check idempotency
and collisions, require atomicity, pass the approved `executionTarget`
unchanged as `p_target_canonical_json`, apply only approved effects, and verify
the result. The idempotency key is always
`standard-product-link:<target fingerprint hex>`.

If the outcome is unknown, inspect current state before retrying. Do not convert
an unknown result into an automatic retry.

### 6. Close the case

Report created and reused IDs, actual effects, audit references, and verification
results. After a verified successful registration, add the exact receipt
`sourceNameRaw` to `.agents/registered-receipt-product-names.json`, sort and
deduplicate `names`, and update `refreshedAt`. Stop after this case. The user
must explicitly start the next case.

## Hard boundaries

- Product names are not identifiers except for the narrow, audited
  same-channel rule: proven equal channel/catalog namespace plus exact equality
  after removing Unicode whitespace only.
- A same-channel name mismatch is discovery-only and cannot authorize a link,
  mapping, or registration effect.
- Prices are observations, not identity evidence.
- Receipt and official-channel codes remain in separate namespaces.
- Family and exact variant are separate entities.
- Research and review agents remain read-only.
- Registration requires a validated proposal and item-specific approval.
- No deletion, merge, overwrite, or image update without exact approval.
- Do not expose private receipt data beyond the user's local project scope.
