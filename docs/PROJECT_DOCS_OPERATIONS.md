# 프로젝트 문서 운영 가이드

PriceTrace의 프로젝트 문서는 Git에 있는 Markdown을 원본으로 사용하고,
Notion의 전용 페이지를 읽기 전용 미러로 운영한다.

## 구성

```text
독립 notion-project-docs 플러그인
  └─ $maintain-project-docs: 저장소 근거를 조사하고 문서를 작성·검토

PriceTrace 저장소
  ├─ project-docs.config.json: 문서 키·경로·필수 섹션
  ├─ docs/Project_Intro.md: intro 원본
  ├─ docs/Project_Detail.md: detail 원본
  ├─ .github/project-docs/: 저장소에 고정한 검증·발행 런타임
  └─ .github/workflows/project-docs-notion.yml: 검증과 설정 기반 발행
```

플러그인은 Codex가 문서를 유지보수하는 작업 방식이고, 저장소의
`.github/project-docs/`는 GitHub Actions가 플러그인 설치 여부와 관계없이
동일하게 실행할 수 있는 고정 버전 런타임이다.

## 로컬 검증

문서를 수정한 뒤 다음 두 명령을 순서대로 실행한다.

```powershell
node .github/project-docs/validate-project-docs.mjs --config project-docs.config.json --require-tracked
node .github/project-docs/sync-project-docs-to-notion.mjs --config project-docs.config.json
```

두 번째 명령은 렌더링만 확인하는 dry-run이다. 로컬에서는 `--apply`를
사용하지 않는다.

## GitHub 설정

저장소 Settings에서 `notion-production` Environment를 만들고 다음 값을
Environment secret으로 등록한다.

- `NOTION_TOKEN`: 읽기·본문 수정 권한이 있는 Notion integration token
- `NOTION_PAGE_IDS_JSON`: 문서 키와 전용 Notion 페이지 ID의 대응표

PriceTrace의 대응표 형식은 다음과 같다.

```json
{"intro":"<Project Intro page ID>","detail":"<Project Detail page ID>"}
```

두 페이지를 integration에 공유하고, Environment에는 `main` 브랜치
제한을 설정한다. PriceTrace는 `publicationMode=on-main-push`이므로 required
reviewer를 두지 않는다. 페이지는 문서 미러 전용으로 사용하며
수동 메모, 하위 페이지, 데이터베이스를 섞지 않는다.

기존 Secret은 다음과 같이 마이그레이션한다.

| 기존 값 | 새 값 |
| --- | --- |
| `NOTION_API_KEY` | `NOTION_TOKEN` |
| `NOTION_INTRO_PAGE_ID` 또는 `NOTION_PAGE_ID` | `NOTION_PAGE_IDS_JSON`의 `intro` |
| `NOTION_DETAIL_PAGE_ID` | `NOTION_PAGE_IDS_JSON`의 `detail` |

새 흐름의 첫 발행이 확인되기 전에는 기존 Secret을 삭제할 필요가 없다.

## 검증과 발행

- Pull request와 `main` 이외의 push에서는 문서 검증과 Notion 렌더링
  dry-run만 수행한다.
- `main`에 설정·런타임·대상 문서 변경이 병합되면 검증 뒤 Notion
  발행을 자동 실행한다.
- 수동 복구가 필요하면 `main`에서 `operation=publish`,
  `confirmation=PUBLISH`로 다시 실행할 수 있다.
- 자동·수동 발행 모두 모든 대상 페이지를 먼저 조회한다. 하나라도
  접근할 수 없거나 완전하게 읽을 수 없으면 아무 페이지도 수정하지
  않는다.
- 사전 점검을 통과하면 각 전용 페이지 본문을 해당 Markdown 렌더링으로
  교체한다. 이미 같은 내용인 페이지는 건너뛴다.

PriceTrace는 문서 변경의 pull request 검토와 `main` 병합을 발행 승인
경계로 사용한다. 공개 플러그인의 기본값은 `manual`이며, 다른 저장소가
동일한 자동 동작을 원할 때만 `publicationMode=on-main-push`를 선택한다.

## 실패와 복구

- 사전 점검 실패: 페이지 공유와 ID 대응표를 수정한 뒤 다시 실행한다.
- 일부 페이지 발행 실패: Notion에서 직접 고치지 않고 같은 커밋을 다시
  실행한다. 이미 반영된 페이지는 건너뛰고 나머지 페이지가 수렴한다.
- 잘못된 내용 발행: Git의 Markdown을 수정·검토한 뒤 새 커밋을 발행한다.
- 토큰 노출: 즉시 폐기하고 새 토큰을 Environment secret에 등록한다.
