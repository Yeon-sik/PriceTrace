# PriceTrace | Project Detail

> 이 문서는 PriceTrace의 구현 근거, 실제 코드 경계, 검증 결과와 미검증
> 영역을 설명합니다. 빠른 소개는 [Project_Intro.md](./Project_Intro.md)를
> 참고합니다.

| 항목 | 내용 |
| --- | --- |
| 문서 상태 | Active |
| 적용 범위 | `2f8cd83`의 웹 MVP, 가격 관측·카탈로그·원격 저장 경계 |
| 최종 갱신 | 2026-07-25T22:00:00+09:00 |
| 최종 검증 기준 | 2026-07-25 로컬 작업 트리의 lint, typecheck, unit test, production build |
| 담당자 | Yeon-sik (개인 프로젝트) |

---

## 1. 문서 목적과 범위

### 포함

- 공개·로컬 private 영수증의 검증과 도메인 변환
- 상품 검색·필터·정렬, 마트 탐색, 관측가 이력, 장바구니
- 표준 상품·판매처 매핑과 관리자용 시장 관측가 입력 경계
- 정산 도메인·백업·원격 동기화 코드의 현재 연결 상태
- 테스트, 정적 배포, 데이터 보호, 원격 운영의 미검증 위험

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
- 공개 기본 데이터는 데모 JSON이며, private 영수증은 로컬 개발 서버 경로에서만 읽습니다.
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

상태는 **검증 완료**, **구현 완료·운영 미검증**, **부분 구현**, **계획**으로만 구분합니다.

| 기능 | 상태 | 확인된 근거 | 남은 위험 |
| --- | --- | --- | --- |
| 공개 영수증 JSON 로드와 상품 탐색 | 구현 완료·운영 미검증 | `JsonReceiptRepository`, receipt/product-browser test, 2026-07-25 build | 현재 E2E 실패 |
| 검색·필터·정렬·마트 탐색 | 구현 완료·운영 미검증 | `ProductBrowser`, `MarketBrowser`, `PriceTrendModal` | 실제 사용성과 모바일 흐름 미검증 |
| 장바구니와 예상 합계 | 부분 구현 | `cart.store`, cart repository test | E2E fixture/selector 갱신 필요, 다기기 동기화 없음 |
| 수령자·배분·정산·백업 | 부분 구현 | settlement domain/store 및 3개 불변식 test | 현재 주 화면 미연결, 사용자 E2E 없음 |
| 가격 이력·판매처 비교 | 부분 구현 | price-history·canonical-price·market analytics domain test | 운영 관측 데이터와 UX 미검증 |
| 표준 카탈로그·상품 매핑 | 부분 구현 | 마이그레이션, 관리자 UI, mapping domain | 실제 관리자 권한·검토 운영 미검증 |
| Supabase 인증·원격 저장 | 구현 완료·운영 미검증 | browser repository, Auth UI, RLS migration | 실제 프로젝트 연결·권한·장애 UX 미검증 |
| private 영수증 개발 모드 | 구현 완료·운영 미검증 | `dev-private.ts`, local receipt server, response schema | 로컬 파일 경로·운영 사용 미검증 |
| GitHub Pages 정적 배포 | 구현 완료·운영 미검증 | `deploy-pages.yml`, 2026-07-25 static export build | 원격 Pages 최신 배포 확인 필요 |
| OCR 자동 추출 | 계획 | `receipt.v2` 템플릿과 검토용 스키마 | 제공자·정확도·검토 UX 미확정 |

## 5. 시스템 아키텍처

```text
data/demo/*.json ─┐
                  ├→ JsonReceiptRepository → Zod mapper → domain
private receipt ──┘                                 │
                                                     ├→ ProductBrowser / MarketBrowser / CartPage
                                                     └→ PriceTrendModal

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
| Receipt / ReceiptItem | `receiptId:storeProductCode:unitPriceKrw` | 원본 JSON 또는 원격 영수증 | 원본 구매 사실은 불변 |
| ProductGroup | 판매처·상품 코드 기반 그룹 | 영수증 관측값에서 계산 | 계산값 |
| Cart lines | 상품 그룹 ID | localStorage | 가변 |
| Catalog / mapping | 카탈로그 namespace와 검토 상태 | Supabase의 검토된 매핑 | 검토 후 변경 |
| Market price observation | 판매처 URL·검증 상태·관측일 | 관리자 검증 입력 | 관측 이력 |
| Settlement state | UUID | localStorage 또는 사용자 소유 원격 데이터 | 가변, 현재 UI 미연결 |

### 불변식

1. `unitPriceKrw >= 0`이며 금액은 KRW 정수로 계산합니다.
2. 구매·배분 수량은 양의 정수이고, 배분 합은 구매 수량을 초과할 수 없습니다.
3. `totalPriceKrw = unitPriceKrw × purchasedQuantity`를 유지합니다.
4. 친구별 합계와 미배분 수량은 배분 내역으로 계산하며 별도 합계를 진실 원천으로 저장하지 않습니다.
5. 상품명은 식별자가 아니며, 원본 구매번호 배열과 원본 증거 행을 보존합니다.

공유 카탈로그 비교에는 `catalog_namespace`, 판매처 상품 코드, 정규화한 상품명
등의 검토된 연결을 사용합니다. 공식·표준 상품 연결은 이보다 강한 사람 검토
경계이며, 규격이나 묶음 수가 다르면 별도 변형으로 유지합니다.

## 7. 핵심 기술 의사결정

### 결정 1. 공개 demo와 private 원본을 분리한다

- **상황**: 실제 영수증에는 거래번호·주소·결제 정보 등 공개하면 안 되는 값이 있을 수 있습니다.
- **제약**: 정적 배포는 로컬 파일이나 비밀값을 숨겨 주지 않습니다.
- **검토한 대안**: 실제 원본을 데모로 사용, 모든 데이터를 원격 DB에 올리기.
- **선택**: `data/demo/` fixture를 기본으로 쓰고, private 모드는 로컬 개발 서버와 환경 변수에서만 사용합니다.
- **근거**: 공개 재현성과 원본 보호를 동시에 유지할 수 있습니다.
- **비용과 위험**: private 모드의 실제 사용자 환경은 아직 검증하지 않았습니다.
- **재검토 조건**: 업로드·동기화 요구가 확정되면 서버 측 접근 제어와 감사 흐름을 먼저 검증합니다.

### 결정 2. 상품명 대신 코드와 검토된 매핑을 사용한다

- **상황**: 이름이 같아도 용량·규격·묶음 수가 다른 상품이 존재합니다.
- **제약**: 잘못된 병합은 거짓 최저가와 잘못된 가격 추이를 만듭니다.
- **선택**: 판매처 상품 코드와 카탈로그 namespace를 보존하고, 검토된 mapping만 통합 비교에 사용합니다.
- **결과**: 자동화율은 낮지만 불확실한 연결을 확정 데이터로 만들지 않습니다.
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

| 연동 대상 | 목적 | 인증/비밀값 | 실패 처리 | 재시도/제한 |
| --- | --- | --- | --- | --- |
| Supabase Auth | 사용자·관리자 식별 | publishable key만 브라우저에 노출 | 인증되지 않으면 관리자 UI를 노출하지 않음 | 실환경 미검증 |
| Supabase PostgreSQL/RLS | 카탈로그, 관측, 사용자 상태 | service role은 서버 전용 | 로컬 상태를 무조건 덮어쓰지 않음 | 운영 권한·장애 UX 미검증 |
| Edge Function | 공식 상품 후보 검색 | 함수 Secret | 검색 결과를 확정 상품으로 저장하지 않음 | 제공자 응답·제한 미검증 |
| GitHub Pages | 정적 UI 배포 | 비밀값 없음 | 원격 기능 장애와 UI 가용성을 분리 | workflow는 존재, 배포 상태 미확인 |
| Notion API | Intro/Detail 동기화 | GitHub Actions Secret | 저장소 Markdown을 진실 원천으로 유지 | `NOTION_DETAIL_PAGE_ID`와 실제 실행 미검증 |

## 9. 데이터 보호와 보안

| 경계 | 정책 | 검증 방법 |
| --- | --- | --- |
| 실제 영수증 | `private-data/`에만 두고 Git·공개 번들에서 제외 | `.gitignore`, private dev server 경로 |
| 공개 데이터 | `data/demo/`의 비식별 fixture만 로드 | `JsonReceiptRepository`와 fixture test |
| 외부 JSON | 전체 Zod 검증 뒤 도메인 변환 | schema/repository test |
| 사용자 권한 | `auth.uid()` 소유권과 관리자 metadata를 사용 | RLS migration 존재, live test 미실행 |
| 비밀값 | service role·외부 API 키를 `NEXT_PUBLIC_*`에 두지 않음 | Edge Function/Actions 경계 검토 |

주요 잔여 위험은 배포된 정책이 로컬 코드와 다를 수 있다는 점입니다. 마이그레이션
파일과 browser client의 존재는 운영 권한 검증을 대체하지 않습니다.

## 10. 테스트와 검증 전략

| 수준 | 도구 | 검증 대상 | 2026-07-25 상태 |
| --- | --- | --- | --- |
| 정적 분석 | ESLint | `src/` 코드 규칙 | 통과 |
| 타입 검사 | TypeScript strict | 타입·경계 | 통과 |
| 단위/저장소 테스트 | Vitest | 영수증, 상품 탐색, 카탈로그, 장바구니, 정산 불변식 | 15개 파일·38개 테스트 통과 |
| E2E | Playwright | 상품 탐색 → 장바구니 → 새로고침 복원 | 실패: 이전 요약 문구 locator timeout |
| production build | Next.js | static export | 통과 |
| 운영 검증 | Supabase/GitHub Pages/Notion | 권한·비밀값·원격 배포 | 미검증 |

### 검증 이력

| 일시 | 기준 | 명령/환경 | 결과 | 미검증 항목 |
| --- | --- | --- | --- | --- |
| 2026-07-25 | `2f8cd83` + 문서 변경만 포함한 로컬 작업 트리 | `npm.cmd run lint` | 통과 | 브라우저/원격 환경 |
| 2026-07-25 | 동일 | `npm.cmd run typecheck` | 통과 | 브라우저/원격 환경 |
| 2026-07-25 | 동일 | `npm.cmd run test` | 15 files / 38 tests 통과 | E2E·실환경 |
| 2026-07-25 | 동일 | `npm.cmd run test:e2e` | 1 scenario 실패 후 runner timeout | fixture·접근 가능한 이름 갱신 |
| 2026-07-25 | 동일 | `npm.cmd run build` | static export 통과 | 실제 Pages 배포 |

## 11. 배포·운영·복구

```text
문서·코드 변경
  → main push
  → GitHub Actions
  → Next.js static export
  → GitHub Pages

Project_Intro/Project_Detail 변경
  → 별도 GitHub Actions workflow
  → Notion 두 페이지 replace_content
```

- `deploy-pages.yml`은 `main` push 또는 수동 실행에서 static export를 배포하도록 구성돼 있습니다.
- `sync-project-docs-to-notion.yml`은 Intro와 Detail을 각각 동기화하지만, 필요한 Secret과 원격 실행 성공은 확인하지 않았습니다.
- 잘못된 정산 백업 import는 schema 검증 전에 기존 상태를 바꾸지 않도록 설계돼 있습니다. 다만 현재 UI에서 복원 흐름은 노출되지 않습니다.
- 원격 데이터 복구는 Supabase Dashboard backup 확인이 런북에 기록돼 있으나, 복구 리허설은 미실행입니다.

## 12. 문제 해결 사례

### E2E가 현재 상품 fixture를 따라가지 못함

- **증상**: `npm.cmd run test:e2e`의 유일한 시나리오가 5초 안에 이전 요약 문구를 찾지 못해 실패합니다.
- **재현**: 홈에서 "상품 둘러보기"를 누른 뒤 `3개 공식 연결 상품 · 3개 관측 기록`의 표시를 기대합니다.
- **원인**: `data/demo/receipt_001.json`과 상품 표시 구조가 바뀌었지만 `e2e/shopping.spec.ts`의 고정 문구·상품 기대값이 함께 갱신되지 않았습니다.
- **현재 대응**: 이 문서에서 E2E를 통과로 표현하지 않고 실패 상태로 기록했습니다.
- **회귀 방지**: 다음 코드 작업에서 현재 fixture와 stable role/name을 기준으로 시나리오를 갱신하고, 통과 결과를 다시 기록합니다.

## 13. 한계, 기술 부채, 다음 단계

| 우선순위 | 항목 | 사용자/운영 영향 | 다음 행동 |
| --- | --- | --- | --- |
| P0 | stale Playwright scenario | 핵심 공개 흐름의 회귀 검증 불가 | 현재 fixture·접근 가능한 이름 기준으로 E2E 갱신 |
| P0 | 정산 UI 미연결 | 구현된 정산 규칙을 사용자가 실행할 수 없음 | 정산 화면을 복구하거나 module의 유지 범위를 재결정 |
| P1 | Supabase 권한·장애 흐름 미검증 | 원격 관리자·동기화 신뢰성 불확실 | 테스트 프로젝트에서 RLS·관리자·실패 UX smoke test |
| P1 | 상품 규격·판매처 관측 데이터 부족 | 단위 가격 비교 범위 제한 | 검증된 규격과 관측 근거 축적 |
| P1 | Notion 동기화 실환경 미검증 | 문서 자동 동기화 신뢰성 불확실 | Secret 설정 후 수동 workflow 실행·결과 확인 |
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
- [Architecture](./ARCHITECTURE.md): M1 설계 스냅샷; 현재 UI 구조의 최종 근거는 본 문서와 소스 코드
- [Receipt v2](./RECEIPT_V2.md)
- [Data Policy](./DATA_POLICY.md)
- [Operations Runbook](./OPERATIONS_RUNBOOK.md)
- [Future Backlog](./FUTURE_BACKLOG.md)
- [ADR](./adr/)
