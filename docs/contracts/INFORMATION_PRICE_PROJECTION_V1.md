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

No previously applied migration is edited. The root coordinates hosted application after reviewing these exact files. `supabase/tests/information_projection_hosted_rollback.sql` performs a synthetic owner/admin flow, native replay, private text preservation, other-account/anonymous checks and private-price count preservation inside `BEGIN`/`ROLLBACK`. It uses existing accounts and an eligible catalog product, changes no roles, and emits only a pass marker. The exact operator script is also executed by the local PGlite harness with isolated prerequisites.

Local verification: 122 historical migrations with documented pre-existing bootstrap accommodations; projection approval/hash/drift/receipt atomicity/replay/lineage/RLS/native reads; seller owner/admin separation/explicit approval/replay/privacy; 715 TypeScript tests across 88 files; mobile browser seller registration → admin approval → public preview → explicit price approval → durable receipt → product price/history (3 Playwright flows). Browser HTTP responses are fixture-controlled, so those tests do not demonstrate hosted HTTP success. Android packaging does not prove a physical-device flow.

Unsupported native types continue to be useful private typed records. Further adapters need their own native validation, preview, explicit impact approval and transactional receipt. Applying a correction to an already published observation is intentionally blocked until a dedicated correction workflow is implemented; it is never represented as another independent price.
