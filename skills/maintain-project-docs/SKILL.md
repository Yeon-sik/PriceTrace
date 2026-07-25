---
name: maintain-project-docs
description: Create, audit, or update evidence-grounded project documentation, especially docs/Project_Intro.md and docs/Project_Detail.md, and prepare a reviewed Git Markdown to Notion mirror. Use when Codex or Claude must document a repository, refresh portfolio or technical case-study pages, reconcile documentation with code and test evidence, validate documentation before publication, or install and maintain the accompanying Notion synchronization workflow.
---

# Maintain Project Docs

Keep repository Markdown as the canonical source. Treat Notion as a generated
mirror, never as a second editable source.

## Execute the workflow

1. Establish the exact repository, branch, target documents, intended audience,
   and requested scope.
2. Read repository instructions and acceptance criteria before documenting
   implementation.
3. Inspect the working tree, current commit, tracked files, source, tests,
   configuration, migrations, deployment files, and existing documentation.
4. Read [references/EVIDENCE_MODEL.md](references/EVIDENCE_MODEL.md) and classify
   every material claim before writing.
5. Preserve useful existing structure. Update only claims affected by current
   evidence; do not replace established documentation with a shorter generic
   summary.
6. Use [assets/PROJECT_INTRO_TEMPLATE.md](assets/PROJECT_INTRO_TEMPLATE.md) for a
   concise external overview and
   [assets/PROJECT_DETAIL_TEMPLATE.md](assets/PROJECT_DETAIL_TEMPLATE.md) for
   technical evidence. Delete optional sections that have no evidence.
7. Run relevant project checks sequentially. Record the command, date, commit or
   dirty-tree boundary, result, and remaining unverified environment.
8. Run:

   ```text
   node <skill-dir>/scripts/validate-project-docs.mjs --require-tracked docs/Project_Intro.md docs/Project_Detail.md
   node <skill-dir>/scripts/validate-project-docs.mjs --templates docs/templates/PROJECT_INTRO_TEMPLATE.md docs/templates/PROJECT_DETAIL_TEMPLATE.md
   ```

9. Review the final diff for private data, invented metrics, stale counts,
   broken links, unsupported Markdown, and scope expansion.
10. Confirm the documents, templates, workflow, and every script referenced by
    the workflow are tracked in the same intended commit. An untracked local
    script is not a deployable automation.
11. Publish only through the reviewed repository workflow. Do not call Notion
    directly from an interactive agent when the repository workflow exists.

## Apply evidence rules

- Separate repository evidence, runtime evidence, user-confirmed evidence,
  inference, and plans.
- Never turn file existence, a local build, or a user statement into stronger
  operational evidence than it is.
- Never document unrelated dirty-tree changes as released work.
- Use one explicit source boundary: a commit, a release, or a clearly labeled
  dirty working tree.
- Describe failed and skipped checks. Do not omit them to make the project look
  complete.
- Do not invent adoption, performance, revenue, accuracy, or user-impact
  numbers.
- Keep private source data, credentials, internal URLs, local absolute paths,
  and personal identifiers out of publishable documents.

## Maintain the Notion mirror

Use [assets/sync-project-docs-to-notion.yml](assets/sync-project-docs-to-notion.yml)
as the workflow baseline and
[scripts/sync-project-docs-to-notion.mjs](scripts/sync-project-docs-to-notion.mjs)
as the deterministic publisher.

- Validate pull requests without secrets.
- Publish only from `main` or an explicitly approved canonical branch.
- Validate all required secrets and source files before the first remote write.
- Reject identical Intro and Detail page IDs after UUID normalization.
- Replace the two dedicated mirror pages idempotently.
- Preflight both pages with read-content access and reject truncated or unknown
  Markdown responses before any write.
- Skip a page only when its complete retrieved Markdown equals the complete
  rendered output; a matching commit marker alone is not enough.
- Rewrite sibling document links to their Notion pages and other tracked
  relative links to immutable GitHub commit URLs.
- Add the source commit banner and report both page results in the Actions
  summary.
- Fail visibly on partial publication so rerunning the same commit converges.
- Keep manual content, child databases, and notes outside the two mirror pages.

## Install project scaffolding

Copy the two template assets to `docs/templates/` only when the repository does
not already have stronger templates. Copy the workflow asset to
`.github/workflows/` and keep the publisher and validator in a tracked,
repository-local path referenced by that workflow.

Do not overwrite existing documents, workflows, or scripts without first
showing and reviewing the diff. Commit the complete bundle atomically; never
commit the workflow without its referenced Skill scripts.
