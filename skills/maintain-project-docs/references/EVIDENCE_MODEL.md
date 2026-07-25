# Evidence model

Use this hierarchy for every material statement in project documentation.

## Evidence classes

| Class | Meaning | Acceptable wording |
| --- | --- | --- |
| Runtime verified | Observed in the named deployed, device, provider, browser, or real-user environment | "Verified in …" with date and evidence locator |
| Repository verified | Confirmed from tracked source, tests, migrations, CI configuration, or a local command | "Implemented" or "local checks passed"; name the boundary |
| User confirmed | The user reports a result that is not independently inspectable in the current run | "User-confirmed" with date; do not upgrade to independently verified |
| Inference | A conclusion follows from evidence but was not directly observed | "Strong inference" and the supporting facts |
| Planned | No implementation evidence exists | "Planned", "proposed", or "not implemented" |

File existence is not runtime verification. A successful build is not
deployment verification. A connected integration is not proof that every page
was updated correctly.

## Evidence ledger

Before editing, build a short working ledger:

| Claim | Class | Source boundary | Locator | Freshness |
| --- | --- | --- | --- | --- |
| Example feature works locally | Repository verified | commit or labeled dirty tree | command and exit result | timestamp |
| Example deployment is live | Runtime verified | production | run URL or smoke check | timestamp |

Do not publish the ledger itself unless it improves the document. Use it to
prevent claims from outrunning their evidence.

## Source boundary

Choose exactly one primary boundary:

- immutable commit SHA;
- release or tag;
- CI run attached to a commit;
- explicitly labeled dirty working tree when the user requests a draft.

If unrelated changes are dirty, inspect them only to avoid conflict. Do not
include them in release claims.

## Verification recording

For each check, record:

- exact command or external procedure;
- execution date in ISO 8601 form;
- source commit or dirty-tree label;
- pass, fail, skipped, or blocked;
- environment actually exercised;
- important environment not exercised.

Do not copy old test counts or dates without rerunning or locating immutable CI
evidence.

## Publication boundary

Repository Markdown owns content. Notion mirror pages are replace-only outputs.

- Do not manually edit generated Notion page bodies.
- Keep collaborative notes and databases on separate pages.
- Publish reviewed canonical-branch content only.
- Link a mirror to its immutable source commit.
- Treat a partial two-page update as a failed run; rerun the same commit to
  converge.

## Privacy boundary

Before publication, inspect:

- tracked fixtures and static bundles, not only `private-data/`;
- Markdown links and images;
- local absolute paths and usernames;
- tokens, API keys, internal hostnames, addresses, phone numbers, transaction
  identifiers, and real source filenames;
- generated outputs accidentally staged by broad Git commands.

When evidence may contain personal data, preserve it privately and publish a
sanitized projection rather than the source.
