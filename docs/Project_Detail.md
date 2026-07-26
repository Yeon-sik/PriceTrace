# PriceTrace | Project Detail

> 이 문서는 PriceTrace의 구현 근거, 실제 코드 경계, 검증 결과와 미검증 영역을 설명합니다. 빠른 소개는 [Project_Intro.md](./Project_Intro.md)를 참고합니다.

| 항목 | 내용 |
| --- | --- |
| 문서 상태 | Active |
| 적용 범위 | 제품 코드 `5d6b8e1`; 운영 자동화 기준 `f227699` |
| 최종 갱신 | 2026-07-26T18:57:30+09:00 |
| 최종 검증 기준 | `f227699`; GitHub Actions·GitHub Pages·Notion 미러의 2026-07-26 실행 근거 |
| 문서 진실 원천 | Git 저장소의 `docs/Project_Detail.md`; Notion은 읽기 전용 미러 |
| 담당자 | Yeon-sik (개인 프로젝트) |

---

## 1. 문서 목적과 범위

### 포함

- 공개·로컬 private 영수증의 검증과 도메인 변환
- 상품 검색·필터·정렬, 마트 탐색, 관측가 이력, 장바구니
- 표준 상품·판매처 매핑과 관리자용 시장 관측가 입력 경계
- 정산 도메인·백업·원격 동기화 코드의 현재 연결 상태
- 테스트, 정적 배포, 데이터 보호, 원격 운영의 확인된 근거와 미검증 위험

### 제외

- OCR 제공자 선정과 자동 추출 정확도
- 실시간 재고·현재 판매가 보장과 지도 기반 매장 탐색
- 검증되지 않은 검색 결과의 자동 상품 연결
- Android 스토어 출시와 Supabase 실환경 운영 완료 주장

PriceTrace의 가격은 실시간 시세가 아닙니다. 영수증 또는 관리자가 검증해
기록한 시점의 **관측 가격**만 표시합니다.

## 2. 문제 맥락과 제약

### 문제

영수증의 실제 구매 가격은 판매처·구매 시점·상품 규격 맥락을 잃기 쉽습니다.
같은 이름의 상품도 용량과 묶음 수가 다를 수 있으므로, 이름만으로 가격을
합치면 잘못된 비교가 됩니다. 실제 원본 영수증에는 공개하면 안 되는 정보가
들어 있을 수 있습니다.

### 핵심 제약

- 정적 GitHub Pages UI에는 실제 영수증·service role·외부 API 비밀값을 넣지 않습니다.
- 공개 기본 데이터는 최소 필드의 관측 projection JSON이며, private 영수증은 로컬 개발 서버 경로에서만 읽습니다.
- Supabase 스키마·RLS·Edge Function은 저장소에 있으나 배포 환경의 권한과 장애 처리는 이 문서 작성 시점에 검증하지 않았습니다.
- 현재 탐색 UI와 기존 공동 정산 module은 분리되어 있으며, 후자는 주 화면에서 노출되지 않습니다.

### 성공 기준

| 기준 | 측정 또는 판정 방법 |
| --- | --- |
| 관측 데이터 무결성 | Zod 스키마, 수량·금액 불변식, 원본 구매번호 보존 테스트 |
| 탐색과 장바구니 | 상품 필터·그룹화·수량 저장의 도메인/저장소 테스트와 브라우저 E2E |
| 비교 신뢰성 | 판매처 상품 코드와 검토된 매핑을 통한 비교 경계 |
| 공개 안전성 | `private-data/`·환경 파일 Git 제외, 공개 fixture 분리 |

## 3. 사용자와 핵심 흐름

| 사용자 | 목표 | 핵심 흐름 |
| --- | --- | --- |
| 장보기 사용자 | 실제 구매 관측가를 찾아 비교 | 영수증 로드 → 상품 검색·필터 → 판매처·가격 이력 확인 |
| 장보기 사용자 | 선택 품목의 예상 비용 확인 | 상품 선택 → 수량 입력 → 장바구니 합계·새로고침 복원 |
| 관리자 | 표준 상품과 판매처 관측을 검토 | 로그인 → 표준 상품/변형/매핑 검토 → 검증된 시장 관측가 등록 |
| 공동 구매자 | 수량과 정산 상태 관리 | 도메인/store는 존재하나 현재 공개 UI 흐름에는 미연결 |

```text
Demo JSON 또는 local private receipt server
  → Zod 검증과 Receipt mapper
  → 상품 그룹화·가격/카탈로그 도메인
  → Next.js 상품·마트·장바구니 UI
  → Cart localStorage

인증된 관리자 경계
  → Supabase Auth / PostgreSQL / RLS / Edge Function
```

## 4. 범위와 구현 현황

구현 상태와 검증 수준을 독립적으로 기록합니다.

- **구현 상태**: 구현 완료 / 부분 구현 / 계획
- **검증 수준**: 실환경 검증 / 저장소 검증 / 사용자 확인 / 미검증

| 기능 | 구현 상태 | 검증 수준 | 환경·기준 | 확인된 근거 | 남은 위험 |
| --- | --- | --- | --- | --- | --- |
| 공개 관측 JSON 로드와 상품 탐색 | 구현 완료 | 저장소 검증 | `5d6b8e1` + 2026-07-26 로컬 | `PublicObservationRepository`, projection test, 공개 관측 검사, build | 배포 UI의 기능별 브라우저 smoke test 미실행 |
| 검색·필터·정렬·마트 탐색 | 구현 완료 | 저장소 검증 | `5d6b8e1` + 2026-07-26 로컬 | `ProductBrowser`, `MarketBrowser`, `PriceTrendModal`, unit/build | 실제 사용성과 모바일 흐름 미검증 |
| 장바구니와 예상 합계 | 구현 완료 | 저장소 검증 | `5d6b8e1` + 2026-07-26 로컬 | `cart.store`, repository test, Playwright 시나리오 1건 성공 | E2E runner 종료 실패, 다기기 동기화 없음 |
| 수령자·배분·정산·백업 | 부분 구현 | 저장소 검증 | 2026-07-26 로컬 전용 테스트 포함 | settlement domain/store와 불변식 test | 현재 주 화면 미연결, clean clone 재현성 부족 |
| 가격 이력·판매처 비교 | 부분 구현 | 저장소 검증 | 2026-07-26 로컬 전용 테스트 포함 | price-history, canonical-price, market-analytics test | 운영 관측 데이터와 UX 미검증 |
| 표준 카탈로그·상품 매핑 | 부분 구현 | 저장소 검증 | `5d6b8e1` + 2026-07-26 로컬 | 마이그레이션, 관리자 UI, mapping domain | 실제 관리자 권한·검토 운영 미검증 |
| Supabase 인증·원격 저장 | 구현 완료 | 저장소 검증 | `5d6b8e1` | browser repository, Auth UI, RLS migration | 실제 프로젝트 연결·권한·장애 UX 미검증 |
| private 영수증 개발 모드 | 구현 완료 | 저장소 검증 | `5d6b8e1` | `dev-private.ts`, local receipt server, response schema | 이번 검증에서 private 서버 미실행 |
| GitHub Pages 정적 배포 | 구현 완료 | 실환경 검증 | `f227699` + 2026-07-26 GitHub Pages | Actions [run 30197236649](https://github.com/Yeon-sik/PriceTrace/actions/runs/30197236649) build·deploy 성공, 배포 URL HTTP 200 | 배포 UI의 기능별 브라우저·모바일 smoke test 미실행 |
| 승인형 Notion 문서 게시 | 구현 완료 | 실환경 검증 | `a5abec7` + 2026-07-26 GitHub Actions/Notion | [run 30196804832](https://github.com/Yeon-sik/PriceTrace/actions/runs/30196804832), Intro·Detail sync 성공, 두 미러의 원본 링크·fingerprint 재조회 | 정기 드리프트 감지는 미구현 |
| OCR 자동 추출 | 계획 | 미검증 | 해당 없음 | 구현 근거 없음 | 제공자·정확도·검토 UX 미확정 |

## 5. 시스템 아키텍처

```text
private-data/receipt_*.json
    ├→ local private server → private Receipt projection ─┐
    └→ explicit sync command → public observation JSON ───┤
                                                          ├→ ProductBrowser / MarketBrowser / CartPage
                                                          └→ PriceTrendModal

public observation JSON → strict Zod validation → public product listings

Cart store → LocalStorageCartRepository

Auth/Admin UI → Supabase browser client → PostgreSQL + RLS
                                         → official-product-search Edge Function

Settlement store → LocalStorage/Supabase settlement repository
                (현재 공개 UI에는 연결되지 않음)
```

### 컴포넌트 책임

| 컴포넌트 | 책임 | 의존성 | 실패 시 영향 |
| --- | --- | --- | --- |
| `src/app/` | 상품·마트·장바구니·관리자 화면 조립 | domain, stores, repositories | 탐색/입력 UI 불가 |
| `src/domain/` | 영수증 변환, 상품 그룹화, 가격 계산, 불변식 | React 밖의 순수 로직 | 데이터 해석·합계 신뢰성 저하 |
| `src/stores/cart.store.ts` | 장바구니 상태와 hydration | cart repository | 선택 수량 복원 실패 |
| `src/stores/settlement.store.ts` | 배분·상태·백업·동기화 상태 | settlement repositories | 현재는 UI 미연결, 재연결 시 정산 기능 영향 |
| `src/repositories/` | JSON, localStorage, Supabase 경계 | Zod, browser APIs, Supabase | 데이터 로드·저장·권한 처리 실패 |
| `supabase/` | 스키마, RLS, Edge Function | Supabase 배포 환경 | 원격 관리자·동기화 기능 실패 |

UI는 외부 JSON과 localStorage를 직접 파싱하지 않습니다. 입력은 repository/mapper
경계에서 검증하고, 합계·상품 그룹·상태 판정은 React 밖에서 계산합니다.

## 6. 도메인 모델과 불변식

### 핵심 엔터티

| 엔터티 | 식별자 또는 경계 | 진실 원천 | 변경 가능 여부 |
| --- | --- | --- | --- |
| Receipt / ReceiptItem | `receiptId:lineId` | 원본 JSON 또는 원격 영수증 | 원본 구매 사실은 불변 |
| ProductGroup | catalog mapping이 있으면 catalog ID, 없으면 판매처·상품 코드·정규화 이름 조합 | 영수증 관측값에서 계산 | 계산값 |
| Cart lines | 상품 그룹 ID | localStorage | 가변 |
| Catalog / mapping | 카탈로그 namespace와 검토 상태 | Supabase의 검토된 매핑 | 검토 후 변경 |
| Market price observation | 판매처 URL·검증 상태·관측일 | 관리자 검증 입력 | 관측 이력 |
| Settlement state | UUID | localStorage 또는 사용자 소유 원격 데이터 | 가변, 현재 UI 미연결 |

### 불변식

1. `unitPriceKrw >= 0`이며 금액은 KRW 정수로 계산합니다.
2. 구매·배분 수량은 양의 정수이고, 배분 합은 구매 수량을 초과할 수 없습니다.
3. `totalPriceKrw = unitPriceKrw × purchasedQuantity`를 유지합니다.
4. 친구별 합계와 미배분 수량은 배분 내역으로 계산하며 별도 합계를 진실 원천으로 저장하지 않습니다.
5. 원본 `ReceiptItem` ID는 상품명이 아닌 영수증 ID와 원본 line ID로 생성하고, 원본 구매번호 배열과 원본 증거 행을 보존합니다.

공유 카탈로그 비교에는 `catalog_namespace`, 판매처 상품 코드, 정규화한 상품명
등의 검토된 연결을 사용합니다. 공식·표준 상품 연결은 이보다 강한 사람 검토
경계이며, 규격이나 묶음 수가 다르면 별도 변형으로 유지합니다.

현재 `ProductGroup` ID는 상품 코드가 있어도 정규화 이름을 포함하고, 코드가 없으면
판매처와 정규화 이름에 의존합니다. 따라서 “상품명을 식별자로 사용하지 않는다”는
목표는 원본 항목에는 충족하지만 화면 그룹에는 아직 충족하지 못한 기술 부채입니다.

## 7. 핵심 기술 의사결정

### 결정 1. 공개 관측 projection과 private 원본을 분리한다

- **상황**: 실제 영수증에는 거래번호·주소·결제 정보 등 공개하면 안 되는 값이 있을 수 있습니다.
- **제약**: 정적 배포는 로컬 파일이나 비밀값을 숨겨 주지 않습니다.
- **검토한 대안**: 실제 원본을 데모로 사용, 모든 데이터를 원격 DB에 올리기.
- **선택**: `data/public/product-observations.v1.json`을 기본으로 쓰고, private 모드는 로컬 개발 서버 응답이 정상일 때만 우선합니다.
- **근거**: 공개 재현성과 원본 보호를 동시에 유지하며, private 파일이 없는 정적 환경에서도 상품 목록을 보장합니다.
- **비용과 위험**: 공개 데이터는 판매처를 채널 단위로 축약하고 날짜를 월 단위로 낮추므로 지점별·일별 분석에는 사용할 수 없습니다.
- **재검토 조건**: 업로드·동기화 요구가 확정되면 서버 측 접근 제어와 감사 흐름을 먼저 검증합니다.

### 결정 2. 원본 항목 식별과 판매처 간 비교를 분리한다

- **상황**: 이름이 같아도 용량·규격·묶음 수가 다른 상품이 존재합니다.
- **제약**: 잘못된 병합은 거짓 최저가와 잘못된 가격 추이를 만듭니다.
- **선택**: 원본 항목은 `receiptId:lineId`로 보존하고, 판매처 상품 코드와 카탈로그 namespace를 유지하며, 검토된 mapping만 판매처 간 통합 비교에 사용합니다.
- **결과**: 자동화율은 낮지만 불확실한 연결을 확정 데이터로 만들지 않습니다.
- **비용과 위험**: 현재 화면 그룹 키에는 정규화 이름이 포함되며, 상품 코드가 없으면 이름이 fallback이 됩니다.
- **재검토 조건**: 라벨된 검토 결과로 자동 매핑의 오류율을 측정할 수 있을 때 보조 자동화를 검토합니다.

### 결정 3. 정적 UI와 권한·비밀값 경계를 분리한다

- **상황**: GitHub Pages는 정적 UI에 적합하지만 service role이나 외부 API 키를 보관할 수 없습니다.
- **선택**: UI는 static export로, 인증·RLS·외부 공식 상품 검색은 Supabase 경계로 분리했습니다.
- **결과**: 정적 UI에서 비밀값을 제거할 수 있습니다.
- **비용과 위험**: 배포된 Supabase 설정, RLS, 요청 제한, 장애 UX는 아직 실환경에서 확인해야 합니다.

### 결정 4. 정산 코드를 보존하되 현재 공개 흐름과 분리한다

- **상황**: 초기 로컬 정산 MVP의 도메인·백업·동기화 코드가 존재하지만 현재 UI는 상품 탐색과 장바구니에 집중합니다.
- **선택**: 정산 불변식과 store는 유지하고, 현재 문서에서는 UI 완성으로 표현하지 않습니다.
- **결과**: 코드 자산을 보존하면서도 사용자 기능 여부를 과장하지 않습니다.
- **재검토 조건**: 정산 화면·접근성·E2E까지 연결할 때 다시 공개 기능으로 승격합니다.

## 8. 외부 연동과 실패 경계

| 연동 대상 | 목적 | 인증/비밀값 | 실패 처리 | 재시도/제한 | 마지막 실환경 확인 |
| --- | --- | --- | --- | --- | --- |
| Supabase Auth | 사용자·관리자 식별 | publishable key만 브라우저에 노출 | 인증되지 않으면 관리자 UI를 노출하지 않음 | 실환경 정책 미검증 | 미검증 |
| Supabase PostgreSQL/RLS | 카탈로그, 관측, 사용자 상태 | service role은 서버 전용 | 로컬 상태를 무조건 덮어쓰지 않음 | 운영 권한·장애 UX 미검증 | 미검증 |
| Edge Function | 공식 상품 후보 검색 | 함수 Secret | 검색 결과를 확정 상품으로 저장하지 않음 | 제공자 응답·제한 미검증 | 미검증 |
| GitHub Pages | 정적 UI 배포 | 비밀값 없음 | 원격 기능 장애와 UI 가용성을 분리 | main build·deploy 후 URL HTTP 확인 | 2026-07-26 `f227699`, run `30197236649`, HTTP 200 |
| Notion API | Intro/Detail 읽기 전용 미러 | `notion-production` Environment Secret | 두 페이지 사전 GET, 부분 실패 집계, 원본 Git 링크 유지 | 요청 30초 timeout, 429·5xx·network 최대 4회 | 2026-07-26 `a5abec7`, run `30196804832`, 두 페이지 재조회 |

## 9. 데이터 보호와 보안

| 경계 | 정책 | 검증 방법 |
| --- | --- | --- |
| 실제 영수증 | `private-data/`에만 두고 Git·공개 번들에서 제외 | `.gitignore`, private dev server 경로 |
| 공개 데이터 | 월·판매 채널·상품·관측가 최소 projection만 Git 추적 | strict Zod schema, 금지 필드 회귀 테스트, `check:public-observations` |
| 외부 JSON | 전체 Zod 검증 뒤 도메인 변환 | schema/repository test |
| 사용자 권한 | `auth.uid()` 소유권과 관리자 metadata를 사용 | RLS migration 존재, live test 미실행 |
| 비밀값 | service role·외부 API 키를 `NEXT_PUBLIC_*`에 두지 않음 | Edge Function/Actions 경계 검토 |

현재 트리에서는 실제 영수증 형태의 `data/demo/receipt_001.json`을 제거했습니다. 다만
과거 Git commit과 이미 복제된 저장소에는 내용이 남아 있을 수 있으므로, 이력 재작성과
강제 push는 별도 승인·백업·협업자 조율이 필요한 미완료 보안 작업입니다.

주요 잔여 위험은 배포된 정책이 로컬 코드와 다를 수 있다는 점입니다. 마이그레이션
파일과 browser client의 존재는 운영 권한 검증을 대체하지 않습니다.

## 10. 테스트와 검증 전략

| 수준 | 도구 | 검증 대상 | 현재 상태 |
| --- | --- | --- | --- |
| 정적 분석 | ESLint | `src/` 코드 규칙 | 통과 |
| 타입 검사 | TypeScript strict | 타입·경계 | 통과 |
| 단위/저장소 테스트 | Vitest | 영수증, 공개 projection, 상품 탐색, 카탈로그, 장바구니, 정산 불변식 | 로컬 16개 파일·41개 테스트 통과; 이 중 일부 테스트·설정은 Git ignored |
| E2E | Playwright | 공개 관측 상품 탐색 → 장바구니 → 새로고침 복원 | Chromium 시나리오 성공, runner 미종료로 명령 timeout |
| production build | Next.js | static export | 통과 |
| 문서 자동화 | Node test/validator | 템플릿, 링크, Notion 사전검증·재시도·멱등성 | validator 0 errors/0 warnings, 독립 배포본 테스트 22건 통과 |
| GitHub Pages 운영 | GitHub Actions/HTTP | static export 배포와 URL 가용성 | `f227699` 배포 성공, HTTP 200 |
| Supabase 운영 | Supabase | 권한·비밀값·원격 장애 흐름 | 미검증 |
| 기존 문서 동기화 | GitHub Actions/Notion | Intro·Detail 두 페이지 교체 | 2026-07-25 사용자 확인 |
| 승인형 문서 동기화 | GitHub Actions/Notion | 사전검증 뒤 두 페이지 교체와 응답 검증 | `a5abec7`에서 승인·sync·재조회 검증 |

### 검증 이력

| 일시 | 기준 커밋 | 명령/환경 | 결과 | 근거 위치 | 미검증 항목 |
| --- | --- | --- | --- | --- | --- |
| 2026-07-26 | `5d6b8e1` + 문서 작업 트리 | `npm.cmd run check:public-observations` | exit 0, 188건·금지 필드 없음·revision 검증 통과 | 현재 로컬 실행 로그 | 실제 Pages 배포 |
| 2026-07-26 | 동일 | `npm.cmd run lint` / `npm.cmd run typecheck` | 모두 exit 0 | 현재 로컬 실행 로그 | clean clone의 ignored 설정 재현 |
| 2026-07-26 | 동일 | `npm.cmd run test` | exit 0, 16 files / 41 tests | 현재 로컬 실행 로그 | 5개 테스트 파일과 일부 설정이 Git ignored |
| 2026-07-26 | 동일 | `npm.cmd run build` | exit 0, static export | 현재 로컬 실행 로그 | 실제 Pages 배포 |
| 2026-07-26 | 동일 | private server 미실행 + `npm.cmd run test:e2e` | 시나리오 1건 1.3초 성공 후 runner 미종료, 180초 timeout·exit 124 | 현재 로컬 실행 로그 | clean exit 원인, 모바일 실기기 |
| 2026-07-26 | 동일 | docs validator / 독립 배포본 test / dry-run | 0 errors·0 warnings / 22 tests / 성공 | 현재 로컬 실행 로그 | GitHub Actions runner와 Notion 권한 |
| 2026-07-26 | `a5abec7` | Actions [run 30196804832](https://github.com/Yeon-sik/PriceTrace/actions/runs/30196804832), `publish` + Environment 승인 | Intro 5,511자·Detail 14,814자 sync 성공; 두 페이지의 source commit·fingerprint 재조회 | GitHub Actions 로그와 Notion connector 조회 | 장기 드리프트·Notion UI별 시각 차이 |
| 2026-07-26 | `f227699` | Actions [run 30197236636](https://github.com/Yeon-sik/PriceTrace/actions/runs/30197236636) / Pages [run 30197236649](https://github.com/Yeon-sik/PriceTrace/actions/runs/30197236649) / HTTP HEAD | 문서 validate 성공, Pages build·deploy 성공, URL HTTP 200, Action 런타임 경고 없음 | GitHub Actions와 배포 URL | 기능별 브라우저·모바일 smoke test |

## 11. 배포·운영·복구

```text
문서·코드 변경
  → main push
  → GitHub Actions
  → Next.js static export
  → GitHub Pages

Project_Intro/Project_Detail 변경
  → PR/push 문서 검증과 Notion 렌더링 dry-run
  → main에서 수동 publish 요청 + PUBLISH 확인
  → notion-production Environment 승인
  → Notion 두 페이지 GET preflight
  → 서로 다른 두 페이지 replace_content
  → 응답 ID·완전성 검증과 Actions summary
```

- `deploy-pages.yml`은 `main` push 또는 수동 실행에서 static export를 배포하도록 구성돼 있습니다.
- 기존 `sync-project-docs-to-notion.yml`의 자동 반영은 2026-07-25 사용자가 확인했으며, 2026-07-26 `a5abec7`에서 범용 설정 기반의 `project-docs-notion.yml`로 교체했습니다.
- 새 workflow는 `main` push만으로 Notion을 수정하지 않습니다. `publish` 선택, 정확한 `PUBLISH` 입력, `notion-production` Environment 승인, canonical branch 검사를 모두 통과해야 합니다.
- 첫 승인형 발행은 2026-07-26 Actions [run 30196804832](https://github.com/Yeon-sik/PriceTrace/actions/runs/30196804832)에서 성공했고, Intro·Detail 미러를 별도 조회해 `a5abec7` 원본 링크와 fingerprint를 확인했습니다.
- GitHub Pages는 `f227699`의 [run 30197236649](https://github.com/Yeon-sik/PriceTrace/actions/runs/30197236649)에서 build·deploy가 성공했고 배포 URL이 HTTP 200으로 응답했습니다.
- 저장소 Markdown이 진실 원천이고 Notion 본문은 읽기 전용 미러입니다. 두 페이지 쓰기는 트랜잭션이 아니므로, 부분 실패 시 같은 커밋을 재실행해 수렴시킵니다.
- 구체적인 Secret 마이그레이션과 첫 발행 절차는 `docs/PROJECT_DOCS_OPERATIONS.md`에 기록합니다.
- 잘못된 정산 백업 import는 schema 검증 전에 기존 상태를 바꾸지 않도록 설계돼 있습니다. 다만 현재 UI에서 복원 흐름은 노출되지 않습니다.
- 원격 데이터 복구는 Supabase Dashboard backup 확인이 런북에 기록돼 있으나, 복구 리허설은 미실행입니다.

## 12. 문제 해결 사례

### 공개 데이터 전환 뒤 E2E 고정 기대값이 어긋남

- **증상**: 기존 시나리오가 5초 안에 이전 공개 영수증 요약 문구를 찾지 못해 실패했습니다.
- **재현**: 홈에서 "상품 둘러보기"를 누른 뒤 `3개 공식 연결 상품 · 3개 관측 기록`의 표시를 기대합니다.
- **원인**: 민감 영수증 fixture를 공개 관측 projection으로 대체했지만 E2E가 과거 집계 문구를 고정값으로 기대했습니다.
- **현재 대응**: 집계 개수 대신 접근 가능한 상품명·관측 월·가격·장바구니 복원을 검증하도록 수정했고 통과했습니다.
- **회귀 방지**: 데이터 건수처럼 정상적으로 변하는 값보다 사용자 행동과 접근 가능한 이름을 기준으로 검증합니다.

## 13. 한계, 기술 부채, 다음 단계

| 우선순위 | 항목 | 사용자/운영 영향 | 다음 행동 |
| --- | --- | --- | --- |
| P0 | 로컬 권위 문서의 정산 M1 범위와 현재 가격 탐색 제품 범위가 충돌 | 완료 기준과 우선순위 판정이 일관되지 않음 | `AGENTS.md`·Acceptance를 갱신할지 정산 UI를 복구할지 명시적으로 결정 |
| P1 | E2E 시나리오 뒤 runner가 종료되지 않음 | CI gate가 성공 시에도 timeout될 수 있음 | Windows process tree와 Playwright webServer 종료 경로 재현·수정 |
| P1 | Supabase 권한·장애 흐름 미검증 | 원격 관리자·동기화 신뢰성 불확실 | 테스트 프로젝트에서 RLS·관리자·실패 UX smoke test |
| P1 | 상품 코드가 없는 ProductGroup이 정규화 이름에 의존 | 이름 변경·충돌 시 그룹 ID가 불안정 | 원본 관측 ID와 별도의 안정적 group ID 도입 |
| P1 | 상품 규격·판매처 관측 데이터 부족 | 단위 가격 비교 범위 제한 | 검증된 규격과 관측 근거 축적 |
| P2 | Notion 수동 드리프트의 주기 감지 없음 | 문서 push 사이에 미러가 수동 변경될 수 있음 | 반복 운영 가치가 확인되면 read-only 정기 검증 추가 |
| P2 | Android 실기기 미검증 | 모바일 품질 미확인 | 대표 기기 smoke test |

OCR, 알림, 지도, 추가 가격 API는 위 P0/P1 위험을 줄이기 전에는 우선 구현하지
않습니다.

## 14. 배운 점과 재설계 방향

- **유지할 결정**: 원본 증거와 가변 상태 분리, 경계에서의 런타임 검증, 사람 검토 가능한 상품 매핑
- **바꿀 결정**: fixture와 화면 문구가 바뀔 때 E2E를 같은 변경 단위에서 갱신
- **추가 검증이 필요한 가설**: 사용자가 영수증 관측가를 반복적인 가격 비교와 다음 장보기에 활용하는가

## 15. 관련 문서

- [Project Intro](./Project_Intro.md)
- [범용 Intro 템플릿](./templates/PROJECT_INTRO_TEMPLATE.md)
- [범용 Detail 템플릿](./templates/PROJECT_DETAIL_TEMPLATE.md)
- [Operations Runbook](./OPERATIONS_RUNBOOK.md)
- [Official Product Discovery](./OFFICIAL_PRODUCT_DISCOVERY.md)
