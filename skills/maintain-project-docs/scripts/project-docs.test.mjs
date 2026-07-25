import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDocumentConfiguration,
  renderNotionMarkdown,
  rewriteRelativeLinks,
  syncProjectDocuments,
} from "./sync-project-docs-to-notion.mjs";
import { validateProjectDocuments } from "./validate-project-docs.mjs";

function temporaryProject() {
  const root = mkdtempSync(path.join(tmpdir(), "project-docs-"));
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, "docs", "Project_Intro.md"), "# Intro\n", "utf8");
  writeFileSync(path.join(root, "docs", "Project_Detail.md"), "# Detail\n", "utf8");
  return root;
}

function publicationEnvironment(overrides = {}) {
  return {
    NOTION_API_KEY: "test-key",
    NOTION_INTRO_PAGE_ID: "11111111111111111111111111111111",
    NOTION_DETAIL_PAGE_ID: "22222222222222222222222222222222",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_SHA: "abc123def456abc123def456abc123def456abcd",
    ...overrides,
  };
}

function pageMarkdownResponse(id, markdown = "", overrides = {}) {
  return new Response(
    JSON.stringify({
      object: "page_markdown",
      id,
      markdown,
      truncated: false,
      unknown_block_ids: [],
      ...overrides,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-request-id": "request-1234567890",
      },
    },
  );
}

function pageIdFromUrl(url) {
  return decodeURIComponent(new URL(url).pathname.split("/").at(-2));
}

function requestedMarkdown(init) {
  return JSON.parse(init.body).replace_content.new_str;
}

test("configuration validates every required secret before publication", () => {
  const root = temporaryProject();
  assert.throws(
    () =>
      buildDocumentConfiguration(
        {
          NOTION_API_KEY: "test-key",
          NOTION_INTRO_PAGE_ID: "11111111111111111111111111111111",
        },
        root,
      ),
    /Project Detail page ID/,
  );
});

test("configuration rejects using one Notion page for both documents", () => {
  const root = temporaryProject();
  assert.throws(
    () =>
      buildDocumentConfiguration(
        publicationEnvironment({
          NOTION_DETAIL_PAGE_ID: "11111111-1111-1111-1111-111111111111",
        }),
        root,
      ),
    /must use different Notion page IDs/,
  );
});

test("configuration rejects malformed Notion page IDs", () => {
  const root = temporaryProject();
  assert.throws(
    () =>
      buildDocumentConfiguration(
        publicationEnvironment({
          NOTION_INTRO_PAGE_ID: "https://www.notion.so/not-a-page-id",
        }),
        root,
      ),
    /invalid format/,
  );
});

test("relative sibling docs become Notion links and tracked assets become immutable GitHub links", () => {
  const root = temporaryProject();
  const documents = [
    {
      file: path.join(root, "docs", "Project_Intro.md"),
      pageId: "11111111111111111111111111111111",
    },
    {
      file: path.join(root, "docs", "Project_Detail.md"),
      pageId: "22222222222222222222222222222222",
    },
  ];
  const context = {
    repository: "owner/repository",
    sourceSha: "abc123",
    serverUrl: "https://github.com",
    rootDirectory: root,
  };
  const sourceDocument = documents[0];

  const rewritten = rewriteRelativeLinks(
    [
      "[Detail](./Project_Detail.md)",
      '[Detail section](./Project_Detail.md#architecture "Architecture")',
      "[Bare detail](Project_Detail.md)",
      "![Screen](./images/screen.png)",
      "![Bare screen](images/screen.png)",
      "[Runbook](./OPERATIONS_RUNBOOK.md#recovery)",
      "",
    ].join("\n\n"),
    sourceDocument,
    documents,
    context,
  );

  assert.match(rewritten, /https:\/\/www\.notion\.so\/22222222222222222222222222222222/);
  assert.doesNotMatch(rewritten, /Project_Detail\.md%23architecture/);
  assert.doesNotMatch(rewritten, /\]\(Project_Detail\.md\)/);
  assert.match(rewritten, /notion\.so\/22222222222222222222222222222222 "Architecture"/);
  assert.match(
    rewritten,
    /https:\/\/raw\.githubusercontent\.com\/owner\/repository\/abc123\/docs\/images\/screen\.png/,
  );
  assert.match(
    rewritten,
    /github\.com\/owner\/repository\/blob\/abc123\/docs\/OPERATIONS_RUNBOOK\.md#recovery/,
  );
});

test("validator rejects unresolved placeholders", () => {
  const root = temporaryProject();
  const intro = path.join(root, "docs", "Project_Intro.md");
  writeFileSync(intro, "# [프로젝트명]\n", "utf8");

  const result = validateProjectDocuments({
    cwd: root,
    files: [intro],
  });

  assert.ok(result.errorCount > 0);
  assert.ok(result.issues.some((issue) => issue.message.includes("placeholder")));
});

test("template validation rejects links written relative to docs/templates", () => {
  const root = temporaryProject();
  const template = path.join(root, "docs", "PROJECT_INTRO_TEMPLATE.md");
  writeFileSync(
    template,
    [
      "# [프로젝트명]",
      "## 1. 30초 요약",
      "## 2. 문제와 해결",
      "## 3. 핵심 기능",
      "## 4. 담당 범위",
      "## 5. 핵심 사용자 흐름",
      "## 6. 핵심 기술적 판단",
      "## 7. 검증 현황",
      "## 8. 현재 한계",
      "## 9. 관련 문서",
      "[Detail](../Project_Detail.md)",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = validateProjectDocuments({
    cwd: root,
    files: [template],
    templates: true,
  });

  assert.ok(result.errorCount > 0);
  assert.ok(result.issues.some((issue) => issue.message.includes("generated docs")));
});

test("require-tracked rejects a publishable document absent from Git", () => {
  const root = temporaryProject();
  const result = validateProjectDocuments({
    cwd: root,
    files: [path.join(root, "docs", "Project_Intro.md")],
    requireTracked: true,
  });

  assert.ok(result.issues.some((issue) => issue.message.includes("itself is not tracked")));
});

test("the problem-solving section remains optional for Detail templates", () => {
  const root = temporaryProject();
  const sourceTemplate = fileURLToPath(
    new URL("../assets/PROJECT_DETAIL_TEMPLATE.md", import.meta.url),
  );
  const withoutProblemSolving = readFileSync(sourceTemplate, "utf8").replace(
    /\n## 12\. 문제 해결 사례[\s\S]*?(?=\n## 13\.)/,
    "",
  );
  const template = path.join(root, "docs", "PROJECT_DETAIL_TEMPLATE.md");
  writeFileSync(template, withoutProblemSolving, "utf8");

  const result = validateProjectDocuments({
    cwd: root,
    files: [template],
    templates: true,
  });

  assert.equal(result.errorCount, 0);
});

test("publication preflights both pages and performs no write if either page is unavailable", async () => {
  const root = temporaryProject();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).includes("11111111111111111111111111111111")) {
      return pageMarkdownResponse("11111111-1111-1111-1111-111111111111");
    }
    return new Response(JSON.stringify({ object: "error", message: "not found" }), {
      status: 404,
    });
  };

  try {
    await assert.rejects(
      syncProjectDocuments({
        environment: publicationEnvironment(),
        rootDirectory: root,
      }),
      /preflight failed before publication/,
    );
    assert.equal(calls.filter((call) => call.method === "GET").length, 2);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publication performs no write when preflight Markdown is truncated", async () => {
  const root = temporaryProject();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    const pageId = pageIdFromUrl(url);
    if (pageId.startsWith("2222")) {
      return pageMarkdownResponse(pageId, "partial", {
        truncated: true,
        unknown_block_ids: ["33333333-3333-3333-3333-333333333333"],
      });
    }
    return pageMarkdownResponse(pageId);
  };

  try {
    await assert.rejects(
      syncProjectDocuments({
        environment: publicationEnvironment(),
        rootDirectory: root,
      }),
      /preflight failed before publication/,
    );
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rerunning the same source commit skips both remote writes", async () => {
  const root = temporaryProject();
  const calls = [];
  const originalFetch = globalThis.fetch;
  const environment = publicationEnvironment();
  const configuration = buildDocumentConfiguration(environment, root);
  const currentMarkdown = new Map(
    configuration.documents.map((document) => [
      document.pageId.replaceAll("-", ""),
      renderNotionMarkdown(document, configuration.documents, configuration),
    ]),
  );
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    const pageId = pageIdFromUrl(url);
    return pageMarkdownResponse(pageId, currentMarkdown.get(pageId.replaceAll("-", "")));
  };

  try {
    const result = await syncProjectDocuments({
      environment,
      rootDirectory: root,
    });
    assert.equal(calls.filter((call) => call.method === "GET").length, 2);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 0);
    assert.deepEqual(
      result.documents.map((document) => document.status),
      ["Already current", "Already current"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a source SHA marker alone does not hide manual Notion drift", async () => {
  const root = temporaryProject();
  const calls = [];
  const originalFetch = globalThis.fetch;
  const environment = publicationEnvironment();
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    const markdown =
      init.method === "PATCH"
        ? requestedMarkdown(init)
        : `Damaged content ${environment.GITHUB_SHA}`;
    return pageMarkdownResponse(pageIdFromUrl(url), markdown);
  };

  try {
    const result = await syncProjectDocuments({
      environment,
      rootDirectory: root,
    });
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 2);
    assert.deepEqual(
      result.documents.map((document) => document.status),
      ["Synced", "Synced"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publication updates both pages only after successful preflight", async () => {
  const root = temporaryProject();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return pageMarkdownResponse(
      pageIdFromUrl(url),
      init.method === "PATCH" ? requestedMarkdown(init) : "",
    );
  };

  try {
    const result = await syncProjectDocuments({
      environment: publicationEnvironment(),
      rootDirectory: root,
    });
    assert.equal(calls.filter((call) => call.method === "GET").length, 2);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 2);
    assert.deepEqual(
      result.documents.map((document) => document.status),
      ["Synced", "Synced"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publication rejects a successful PATCH response with different Markdown", async () => {
  const root = temporaryProject();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return pageMarkdownResponse(
      pageIdFromUrl(url),
      init.method === "PATCH" ? "WRONG REMOTE CONTENT" : "",
    );
  };

  try {
    await assert.rejects(
      syncProjectDocuments({
        environment: publicationEnvironment(),
        rootDirectory: root,
      }),
      /publication was partial or failed/,
    );
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("--apply is rejected outside GitHub Actions main", () => {
  const script = fileURLToPath(new URL("./sync-project-docs-to-notion.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--apply"], {
    cwd: temporaryProject(),
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTIONS: "false",
      GITHUB_REF: "refs/heads/feature/test",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /allowed only in GitHub Actions on refs\/heads\/main/);
});
