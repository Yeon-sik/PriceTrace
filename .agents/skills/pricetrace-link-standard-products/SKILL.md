---
name: pricetrace-link-standard-products
description: Coordinate a project-scoped PriceTrace workflow that investigates one receipt item and one official-channel listing, delegates identity, evidence, and adversarial review to custom subagents, produces and validates a LinkProposal, and stores it in the local admin approval queue for item-specific approval and registration. Use for PriceTrace official-product or receipt-to-standard-product research, proposal review, and approval-queue handoff.
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

Also check the current exact receipt source mapping by
`sourceLabel + sourceProductCode` before starting investigation agents. If it
is already registered, synchronize the exact `sourceNameRaw` into the local
name file, sort and deduplicate it, update `refreshedAt`, and stop. This keeps
the local shortcut current after approvals completed entirely in the browser.

Capture immutable receipt and official-listing inputs, including their distinct
source namespaces, revision or snapshot identifiers, and snapshot hash. Assign
one `caseId`. Do not infer that receipt and official codes share a namespace.
Also capture the receipt merchant's catalog namespace separately from its
merchant SKU namespace. A same-channel rule may be evaluated only when that
catalog namespace is explicitly proven and exactly equals the official
listing's `channelId`.

If raw inputs cannot be frozen, stop with `insufficient_evidence`.

### 1a. Record every exploration exception

Whenever a receipt item is excluded or stopped during preflight, research,
independent review, proposal validation, or queue handoff, append it to the
living log `docs/예외처리_2026-08-03.md`. Continue editing this file on later
dates; do not create another date-specific exception file. Use the local Korea
date in section headings for later activity and use this exact line shape:

`상품이름(물품번호, 영수증 날짜) : 이유`

Record every actual preflight exclusion, missing or conflicting evidence,
rejected review, incorrect frozen input that required correction, and workflow
or system error that prevented the case from proceeding. Backfill earlier
omissions when they are discovered. Do not delete a historical entry after it
is fixed; move it to a resolved-history section or suffix the reason with
`(해소됨)`. Do not record an item merely because its turn has not started.
Deduplicate only exact repeats of the same product code, receipt date, and
reason; retain materially different failures for the same product.

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
exceptions are the audited same-channel exact and verified-name rules:

1. Prove `receipt.sourceCatalogNamespace === officialListing.channelId`.
2. Normalize both raw names by removing Unicode whitespace only. Do not alter
   either frozen raw value. For candidate discovery, compare lower-cased names
   after removing non-alphanumeric characters. Ignore one leading
   parenthesized numeric receipt classification code for discovery only, and
   accept only when exactly one candidate matches at least 85% of the receipt
   name against one contiguous official-name window.
   This threshold discovers a candidate only and never proves identity.
3. If the normalized names are exactly equal, record
   `sameChannelNameRule.outcome = "apply_official_identity"` and import the
   official brand, content amount, and content unit into `normalizedIdentity`.
   Import package count or GTIN only when the official primary evidence states
   them at the exact sellable-package level.
4. If any non-whitespace character differs, the default remains
   `sameChannelNameRule.outcome = "discovery_only"`.
5. A single Unicode code-point substitution may instead use
   `sameChannelNameRule.outcome = "apply_verified_name_equivalence"` only when
   the item-specific proof freezes the exact index and both code points, cites matching primary
   official-channel evidence and separate manufacturer or brand primary
   evidence, and binds a sufficient conflict-free approval from
   `pricetrace_independent_reviewer`. User assertion, price similarity, fuzzy
   score, or a global spelling replacement is never sufficient.
6. A single Unicode code-point insertion or deletion may use the same outcome
   with `method = "single_unicode_code_point_insertion_deletion_v1"` only when
   the item-specific proof freezes the edit direction, exact index and code
   point, both code-point lengths, a normalized discovery similarity of at
   least 90%, and `uniqueOfficialCandidate = true`. The proof must cite matching
   primary official-channel evidence and separate manufacturer or brand primary
   evidence and bind a sufficient conflict-free approval from
   `pricetrace_independent_reviewer`. The 90% score remains discovery evidence,
   not standalone identity proof.
7. A receipt label truncated inside a longer official name may use the same
   outcome with `method = "official_name_contains_receipt_name_v1"` only when:
   the whitespace-normalized receipt name has at least six Unicode code points,
   covers at least 60% of the longer official name, occurs exactly once in that
   name, and selects exactly one name candidate across the complete frozen
   official snapshot before price is considered. Freeze the exact index,
   lengths, prefix, suffix, and `officialListing.officialPrice`; the frozen
   official price must equal the receipt unit price. Price only corroborates the
   already-unique name candidate and never resolves ambiguity. Cite the frozen
   transactional receipt row and primary official-channel name and price
   evidence, then bind a sufficient conflict-free approval from
   `pricetrace_independent_reviewer`.
8. When the user explicitly selects one official listing for one frozen receipt
   row, freeze that choice in `executionTarget.userSelectedOfficialVariant`.
   Bind the receipt source ID, official namespace and code, raw specification,
   and the user-selection source reference and content hash. This may resolve
   only that item-specific typo/truncation or same-name variant ambiguity, and
   still requires primary official and manufacturer/brand evidence plus an
   independent approval. It never changes the automatic 85% discovery rule.

Every new proposal must include the frozen receipt catalog namespace and a
`sameChannelNameRule` evaluation, even when the outcome is `not_applicable`.
For an approval-ready positive link, retrieve the frozen official HTTPS image
metadata, propose it as the standard-family representative image, and include
`update_representative_image`. Never overwrite a different or uploaded image;
report that collision instead.

An approval-ready positive proposal must also freeze one non-null
`executionTarget`. Use `strict_v6` when an exact Coupang observation is part of
the reviewed target. Use `link_only_v1` only when primary official-channel and
receipt evidence prove the exact sellable variant but no Coupang offer exists
or should be registered. The link-only target sets `coupangOffer` to `null` and
omits `register_coupang_offer`; it never fabricates a retailer price. Apparel
targets preserve the official numeric size and store one typed `apparelSize`
from `S(90)`, `M(95)`, `L(100)`, `XL(105)`, `XXL(110)`, or `XXXL(115)`, while
sellable quantity remains `1 each`. `approval.targetFingerprint` is the SHA-256
hash of the exact target object.
Composite razor kits preserve typed `razor_handle` and `razor_blade`
`kitComponents` while the sellable catalog quantity remains `1 each`; never
flatten unlike components into a homogeneous count.
An unchanged approval sends this object unchanged. If the administrator edits
an allowed target field in the approval modal, the UI must build a new complete
proposal target, recompute the fingerprint and idempotency key, validate the
rebuilt LinkProposal, and send that exact rebuilt target. It must never send an
unvalidated form-only target or modify frozen receipt and official inputs.

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

Never queue for approval unless both checks pass.

If review is `needs_more_evidence` or `reject`, stop and report the exact missing
or conflicting fields in one short `제안 불가:` line. Do not show an approval
phrase and do not invoke the write agent.

### 4. Queue item-specific approval

Queue a proposal only when it is already execution-ready: positive decision,
independent `approve` verdict, sufficient evidence, no conflicts, no blocking
missing fields, the exact effect allowlist, verified write path, current
collision check, and `execution.status = not_started`.

Open the signed-in local PriceTrace administrator page, expand
`GPT 제안서 로컬 저장`, and save the validated LinkProposal JSON. The queue is
browser-local. It is not a remote database, an approval record, or write
authorization. Do not ask the user to copy an approval phrase into chat.

If the administrator page cannot be accessed, report that the validated
proposal was not queued and stop. Do not replace the local queue with an
automatic write.

The queue card shows only the official image and standard-family name. The
administrator opens the card to review the full receipt, official, target,
optional Coupang, image, and effect fields. The modal provides:

- `연결 승인` when the target is unchanged;
- `수정 후 승인` when an allowed target field changed;
- `대기열에서 삭제` when the proposal should be discarded.

Frozen receipt and official-listing evidence remain read-only. An allowed
target edit must be rebuilt as a complete LinkProposal with a new target
fingerprint and idempotency key, then validated before the same explicit button
action can execute it. The local queue entry itself is never approval.

### 5. Apply only through the approval modal

The GPT orchestration task stops after the validated local queue handoff. It
must not invoke the write RPC or start `pricetrace_registration_executor` for
a queued case. The signed-in administrator modal owns explicit approval and
calls the verified atomic path named by the target: `strict_v6` or
`link_only_v1`.

The modal re-reads current state, checks idempotency and collisions, passes the
validated current `executionTarget` unchanged as `p_target_canonical_json`,
applies only approved effects, and verifies the result. The idempotency key is
always `standard-product-link:<target fingerprint hex>`.

If the outcome is unknown, inspect current state before retrying. Do not convert
an unknown result into an automatic retry.

### 6. Close the case

After verified successful registration, the UI deletes that proposal from the
local queue. On the next agent run, detect the exact live receipt mapping before
starting research. If it is already registered, synchronize the exact receipt
`sourceNameRaw` into `.agents/registered-receipt-product-names.json`, sort and
deduplicate `names`, and update `refreshedAt`. Stop after this case. The user
must explicitly start the next case.

## Hard boundaries

- Product names are not identifiers. The narrow same-channel rule permits
  exact equality after removing Unicode whitespace only, or one frozen
  item-specific single-code-point substitution or insertion/deletion proof
  backed by official and manufacturer or brand primary evidence plus
  independent approval. Containment remains a separate audited exception.
- An unverified same-channel name mismatch is discovery-only and cannot
  authorize a link, mapping, or registration effect. Never apply a global typo
  substitution or silently rewrite either source name.
- Prices are observations, not identity evidence.
- Receipt and official-channel codes remain in separate namespaces.
- Family and exact variant are separate entities.
- Research and review agents remain read-only.
- Registration requires a validated proposal and item-specific approval in the signed-in admin modal.
- No deletion, merge, overwrite, or image update without exact approval.
- Do not expose private receipt data beyond the user's local project scope.
