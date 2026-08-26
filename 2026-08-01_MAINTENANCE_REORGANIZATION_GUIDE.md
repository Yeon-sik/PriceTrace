# 2026-08-01 유지보수 중심 저장소 정리 가이드

> 목적: 현재 기능과 데이터 계약을 바꾸지 않고, 이후의 파일 정리·코드 분리·안전한 삭제 작업을 작은 단위로 실행하기 위한 기준 문서다.  
> 이번 작성 범위: 정적 분석과 가이드 작성만 수행했다. 코드 이동, 코드 수정, 파일 삭제, 의존성 변경, DB 변경, 배포는 수행하지 않았다.


## 2. 조사 경계와 증거 수준

| 항목 | 값 |
| --- | --- |
| 조사일 | 2026-08-01 |
| 기준 리비전 | `b7bc14acecfbfcd26b8e5b1d3d4f3f1c71ee6929` + dirty working tree |
| 브랜치 | `feat/standard-product-brands` |
| Codebase MCP 인덱스 | full mode, 2,249 nodes, 4,223 edges, 195 files |
| 주요 언어 | TypeScript 88, SQL 34, TOML 7, Java 3, YAML 3, CSS 2 files |
| 추가 정적 검증 | Git 추적·ignore 상태, 전체 참조 검색, TypeScript import 도달성 분석, 설정·워크플로우 확인 |
| 수행하지 않은 검증 | 브라우저, 실제 Supabase, Android 기기, Pages, Notion, 전체 테스트 실행 |

이 문서에서 사용하는 판단 표시는 다음과 같다.

- **저장소 확인**: 현재 파일·참조·설정·테스트·Git 상태에서 직접 확인했다.
- **강한 추론**: 정적 도달성과 대체 경로가 명확하지만 실제 런타임을 실행하지 않았다.
- **결정 필요**: 코드만으로 제품 의도나 외부 소비자를 확정할 수 없다.

파일이 존재한다는 사실은 실제 기능이 사용 중이라는 증거가 아니다. 반대로 로컬 import가 없다는 사실만으로 마이그레이션, 도구 규약 파일, 외부 호출 엔드포인트를 삭제해도 된다는 뜻도 아니다.

## 3. 현재 구조

### 3.1 실제 실행 흐름

```text
src/app/page.tsx
  ├─ PublicReceiptRepository
  │    └─ data/public/receipts + product-observations
  ├─ PublicOfficialChannelCatalogRepository
  │    └─ data/public/official-channel-catalog
  ├─ ProductBrowser / MarketBrowser / CartPage
  └─ AdminPage
       ├─ AdminQualityPanel
       └─ StandardProductWorkspace

private-data (Git 제외, 원본 증거)
  ├─ scripts/sync-public-receipts.ts
  └─ scripts/sync-public-official-channel-catalog.ts
       └─ data/public (검토 후 Git에 반영되는 공개 projection)

Supabase
  ├─ src/app의 여러 컴포넌트가 browser client를 직접 호출
  ├─ src/repositories의 일부 데이터 접근 객체
  ├─ supabase/functions
  └─ supabase/migrations
```

Codebase MCP 경계 집계는 `app → domain` 호출 78개, `app → lib` 호출 10개, `app → repositories` 호출 3개다. `getSupabaseBrowserClient`의 직접 호출자는 상품 브라우저, 카탈로그 관리자, 공식 상품 연결, 가격 모달, 관리자 품질 화면 등 여러 UI에 흩어져 있다.

이는 localStorage가 repository 뒤에 있는 현재 구조와 대비된다. localStorage 호출은 `cart.repository.ts`, `local-storage-settlement.repository.ts`, `official-product.repository.ts` 안에 한정되어 있다. Supabase 접근도 같은 방식으로 feature repository 또는 query service 뒤로 모으는 것이 우선이다.

### 3.2 유지할 경계

- `src/domain`: 금액·상품 식별·그룹핑·정규화·공개 데이터 검증 같은 순수 로직
- `src/repositories`: localStorage, 공개 JSON, Supabase, 파일 projection 같은 I/O
- `src/stores`: 사용자 변경 상태와 영속화 조정
- `src/app`: Next.js route 조립과 feature 진입점
- `scripts`: private 원본에서 public projection을 만드는 오프라인 명령
- `data/public`: 공개 가능한 생성 결과이며, 생성 스크립트와 검증이 소유
- `private-data`: 원본 증거이며 Git·브라우저 번들에서 격리
- `supabase/migrations`: 적용 순서가 의미 있는 변경 이력

## 4. 가장 먼저 해결할 구조적 충돌

`AGENTS.md`와 `ACCEPTANCE_CRITERIA.md`는 정산 중심 Milestone 1을 권위 범위로 지정한다. 반면 현재 페이지는 상품 탐색·표준 상품·공식 채널·Supabase 관리자 흐름을 중심으로 구성되어 있고, `docs/Project_Detail.md`도 이 충돌을 P0 기술 부채로 기록한다.

이 결정을 내리기 전에는 아래 정산 파일을 “화면에서 안 보인다”는 이유로 삭제하면 안 된다.

- `src/stores/settlement.store.ts`
- `src/repositories/settlement.repository.ts`
- `src/repositories/local-storage-settlement.repository.ts`
- `src/repositories/supabase-settlement.repository.ts`
- 관련 정산 도메인 테스트와 acceptance 문서

선택지는 두 개다.

1. **정산을 여전히 제품 핵심으로 유지**: 정산 UI를 복구하고 권위 문서를 유지한다.
2. **가격 탐색·표준 카탈로그로 제품 범위를 변경**: `AGENTS.md`, acceptance, task 문서를 먼저 갱신한 뒤 정산 전용 코드를 별도 삭제 PR에서 제거한다.

제품 범위 결정과 코드 삭제를 같은 커밋으로 처리하지 않는다.

## 5. 코드 분리 우선순위

### P0. `src/app/ProductBrowser.tsx`

**저장소 확인**

- 파일 557줄, `ProductBrowser` 본체 422줄
- cyclomatic complexity 27, cognitive complexity 46
- 상품 조회, Supabase RPC fallback, 공식/표준 매핑, 검색·필터·정렬, 페이지네이션, 장바구니, 상세·판매처 모달 상태를 함께 소유

**최소 분리안**

```text
src/features/product-browser/
  ProductBrowser.tsx                 # 조립만 담당
  use-product-catalog.ts             # 조회·RPC fallback·loading/error
  product-browser.selectors.ts       # 검색·필터·정렬·페이지 계산
  ProductFilters.tsx
  ProductResults.tsx
  StandardProductCard.tsx
  OfficialLinkedStandardCard.tsx
```

`src/domain/product-browser.ts`의 순수 함수는 유지하고, React state와 Supabase 응답 변환만 feature로 이동한다. 먼저 selector 특성화 테스트를 추가한 뒤 JSX를 분리한다.

### P0. `src/app/CatalogExplorerPanel.tsx`

**저장소 확인**

- 파일 399줄, `CatalogExplorerPanel` 본체 338줄
- cyclomatic complexity 34, cognitive complexity 38
- 조회, 선택 상태, 수정 modal, 장바구니, variant 삭제, mapping 삭제, Supabase 쓰기를 함께 소유
- `deleteSelectedVariant`와 `deleteSelectedMapping`은 Codebase MCP 유사도 0.969

**최소 분리안**

```text
src/features/catalog-admin/
  CatalogExplorerPanel.tsx
  use-catalog-explorer.ts
  catalog-admin.repository.ts
  CatalogList.tsx
  CatalogDetail.tsx
  CatalogMappingActions.tsx
```

두 삭제 함수는 공통 destructive-action helper로 합치되, 대상 table·확인 문구·성공 후 갱신 함수를 명시적으로 주입한다. 범용 추상화는 만들지 않는다.

### P0. `src/app/OfficialProductPanel.tsx`

**저장소 확인**

- 파일 579줄
- `StandardProductConnectionModal` 312줄, complexity 16/21
- 내부 `saveMapping` 242줄, complexity 16/21
- workspace 조회, 브랜드·규격 form, LinkProposal 검증, fingerprint 확인, RPC 실행, 쿠팡 가격, 대표 이미지 처리를 함께 소유
- 현재 dirty tree에서 `brand.ts`, `standard-product-registration.ts`, `official-image-approval.ts`로 도메인 추출이 진행 중이므로 이 파일은 현재 정리 작업의 직접 대상이 아니다.

**최소 분리안**

```text
src/features/standard-product-linking/
  StandardProductWorkspace.tsx
  StandardProductConnectionModal.tsx
  use-standard-product-link-form.ts
  standard-product-link.repository.ts
  StandardProductImageModal.tsx
  product-image-fields/
```

도메인 검증은 현재 추출 중인 `src/domain/*`에 남기고, RPC 호출·오류 변환만 repository로 이동한다. 승인 fingerprint와 대상 identity 비교는 UI 편의를 위해 약화하지 않는다.

### P1. `src/app/PriceTrendModal.tsx`

- 파일 199줄, modal 본체 133줄, complexity 9/11
- 공개 관측과 로그인 후 Supabase 관측을 한 컴포넌트에서 병합한다.
- `trend.repository.ts`와 `mergeTrendPoints` 순수 함수로 나눈다.
- 공개-only, 로그인+공식 연결, RPC 실패의 세 경로를 테스트한다.

### P1. 공개 데이터 도메인과 동기화 스크립트

| 현재 파일 | 확인된 책임 | 분리 방향 |
| --- | --- | --- |
| `src/domain/public-receipt.ts` (380줄) | schema, privacy validation, projection, hash/revision, index, 역매핑 | `public-receipt.schema.ts`, `.projection.ts`, `.privacy.ts`, `.index.ts` |
| `scripts/sync-public-receipts.ts` | source discovery, 검증, registry, stale 제거, check/write mode | `discover → transform → validate → emit` 단계 함수 |
| `scripts/sync-public-official-channel-catalog.ts` (386줄) | source schema, snapshot 탐색, 정규화, semantic check, 138줄 builder, check/write | pure builder와 filesystem CLI adapter 분리 |

public 파일은 임시 파일에 전체 결과를 만든 뒤 검증하고, 마지막에 교체하는 원자적 쓰기 방식을 사용한다. 일부 파일만 갱신된 상태를 허용하지 않는다.

### P1. 자동화 스크립트

| 현재 파일 | 확인된 병목 | 분리 방향 |
| --- | --- | --- |
| `.agents/skills/pricetrace-link-standard-products/scripts/validate-link-proposal.mjs` (735줄) | schema 정의와 semantic check, fingerprint, CLI가 한 파일 | `proposal-schema`, `semantic-validation`, `fingerprint`, `cli` |
| `.github/project-docs/sync-project-docs-to-notion.mjs` (551줄) | Markdown link 처리, Notion HTTP/retry, preflight, update, summary, CLI | `markdown-renderer`, `notion-client`, `sync-service`, `cli` |

LinkProposal 계약과 DB RPC 계약은 같은 의미를 유지해야 한다. schema를 파일별로 복사하지 말고 한 소스에서 import한다. Notion 스크립트는 `--apply`가 없는 dry-run을 기본값으로 유지한다.

### P2. 스타일

`src/app/page.module.css`는 59,191 bytes를 64개의 긴 줄에 담고 있고 대부분의 화면이 공유한다. 컴포넌트를 먼저 나눈 뒤 feature별 CSS Module을 옮긴다.

1. 포맷 변경만 하는 커밋
2. feature별 class 이동 커밋
3. desktop/mobile screenshot과 Playwright 회귀 확인

JSX 분리와 CSS 대이동을 한 커밋에서 동시에 하지 않는다.

## 6. 삭제 가이드

### 6.1 다음 정리 작업에서 바로 삭제 가능한 로컬 생성물

아래 항목은 Git 미추적·ignore 상태이며 명령으로 재생성된다. **이번 작업에서는 삭제하지 않았다.**

| 경로 | 현재 크기(조사 시점) | 재생성 경로 | 판단 |
| --- | ---: | --- | --- |
| `node_modules/` | 약 665 MB | `npm.cmd ci` 또는 `npm.cmd install` | 디스크 정리 시 삭제 가능 |
| `.next/` | 약 406 MB | `npm.cmd run dev` / `build` | 삭제 가능 |
| `out/` | 약 3.5 MB | `npm.cmd run build` | 삭제 가능; Pages와 Capacitor가 결과를 소비 |
| `test-results/`, `playwright-report/`, `coverage/` | 실행별 변동 | 테스트 명령 | 삭제 가능 |
| `tsconfig.tsbuildinfo` | 약 131 KB | `npm.cmd run typecheck` | 삭제 가능 |
| `android/.gradle/`, `android/build/`, `android/app/build/` | 약 21 MB | Gradle build | 삭제 가능 |
| `android/capacitor-cordova-android-plugins/` | 약 11 KB | Capacitor sync | sync 전제하에 삭제 가능 |
| `android/app/src/main/assets/public/` | 약 1.1 MB | `npm.cmd run android:sync` | sync 전제하에 삭제 가능 |
| `supabase/.temp/` | 약 4 KB | Supabase CLI | 삭제 가능 |

`private-data/`는 생성물이 아니다. 이 표의 정리 명령에 절대 포함하지 않는다.

### 6.2 현재 런타임에 영향 없이 제거 가능한 소스 후보

아래 판단은 Codebase MCP caller 확인과 ignore를 무시한 전체 참조 검색을 함께 사용했다. 실제 삭제는 현재 feature 작업을 완료한 뒤 별도 PR에서 한 묶음씩 수행한다.

| 후보 | 저장소 근거 | 삭제 범위 | 신뢰도 |
| --- | --- | --- | --- |
| `src/domain/catalog.ts` | 외부 import 0, 테스트 0, `PurchaseType` 정의는 현재 `src/domain/types.ts`가 사용 중 | 파일 1개 | 높음 |
| `src/repositories/official-product-discovery.repository.ts` | class caller 0, 정의 외 참조 0, 현재 공식 연결은 별도 수동 검토 흐름 사용 | repository 파일만; Supabase function은 유지 | 높음 |
| `src/repositories/supabase-production.repository.ts` | class caller 0, 정의 외 참조 0, 현재 `AdminQualityPanel`은 별도 직접 경로 사용 | repository 파일만; `production.ts`와 migration은 유지 | 높음 |
| Android `ExampleUnitTest.java` | `2 + 2 = 4`만 검사하는 Capacitor template | 예제 test 파일 | 높음 |
| Android `ExampleInstrumentedTest.java` | 실제 app ID는 `com.yeonsik.pricetracker`인데 template은 `com.getcapacitor.app`을 기대 | 예제 instrumented test 파일 | 높음 |

Android 예제 테스트를 삭제한 뒤에는 빈 `com/getcapacitor/myapp` 디렉터리도 제거한다. 이후 실제 Android smoke test를 별도 작업으로 추가한다.

### 6.3 통합 후 제거할 수 있는 중복 명령

- `dev`, `dev:public`, `dev:demo`는 현재 모두 `next dev`다.
- `sync:public-observations`와 `check:public-observations`는 receipt 명령의 alias다.

`dev:public`은 저장소 내부 참조가 없다. 그러나 외부 개인 스크립트 사용 여부는 코드로 확인할 수 없으므로, 한 번의 deprecation 안내 후 제거한다. `dev:demo`와 observation alias는 기존 로컬 문서·과거 검증 기록에 남아 있으므로 문서 명령을 먼저 갱신한다.

### 6.4 삭제 보류

| 경로 | 보류 이유 | 삭제 전 필요한 결정 |
| --- | --- | --- |
| `src/app/MarketAnalyticsPanel.tsx`, `market-analytics.ts`, `price-history.ts` | 앱 진입점에서 도달하지 않지만 테스트와 `Project_Detail`의 부분 구현 기록이 존재 | M5 기능 폐기 또는 재연결 결정 |
| `src/domain/standard-product.ts` | 앱에는 미연결이지만 활성 테스트가 있고 현재 dirty test와 겹침 | 새 표준 상품 모델로 완전 대체됐는지 확인 |
| 정산 store/repositories | 앱에는 미연결이지만 권위 문서의 핵심 범위 | 섹션 4의 제품 범위 결정 |
| `src/lib/supabase/database.types.ts` | 현재 client에서 미사용이지만 dirty tree에서 갱신 중이며 설계 문서가 typed client 적용을 요구 | 현재 기능 브랜치 완료 후 생성·사용 정책 결정 |
| `standard-product-queue-research.md` | 직접 참조는 없지만 조사 근거가 구조화된 proposal/registry로 이전됐는지 확인 불가 | 항목별 provenance 이전 후 archive 또는 삭제 |
| `OPENCLAW_PRICETRACE_RUNBOOK.md`, `HEARTBEAT.md`, `IDENTITY.md`, `SOUL.md`, `TOOLS.md`, `USER.md` | 저장소 코드가 아니라 OpenClaw workspace 계약일 수 있음 | OpenClaw 실제 loader 확인 |
| `skills/pricetrace-register-standard-products/` | 새 `.agents/skills/...`와 역할이 겹치지만 runbook이 기존 skill 이름을 사용 | OpenClaw 소비 경로를 새 skill로 이전 |
| ignored `docs/ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `DATA_POLICY.md`, `FUTURE_BACKLOG.md`, `RECEIPT_V2.md` | README·template에서 링크하며 일부는 로컬 권위 정보 | 내용 이전과 링크 수정 후 삭제 판단 |

### 6.5 삭제 금지

- 현재 수정·미추적 38개 경로
- `private-data/` 전체
- 검토되지 않은 `data/public/` 생성 결과
- `src/repositories/public-receipt-files.generated.ts`
- 적용 이력이 있는 `supabase/migrations/*`
- 현재 미추적 신규 migration과 `supabase/tests/`
- `.agents/skills/pricetrace-link-standard-products/*`
- `.codex/agents/*`, `.codex/config.toml`
- `project-docs.config.json`이 소유하는 `docs/Project_Intro.md`, `docs/Project_Detail.md`
- `.github/project-docs/*`, `.github/workflows/project-docs-notion.yml`

특히 migration은 “최종 schema만 남기면 된다”는 기준으로 삭제하거나 합치지 않는다. 원격 적용 이력과 새 환경 재현성을 모두 확인하기 전에는 과거 migration을 보존한다.

## 7. 문서 정리 방향

### 7.1 현재 문제

- README는 `docs/ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `DATA_POLICY.md`를 링크하지만 이 파일들은 Git에서 무시되고 추적되지 않는다.
- `AGENTS.md`, acceptance, task 문서는 로컬 권위 문서이지만 대부분 Git에서 무시된다.
- `docs/Project_Intro.md`와 `Project_Detail.md`는 Git→Notion 발행의 canonical source다.
- OpenClaw/Codex runtime 문서와 제품 문서가 루트에 함께 있다.
- `standard-product-queue-research.md`는 날짜가 있는 조사 메모지만 구조화된 provenance와 lifecycle이 없다.

### 7.2 목표 소유권

```text
README.md                       # 짧은 진입점과 문서 인덱스
GOAL.md                         # 제품 원칙
docs/
  overview/                     # 공개 소개
  architecture/                # 구조와 도메인 경계
  operations/                  # 배포·데이터 생성·Notion 운영
  decisions/                   # ADR
  research/                    # 만료일·소유자가 있는 조사 자료
  archive/                     # 더 이상 권위가 아닌 문서
.agents/, .codex/, skills/      # 에이전트 런타임 계약
OPENCLAW_PRICETRACE_RUNBOOK.md  # loader/운영 경로가 확정될 때까지 루트 유지
```

실제 이동 전에는 `project-docs.config.json`, GitHub Actions path filter, Markdown 상대 링크, OpenClaw skill 경로를 함께 갱신해야 한다. 문서 이동만 먼저 하면 Notion 발행과 agent 실행이 깨질 수 있다.

### 7.3 문서 삭제 규칙

문서는 아래 네 조건을 모두 충족할 때만 삭제한다.

1. 현재 canonical 문서가 같은 정보를 포함한다.
2. 코드·README·workflow·template·agent runtime의 참조가 0이다.
3. 법적·운영·데이터 provenance 증거가 아니다.
4. Git history만으로 복구해도 충분하다는 소유자 확인이 있다.

조사 메모는 바로 삭제하기보다 `owner`, `createdAt`, `expiresAt`, `result`, `migratedTo`를 먼저 기록한다. `migratedTo`가 확인된 뒤 archive 또는 삭제한다.

## 8. 단계별 실행 계획

### Phase 0 — 현재 작업 보호

1. 현재 38개 dirty 경로를 기능 작업으로 검토한다.
2. 기능 작업을 작은 커밋으로 완료하거나 안전하게 별도 보관한다.
3. 최신 기준 SHA를 기록한다.
4. 정리 전용 branch를 생성한다.

완료 조건: 정리 diff와 기능 diff가 섞이지 않는다.

### Phase 1 — 제품 범위 결정

1. 정산 M1 유지 또는 가격 탐색 중심 전환을 결정한다.
2. 권위 문서만 먼저 갱신한다.
3. 코드 삭제 없이 문서 review를 완료한다.

완료 조건: 어떤 dormant 코드가 “보존 기능”이고 어떤 코드가 “폐기 기능”인지 명시된다.

### Phase 2 — 안전 삭제

한 커밋에 한 후보군만 처리한다.

1. 전체 참조 검색
2. 파일 삭제
3. 관련 테스트·문서 참조 정리
4. lint → typecheck → unit test → build 순차 실행
5. diff 검토

첫 후보군은 `catalog.ts`, 두 미사용 repository, Android template test다. settlement, migration, public/private data는 포함하지 않는다.

### Phase 3 — UI 분리

순서는 `ProductBrowser` → `CatalogExplorerPanel` → `OfficialProductPanel`이다.

각 파일에서 다음 순서를 반복한다.

1. 기존 동작을 고정하는 selector/component/E2E 테스트 추가
2. 순수 계산 추출
3. I/O 추출
4. JSX component 추출
5. CSS 이동은 마지막 별도 커밋

완료 조건: 사용자 동작, 접근 가능한 이름, 오류 문구, focus/Escape, 모바일 layout이 유지된다.

### Phase 4 — 공개 데이터 파이프라인 분리

1. pure transform과 filesystem I/O를 분리한다.
2. check mode에서 파일을 쓰지 않는 테스트를 추가한다.
3. invalid input 한 건이 전체 출력을 보존하는지 검증한다.
4. stale 파일 제거는 새 결과 검증 후에만 실행한다.

완료 조건: public projection hash·revision·index·observation link가 기존 결과와 동일하다.

### Phase 5 — 문서와 자동화 정리

1. README broken/local-only link 정책 결정
2. canonical 문서와 archive 문서 분리
3. LinkProposal validator 분리
4. Notion sync script 분리
5. dry-run과 publication approval gate 회귀 테스트

완료 조건: Git Markdown이 계속 canonical이고, Notion은 generated mirror로만 동작한다.

### Phase 6 — CI 유지보수 게이트

현재 Pages workflow는 install과 build를 수행하지만 lint, typecheck, unit test를 명시적으로 gate하지 않는다. 별도 quality job 또는 workflow에서 다음을 순차 실행한다.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run check:public-receipts
npm.cmd run check:public-official-catalog
npm.cmd run build
```

E2E는 핵심 상품 탐색·장바구니·관리자 mock 경로를 PR gate로 두되, runner 종료 문제가 먼저 해결되어야 한다. Android 변경이 있는 PR만 `npm.cmd run android:debug`를 추가한다.

## 9. 공통 검증 체크리스트

### 변경 전

- [ ] `git status --short --branch` 기록
- [ ] 기준 SHA 기록
- [ ] private data가 diff/stage에 없는지 확인
- [ ] 현재 실패하는 검사가 있다면 cleanup과 분리해 기록

### 삭제 전

- [ ] `rg --no-ignore`로 코드·테스트·문서·workflow·runtime 참조 확인
- [ ] Codebase MCP inbound caller 확인
- [ ] dynamic import, CLI 경로, framework convention, 외부 endpoint 여부 확인
- [ ] 적용된 migration, generated registry, agent loader 파일이 아님을 확인
- [ ] 현재 dirty 파일이 아님을 확인

### 분리 후

- [ ] public API와 exported type 유지
- [ ] 저장 format과 `schemaVersion` 유지
- [ ] KRW 정수·상품 ID·배분 불변식 유지
- [ ] invalid import가 기존 상태를 변경하지 않음
- [ ] 공식 연결 승인·fingerprint gate 유지
- [ ] Supabase admin 판정은 `app_metadata.role` 유지
- [ ] `/PriceTrace` basePath와 Capacitor empty basePath 유지

### 제출 전

- [ ] lint, typecheck, unit test, data checks, build를 병렬이 아닌 순차 실행
- [ ] UI 변경 시 Playwright 실행
- [ ] Android 변경 시 debug APK build, 가능하면 기기 smoke test
- [ ] configured docs 변경 시 아래 두 명령 실행

```powershell
node .github/project-docs/validate-project-docs.mjs --config project-docs.config.json --require-tracked
node .github/project-docs/sync-project-docs-to-notion.mjs --config project-docs.config.json
```

- [ ] 마지막 `git diff --check`
- [ ] 의도한 파일만 stage
- [ ] 한 커밋이 한 구조 변경만 포함

## 10. 완료 기준

정리 작업은 파일 수가 줄었다고 완료가 아니다. 다음 상태가 모두 충족되어야 한다.

- route component는 조립과 데이터 연결에 집중한다.
- 큰 feature component는 조회, 계산, 쓰기, 표시 책임이 분리되어 있다.
- UI는 localStorage와 Supabase 세부 구현을 직접 소유하지 않는다.
- public/private 데이터 경계와 생성 ownership이 명확하다.
- 삭제 파일은 참조 0과 대체 경로가 증명되어 있다.
- 권위 문서와 실제 제품 범위가 일치한다.
- 모든 자동 검증과 필요한 runtime smoke test의 범위·미검증 영역이 명시된다.

이 가이드의 첫 실행 단위는 **현재 feature 작업 보호와 제품 범위 결정**이다. 그 전에는 settlement, migration, public/private data, agent runtime 파일을 삭제 대상으로 잡지 않는다.
