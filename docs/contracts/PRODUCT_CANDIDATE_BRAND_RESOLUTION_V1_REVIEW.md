# Product Brand integration self-review — 2026-10-23

Reviewed baselines: PriceTrace `8119103a7e1dc6ed1bc1880c4288ca2414ba50cc` on `feat/ocr-brand-resolution`; OCR-App `9f27996bc1cf222be2b7866bf82d850fe2c31dd7` on `feat/pricetrace-brand-resolution`.

## Findings and corrections

| Priority | Finding | Correction in OCR-App |
| --- | --- | --- |
| P1 | The older projection/artifact fingerprint sorts evidence arrays. Reordering the exact PT source can change its authority key while leaving the old uploaded projection accepted. | Restore captures an exact-source hash for unchanged successful legacy metadata while retaining its authority key. Revision/invalidation compares that hash and clears only affected approvals/projections. Already stale uploaded metadata is blocked on restore. |
| P2 | An ingest failure explicitly returned null metadata. After a sidecar change, a transient failure could discard an already accepted legacy authority key and retry with a different derived key. Recovery-validation failures could also discard the accepted ingest metadata. | Both failure paths retain the appropriate accepted metadata. Tests prove legacy-key reuse across a 503 retry and preservation after a concurrent selection mismatch. |
| P2 | Public Brand search sent a signed-in access token without refreshing it. An expired token could prevent access to an otherwise public catalog. | Public search always uses the publishable key without user Authorization. Private commands retain their existing authenticated refresh behavior. |

Three new reproductions failed against the reviewed OCR baseline before the fixes. Five regression tests were added, including stale-upload restore and recovery-mismatch cases. No unresolved blocking issue remains in the reviewed paths. This was a self-review, not an independent review.

## PriceTrace result

No production correction was required. Reviewed the new table, grants/RLS, owner filtering, current-fingerprint join, observed-value validation, explicit confirmation, proper-descendant validation, clear/upsert semantics, archive behavior and hierarchy locking. Existing source/public product tables remain outside the mutation path.

Re-ran `npm.cmd run test:purchase-sql`: all 107 migrations and 12 SQL fixtures passed, including candidate ingest-v1 and public-v1–v4 function-definition compatibility checks. The existing documented historical bootstrap accommodations remain unchanged.

No migration, RPC signature, strict public schema or production Supabase state changed during this follow-up. The PriceTrace commit records this review evidence only.

## OCR validation

Executed against a SHA-256 checked ASCII build copy because of the existing Windows parent-path limitation:

```text
:core:test
:app:testDebugUnitTest
:desktop-app:test
:app:assembleDebug
:app:assembleDebugAndroidTest
:receipt-scanner:assembleDebugAndroidTest
lint
```

- Core: 367 tests, zero failures, one optional live smoke skipped without its environment variables. Brand-resolution regression class: 16 tests passed.
- App: 145 JVM tests passed.
- Desktop: 98 tests, zero failures, three existing owner-approved remote tests skipped.
- Debug and instrumentation APK assembly: passed.
- Android lint: passed.
- `git diff --check`: passed on both branches.

Canonical OCR schema/codec files, source logical keys, CashOS/Fitness wire formats, existing legacy projection fingerprint formats and PT ingest-v1 remain unchanged. The fix supplements the existing projection fingerprint rather than silently replacing it for already accepted sessions.

Instrumentation and authenticated real-user mutation were not repeated in this follow-up. The earlier emulator and rollback/live-read evidence remains in [the original validation report](PRODUCT_CANDIDATE_BRAND_RESOLUTION_V1_VALIDATION.md).
