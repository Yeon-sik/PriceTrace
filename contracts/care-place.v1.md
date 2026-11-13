# care-place.v1

PriceTrace owns public hospital/pharmacy identity. OCR App and the manual home form call
`register_care_place_v1(p_request_id, p_place, p_public_confirmed)` after login and explicit confirmation.
Public `search_care_places_v1` and `get_care_place_v1` return only `schema_version`, `place_id`,
`category` (`hospital`/`pharmacy`), `name`, `address`, `phone`.

Normalized category/name/address is unique. Concurrent registration is serialized; repeated request IDs
must contain the same payload. Repeated institutions return their existing UUID without overwriting facts.
Registration provenance is owner-private. No source receipt, patient, payment, prescription or dose is public.

The home displays a compact institution section and links to full search/manual registration. CashOS
attaches the selected UUID and snapshot to an existing owned expense. HealthTrace stores it as the
prescription's `pricetrace` place reference; it does not infer illness or consumption from payment.

Migration: `20261113135733_care_places.sql`. Local verification: `npm run test:care-places`, full tests,
lint/typecheck/build and purchase SQL checks. The care SQL test checks duplicate/retry, consent,
strict fields, owner separation and public output. The migration was applied and Galaxy A25 + desktop/mobile
flows verified on 2026-11-13 using temporary fixtures, all removed afterward; existing store rows preserved.
