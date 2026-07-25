#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const INTRO_SECTIONS = [
  "30초 요약",
  "문제와 해결",
  "핵심 기능",
  "담당 범위",
  "핵심 사용자 흐름",
  "핵심 기술적 판단",
  "검증 현황",
  "현재 한계",
  "관련 문서",
];

const DETAIL_SECTIONS = [
  "문서 목적과 범위",
  "문제 맥락과 제약",
  "사용자와 핵심 흐름",
  "범위와 구현 현황",
  "시스템 아키텍처",
  "도메인 모델과 불변식",
  "핵심 기술 의사결정",
  "외부 연동과 실패 경계",
  "데이터 보호와 보안",
  "테스트와 검증 전략",
  "배포·운영·복구",
  "한계, 기술 부채, 다음 단계",
  "배운 점과 재설계 방향",
  "관련 문서",
];

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bntn_[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bsecret_[A-Za-z0-9_-]{16,}\b/g,
];

const LOCAL_PATH_PATTERNS = [
  /\b[A-Za-z]:\\Users\\[^\\\s]+/g,
  /\/(?:Users|home)\/[^/\s]+/g,
];

const PLACEHOLDER_MARKERS = [
  "[프로젝트명]",
  "[YYYY",
  "[현재 문서",
  "[사용자 유형]",
  "[핵심 기능]",
  "[기능]",
  "[상태]",
  "[항목]",
  "[내용]",
  "[컴포넌트]",
  "[엔터티]",
  "[외부 서비스]",
  "[문제 1]",
  "[명령 또는 CI]",
  "[기기/OS]",
  "{{",
  "TODO",
  "TBD",
  "FIXME",
];

function parseArguments(argv) {
  const options = {
    requireTracked: false,
    templates: false,
    files: [],
  };

  for (const argument of argv) {
    if (argument === "--require-tracked") options.requireTracked = true;
    else if (argument === "--templates") options.templates = true;
    else if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(argument);
  }

  if (options.files.length === 0) {
    options.files = options.templates
      ? [
          "docs/templates/PROJECT_INTRO_TEMPLATE.md",
          "docs/templates/PROJECT_DETAIL_TEMPLATE.md",
        ]
      : ["docs/Project_Intro.md", "docs/Project_Detail.md"];
  }

  return options;
}

function findRepositoryRoot(startDirectory) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return startDirectory;
  }
}

function sourceLine(text, index) {
  return text.slice(0, index).split("\n").length;
}

function extractHeadings(text) {
  return [...text.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map((match) => ({
    level: match[1].length,
    title: match[2].replace(/[*_`]/g, "").trim(),
    line: sourceLine(text, match.index),
  }));
}

function sectionTitleMatches(heading, requiredTitle) {
  return heading
    .replace(/^\d+(?:-\d+)?[.)]?\s*/, "")
    .toLocaleLowerCase()
    .includes(requiredTitle.toLocaleLowerCase());
}

function trackedByGit(repositoryRoot, targetPath) {
  const relativeTarget = path.relative(repositoryRoot, targetPath).replaceAll("\\", "/");
  try {
    const output = execFileSync("git", ["ls-files", "--", relativeTarget], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0;
  } catch {
    return false;
  }
}

function markdownTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<") && trimmed.includes(">")) {
    return trimmed.slice(1, trimmed.indexOf(">"));
  }
  return trimmed.split(/\s+["'(]/, 1)[0];
}

function validateLinks({ filePath, text, repositoryRoot, requireTracked, addIssue }) {
  const linkPattern = /(!?)\[([^\]]*)\]\(([^)\n]+)\)/g;

  for (const match of text.matchAll(linkPattern)) {
    const isImage = match[1] === "!";
    const label = match[2].trim();
    const target = markdownTarget(match[3]);
    const line = sourceLine(text, match.index);

    if (isImage && label.length === 0) {
      addIssue("error", filePath, line, "Image alt text must not be empty.");
    }

    if (
      target.length === 0 ||
      target.startsWith("#") ||
      /^(?:https?:|mailto:|tel:|data:)/i.test(target)
    ) {
      continue;
    }

    if (/^[A-Za-z]:[\\/]/.test(target) || target.startsWith("/")) {
      addIssue("error", filePath, line, `Publishable Markdown contains an absolute local path: ${target}`);
      continue;
    }

    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(target.split(/[?#]/, 1)[0]);
    } catch {
      addIssue("error", filePath, line, `Link target is not valid URI text: ${target}`);
      continue;
    }

    const resolvedTarget = path.resolve(path.dirname(filePath), decodedTarget);
    if (!existsSync(resolvedTarget)) {
      addIssue("error", filePath, line, `Relative link target does not exist: ${target}`);
      continue;
    }

    if (requireTracked && !trackedByGit(repositoryRoot, resolvedTarget)) {
      addIssue("error", filePath, line, `Relative link target is not tracked by Git: ${target}`);
    }
  }
}

export function validateProjectDocuments(rawOptions = {}) {
  const options = {
    requireTracked: Boolean(rawOptions.requireTracked),
    templates: Boolean(rawOptions.templates),
    files: rawOptions.files ?? [],
    cwd: rawOptions.cwd ?? process.cwd(),
  };
  const repositoryRoot = findRepositoryRoot(options.cwd);
  const issues = [];
  const addIssue = (severity, filePath, line, message) => {
    issues.push({
      severity,
      file: path.relative(repositoryRoot, filePath).replaceAll("\\", "/"),
      line,
      message,
    });
  };

  for (const inputFile of options.files) {
    const filePath = path.resolve(options.cwd, inputFile);
    if (!existsSync(filePath)) {
      addIssue("error", filePath, 1, "Document does not exist.");
      continue;
    }

    const text = readFileSync(filePath, "utf8");
    const lines = text.split(/\r?\n/);
    const headings = extractHeadings(text);
    const baseName = path.basename(filePath).toLocaleLowerCase();
    const isIntro = baseName.includes("intro");
    const isDetail = baseName.includes("detail");

    if (options.requireTracked && !trackedByGit(repositoryRoot, filePath)) {
      addIssue("error", filePath, 1, "Published document itself is not tracked by Git.");
    }
    if (text.includes("\uFFFD")) {
      addIssue("error", filePath, 1, "Document contains a Unicode replacement character.");
    }
    if (!text.endsWith("\n")) {
      addIssue("warning", filePath, lines.length, "Document should end with a newline.");
    }
    lines.forEach((lineText, index) => {
      if (/[ \t]+$/.test(lineText)) {
        addIssue("warning", filePath, index + 1, "Trailing whitespace.");
      }
    });

    const h1Headings = headings.filter((heading) => heading.level === 1);
    if (h1Headings.length !== 1) {
      addIssue("error", filePath, 1, `Expected exactly one H1 heading, found ${h1Headings.length}.`);
    }
    for (let index = 1; index < headings.length; index += 1) {
      if (headings[index].level > headings[index - 1].level + 1) {
        addIssue(
          "error",
          filePath,
          headings[index].line,
          `Heading level jumps from H${headings[index - 1].level} to H${headings[index].level}.`,
        );
      }
    }

    const requiredSections = isIntro ? INTRO_SECTIONS : isDetail ? DETAIL_SECTIONS : [];
    for (const requiredSection of requiredSections) {
      if (!headings.some((heading) => sectionTitleMatches(heading.title, requiredSection))) {
        addIssue("error", filePath, 1, `Required section is missing: ${requiredSection}`);
      }
    }

    for (const secretPattern of SECRET_PATTERNS) {
      for (const match of text.matchAll(secretPattern)) {
        addIssue("error", filePath, sourceLine(text, match.index), "Possible credential or secret value.");
      }
    }
    for (const localPathPattern of LOCAL_PATH_PATTERNS) {
      for (const match of text.matchAll(localPathPattern)) {
        addIssue(
          "error",
          filePath,
          sourceLine(text, match.index),
          "Publishable Markdown contains a user-specific local path.",
        );
      }
    }

    if (!options.templates) {
      if (isIntro && !/^\|\s*문서 기준\s*\|/m.test(text)) {
        addIssue("error", filePath, 1, "Project Intro must state one explicit document source boundary.");
      }
      if (isDetail && !/^\|\s*문서 진실 원천\s*\|/m.test(text)) {
        addIssue("error", filePath, 1, "Project Detail must identify the canonical document source.");
      }
      if (
        isDetail &&
        !/^\|\s*기능\s*\|\s*구현 상태\s*\|\s*검증 수준\s*\|/m.test(text)
      ) {
        addIssue(
          "error",
          filePath,
          1,
          "Project Detail must separate implementation status from verification level.",
        );
      }
      for (const marker of PLACEHOLDER_MARKERS) {
        const index = text.indexOf(marker);
        if (index >= 0) {
          addIssue("error", filePath, sourceLine(text, index), `Unresolved placeholder marker: ${marker}`);
        }
      }
      validateLinks({
        filePath,
        text,
        repositoryRoot,
        requireTracked: options.requireTracked,
        addIssue,
      });
    } else {
      const outputRelativeLink = /\]\(\.\.\/(?:Project_(?:Intro|Detail)|ARCHITECTURE|OPERATIONS_RUNBOOK|FUTURE_BACKLOG)/;
      const match = outputRelativeLink.exec(text);
      if (match) {
        addIssue(
          "error",
          filePath,
          sourceLine(text, match.index),
          "Template links must be relative to the generated docs/ file, not docs/templates/.",
        );
      }
    }
  }

  return {
    repositoryRoot,
    issues,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
  };
}

function printResult(result) {
  for (const issue of result.issues) {
    const label = issue.severity.toUpperCase();
    console.error(`${label} ${issue.file}:${issue.line} ${issue.message}`);
  }

  const checked = result.errorCount === 0 ? "passed" : "failed";
  console.log(
    `Project document validation ${checked}: ${result.errorCount} error(s), ${result.warningCount} warning(s).`,
  );
}

const isDirectExecution =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = validateProjectDocuments({ ...options, cwd: process.cwd() });
    printResult(result);
    if (result.errorCount > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
