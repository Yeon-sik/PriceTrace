# Cloud development

## Reproducible checkout

Use this repository root, Node **22.22.0** (`.nvmrc`), and npm with the committed `package-lock.json`. Start from a feature branch. A fresh remote clone includes the source and regression tests; local worktrees, tool caches, private files, and installed dependencies are not required.

```bash
bash scripts/cloud-setup.sh
bash scripts/cloud-check.sh
bash scripts/cloud-start.sh
```

Setup verifies and, on Linux x64/arm64, downloads the pinned Node distribution from nodejs.org, validates its SHA-256 checksum, and installs locked dependencies. Generated runtime files stay under ignored `.cloud/`. Allow nodejs.org and registry.npmjs.org. Package install hooks may also need github.com and its release asset hosts. Dependency setup fails if a required download fails.

## Codex Cloud

Set the environment **Install script** to `bash scripts/cloud-setup.sh`. Set the **Start skill** to run `bash scripts/cloud-start.sh`, wait for HTTP readiness, then open `http://localhost:3000/PriceTrace`. Ask the agent to run `bash scripts/cloud-check.sh` after edits. The scripts are repository instructions; committing them does not configure or execute a hosted environment.

## Claude Code Cloud

In the environment Setup script, run the setup command from the checked-out repository root. Claude setup runs on Ubuntu 24.04 using Bash, before environment variables are available. Keep setup below the documented roughly five-minute cache budget. Run checks and browser installation in the session rather than cached setup. Start the preview separately after each session starts; running processes are not part of the environment cache.

## Validation boundaries

The standard check runs lint, typecheck, unit/integration tests, and a production build. It also runs the purchase SQL fixtures in local in-memory PGlite. It needs no real keys, receipt files, financial data, account credentials, or operating database. Do not run `db:push`, `supabase db push`, remote SQL, or Notion publication as part of setup or checks. Production migrations require a separately approved operation.

For browser tests:

```bash
npm exec -- playwright install --with-deps chromium
CI=true npm run test:e2e
```

E2E uses synthetic network responses and test-only placeholders. It does not prove production login, deployed RLS, database application, Android behavior, or external OCR model downloads. Build output is a compilation/export check. The main push workflow publishes Pages; a PR check does not deploy it.

Actual hosted Codex/Claude session execution must be confirmed separately from local Windows checks and Linux GitHub Actions. No hosted-session success is implied by this guide.

## Official references

- [Codex Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments): Install script and Start skill.
- [Claude Code cloud environments](https://code.claude.com/docs/en/cloud-environments): setup, network, runtime cache, and startup lifecycle.
