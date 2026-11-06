# Private information → approved public retail price

The inbox remains an immutable, owner-private `information-record.v1` archive. Import and OCR delivery do not publish prices. The receiving user explicitly chooses a verified retail package, an approved seller, an original KRW decimal field, and an original date/datetime field (or `occurred_at`). Generic `pricetrace.observation` records are supported; record type is not used to guess identity.

## Review and atomic application

`preview_pricetrace_information_price_v1(p_record_id, p_expected_user_id, p_source_fingerprint, p_mapping)` returns blocked/ready/applied. The exact mapping keys are `catalog_product_id`, `store_id`, `price_field`, `date_field`. A ready response identifies the account, source hash, mapping digest, selected public facts, and current count/minimum impact.

`apply_pricetrace_information_price_v1` takes those same parameters plus `p_mapping_digest` and `p_publication_approved=true`. It revalidates authority, immutable source, typed amounts/dates, active verified catalog and standard product, verified specification and approved seller. It calls the existing `submit_price_observation_v1` and saves an immutable owner receipt in the same transaction. Any failure rolls back both native data and receipt. Same-record replay returns the original result. Mapping/identity drift requires a new preview.

The price is an explicitly selected package's price, not a receipt total. Fractional KRW, missing currency/date/seller, unsupported services/menus and unknown values stay pending with a reason. Explicit zero is permitted; missing values never become zero. Capture time is not an observation date fallback. Original fields/references/text are not rewritten.

The known correction family is traversed in both directions. An applied ancestor, descendant or sibling prevents another member's application; the same record's receipt can replay. Unknown ancestry, cycles and over 64 linked corrections are blocked. Owner-scoped transaction advisory locks serialize application checks against concurrent receipts. Future records not yet linked cannot be inferred to represent the same fact; native exact `(store,date,catalog,price)` uniqueness supplies an additional deduplication boundary.

Only package/seller identity, observation date and integer KRW price become public. `get_information_public_prices_v1` is the public read allowlist. The product browser labels these `공개 가격 관측`, groups by canonical package and seller IDs, and supplies the existing price history/latest/minimum views. It does not merge a private receipt with public observations merely because names match. No CashOS transaction, receipt total, Fitness intake, or health record is created.

## Preparing a seller when none is approved

The previous schema intentionally defines sellers as admin-curated and offered no registration UI. The inbox now exposes a preparation flow:

1. The source owner supplies the exact seller name, branch/address or online seller identification, public HTTPS verification URL and private evidence note. Explicit submission creates a pending immutable request.
2. Existing `app_metadata.role=admin` users can inspect pending evidence. They supply a review reason and explicitly approve the name/location for public visibility, or reject the request. `user_metadata` cannot grant authority.
3. Approval atomically creates an approved public seller and closes the request. Replaying the same decision is idempotent; a conflicting final decision is rejected. Exact matching name/location/URL identity reuses the existing public seller, without name-based guesses or reactivating rejected identities.
4. The source owner refreshes approved sellers, selects the exact one, then separately previews and approves the price publication.

`pricetrace_seller_review_requests` is visible only to its owner and existing admins. Public seller read never includes evidence notes, source record IDs or user identities. There are no automatic role grants or seeded real sellers. In the read-only November 6 preflight there were 106 eligible retail packages and zero approved public sellers; the root verified an existing admin account. Real seller facts must be entered and reviewed by the user.

## Database delivery and verification

Apply in order, using the project's authenticated Supabase CLI migration workflow:

- `20261106135123_information_public_price_projection.sql`
- `20261106140713_information_seller_review.sql`
- `20261106142738_information_projection_observation_lock.sql` (forward-only existing-observation row lock)
- `20261106155626_information_projection_archive_guard.sql` (forward-only archived-source protection)

No previously applied migration is edited. The root coordinates hosted application after reviewing these exact files. `supabase/tests/information_projection_hosted_rollback.sql` performs a synthetic owner/admin flow, native replay, private text preservation, other-account/anonymous checks and private-price count preservation inside `BEGIN`/`ROLLBACK`. It uses existing accounts and an eligible catalog product, changes no roles, and emits only a pass marker. The exact operator script is also executed by the local PGlite harness with isolated prerequisites.

The coordinating root applied these three migrations on November 6, 2026 and ran that exact script on the hosted database. It returned `INFORMATION_SELLER_TO_NATIVE_PUBLIC_PRICE_ROLLBACK_PASS`, including the native public reader under the anonymous role. Synthetic seller/price/inbox records were rolled back. This is hosted SQL evidence; it is separate from fixture-controlled browser tests and does not establish a physical-device publication flow.

Local verification: 123 historical migrations with documented pre-existing bootstrap accommodations; projection approval/hash/drift/receipt atomicity/replay/lineage/RLS/native reads; seller owner/admin separation/explicit approval/replay/privacy; 715 TypeScript tests across 88 files; mobile browser seller registration → admin approval → public preview → explicit price approval → durable receipt → product price/history (4 Playwright flows, including archive/reopen). Browser HTTP responses are fixture-controlled, so those tests do not demonstrate hosted HTTP success. Android packaging does not prove a physical-device flow.

Unsupported native types continue to be useful private typed records. Further adapters need their own native validation, preview, explicit impact approval and transactional receipt. Applying a correction to an already published observation is intentionally blocked until a dedicated correction workflow is implemented; it is never represented as another independent price.

## Final independent review and verification — 2026-11-07 KST

Independent review found that archived private sources could still be published. The fourth migration now returns a blocked preview for new applications; apply revalidates the current state under its row lock and rejects a stale ready preview with SQLSTATE 22023. Existing immutable receipts still replay after archive without changing the archive state. The UI requires explicitly returning an archived source to pending and hides new-publication controls. Local SQL and mobile/desktop browser regression tests cover this boundary, original text preservation, reopening and receipt replay. A narrow independent re-review found no remaining confirmed P1/P2 in the fix.

The fourth migration was applied to the hosted database without editing the first three. SQL SHA-256: `7388F6B5538F2204CE26184690E6F622A5FC43F434A2C1C6FAAE25C3EAB74133`. The updated exact hosted rollback script returned `INFORMATION_SELLER_TO_NATIVE_PUBLIC_PRICE_ROLLBACK_PASS`, including archive/stale-preview rejection and existing-receipt replay. Post-rollback counts: catalog 113, private prices 3, public prices 0, approved sellers 0, inbox 0, projection receipts 0 and seller requests 0. No synthetic seller or price remains.

Final checks: lint 0 errors/one pre-existing img warning; typecheck; 715 tests/88 files; 123-migration PGlite harness; four Playwright flows; Next production and Android debug builds. The historical harness still documents pre-existing bootstrap/test accommodations; it is not a clean replay claim for every old migration. Browser HTTP is fixture-controlled, distinct from hosted SQL. Node 22.19.0 was used, below the repository's 22.22.0 recommendation.

APK SHA-256: `5AC86E88C1B49112DC58ED8A576C020A25020BE6C4E75A1A657379653E8E9C39`. No physical-device installation, web deployment or push was performed.
