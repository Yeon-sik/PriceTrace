#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NOTION_API_VERSION = "2026-03-11";
const API_BASE_URL = "https://api.notion.com";
const MAX_ATTEMPTS = 4;
const SOURCE_FINGERPRINT_PATTERN = /source sha256\s+`?([0-9a-f]{64})`?/i;

function markdownSha256(markdown) {
  return createHash("sha256").update(markdown).digest("hex");
}

function extractSourceFingerprint(markdown) {
  return SOURCE_FINGERPRINT_PATTERN.exec(markdown)?.[1]?.toLocaleLowerCase() ?? "";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pageUrl(pageId) {
  return `https://www.notion.so/${pageId.replaceAll("-", "")}`;
}

function encodeRepositoryPath(repositoryPath) {
  return repositoryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseMarkdownLinkDestination(rawDestination) {
  const trimmed = rawDestination.trim();
  let target;
  let titleSuffix = "";

  if (trimmed.startsWith("<")) {
    const closingBracket = trimmed.indexOf(">");
    if (closingBracket < 0) return null;
    target = trimmed.slice(1, closingBracket);
    titleSuffix = trimmed.slice(closingBracket + 1);
  } else {
    const match = /^(\S+)(\s+(?:"[^"\n]*"|'[^'\n]*'))?$/.exec(trimmed);
    if (!match) return null;
    target = match[1];
    titleSuffix = match[2] || "";
  }

  if (
    target.startsWith("#") ||
    target.startsWith("?") ||
    target.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(target) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)
  ) {
    return null;
  }
  const suffixIndex = target.search(/[?#]/);
  return {
    path:
      suffixIndex < 0
        ? target
        : target.slice(0, suffixIndex),
    urlSuffix:
      suffixIndex < 0
        ? ""
        : target.slice(suffixIndex),
    titleSuffix,
  };
}

function cleanPageId(rawPageId, label) {
  const pageId = rawPageId?.trim();
  if (!pageId) throw new Error(`${label} page ID GitHub Secret is required.`);
  if (!/^[0-9a-f]{32}$/i.test(pageId.replaceAll("-", ""))) {
    throw new Error(`${label} page ID has an invalid format.`);
  }
  return pageId;
}

export function buildDocumentConfiguration(environment = process.env, rootDirectory = process.cwd()) {
  const apiKey = environment.NOTION_API_KEY?.trim();
  if (!apiKey) throw new Error("NOTION_API_KEY GitHub Secret is required.");

  const introPageId = cleanPageId(environment.NOTION_INTRO_PAGE_ID || environment.NOTION_PAGE_ID, "Project Intro");
  if (!environment.NOTION_INTRO_PAGE_ID && environment.NOTION_PAGE_ID) {
    console.warn("Using legacy NOTION_PAGE_ID. Migrate it to NOTION_INTRO_PAGE_ID.");
  }
  const detailPageId = cleanPageId(environment.NOTION_DETAIL_PAGE_ID, "Project Detail");
  if (normalizedPageId(introPageId) === normalizedPageId(detailPageId)) {
    throw new Error("Project Intro and Project Detail must use different Notion page IDs.");
  }
  const documents = [
    {
      key: "intro",
      label: "Project Intro",
      file: path.resolve(rootDirectory, "docs/Project_Intro.md"),
      repositoryPath: "docs/Project_Intro.md",
      pageId: introPageId,
    },
    {
      key: "detail",
      label: "Project Detail",
      file: path.resolve(rootDirectory, "docs/Project_Detail.md"),
      repositoryPath: "docs/Project_Detail.md",
      pageId: detailPageId,
    },
  ];

  for (const document of documents) {
    readFileSync(document.file, "utf8");
  }

  return {
    apiKey,
    apiBaseUrl: API_BASE_URL,
    documents,
    rootDirectory: path.resolve(rootDirectory),
    repository: environment.GITHUB_REPOSITORY?.trim() || "",
    sourceSha: environment.GITHUB_SHA?.trim() || "",
    serverUrl: (environment.GITHUB_SERVER_URL || "https://github.com").replace(/\/+$/, ""),
    summaryPath: environment.GITHUB_STEP_SUMMARY?.trim() || "",
  };
}

export function rewriteRelativeLinks(markdown, sourceDocument, documents, context) {
  const notionTargets = new Map(
    documents.map((document) => [
      path.resolve(document.file).toLocaleLowerCase(),
      pageUrl(document.pageId),
    ]),
  );
  const relativeLinkPattern = /(!?)\[([^\]]*)\]\(([^)\n]+)\)/g;

  return markdown.replace(
    relativeLinkPattern,
    (fullMatch, imagePrefix, label, rawDestination) => {
      const destination = parseMarkdownLinkDestination(rawDestination);
      if (!destination) return fullMatch;

      let decodedPath;
      try {
        decodedPath = decodeURIComponent(destination.path);
      } catch {
        return fullMatch;
      }

      const absoluteTarget = path.resolve(path.dirname(sourceDocument.file), decodedPath);
      const notionTarget = notionTargets.get(absoluteTarget.toLocaleLowerCase());
      if (notionTarget) {
        return `${imagePrefix}[${label}](${notionTarget}${destination.titleSuffix})`;
      }

      if (!context.repository || !context.sourceSha) return fullMatch;
      const repositoryTarget = path
        .relative(context.rootDirectory || process.cwd(), absoluteTarget)
        .replaceAll("\\", "/");
      if (repositoryTarget.startsWith("../")) return fullMatch;

      const encodedTarget = encodeRepositoryPath(repositoryTarget);
      const targetUrl = imagePrefix
        ? `https://raw.githubusercontent.com/${context.repository}/${context.sourceSha}/${encodedTarget}`
        : `${context.serverUrl}/${context.repository}/blob/${context.sourceSha}/${encodedTarget}`;
      return `${imagePrefix}[${label}](${targetUrl}${destination.urlSuffix}${destination.titleSuffix})`;
    },
  );
}

export function renderNotionMarkdown(sourceDocument, documents, context) {
  const source = readFileSync(sourceDocument.file, "utf8");
  const rewritten = rewriteRelativeLinks(source, sourceDocument, documents, context);
  if (!context.repository || !context.sourceSha) return rewritten;

  const shortSha = context.sourceSha.slice(0, 12);
  const commitUrl = `${context.serverUrl}/${context.repository}/commit/${context.sourceSha}`;
  const sourceFingerprint = markdownSha256(rewritten);
  const banner =
    `> Automated read-only mirror. Canonical source: ` +
    `[${sourceDocument.repositoryPath}](${context.serverUrl}/${context.repository}/blob/${context.sourceSha}/${sourceDocument.repositoryPath}) | ` +
    `[commit ${shortSha}](${commitUrl}) | source sha256 \`${sourceFingerprint}\`\n\n`;
  return `${banner}${rewritten}`;
}

async function notionRequest(url, init, label) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response;

      const body = (await response.text()).slice(0, 1_500);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === MAX_ATTEMPTS) {
        const childContentHint =
          /child|database|allow_deleting_content/i.test(body)
            ? " Keep child pages, databases, and manual notes outside the generated mirror page."
            : "";
        throw new Error(`${label} failed (${response.status}): ${body}${childContentHint}`);
      }

      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const waitMilliseconds = Number.isFinite(retryAfterSeconds)
        ? Math.max(1_000, retryAfterSeconds * 1_000)
        : 750 * 2 ** (attempt - 1);
      await delay(waitMilliseconds);
    } catch (error) {
      lastError = error;
      const timeoutOrNetworkError =
        error instanceof TypeError ||
        (error instanceof Error && /timeout|aborted|fetch/i.test(error.message));
      if (!timeoutOrNetworkError || attempt === MAX_ATTEMPTS) throw error;
      await delay(750 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new Error(`${label} failed without a response.`);
}

function normalizedPageId(pageId) {
  return pageId.replaceAll("-", "").toLocaleLowerCase();
}

async function preflightDocument(document, configuration) {
  const response = await notionRequest(
    `${configuration.apiBaseUrl}/v1/pages/${encodeURIComponent(document.pageId)}/markdown`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Notion-Version": NOTION_API_VERSION,
      },
    },
    `${document.label} preflight`,
  );
  const result = await response.json();
  if (result.object !== "page_markdown") {
    throw new Error(`${document.label} preflight returned an unexpected response object.`);
  }
  if (
    typeof result.markdown !== "string" ||
    result.truncated ||
    (result.unknown_block_ids?.length ?? 0) > 0
  ) {
    throw new Error(
      `${document.label} preflight response was incomplete (truncated=${Boolean(result.truncated)}, unknown=${result.unknown_block_ids?.length ?? 0}).`,
    );
  }
  if (normalizedPageId(result.id) !== normalizedPageId(document.pageId)) {
    throw new Error(`${document.label} preflight returned a different page.`);
  }
  return result;
}

async function updateDocument(document, configuration, markdown) {
  const startedAt = Date.now();
  const response = await notionRequest(
    `${configuration.apiBaseUrl}/v1/pages/${encodeURIComponent(document.pageId)}/markdown`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${configuration.apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION,
      },
      body: JSON.stringify({
        type: "replace_content",
        replace_content: { new_str: markdown },
      }),
    },
    `${document.label} sync`,
  );

  const result = await response.json();
  if (result.object !== "page_markdown") {
    throw new Error(`${document.label} sync returned an unexpected response object.`);
  }
  if (normalizedPageId(result.id) !== normalizedPageId(document.pageId)) {
    throw new Error(`${document.label} sync returned a different page.`);
  }
  if (
    typeof result.markdown !== "string" ||
    result.truncated ||
    (result.unknown_block_ids?.length ?? 0) > 0
  ) {
    throw new Error(
      `${document.label} sync response was incomplete (truncated=${Boolean(result.truncated)}, unknown=${result.unknown_block_ids?.length ?? 0}).`,
    );
  }

  const sourceFingerprint = extractSourceFingerprint(markdown);
  const notionNormalized = result.markdown !== markdown;
  if (
    notionNormalized &&
    (!sourceFingerprint || !result.markdown.toLocaleLowerCase().includes(sourceFingerprint))
  ) {
    throw new Error(
      `${document.label} sync response lost the source fingerprint during Notion normalization.`,
    );
  }

  return {
    label: document.label,
    pageUrl: pageUrl(document.pageId),
    status: notionNormalized ? "Synced (Notion-normalized)" : "Synced",
    characters: markdown.length,
    sha256: markdownSha256(markdown),
    notionCharacters: result.markdown.length,
    notionSha256: markdownSha256(result.markdown),
    elapsedMilliseconds: Date.now() - startedAt,
    requestId: response.headers.get("x-request-id") || "",
  };
}

function writeSummary(configuration, results, failures) {
  if (!configuration.summaryPath) return;
  const lines = [
    "## Project docs to Notion",
    "",
    "| Document | Result | Source hash | Notion hash | Size | Duration | Request |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const result of results) {
    const notionHash = result.notionSha256 || result.sha256;
    const notionCharacters = result.notionCharacters ?? result.characters;
    const size =
      notionCharacters === result.characters
        ? `${result.characters} chars`
        : `${result.characters} -> ${notionCharacters} chars`;
    lines.push(
      `| [${result.label}](${result.pageUrl}) | ${result.status} | \`${result.sha256.slice(0, 12)}\` | \`${notionHash.slice(0, 12)}\` | ${size} | ${result.elapsedMilliseconds} ms | ${result.requestId ? `\`${result.requestId.slice(0, 12)}\`` : "-"} |`,
    );
  }
  for (const failure of failures) {
    lines.push(`| ${failure.label} | Failed | - | - | - | - | - |`);
  }
  if (configuration.sourceSha) {
    lines.push("", `Source commit: \`${configuration.sourceSha}\``);
  }
  appendFileSync(configuration.summaryPath, `${lines.join("\n")}\n`, "utf8");
}

export async function syncProjectDocuments({
  environment = process.env,
  rootDirectory = process.cwd(),
  dryRun = false,
} = {}) {
  const configuration = buildDocumentConfiguration(environment, rootDirectory);
  const renderedDocuments = configuration.documents.map((document) => ({
    document,
    markdown: renderNotionMarkdown(document, configuration.documents, configuration),
  }));

  if (dryRun) {
    return {
      dryRun: true,
      documents: renderedDocuments.map(({ document, markdown }) => ({
        label: document.label,
        characters: markdown.length,
        sha256: createHash("sha256").update(markdown).digest("hex"),
      })),
    };
  }

  const preflight = await Promise.allSettled(
    renderedDocuments.map(({ document }) => preflightDocument(document, configuration)),
  );
  const preflightFailures = [];
  preflight.forEach((result, index) => {
    if (result.status === "rejected") {
      preflightFailures.push({
        label: renderedDocuments[index].document.label,
        error: result.reason,
      });
    }
  });
  if (preflightFailures.length > 0) {
    const messages = preflightFailures.map(({ label, error }) => {
      const message = error instanceof Error ? error.message : String(error);
      return `${label}: ${message}`;
    });
    throw new Error(`Notion preflight failed before publication.\n${messages.join("\n")}`);
  }

  const alreadyCurrent = new Map();
  preflight.forEach((result, index) => {
    if (
      result.status === "fulfilled" &&
      typeof result.value.markdown === "string" &&
      result.value.markdown === renderedDocuments[index].markdown
    ) {
      alreadyCurrent.set(renderedDocuments[index].document.key, true);
    }
  });

  const settled = await Promise.allSettled(
    renderedDocuments.map(({ document, markdown }) => {
      if (!alreadyCurrent.has(document.key)) {
        return updateDocument(document, configuration, markdown);
      }
      return Promise.resolve({
        label: document.label,
        pageUrl: pageUrl(document.pageId),
        status: "Already current",
        characters: markdown.length,
        sha256: markdownSha256(markdown),
        notionCharacters: markdown.length,
        notionSha256: markdownSha256(markdown),
        elapsedMilliseconds: 0,
        requestId: "",
      });
    }),
  );
  const results = [];
  const failures = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") results.push(result.value);
    else {
      failures.push({
        label: renderedDocuments[index].document.label,
        error: result.reason,
      });
    }
  });
  writeSummary(configuration, results, failures);

  if (failures.length > 0) {
    const messages = failures.map(({ label, error }) => {
      const message = error instanceof Error ? error.message : String(error);
      return `${label}: ${message}`;
    });
    throw new Error(`Notion publication was partial or failed.\n${messages.join("\n")}`);
  }

  return { dryRun: false, documents: results };
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;
  if (
    apply &&
    (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main")
  ) {
    console.error("--apply is allowed only in GitHub Actions on refs/heads/main.");
    process.exitCode = 1;
  } else {
    const environment = dryRun
      ? {
          ...process.env,
          NOTION_API_KEY: process.env.NOTION_API_KEY || "dry-run",
          NOTION_INTRO_PAGE_ID:
            process.env.NOTION_INTRO_PAGE_ID || "11111111111111111111111111111111",
          NOTION_DETAIL_PAGE_ID:
            process.env.NOTION_DETAIL_PAGE_ID || "22222222222222222222222222222222",
        }
      : process.env;
    syncProjectDocuments({ environment, dryRun })
      .then((result) => {
        for (const document of result.documents) {
          console.log(
            `${document.label}: ${result.dryRun ? "validated" : "synced"} (${document.characters} chars, sha256 ${document.sha256.slice(0, 12)}).`,
          );
        }
      })
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
