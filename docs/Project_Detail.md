# PriceTrace | Project Detail

> 이 문서는 PriceTrace의 구현 근거, 아키텍처, 데이터 경계, 기술적 판단과
> 검증 상태를 설명합니다. 빠른 소개는 [Project_Intro.md](./Project_Intro.md)를
> 참고합니다.

| 항목 | 내용 |
| --- | --- |
| 문서 상태 | Active |
| 적용 범위 | 웹 MVP와 이후 가격 이력·카탈로그·원격 저장 확장 |
| 최종 갱신 | 2026-07-24 |
| 최종 검증 기준 | 2026-07-24 현재 작업 트리의 lint, typecheck, unit test |
| 프로젝트 형태 | 개인 프로젝트 |

---

## 1. 문서 목적과 범위

### 포함

- 영수증 데이터 로드와 검증
- 상품 검색·필터·정렬과 장바구니
- 수령자별 물품 배분과 정산 상태
- 가격 관측 이력과 판매처 비교
- 표준 상품 카탈로그와 판매처 상품 매핑
- localStorage와 Supabase 저장 경계
- 테스트, 배포, 데이터 보호와 운영 위험

### 제외

- OCR 제공자 선정과 자동 추출 정확도
- 지도 기반 매장 탐색
- 실시간 재고 또는 현재 판매가 보장
- 검증되지 않은 검색 결과의 자동 상품 연결
- Android 스토어 출시 운영

이 서비스의 가격은 실시간 시세가 아니라 영수증 또는 검증된 판매자 정보에서
확인한 시점의 **관측 가격**입니다.

## 2. 문제 맥락과 제품 원칙

### 문제

영수증에는 실제 구매 가격이 남지만 시간이 지나면 검색·비교하기 어렵습니다.
판매처마다 상품 표기와 코드가 다르므로 이름만으로 같은 상품을 판단하면 규격이
다른 상품이 합쳐질 수 있습니다. 공동 구매에서는 구매 사실과 별도로 사람별
수량, 전달, 입금 상태를 관리해야 합니다.

### 제품 원칙

1. 가격은 출처와 관측 시점을 가진 값으로 저장합니다.
2. 상품명은 식별자가 아닙니다.
3. 원본 구매 사실과 사용자가 변경하는 정산 상태를 분리합니다.
4. 검증되지 않은 검색 결과와 상품 매핑은 확정 데이터로 표시하지 않습니다.
5. 금액은 KRW 정수로 계산합니다.
6. 사용자 데이터와 공개 샘플 데이터의 경계를 유지합니다.

### 성공 기준

| 기준 | 판정 방법 |
| --- | --- |
| 영수증 데이터 무결성 | 스키마, 수량·금액 불변식, 원본 구매번호 보존 |
| 공동 구매 정산 | 초과 배분 차단과 배분 내역 기반 합계 계산 |
| 상태 복구 | 백업 export/import round trip과 실패 시 기존 상태 보존 |
| 가격 비교 신뢰성 | 검증된 상품 식별·판매자 관측만 비교 |
| 공개 안전성 | 실제 영수증과 비밀값이 Git·정적 번들에 포함되지 않음 |

## 3. 사용자와 핵심 흐름

| 사용자 | 목표 | 핵심 흐름 |
| --- | --- | --- |
| 개인·가구 | 실제 구매 가격을 다시 찾고 비교 | 영수증 선택 → 검색·필터 → 가격 이력 |
| 공동 구매자 | 물품과 금액을 사람별로 정산 | 수령자 선택 → 수량 배분 → 전달·입금 확인 |
| 장보기 사용자 | 관측가로 예상 구매 금액 계산 | 상품 탐색 → 장바구니 → 예상 합계 |
| 운영자 | 잘못된 상품 연결과 데이터를 검토 | 후보 확인 → 승인/반려 → 감사 이력 |

```text
영수증 JSON 또는 Supabase 데이터
  → Zod 경계 검증
  → Repository / Mapper
  → Domain Service / Selector
  → Next.js UI
  → localStorage 또는 사용자 소유 원격 데이터
```

## 4. 범위와 구현 현황

| 기능 | 상태 | 확인된 근거 | 남은 위험 |
| --- | --- | --- | --- |
| 영수증 JSON 로드와 상품 탐색 | 검증 완료 | 공개 샘플, 스키마·repository 테스트 | 최신 브랜치 전체 회귀 실행 필요 |
| 검색·필터·정렬 | 검증 완료 | ProductBrowser와 도메인 테스트 | 모바일 실사용성 재확인 필요 |
| 장바구니와 예상 합계 | 검증 완료 | cart store/repository 테스트 | 다기기 동기화 없음 |
| 수령자·배분·정산 | 구현 완료·운영 미검증 | settlement 도메인·저장소 테스트 | 현재 공개 UI의 전체 흐름 재검증 필요 |
| JSON 백업·복원 | 구현 완료·운영 미검증 | Zod 전체 검증과 repository 경계 | 최신 E2E 재실행 필요 |
| 가격 이력과 판매처 비교 | 부분 구현 | price-history, canonical-price, market analytics 도메인 | 운영 관측 데이터와 UX 검증 필요 |
| 표준 카탈로그·상품 매핑 | 부분 구현 | 마이그레이션, 탐색·관리 UI, 검토 상태 | 관리자 검토 대기열의 운영 완결성 |
| Supabase 인증·원격 저장 | 구현 완료·운영 미검증 | Auth UI, repository, RLS 마이그레이션 | 실제 프로젝트 정책과 장애 UX |
| 공식 상품 후보 검색 | 부분 구현 | Edge Function과 후보 확인 구조 | 외부 검색 정확도와 API 운영 |
| Android 패키징 | 부분 구현 | Capacitor Android 프로젝트 | 실기기와 스토어 배포 미검증 |
| OCR 자동 추출 | 계획 | 검토용 DB 기반과 범용 `receipt.v2` 이미지 분석 템플릿 | 제공자·정확도·사용자 검토 흐름 미확정 |

## 5. 시스템 아키텍처

```text
Public receipt fixture / Private receipt / Supabase PostgreSQL
                            │
                            ▼
                    Zod Schema Validation
                            │
                            ▼
                Repository / Mapper Boundary
          ┌─────────────────┼─────────────────┐
          │                 │                 │
   JSON Receipt       localStorage       Supabase
   Repository         Repositories       Repositories
          └─────────────────┼─────────────────┘
                            ▼
                  Domain Service / Selector
          ┌─────────────────┼─────────────────┐
          │                 │                 │
   Receipt rules       Settlement       Price/Catalog
          └─────────────────┼─────────────────┘
                            ▼
                     Next.js / React UI
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
       GitHub Pages              Supabase Edge Function
```

### 컴포넌트 책임

| 계층 | 책임 | 대표 위치 |
| --- | --- | --- |
| UI | 화면 조립, 입력, 접근 가능한 상호작용 | `src/app/` |
| Store | 화면 간 공유 상태와 repository 연결 | `src/stores/` |
| Domain | 계산, 불변식, 비교와 상태 판정 | `src/domain/` |
| Repository | JSON, localStorage, Supabase 경계 | `src/repositories/` |
| Schema/Migration | 원격 데이터 제약과 권한 정책 | `supabase/migrations/` |
| Serverless | 비밀값이 필요한 외부 검색 | `supabase/functions/` |

UI 컴포넌트는 localStorage와 외부 JSON을 직접 처리하지 않습니다. 외부 입력은
repository/mapper 경계에서 검증하고, 합계와 상태 집계는 React 밖의 도메인
로직에서 계산합니다.

## 6. 도메인 모델과 불변식

### 핵심 엔터티

| 영역 | 엔터티 | 진실 원천 | 책임 |
| --- | --- | --- | --- |
| 원본 구매 | `receipts`, `receipt_items` | 원본 영수증 | 판매처, 구매일, 거래번호, 품목·수량·금액 |
| 가격 관측 | `store_products`, `price_observations` | 영수증/검증된 관측 | 판매처 상품과 관측가 이력 |
| 표준 카탈로그 | `catalog_products`, `source_product_mappings` | 검토된 카탈로그 | 판매처 간 비교 가능한 상품 연결 |
| 시장 가격 | `market_price_observations` | 검증된 판매자 URL 관측 | 배송비·수량을 포함한 실효 단가 |
| 공동 정산 | `recipients`, `allocations`, `settlement_statuses` | 사용자 상태 | 수령자, 배분 수량, 전달·입금 |
| 운영 | `receipt_quality_flags`, `audit_logs` | 운영 기록 | 데이터 품질과 변경 추적 |

### 핵심 불변식

1. `unitPriceKrw >= 0`
2. 구매 수량과 배분 수량은 양의 정수입니다.
3. `totalPriceKrw = unitPriceKrw × purchasedQuantity`
4. 품목별 모든 배분 수량의 합은 구매 수량을 초과할 수 없습니다.
5. 친구별 합계는 배분 내역에서 계산하며 별도 진실 원천으로 저장하지 않습니다.
6. 미배분 수량은 구매 수량에서 배분 수량 합을 뺀 값입니다.
7. 상품명은 식별자로 사용하지 않습니다.
8. 원본 구매번호 배열과 원본 증거 행을 보존합니다.

### 상품 식별 경계

공유 카탈로그 상품을 자동으로 합치려면 다음 정보가 일치해야 합니다.

1. 동일한 `catalog_namespace`
2. 동일한 판매처 상품 코드
3. 동일한 정규화 상품명

공식 상품 연결은 이보다 강한 검토 경계입니다. 크기나 묶음 수가 다른 상품은
별도 구매 변형으로 유지합니다.

## 7. 핵심 기술 의사결정

### 결정 1. 로컬 우선 MVP 후 원격 저장으로 확장

- **상황**: 정산 사용자 흐름은 서버 없이 검증할 수 있지만 다기기와 사용자 격리는 원격 저장이 필요합니다.
- **선택**: JSON + localStorage로 먼저 완성하고, 필요한 영역을 Supabase로 확장했습니다.
- **근거**: 초기 인프라보다 실제 배분·정산 흐름의 불확실성을 먼저 줄일 수 있습니다.
- **결과**: 로그인 없이 MVP를 검증하고, repository 경계 뒤에 원격 저장소를 추가할 수 있습니다.
- **비용과 위험**: 동기화 충돌, 오프라인 표시, 원격 장애 UX가 별도 과제로 남습니다.
- **재검토 조건**: 다기기 사용과 공동 편집이 핵심 사용 패턴으로 확인될 때 동기화 정책을 우선합니다.

### 결정 2. 원본 구매 사실과 정산 상태 분리

- **상황**: 영수증은 과거 구매 증거이고 수령자·배분·입금 상태는 계속 바뀝니다.
- **선택**: 원본 영수증은 읽기 전용으로 보존하고 가변 상태는 별도 저장합니다.
- **근거**: 정산 수정이 원본 구매 사실을 오염시키지 않습니다.
- **결과**: 동일한 영수증에서 여러 사용자별 상태를 안전하게 관리할 수 있습니다.
- **비용과 위험**: 두 데이터 집합의 참조 무결성과 마이그레이션을 관리해야 합니다.

### 결정 3. 상품명 대신 코드와 검토된 매핑 사용

- **상황**: 같은 이름에도 규격·용량·묶음 수가 다른 상품이 존재합니다.
- **선택**: 판매처 상품 코드와 카탈로그 namespace를 보존하고 검토된 매핑만 통합 비교에 사용합니다.
- **근거**: 이름 기반 자동 병합으로 발생하는 거짓 최저가와 잘못된 추이를 방지합니다.
- **결과**: 데이터 신뢰도는 높아지지만 매핑 검토 비용이 생깁니다.
- **재검토 조건**: 충분한 라벨 데이터로 자동 매핑 정확도를 측정할 수 있을 때 보조 자동화를 검토합니다.

### 결정 4. 외부 검색 결과를 후보로만 사용

- **상황**: 검색 결과만으로 브랜드·규격·구성을 확정할 수 없습니다.
- **선택**: Brave Search 결과는 후보 URL로 제공하고 사용자 확인 전에는 확정하지 않습니다.
- **근거**: 검색 자동화보다 잘못된 상품 연결의 비용이 더 큽니다.
- **결과**: 자동화율은 낮지만 오류를 사람이 검토할 수 있습니다.

### 결정 5. 정적 UI와 비밀값 처리 경계 분리

- **상황**: GitHub Pages는 간단하지만 서버 비밀값을 보관할 수 없습니다.
- **선택**: UI는 정적으로 배포하고 비밀 API 호출은 Supabase Edge Function에서 수행합니다.
- **근거**: 배포 비용을 낮추면서 API 키를 브라우저 번들에서 제외합니다.
- **비용과 위험**: 정적 UI와 원격 서비스의 장애·인증·요청 제한을 따로 관리해야 합니다.

## 8. 외부 연동과 실패 경계

| 연동 | 목적 | 비밀값 | 실패 시 원칙 |
| --- | --- | --- | --- |
| Supabase Auth | 사용자 식별 | 브라우저에는 publishable key만 사용 | 로컬 기능과 원격 기능의 상태를 구분 |
| Supabase PostgreSQL | 사용자 소유 데이터와 가격 관측 | service role은 서버 환경만 사용 | 로컬 상태를 무조건 덮어쓰지 않음 |
| Supabase Edge Function | 서버 측 외부 검색 | 함수 Secret | 오류를 확정 데이터로 저장하지 않음 |
| Brave Search API | 공식 상품 후보 탐색 | Edge Function 환경 | 결과는 후보로만 표시 |
| GitHub Pages | 정적 UI 배포 | 비밀값 없음 | 원격 기능 장애와 정적 UI 가용성을 분리 |
| Notion API | 프로젝트 문서 동기화 | GitHub Actions Secret | 동기화 실패 시 저장소 Markdown이 진실 원천 |

## 9. 데이터 보호와 보안

| 경계 | 정책 | 현재 근거 |
| --- | --- | --- |
| 실제 영수증 | `private-data/`에만 두고 Git과 공개 번들에서 제외 | `.gitignore`와 데이터 정책 |
| 공개 데이터 | `data/demo/`의 비식별 샘플만 사용 | 공개 fixture 분리 |
| 외부 JSON | 전체 Zod 검증 후 반영 | schema/repository 테스트 |
| 사용자 데이터 | `auth.uid()` 기반 소유권 정책 | RLS 마이그레이션 |
| 관리자 권한 | 사용자 수정 가능한 필드 대신 서버 관리 역할 사용 | 관리자 정책 마이그레이션 |
| 비밀값 | `NEXT_PUBLIC_*`에 service role과 외부 API 키를 넣지 않음 | Edge Function·Actions Secret 경계 |

실제 배포 환경의 RLS, Data API 노출 범위, 관리자 역할 부여, Secret 설정은
코드 존재만으로 검증됐다고 간주하지 않습니다.

## 10. 테스트와 검증 전략

| 수준 | 도구 | 검증 대상 | 문서 작성 시 상태 |
| --- | --- | --- | --- |
| 정적 분석 | ESLint | 코드 규칙 | 2026-07-24 현재 작업 트리 통과 |
| 타입 검사 | TypeScript strict | 타입과 경계 | 2026-07-24 현재 작업 트리 통과 |
| 단위 테스트 | Vitest | 영수증, 정산, 가격, 카탈로그 규칙 | 2026-07-24 현재 작업 트리 통과 |
| 저장소 테스트 | Vitest | JSON, cart, settlement, admin 경계 | 단위 테스트 실행에 포함해 통과 |
| 사용자 흐름 | Playwright | 탐색과 핵심 브라우저 흐름 | 최신 UI 기준 재검증 필요 |
| 빌드 | Next.js | 정적 산출물 | 최신 브랜치 기준 재실행 필요 |
| 실기기 | Android/Capacitor | 입력, 네트워크, 화면 | 미검증 |
| 운영 환경 | Supabase/GitHub Pages | 권한, 비밀값, 배포 | 별도 실환경 확인 필요 |

### 현재 검증 이력

| 일시 | 명령/환경 | 결과 | 해석 |
| --- | --- | --- | --- |
| 2026-07-24 | `npm.cmd run lint` | 통과 | 현재 작업 트리의 `src/` 기준 |
| 2026-07-24 | `npm.cmd run typecheck` | 통과 | 현재 작업 트리 기준 |
| 2026-07-24 | `npm.cmd run test` | 14개 파일·37개 테스트 통과 | 현재 작업 트리 기준 |

E2E와 production build는 이 문서 변경과 동시에 실행하지 않았습니다. 전체
검증은 다음 순서로 실행합니다.

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

## 11. 배포·운영·복구

```text
main 반영
  → GitHub Actions
  → Next.js 정적 산출물
  → GitHub Pages

원격 데이터와 비밀 기능
  → Supabase Auth / PostgreSQL / RLS / Edge Function

프로젝트 문서
  → Markdown 변경 감지
  → GitHub Actions
  → Intro/Detail 각각의 Notion 페이지
```

- 저장소의 Markdown이 프로젝트 문서의 진실 원천입니다.
- 실제 영수증은 공개 배포 경로에 포함하지 않습니다.
- 잘못된 백업 import는 기존 로컬 상태를 변경하지 않습니다.
- Supabase 마이그레이션은 코드가 새 스키마를 읽기 전에 적용·확인해야 합니다.
- 원격 백업·복구 리허설과 장애 관찰은 운영 전 추가해야 합니다.

## 12. 확인된 한계와 기술 부채

| 우선순위 | 항목 | 영향 | 다음 행동 |
| --- | --- | --- | --- |
| P0 | 최신 E2E·production build 기록 부재 | 공개 사용자 흐름과 배포 산출물 근거가 낡을 수 있음 | E2E → build 순차 실행 |
| P1 | 배포 Supabase 권한·장애 흐름 미검증 | 원격 기능 신뢰성 불확실 | RLS·관리자·실패 UX smoke test |
| P1 | 상품 규격과 판매자 관측 데이터 부족 | 단위 가격 비교 범위 제한 | 검증된 규격 데이터 축적 |
| P1 | 관리자 검토 대기열 운영 미완성 | 상품 매핑 비용 증가 | 승인·반려·감사 흐름 검증 |
| P2 | Android 실기기 검증 부재 | 모바일 품질 미확인 | 대표 기기 smoke test |
| P2 | 제품 성과 지표 부재 | 실제 사용자 가치 미측정 | 사용자 인터뷰와 반복 사용 지표 정의 |

OCR, 알림, 지도, 추가 가격 API는 위 위험을 줄이기 전에 우선 구현하지 않습니다.

## 13. 배운 점과 재설계 방향

- **유지할 결정**: 원본 증거와 가변 상태 분리, 경계에서의 런타임 검증, 사람 검토 가능한 상품 매핑
- **바꿀 결정**: 원격 동기화 도입 시점부터 충돌·오프라인·실패 상태를 사용자 흐름에 포함
- **먼저 만들 것**: 자동 상품 검색보다 운영자가 처리할 검토 대기열과 근거 UI
- **추가 검증이 필요한 가설**: 사용자가 실제 구매 이력을 반복적으로 가격 비교와 다음 장보기에 활용하는가

## 14. 관련 문서

- [Project Intro](./Project_Intro.md)
- [범용 Intro 템플릿](./templates/PROJECT_INTRO_TEMPLATE.md)
- [범용 Detail 템플릿](./templates/PROJECT_DETAIL_TEMPLATE.md)
- [Architecture](./ARCHITECTURE.md)
- [Domain Model](./DOMAIN_MODEL.md)
- [Receipt v2](./RECEIPT_V2.md)
- [Receipt image-analysis template](./templates/RECEIPT_V2_TEMPLATE.json)
- [Receipt image-analysis prompt](./templates/RECEIPT_IMAGE_ANALYSIS_PROMPT.md)
- [Data Policy](./DATA_POLICY.md)
- [Operations Runbook](./OPERATIONS_RUNBOOK.md)
- [Future Backlog](./FUTURE_BACKLOG.md)
- [ADR](./adr/)
