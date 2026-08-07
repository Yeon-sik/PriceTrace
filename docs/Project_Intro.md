# PriceTrace | 영수증 관측가를 검증 가능한 상품 기록으로 연결하는 웹 앱

> PriceTrace는 영수증의 실제 구매 가격과 공식 판매채널의 등재 가격을 출처·관측 시점·상품 코드와 함께 보존하고, 표준 상품군·정확한 판매 규격·장바구니·관리자 승인 흐름으로 연결합니다. 가격을 실시간 시세나 재고 보장이 아닌 **근거가 있는 관측가**로 다룹니다.

| 항목 | 내용 |
| --- | --- |
| 개발 기간 | 2026-07 ~ 진행 중 |
| 프로젝트 형태 | 개인 프로젝트 |
| 담당 범위 | 제품 범위, 도메인 모델, 프론트엔드, 데이터 계층, 테스트, Supabase migration, 배포·문서 자동화 |
| 현재 상태 | 공개 영수증·공식 카탈로그 탐색, 출처 보존 장바구니, 지문 기반 표준 상품 연결 승인 흐름 구현 |
| 기능 기준 | `3ed567e`; 게시 커밋은 Notion 미러 상단의 source commit으로 추적 |
| 주요 기술 | Next.js 15, React 19, TypeScript, Zod, Zustand, Supabase, Playwright, Capacitor |
| Demo | [GitHub Pages](https://yeon-sik.github.io/PriceTrace/) — URL 가용성은 2026-07-26 운영 검증, 최신 기능 smoke test는 별도 필요 |
| Repository | [GitHub](https://github.com/Yeon-sik/PriceTrace) |
| 상세 문서 | [Project_Detail.md](./Project_Detail.md) |

---

## 1. 30초 요약

- **문제**: 실제 구매가는 영수증에 남지만, 상품명만으로는 같은 상품·같은 규격인지 판정할 수 없고 판매처·시점별 비교 근거도 쉽게 사라집니다.
- **해결**: 영수증 공개 projection과 공식 판매채널 snapshot을 각각 검증하고, `sourceLabel + sourceProductCode`, 공식 namespace, 표준 상품군, 정확한 판매 규격을 분리합니다.
- **핵심 결과**: 공개 영수증 4건과 연결 관측 223건, PX 공식 판매채널 등재 2,269건을 정적 환경에서 탐색할 수 있으며, 영수증 관측과 공식 표시가를 출처가 다른 장바구니 항목으로 보존합니다.
- **안전 경계**: 표준 상품 연결은 이름 유사도만으로 확정하지 않습니다. 검토된 LinkProposal, 불변 입력·대상 지문, 관리자 승인, 원자적 Supabase RPC를 함께 요구합니다.

## 2. 문제와 해결

| 사용자 문제 | PriceTrace의 해결 방식 | 사용자 가치 |
| --- | --- | --- |
| 영수증 속 실제 구매가를 다시 찾기 어렵다 | 판매처·관측일·상품 코드와 함께 공개 관측을 구조화 | 가격의 출처와 시점을 잃지 않음 |
| 이름이 비슷하지만 규격이 다른 상품이 섞일 수 있다 | 표준 상품군과 정확한 판매 규격을 분리하고 검토된 mapping만 사용 | 거짓 최저가와 잘못된 추이를 줄임 |
| 공식 등재가 실제 구매·재고처럼 보일 수 있다 | `official-channel`과 `receipt-observation` provenance를 UI·장바구니에서 분리 | 공식 표시가와 실제 구매 관측을 구분 |
| 검토 결과가 브라우저 새로고침이나 수정 과정에서 바뀔 수 있다 | LinkProposal을 Zod 검증 후 대상 SHA-256 지문으로 localStorage 대기열에 저장 | 승인 대상을 다시 확인하고 중복·변조를 차단 |
| 원본 영수증을 그대로 공개하면 민감 정보가 노출될 수 있다 | private 원본과 strict allowlist 공개 projection을 분리 | 공개 재현성과 금지 정보 차단을 함께 유지 |

## 3. 핵심 기능과 결과

| 영역 | 구현 결과 | 근거와 상태 |
| --- | --- | --- |
| 공개 영수증 | 영수증별 JSON 4건과 인덱스, 연결 관측 223건을 Zod·privacy·revision 규칙으로 검증 | `check:public-receipts` 통과 |
| 공식 판매채널 | PX 등재 snapshot 2,269건을 검색·분류하고, 특정 지점 재고나 구매 사실과 구분 | `check:public-official-catalog` 통과 |
| 상품 탐색·가격 기록 | 검색·필터·정렬, 판매처 기록, 영수증 관측 이력, 표준/공식 상품 구분 | Vitest와 Playwright 검증, 최신 배포 smoke test는 별도 필요 |
| 장바구니 | 영수증 관측 상품과 공식 판매채널 상품을 provenance와 관측일을 보존해 수량·합계 계산 | cart domain test, localStorage repository, 공식 상품 E2E 통과 |
| 표준 상품 연결 | 검토 제안을 대상 지문 기준 대기열에 저장하고, 관리자 수정 시 지문·idempotency key를 재생성한 뒤 승인 RPC 실행 | proposal queue 6개 test, LinkProposal validator, strict registration test |
| 규격 계약 | 의류 사이즈, 단일/묶음 내용량, 복합 키트, 와이퍼 길이, 사용자 선택 exact variant를 명시적으로 검증 | TypeScript/Zod/SQL 회귀 테스트; 실사용 승인 시나리오는 추가 확인 필요 |
| Supabase schema | append-only migration을 연결 원격 DB에 `20260805011500`까지 적용 | 원격 migration 정합 확인; 전체 Auth·RLS·관리자 브라우저 E2E는 미검증 |
| 정산 | 배분·상태·백업 도메인과 저장소를 보존 | 단위 테스트 통과, 현재 공개 주 화면에는 연결되지 않음 |

수치가 없는 사용자 채택·정확도·매출·성능 효과는 주장하지 않습니다. 현재 결과는
저장소 코드, 로컬 검사, 연결 원격 migration, 과거 GitHub Pages·Notion 운영 실행처럼
확인 가능한 경계까지만 기술합니다.

## 4. 담당 범위와 기여

- **제품**: 가격을 현재가가 아닌 출처·시점이 있는 관측가로 정의하고, 공식 등재·구매 관측·표준 상품군·판매 규격을 분리했습니다.
- **프론트엔드**: 홈·상품·공식 카탈로그·장바구니·권한 기반 관리자 화면을 Next.js App Router에서 조립했습니다.
- **도메인/데이터**: 영수증 원본, 공개 관측, 공식 listing, 표준 상품군, exact variant, 승인 제안, 장바구니와 정산 상태의 진실 원천을 나눴습니다.
- **품질/운영**: Zod 경계 검증, Vitest, Playwright, append-only migration, GitHub Pages·Notion 자동화를 관리했습니다.
- **AI 활용**: 후보 조사와 초안을 가속하되, 상품 연결은 증거·지문·사람 승인·재조회 조건을 통과해야만 실행되도록 제한했습니다.

## 5. 핵심 사용자 흐름

```text
공개 영수증 JSON → strict 검증 → 영수증 관측 상품 탐색 ─┐
                                                       ├→ 출처 표시 장바구니 → 수량·예상 합계 유지
공식 판매채널 snapshot → strict 검증 → 공식 상품 탐색 ──┘

영수증 항목 + 공식 exact variant 근거
  → 검토된 LinkProposal
  → 대상 지문 기반 로컬 승인 대기열
  → 관리자 재검증·승인
  → 원자적 Supabase RPC와 결과 재조회
```

공식 판매채널 등재는 특정 지점의 판매·재고 또는 사용자의 구매 사실을 의미하지
않습니다. 공동 구매 정산도 위 탐색 흐름과 분리된 도메인 코드로 보존하며, UI에
연결되기 전에는 사용자 기능 완료로 표현하지 않습니다.

## 6. 핵심 기술적 판단

### 상품군·판매 규격·출처를 하나의 ID로 합치지 않는다

- **상황**: 같은 제품군 안에서도 용량·묶음·사이즈·구성품이 다르고, 공식 표시가와 실제 구매가는 증거 성격이 다릅니다.
- **선택**: `standard_products`는 상품군, `catalog_products`는 정확한 판매 규격으로 유지합니다. 영수증 판매처 identity는 `sourceLabel + sourceProductCode`, 공식 listing은 namespace와 상품 코드를 사용합니다.
- **연결 조건**: 상품명 유사도는 후보 탐색에만 사용하고, exact variant 근거·검토 상태·입력/대상 지문·명시적 승인을 실행 조건으로 둡니다.
- **결과**: 자동화율보다 감사 가능성과 잘못된 상품 병합 방지를 우선합니다.

추가 의사결정과 트레이드오프는 [Project Detail](./Project_Detail.md)에 정리했습니다.

## 7. 검증 현황

| 검증 항목 | 상태 | 마지막 확인 | 근거 |
| --- | --- | --- | --- |
| 공개 영수증 | 통과 | 2026-08-08 | `check:public-receipts`: 4건·관측 223건·index revision/link 검증 |
| 공식 카탈로그 | 통과 | 2026-08-08 | `check:public-official-catalog`: 2,269건·source SHA 검증 |
| ESLint / TypeScript | 통과 | 2026-08-08 | `npm.cmd run lint`, `npm.cmd run typecheck` |
| 단위·저장소 테스트 | 통과 | 2026-08-08 | `npm.cmd run test`: 29개 파일·161개 테스트 |
| LinkProposal validator | 통과 | 2026-08-08 | strict-v6 target alignment·exact-name·approval gate 회귀 테스트 |
| E2E | 통과 | 2026-08-08 | Chromium 9개 시나리오, 공식 상품 장바구니 포함, 정상 종료 |
| production build | 통과 | 2026-08-08 | Next.js static export |
| Android package | 로컬 검증 | 2026-08-08 | Capacitor sync·Gradle debug build 성공; 실제 기기 기능은 미검증 |
| Supabase 원격 schema | 부분 실환경 검증 | 2026-08-08 | migration local/remote 일치 `20260805011500`; DB lint schema error 없음, 기존 미사용 변수 warning 1건 |
| 문서 자동화 | 로컬·과거 운영 검증 | 2026-08-08 | 최신 skill 46 tests, 저장소 runtime installer dry-run 8/8 unchanged; 과거 자동 발행 [run 30198781222](https://github.com/Yeon-sik/PriceTrace/actions/runs/30198781222) |
| GitHub Pages | 과거 운영 검증 | 2026-07-26 | [run 30198781229](https://github.com/Yeon-sik/PriceTrace/actions/runs/30198781229) build·deploy 성공; `3ed567e` 기능 smoke test는 미실행 |
| Notion 미러 | 과거 운영 검증 | 2026-07-26 | Intro·Detail source commit·fingerprint 재조회; 이번 문서 revision은 병합 후 재검증 대상 |

## 8. 현재 한계와 다음 단계

- **원격 기능 검증**: migration 적용은 확인했지만 관리자 로그인, RLS 거부, LinkProposal 승인·재조회 전체 흐름은 실제 브라우저에서 아직 검증하지 않았습니다.
- **배포 검증**: 로컬 build와 E2E는 통과했지만 `3ed567e` 기준 GitHub Pages 기능 smoke test는 별도입니다.
- **모바일 검증**: Android debug APK 생성은 확인했지만 실제 기기에서 공식 상품·관리자 흐름을 실행하지 않았습니다.
- **데이터 확장**: 규격 근거가 불완전하거나 후보가 충돌하는 상품은 예외 목록에 남기며 억지로 연결하지 않습니다.
- **다음 단 하나**: 배포된 관리자 화면에서 승인 제안 한 건을 실행하고, 표준 상품군·exact variant·판매처 mapping·감사 기록을 재조회합니다.
- **하지 않는 것**: 실시간 재고·현재가 보장, 검증 전 자동 상품 연결, 근거 없는 단위·규격 보정은 구현하지 않습니다.

## 9. 관련 문서

- [Project Detail](./Project_Detail.md): 아키텍처, 도메인 경계, 검증 이력, 운영 위험
- [Operations Runbook](./OPERATIONS_RUNBOOK.md): 원격 운영 보호 장치와 복구 절차
- [Official Product Discovery](./OFFICIAL_PRODUCT_DISCOVERY.md): 공식 상품 후보 검색 연동
- [프로젝트 문서 운영](./PROJECT_DOCS_OPERATIONS.md): Git Markdown → Notion 미러 정책
- [범용 Intro 템플릿](./templates/PROJECT_INTRO_TEMPLATE.md)
- [범용 Detail 템플릿](./templates/PROJECT_DETAIL_TEMPLATE.md)
