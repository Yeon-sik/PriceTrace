# PriceTrace agent instructions

PriceTrace is a Next.js/React/TypeScript application for exploring price observations with explicit source, seller, time, and product identity. Read the relevant `docs/contracts/` document and timestamped migrations before changing a contract.

- Work on a feature branch and preserve unrelated changes and other worktrees.
- Keep TypeScript strict mode, domain logic outside React, I/O in repositories, and UI orchestration in feature hooks.
- Preserve KRW integer amounts, quantity/amount conservation, original line references, and explicit units. Missing facts remain missing.
- Never infer verified catalog, brand, merchant, restaurant, menu, or nutrition identity from names or OCR guesses. Keep owner-private evidence separate from public projections and confirmed identity.
- Never publish private receipts, financial data, tokens, `.env` files, or user identifiers. Do not access `private-data/` for cloud validation.
- Preserve authentication, owner scopes, RLS, explicit approval, and append-only migration history. Never weaken validation or remove tests to make checks pass.
- SQL in a PR is source only. Do not run remote migrations, SQL, barcode registration operations, or Notion publication without a separate explicit instruction.
- Read `docs/CLOUD_DEVELOPMENT.md` for installation and preview. Run lint, typecheck, test, and build sequentially; run `npm run test:purchase-sql` for database contracts and relevant Playwright tests for UI flows.
- Public data synchronization requires the authorized private source and a separate review; it is not part of keyless cloud setup.
- Distinguish local checks, Linux CI, hosted Codex/Claude sessions, production database/deployment, browser flows, and Android device evidence in completion reports.

Do not add business features, external APIs, infrastructure, or broad refactors during environment maintenance.
