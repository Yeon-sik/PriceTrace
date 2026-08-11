# PriceTrace | Project Detail

> 이 문서는 PriceTrace의 구현 근거, 실제 코드 경계, 검증 결과와 미검증 영역을 설명합니다. 빠른 소개는 [Project_Intro.md](./Project_Intro.md)를 참고합니다.

| 항목 | 내용 |
| --- | --- |
| 문서 상태 | Active |
| 기능 기준 | `49fd5e3` (`main`, 원격 DB lint 정리 migration 포함) |
| 최종 갱신 | 2026-08-11T14:50:34+09:00 |
| 최종 검증 경계 | 로컬 lint·typecheck·36개 파일 202개 test·public data·build·E2E 16개 시나리오·Android debug build, 연결 원격 Supabase migration·DB lint, Notion 두 대상 preflight |
| 문서 진실 원천 | Git 저장소의 `docs/Project_Detail.md`; Notion은 source commit과 fingerprint를 표시하는 읽기 전용 미러 |
| 담당자 | Yeon-sik (개인 프로젝트) |

---

## 1. 문서 목적과 범위

### 포함

- 공개 영수증의 검증·도메인 변환과 private 원본의 수동 공개 projection
- 공식 판매채널 snapshot의 검증·탐색과 영수증 관측과의 provenance 분리
- 상품 검색·필터·정렬, 판매처별 가격 기록, 장바구니
- 표준 상품군, 정확한 판매 규격, 판매처 상품 identity와 관리자 승인 연결
- LinkProposal 생성·검토·대상 지문·로컬 승인 대기열·기존 등록/충돌 reconciliation·원자적 등록 RPC
- `product-read.v1`, exact variant 기반 Nutrition 연결 계약, 승인된 공개 영양의 read-only 표시
- URL 기반 화면·판매처 상태 복원과 공통 dialog Escape·focus·scroll lifecycle
- 정산 도메인·백업·원격 동기화 코드의 현재 연결 상태
- 테스트, 정적 배포, Android 패키징, 문서 자동화, 데이터 보호의 확인된 근거와 미검증 위험

### 제외

- OCR 제공자 선정과 실제 영수증 자동 추출 정확도
- 실시간 재고·현재 판매가 보장과 지도 기반 매장 탐색
- 상품명이나 AI 추측만으로 수행하는 자동 상품 연결
- 현재 공개 UI에서 Nutrition 연결·해제 제안을 실행할 수 있다는 주장
- Android 스토어 출시 완료 주장
- Supabase Auth·RLS·관리자 승인 전체 흐름의 실환경 완료 주장

PriceTrace의 가격은 실시간 시세가 아닙니다. 영수증 구매 또는 공식 판매채널 등재에서
출처와 관측 시점을 확인할 수 있는 **관측 가격**으로만 표현합니다.

## 2. 문제 맥락과 제약

### 문제

영수증의 실제 구매 가격은 판매처·구매 시점·상품 규격 맥락을 잃기 쉽습니다.
같은 이름의 상품도 용량, 묶음 수, 사이즈, 구성품이 다를 수 있으므로 이름만으로
합치면 거짓 최저가와 잘못된 가격 추이가 만들어집니다. 공식 판매채널의 표시가는
특정 지점의 재고나 사용자의 구매 사실과도 다릅니다. 원본 영수증에는 공개하면 안
되는 정보가 포함될 수 있습니다.

### 핵심 제약

- 정적 GitHub Pages UI에는 원본 이미지·원본 JSON·거래/결제/승인 정보·OCR 원문·service role·외부 API 비밀값을 넣지 않습니다.
- 공개 기본 데이터는 strict allowlist로 생성한 영수증별 공개 JSON, 인덱스, 영수증 품목 연결 관측입니다. 원본 영수증은 로컬 경로에서만 읽습니다.
- 공식 listing identity는 공식 namespace와 상품 코드로 보존하며, 등재 정보만으로 표준 상품이나 정확한 판매 규격을 자동 확정하지 않습니다.
- 연결 원격 Supabase migration은 2026-08-11 read-only 조회에서 `20260810193000`까지 로컬과 일치하고 DB lint 결과는 0건입니다. 다만 실제 관리자 로그인, RLS 거부, 승인 RPC, 결과 재조회, 장애 UX를 한 흐름으로 수행한 브라우저 증거는 아직 없습니다.
- Nutrition 데이터와 링크 상태는 별도 프로젝트가 소유합니다. PriceTrace 공개 UI는 익명 read-only RPC만 사용하고, 실제 production Nutrition RPC·승인 데이터는 이번 실행에서 확인하지 않았습니다.
- 현재 탐색 UI와 기존 공동 정산 module은 분리되어 있으며, 정산은 주 화면에 노출되지 않습니다.

### 성공 기준

| 기준 | 측정 또는 판정 방법 |
| --- | --- |
| 관측 데이터 무결성 | Zod 스키마, 수량·금액 불변식, 원본 line reference, revision·link 검사 |
| 탐색과 장바구니 | 검색·필터·그룹화·수량 저장·provenance 보존의 domain/repository test와 브라우저 E2E |
| 비교 신뢰성 | 판매처 identity, 표준 상품군과 exact variant 분리, 검토된 mapping만 비교에 사용 |
| 승인 안전성 | LinkProposal strict 검증, 입력·대상 fingerprint, 명시적 승인, 원자적 RPC, idempotency |
| 교차 프로젝트 연결 | versioned read contract, exact `catalogProductId`, Nutrition revision, 소유권별 독립 승인 |
| 공개 안전성 | `private-data/`·환경 파일 Git 제외, strict 공개 projection과 금지 필드 검사 |

## 3. 사용자와 핵심 흐름

| 사용자 | 목표 | 핵심 흐름 |
| --- | --- | --- |
| 장보기 사용자 | 실제 구매 관측가를 찾아 비교 | 공개 영수증 로드 → 상품 검색·필터 → 판매처·관측 시점·가격 이력 확인 |
| 장보기 사용자 | 공식 등재 상품과 구매 관측을 구분해 담기 | 영수증 또는 공식 카탈로그 탐색 → 출처 표시 확인 → 장바구니 수량·예상 합계·새로고침 복원 |
| 장보기 사용자 | 표준 상품에 승인된 영양이 있는지 확인 | 표준 상품 정보 → 정확 규격별 공개 Nutrition 조회 → 승인 결과만 영양성분표로 확인 |
| 관리자 | 한 영수증 항목을 검토된 표준 상품에 연결 | LinkProposal 검토 → 대상 지문 대기열 → 관리자 재검증 → 승인 RPC → 결과 재조회 |
| 공동 구매자 | 수량과 정산 상태 관리 | domain/store는 존재하나 현재 공개 UI 흐름에는 미연결 |

```text
공개 영수증 JSON → strict Zod 검증 → Receipt mapper ───────┐
                                                            ├→ 상품 탐색 → provenance 보존 CartProduct
공식 판매채널 snapshot → strict 검증 → 공식 상품 탐색 ─────┘                   ↓
                                                                     Cart localStorage

표준 상품 exact variants
  → Nutrition 익명 공개 RPC 병렬 조회
  → 성공 결과 revision 중복 제거, 일부 실패 격리
  → 승인된 영양 read-only modal

영수증 항목 + 공식 exact variant 근거
  → 검토된 LinkProposal
  → 불변 입력·대상 SHA-256 fingerprint
  → localStorage 승인 대기열
  → 이미 등록됨 / mapping 충돌 / 활성 제안 reconciliation
  → 관리자 재검증·명시적 승인
  → Supabase 원자적 RPC
  → 표준 상품군·exact variant·판매처 mapping·감사 결과 재조회
```

공식 판매채널 등재는 특정 지점의 판매·재고 또는 사용자의 구매 사실을 의미하지
않습니다. 정산도 위 탐색·연결 흐름과 별도 진실 원천으로 유지합니다.

## 4. 범위와 구현 현황

구현 상태와 검증 수준은 독립적으로 기록합니다.

- **구현 상태**: 구현 완료 / 부분 구현 / 계획
- **검증 수준**: 실환경 검증 / 부분 실환경 검증 / 저장소 검증 / 미검증

| 기능 | 구현 상태 | 검증 수준 | 환경·기준 | 확인된 근거 | 남은 위험 |
| --- | --- | --- | --- | --- | --- |
| 공개 영수증 JSON 로드와 상품 탐색 | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | 공개 영수증 4건·연결 관측 223건, Zod·privacy·revision·link 검사 | 최신 Pages 기능 smoke test 미실행 |
| 검색·필터·정렬·판매처 기록 | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | domain/repository test, URL 복원, Chromium 16개 시나리오 | 실제 사용자 사용성과 배포 모바일 흐름 미검증 |
| 공식 판매채널 카탈로그 | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | PX 등재 2,269건 source SHA 검증, 검색·분류 UI | 특정 지점 재고·실제 구매를 증명하지 않음 |
| 출처 보존 장바구니 | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | `CartProduct`, 양의 정수 수량 selector, localStorage, 공식 상품 E2E | 다기기 동기화 없음 |
| 표준 상품군·exact variant 모델 | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | 의류 사이즈, 단일/묶음 내용량, 복합 키트, 와이퍼 길이, `kg`→`g` strict contract | 실데이터의 불완전한 규격 근거는 계속 사람 검토 필요 |
| LinkProposal 승인 대기열·등록 | 구현 완료 | 부분 실환경 검증 | `49fd5e3`, 2026-08-11 | queue 8 tests, 등록/충돌 reconciliation, strict validator, 원격 migration 적용 | 배포 관리자 Auth·RLS·승인·재조회 E2E 미실행 |
| 승인된 공개 영양 표시 | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | exact variant별 익명 조회, 부분 실패 격리·재시도, 관련 Chromium 시나리오 | 실제 Nutrition production RPC·데이터 미검증 |
| `product-read.v1`·Nutrition 제안 계약 | 계약 구현 완료, UI 부분 구현 | 저장소 검증 | `49fd5e3`, 2026-08-11 | Zod·repository·migration test; PriceTrace RPC migration의 원격 존재는 별도 확인 | 실제 RPC 응답·연결/해제 제안 UI·Nutrition 승인자 흐름 미검증 |
| URL navigation·dialog lifecycle | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | `?view`/`?store`, history 복원, Escape·focus trap/restore·중첩 scroll lock test | 배포 브라우저별 회귀 미검증 |
| 수령자·배분·정산·백업 | 부분 구현 | 저장소 검증 | `49fd5e3`, 2026-08-11 | settlement domain/store와 불변식 test | 현재 주 화면 미연결 |
| private 원본의 수동 공개 반영 | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | private validate, public sync, 공개 projection 검사 | 공개 정책 변경과 원본 정확성은 사람 검토 필요 |
| Supabase schema | 구현 완료 | 부분 실환경 검증 | 연결 원격 DB, 2026-08-11 | migration local/remote `20260810193000` 일치, DB lint 결과 0건 | 전체 Auth·RLS·승인 런타임 흐름 미검증 |
| Android debug package | 구현 완료 | 저장소 검증 | `49fd5e3`, 2026-08-11 | Capacitor sync·Gradle debug APK 생성 | 실제 기기 기능 smoke test 미실행 |
| GitHub Pages 정적 배포 | 구현 완료 | 과거 실환경 검증 | 2026-07-26 | Actions [run 30198781229](https://github.com/Yeon-sik/PriceTrace/actions/runs/30198781229) build·deploy 성공 | `49fd5e3` 기준 기능 smoke test 미실행 |
| 정책 기반 Notion 문서 게시 | 구현 완료 | 로컬·과거 실환경 검증 | 2026-08-11 | validator·2문서 render-only dry run, 두 대상 페이지 preflight; 과거 [run 30198781222](https://github.com/Yeon-sik/PriceTrace/actions/runs/30198781222) 자동 발행 | 이번 문서 revision은 병합 후 Actions·Notion 재검증 필요 |
| OCR 자동 추출 | 계획 | 미검증 | 해당 없음 | 웹 저장소 구현 근거 없음 | 제공자·정확도·검토 UX 미확정 |

## 5. 시스템 아키텍처

```text
?view / ?store URL ↔ Home navigation state
                ↓

private-data/receipt_YYYY-MM-DD_NNN.json
  └→ manual validate + sync
       ├→ public receipt JSON per file
       ├→ receipt index JSON
       └→ linked observation JSON
                ↓ strict Zod + privacy + revision/link 검사
             ProductBrowser / MarketBrowser / PriceTrendModal
                ↓
             CartProduct(priceSource = receipt-observation)

official-channel snapshot
  → strict catalog 검사
  → PxOfficialProductBrowser
  → CartProduct(priceSource = official-channel)

Cart store → LocalStorageCartRepository

standard/catalog product IDs ─┬→ product-read.v1 (외부 연결용 PriceTrace 계약)
                              └→ public Nutrition RPC (separate owner)
                                   → approved nutrition read-only modal

LinkProposal → strict schema + target fingerprint
             → StandardProductLinkProposalQueueRepository
             → Admin UI revalidation
             → Supabase browser client
             → PostgreSQL + RLS + atomic registration RPC

Settlement store → LocalStorage/Supabase settlement repository
                 (현재 공개 UI에는 연결되지 않음)
```

### 컴포넌트 책임

| 컴포넌트 | 책임 | 의존성 | 실패 시 영향 |
| --- | --- | --- | --- |
| `src/app/` | 상품·공식 카탈로그·장바구니·관리자 화면 조립 | features, domain, stores | 탐색·승인 UI 불가 |
| `src/features/` | 데이터 조회, selector, 복합 UI 흐름 | repositories, domain | 기능별 상태·쓰기 흐름 실패 |
| `src/hooks/use-dialog-lifecycle.ts` | Escape, focus trap·복원, 중첩 scroll lock | browser DOM | dialog 접근성·복귀 실패 |
| `src/domain/` | 영수증 변환, 상품 identity·규격·가격·장바구니·승인 불변식 | React 밖의 순수 로직, Zod | 데이터 해석·비교·승인 신뢰성 저하 |
| `src/stores/cart.store.ts` | 장바구니 상태와 hydration | cart repository | 선택 수량 복원 실패 |
| `src/repositories/standard-product-link-proposal-queue.repository.ts` | 검증된 제안을 대상 fingerprint 기준으로 보관 | localStorage, LinkProposal schema | 승인 대상 손실·변조 감지 실패 |
| `src/repositories/product-read.repository.ts` / `nutrition-catalog.repository.ts` | versioned 상품 읽기와 별도 Nutrition 공개 조회·제안 I/O | 두 Supabase 프로젝트, Zod | 영양 표시·연결 계약 실패; 가격 상세는 계속 사용 |
| `src/repositories/` | 공개 JSON, localStorage, Supabase I/O 경계 | Zod, browser APIs, Supabase | 데이터 로드·저장·권한 처리 실패 |
| `supabase/` | append-only schema, RLS, RPC, Edge Function | Supabase 배포 환경 | 원격 관리자·동기화 기능 실패 |
| `.agents/skills/pricetrace-link-standard-products/` | 한 항목 단위 조사·증거·독립 검토·승인 제안 절차 | read-only 분석 agent, LinkProposal contract | 근거 없는 일괄 연결 위험 증가 |
| `.github/project-docs/` | 문서 검증·렌더링·Notion publication | Git source, Actions Secret | 문서 미러 갱신 실패 |

UI는 외부 JSON과 localStorage를 직접 파싱하지 않습니다. 입력은 repository/mapper
경계에서 검증하고, 합계·상품 그룹·상태 판정은 React 밖에서 계산합니다.

## 6. 도메인 모델과 불변식

### 핵심 엔터티

| 엔터티 | 식별자 또는 경계 | 진실 원천 | 변경 가능 여부 |
| --- | --- | --- | --- |
| Receipt / ReceiptItem | `receiptId:lineId` | 원본 영수증과 검증된 공개 projection | 구매 사실·원본 line reference는 불변 |
| Receipt observation | 판매처 identity, 관측일, 영수증 line reference | 공개 영수증 연결 관측 | append-oriented 관측 기록 |
| Official listing | `sourceProductCodeNamespace + sourceProductCode` | 공식 판매채널 snapshot | snapshot 갱신 가능, 구매 사실 아님 |
| StandardProduct | 상품군 ID | 검토된 Supabase 카탈로그 | 검토 후 변경 |
| CatalogProduct | 정확한 판매 규격 ID | 검토된 Supabase variant | 규격 근거와 함께 변경 |
| LinkProposal | schema version, 입력·대상 fingerprint, review 상태 | 검토된 승인 제안 | 승인 전 수정 시 fingerprint·idempotency 재생성 |
| ProductReadV1 | `pricetrace + catalogProductId + sha256 revision` | PriceTrace 공개 RPC | 검증된 exact variant·판매처 mapping·시장 관측만 갱신 |
| ProductNutritionLink | `namespace + catalogProductId + nutritionFoodId` | Nutrition DB의 승인 상태 | Nutrition 소유 승인으로 변경, PriceTrace 이름은 identity가 아님 |
| Cart line | 상품 ID와 `priceSource` provenance | localStorage | 가변 |
| Settlement state | UUID | localStorage 또는 사용자 소유 원격 데이터 | 가변, 현재 UI 미연결 |

### 불변식

1. 가격은 출처와 관측 시점이 있는 KRW 정수이며 실시간 현재가나 재고 보장으로 표현하지 않습니다.
2. 판매처 상품의 기본 identity는 `sourceLabel + sourceProductCode`입니다.
3. 공식 listing identity는 `sourceProductCodeNamespace + sourceProductCode`입니다.
4. `standard_products`는 상품군, `catalog_products`는 정확한 판매 규격이며 두 ID를 혼용하지 않습니다.
5. 상품명 유사도는 후보 탐색에만 사용하고 연결 확정 근거로 사용하지 않습니다.
6. LinkProposal은 전체 schema, review 상태, 불변 입력·대상 fingerprint와 명시적 승인을 통과해야 합니다.
7. 공식 등재는 특정 지점의 판매·재고나 사용자의 구매 사실을 의미하지 않습니다.
8. 장바구니는 `official-channel`과 `receipt-observation` provenance를 보존합니다.
9. 단위 가격은 검증된 내용량·단위·패키지 수량·기준 단위가 있을 때만 계산합니다.
10. 원본 `ReceiptItem` ID, 구매 식별자, 증거 행을 보존하며 할인·세금·수수료를 임의로 상품 행으로 바꾸지 않습니다.
11. 정산의 배분 합은 구매 수량을 초과할 수 없고, 합계와 미배분 수량은 배분 내역에서 계산합니다.
12. 공개 데이터와 원격 DB를 병합할 때 출처 우선순위와 최신 관측 선택 규칙을 test로 고정합니다.
13. PriceTrace는 상품·가격 read contract를, Nutrition DB는 영양·링크 상태를 소유하며 cross-project foreign key를 만들지 않습니다.
14. 공개 상품 화면은 승인된 Nutrition 결과만 읽고, 이름 검색 결과나 pending proposal을 승인된 영양처럼 표시하지 않습니다.

현재 `ProductGroup`에는 카탈로그 mapping이 없는 경우 판매처·상품 코드·정규화 이름
fallback이 남아 있습니다. 이를 표준 상품 확정 근거로 사용하지 않으며, 이름 변경이나
충돌 가능성은 별도 기술 부채로 관리합니다.

## 7. 핵심 기술 의사결정

### 결정 1. 검증 공개 영수증 projection과 private 원본을 분리한다

- **상황**: 원본 영수증에는 거래번호·결제·승인 정보, OCR 원문, 원본 이미지 경로 등 공개하면 안 되는 값이 있습니다.
- **제약**: 정적 배포는 로컬 파일이나 비밀값을 숨겨 주지 않습니다.
- **검토한 대안**: 실제 원본을 데모로 사용, 모든 데이터를 원격 DB에 업로드.
- **선택**: 영수증별 공개 JSON, 파일 인덱스, 연결 관측을 strict allowlist로 생성합니다. 앱은 공개 projection만 읽고 private 원본은 수동 validate·sync 입력으로만 사용합니다.
- **결과**: private 파일이 없는 정적 환경에서도 공개 데이터의 출처·연결·revision을 검증할 수 있습니다.
- **비용과 위험**: 공개된 판매처 정보와 발행일은 Git 이력에 남으므로 정책 변경 시 기존 이력도 별도 검토해야 합니다.

### 결정 2. 상품군, 정확한 판매 규격, 판매처 identity를 분리한다

- **상황**: 같은 제품군 안에서도 용량·묶음·사이즈·구성품이 다릅니다.
- **제약**: 잘못된 병합은 거짓 최저가와 잘못된 가격 추이를 만듭니다.
- **선택**: `standard_products`는 상품군, `catalog_products`는 exact variant로 유지합니다. 원본 항목은 `receiptId:lineId`, 판매처 항목은 판매처 identity, 공식 listing은 namespace와 상품 코드를 보존합니다.
- **연결 조건**: exact variant 근거, LinkProposal review 상태, 입력·대상 fingerprint, 관리자 승인을 요구합니다.
- **결과**: 자동화율보다 감사 가능성과 잘못된 상품 병합 방지를 우선합니다.
- **비용과 위험**: 후보가 불완전하면 연결하지 못한 항목이 남습니다.

### 결정 3. 정적 UI와 권한·비밀값 경계를 분리한다

- **상황**: GitHub Pages는 정적 UI에 적합하지만 service role이나 외부 API key를 보관할 수 없습니다.
- **선택**: UI는 static export로, 인증·RLS·외부 공식 상품 검색은 Supabase 경계로 분리했습니다.
- **결과**: 정적 UI와 공개 번들에서 비밀값을 제거할 수 있습니다.
- **비용과 위험**: 원격 schema 적용만으로 Auth·RLS·장애 UX가 검증되지는 않습니다.

### 결정 4. 정산 코드를 보존하되 현재 공개 흐름과 분리한다

- **상황**: 초기 로컬 정산 MVP의 domain·backup·sync 코드가 존재하지만 현재 UI는 가격 탐색과 장바구니에 집중합니다.
- **선택**: 정산 불변식과 store를 유지하고, UI에 연결되기 전에는 사용자 기능 완료로 표현하지 않습니다.
- **결과**: 기존 코드와 데이터 계약을 보존하면서 현재 제품 범위를 명확히 합니다.

### 결정 5. 공식 표시가와 영수증 구매 관측을 같은 가격처럼 취급하지 않는다

- **상황**: 공식 등재 정보는 실제 구매 영수증보다 범위가 넓지만 구매·재고를 증명하지 않습니다.
- **선택**: 장바구니를 공통 `CartProduct`로 조립하되 `official-channel`과 `receipt-observation` provenance, 관측일, source identity를 보존합니다.
- **결과**: 사용자는 같은 장바구니에서 예상 합계를 계산하면서도 가격 근거를 구분할 수 있습니다.
- **비용과 위험**: 가격 비교 UI가 provenance 차이를 계속 명확히 표시해야 합니다.

### 결정 6. 상품·가격과 영양·연결 상태를 versioned 계약으로 분리한다

- **상황**: PriceTrace와 Nutrition은 서로 다른 배포·승인·데이터 소유권을 가집니다.
- **선택**: PriceTrace는 `product-read.v1`로 검증된 상품군·exact variant·판매처 mapping·시장 관측만 공개하고, Nutrition은 영양과 `namespace + catalogProductId + nutritionFoodId` 링크 상태를 소유합니다.
- **현재 UI**: 표준 상품 상세는 승인된 영양만 익명 read-only RPC로 표시합니다. 연결·해제 proposal domain/repository 코드는 존재하지만 현재 화면에는 연결하지 않았습니다.
- **결과**: 이름이 바뀌어도 exact ID와 revision으로 경계를 검증하고, 한 연동이 실패해도 상품·가격 상세는 유지합니다.
- **비용과 위험**: 두 프로젝트의 환경 변수·RPC version·승인 운영이 함께 맞아야 하며 production 통합은 별도 실환경 검증이 필요합니다.

## 8. 외부 연동과 실패 경계

| 연동 대상 | 목적 | 인증/비밀값 | 실패 처리 | 마지막 확인과 경계 |
| --- | --- | --- | --- | --- |
| Supabase Auth | 사용자·관리자 식별 | publishable key만 브라우저 노출 | 인증되지 않으면 관리자 쓰기 흐름을 허용하지 않음 | 코드·migration 검증, live login 미검증 |
| Supabase PostgreSQL/RLS/RPC | 카탈로그, 관측, 승인 등록, 사용자 상태, `product-read.v1` | service role은 서버 전용 | 승인 대상 재검증, 원자적 RPC, 실패 후 결과 재조회 | 2026-08-11 migration `20260810193000` 정합·lint 0건; 전체 Auth·RLS·승인 E2E 미검증 |
| Fitness Nutrition Supabase | 승인된 영양 조회와 별도 링크 상태 | 브라우저에는 publishable key만 사용; 공개 조회 client는 세션 비영속 | 규격별 실패 격리·재시도, 가격·판매처 상세 유지 | 코드·mock E2E 검증; 실제 production RPC·승인 데이터 미검증 |
| official-product-search Edge Function | 공식 상품 후보 검색 | 함수 Secret | 검색 결과를 확정 상품으로 저장하지 않음 | 제공자 응답·제한 실환경 미검증 |
| GitHub Pages | 정적 UI 배포 | 비밀값 없음 | 원격 기능 장애와 UI 가용성을 분리 | 2026-07-26 run `30198781229`; 최신 기능 smoke test 미실행 |
| Notion API | Intro/Detail 읽기 전용 미러 | `notion-production` Environment Secret | 두 페이지 preflight, 실패 집계, Git 원본 링크·fingerprint 유지 | 2026-07-26 run `30198781222`; 이번 문서는 병합 후 재검증 대상 |

## 9. 데이터 보호와 보안

| 경계 | 정책 | 검증 방법 |
| --- | --- | --- |
| 원본 영수증·이미지 | `private-data/`에만 두고 Git·공개 번들·앱 runtime에서 제외 | `.gitignore`, 수동 validate·sync 경로 |
| 공개 영수증 | 정책상 허용된 판매처·발행일·품목·수량·금액만 Git 추적 | strict Zod allowlist, 공개 영수증 회귀 테스트 |
| 공개 금지 필드 | 거래번호, 결제·승인 정보, 고객 식별정보, OCR 원문, 원본 이미지 경로·파일명 제외 | 금지 key·value·path 검사, `check:public-receipts` |
| 영수증-관측 연결 | 관측마다 원본 영수증과 line reference, index revision 저장 | 전체 link·파일명·revision 일치 검사 |
| 공식 카탈로그 | source snapshot과 SHA를 검증하고 구매·재고로 과장하지 않음 | `check:public-official-catalog` |
| 승인 제안 | 전체 LinkProposal과 target fingerprint가 일치할 때만 대기열 저장 | Zod, queue id/fingerprint test, invalid enqueue 비파괴 test |
| 상품·영양 경계 | exact catalog ID와 양쪽 revision을 보존하고 이름을 identity로 사용하지 않음 | `product-read.v1`, Nutrition schema/repository test |
| 사용자 권한 | `auth.uid()` 소유권과 신뢰 가능한 관리자 metadata 사용 | RLS migration·test 존재, live 브라우저 test 미실행 |
| 비밀값 | service role·외부 API key를 `NEXT_PUBLIC_*`에 두지 않음 | Edge Function·Actions 환경 경계와 변경 파일 scan |

현재 트리에서 private 원본은 추적하지 않습니다. 과거 공개 이력에 민감 정보가
존재하는지와 이력 재작성 필요성은 별도 보안 검토 범위이며, 강제 push는 승인·백업·
협업자 조율 없이 수행하지 않습니다.

## 10. 테스트와 검증 전략

| 수준 | 도구 | 검증 대상 | 2026-08-11 상태 |
| --- | --- | --- | --- |
| 정적 분석 | ESLint | source code 규칙 | 통과 |
| 타입 검사 | TypeScript strict | 타입·계층 경계 | 통과 |
| 공개 영수증 | Zod + privacy/link 검사 | 4개 영수증, 223개 연결 관측, revision·금지 필드 | 통과 |
| 공식 카탈로그 | snapshot schema + source SHA | PX 공식 listing 2,269건 | 통과 |
| 단위/저장소 테스트 | Vitest | 영수증, 카탈로그, 규격, 장바구니, 승인 queue, product-read/Nutrition, 정산 | 36 files / 202 tests 통과 |
| LinkProposal contract | Node/Vitest validator | strict-v6 target alignment, reconciliation, exact-name, approval gate | 통과 |
| E2E | Playwright Chromium | 탐색·URL 복원·dialog focus·장바구니·공식 상품·승인 영양·모바일 | 16/16 시나리오 통과; 완료 후 teardown에서 240초 timeout |
| production build | Next.js | static export | 통과 |
| Android package | Capacitor + Gradle | web sync와 debug APK | 로컬 build 통과, 실제 기기 미검증 |
| Supabase remote | Supabase CLI | migration list, DB lint | `20260810193000`까지 local/remote 정합, lint 결과 0건 |
| 저장소 문서 runtime | Node | configured document validator, Notion render-only dry run | 두 문서 통과 |
| GitHub Pages 운영 | GitHub Actions | static export 배포 | 과거 run `30198781229` 성공; 최신 기능 미검증 |
| Notion 운영 | GitHub Actions + preflight/read-back | Intro·Detail replace와 source commit·fingerprint | 2026-08-11 두 페이지 preflight, 현재 source `80dee8b`; 이번 revision은 병합 후 확인 |

### 검증 이력

| 일시 | 기준 | 명령/환경 | 결과 | 미검증 항목 |
| --- | --- | --- | --- | --- |
| 2026-08-11 | `49fd5e3` 기능 트리 | lint → typecheck → unit → public receipts → official catalog → build | 모두 exit 0, 36 files / 202 tests, 영수증 4건·관측 223건, 공식 listing 2,269건 | 최신 Pages 기능 smoke test |
| 2026-08-11 | `49fd5e3` 기능 트리 | `npm.cmd run test:e2e` | Chromium 16/16 시나리오 통과; 완료 후 dev-server teardown에서 240초 timeout | 명령 정상 종료 원인 확인, 배포 브라우저 |
| 2026-08-11 | `49fd5e3` 기능 트리 | `npm.cmd run android:debug` | Capacitor sync·Gradle debug APK 생성 | 실제 Android 기기 기능 |
| 2026-08-11 | 연결 원격 Supabase | migration list → DB lint | `20260810193000`까지 local/remote 정합, lint 결과 0건 | live Auth·RLS·승인·장애 흐름 |
| 2026-08-11 | 문서 브랜치 | validator → 2문서 render-only dry run → Notion 대상 GET preflight | 로컬 문서 계약 통과, 현재 두 미러 접근 가능 | main 병합 commit의 Actions publish·post-write read-back |
| 2026-08-08 | `3ed567e` 기능 트리 | lint → typecheck → unit → public receipts → official catalog → build → E2E | 모두 exit 0, 29 files / 161 tests, 영수증 4건·관측 223건, 공식 listing 2,269건, E2E 9건 정상 종료 | 최신 Pages 기능 smoke test |
| 2026-08-08 | `3ed567e` 기능 트리 | `npm.cmd run android:debug` | Capacitor sync·Gradle debug build 성공 | 실제 Android 기기 기능 |
| 2026-08-08 | 연결 원격 Supabase | migration dry-run → apply → list → DB lint | `20260805011500` 적용·local/remote 정합, schema error 없음, 기존 unused-variable warning 1건 | live Auth·RLS·승인·장애 흐름 |
| 2026-08-08 | 최신 `maintain-project-docs` | skill tests / repository installer dry-run | 46/46 tests, pinned 8개 파일 모두 unchanged | GitHub runner와 이번 Notion publish |
| 2026-07-26 | `f86ec4b` | 자동 발행 [run 30198781222](https://github.com/Yeon-sik/PriceTrace/actions/runs/30198781222) / Pages [run 30198781229](https://github.com/Yeon-sik/PriceTrace/actions/runs/30198781229) | 승인 대기 없이 Intro·Detail sync, source commit·fingerprint 재조회, Pages build·deploy 성공 | 정기 drift·최신 기능 smoke test |
| 2026-07-26 | `218c9a4` | 수동 복구 [run 30198169508](https://github.com/Yeon-sik/PriceTrace/actions/runs/30198169508) | 두 페이지 sync 후 source commit·fingerprint 재조회 | 장기 drift |
| 2026-07-26 | `a5abec7` | 승인형 발행 [run 30196804832](https://github.com/Yeon-sik/PriceTrace/actions/runs/30196804832) | Environment 승인 후 Intro·Detail sync·재조회 | Notion UI별 시각 차이 |

로컬 통과를 배포, 원격 권한, 실제 기기 동작으로 확장해 표현하지 않습니다. 외부
환경은 그 환경에서 직접 확인한 행만 실환경 근거로 기록합니다.

## 11. 배포·운영·복구

```text
코드 변경 → feature branch → PR checks → main merge
                                  └→ deploy-pages.yml → static export → GitHub Pages

Project_Intro/Project_Detail 또는 문서 runtime 변경
  → PR에서 validator + render-only dry-run
  → project-docs.config.json의 canonicalBranch/publicationMode 확인
  → Actions가 이벤트 commit을 checkout해 tracked Markdown 로드
  → Notion 두 페이지 GET preflight
  → Intro/Detail replace_content
  → 응답 ID·source commit·fingerprint 검증
```

- `deploy-pages.yml`은 `main` push 또는 수동 실행에서 static export를 배포합니다.
- `project-docs-notion.yml`은 canonical branch를 workflow에 하드코딩하지 않고 `project-docs.config.json`에서 계산합니다.
- PriceTrace의 `publicationMode`는 `on-main-push`입니다. 관련 Markdown·설정·runtime이 `main`에 병합되면 검증 후 자동 발행합니다.
- sync runtime은 Actions가 checkout한 canonical-branch event commit의 tracked Markdown을 publication 입력으로 사용합니다.
- 두 Notion 페이지 쓰기는 transaction이 아니므로, 부분 실패 시 같은 source commit으로 workflow를 재실행해 수렴시킵니다.
- Git Markdown이 진실 원천이고 Notion 본문은 source commit과 fingerprint를 가진 읽기 전용 미러입니다.
- 구체적인 Secret, 첫 발행, 복구 절차는 [PROJECT_DOCS_OPERATIONS.md](./PROJECT_DOCS_OPERATIONS.md)에 기록합니다.
- 잘못된 정산 backup import는 전체 schema 검증 전에 기존 상태를 바꾸지 않습니다. 원격 DB 복구 rehearsal은 아직 실행하지 않았습니다.

## 12. 문제 해결 사례

### 공개 데이터 전환 뒤 E2E 고정 기대값이 어긋남

- **증상**: 데이터 revision이 바뀌자 이전 집계 문구를 기대하던 E2E가 실패했습니다.
- **원인**: 민감 fixture를 검증 공개 projection으로 바꿨지만 test가 정상적으로 변할 수 있는 건수를 UI 문구로 고정했습니다.
- **대응**: 접근 가능한 상품명, 관측 시점, 가격, 장바구니 복원처럼 사용자 행동과 domain contract를 검증하도록 변경했습니다.
- **회귀 방지**: 변동 가능한 데이터 건수보다 안정적인 행동·접근성·provenance를 assertion으로 사용합니다.

### 저장소 문서 runtime이 최신 skill과 두 파일 어긋남

- **증상**: 최신 installer dry-run에서 workflow와 Notion sync runtime 두 파일이 conflict로 보고됐습니다.
- **원인**: 저장소 pinned runtime에는 config 기반 canonical ref와 immutable source Markdown 주입 경로가 없었습니다.
- **대응**: 최신 skill contract에 맞춰 두 파일을 복원하고 skill test 46건을 통과시켰습니다.
- **검증**: installer dry-run을 다시 실행해 생성 대상 0개, pinned 8개 파일 모두 unchanged를 확인했습니다.
- **회귀 방지**: 문서 갱신 PR에서 validator와 render-only dry-run을 실행하고, skill upgrade 시 installer dry-run을 먼저 비교합니다.

### 로컬 migration과 연결 원격 DB의 적용 상태가 달랐음

- **증상**: 원격 dry-run에서 사용자 선택 exact variant·composite kit migration 한 건이 대기 상태로 나타났습니다.
- **대응**: 대상 목록을 확인한 뒤 append-only migration을 적용하고 local/remote 목록을 재조회했습니다.
- **결과**: 2026-08-11 재조회에서 양쪽이 `20260810193000`까지 일치했고 DB lint 결과도 0건이었습니다.
- **남은 경계**: schema 정합은 실제 관리자 Auth·RLS·승인 E2E를 대신하지 않습니다.

## 13. 한계, 기술 부채, 다음 단계

| 우선순위 | 항목 | 사용자/운영 영향 | 다음 행동 |
| --- | --- | --- | --- |
| P0 | 배포 관리자 승인 전체 흐름 미검증 | LinkProposal 안전 계약이 실제 Auth·RLS·RPC 환경에서 동작하는지 불확실 | 제안 1건으로 로그인 → RLS 거부/허용 → 승인 → 결과·감사 기록 재조회 |
| P0 | Nutrition production 통합·승인 흐름 미검증 | mock E2E와 실제 별도 DB의 RPC·승인 데이터가 다를 수 있음 | exact variant 한 건으로 공개 조회 → 부분 실패 → 승인 결과를 production에서 재검증 |
| P1 | 최신 기능의 GitHub Pages smoke test 미실행 | 로컬 E2E와 실제 정적 배포 사이 차이 가능 | desktop/mobile에서 탐색·공식 상품·장바구니 smoke test |
| P1 | Nutrition 제안 UI 미연결 | versioned proposal 계약이 있어도 사용자는 화면에서 link/unlink를 제안할 수 없음 | 승인 운영 주체·UX를 확정한 뒤 별도 기능으로 연결 |
| P1 | Playwright teardown timeout | 모든 시나리오 성공 뒤에도 CI/로컬 작업이 실패로 보일 수 있음 | webServer 종료 조건과 열린 handle을 별도 진단 |
| P1 | catalog mapping 없는 ProductGroup이 정규화 이름 fallback에 의존 | 이름 변경·충돌 시 화면 그룹이 불안정 | 원본 관측 ID와 별도의 안정적 group key 설계 |
| P1 | 규격·판매처 관측 근거가 부족한 상품 존재 | 단위 가격 비교와 exact variant 연결 범위 제한 | 검증 가능한 근거만 축적하고 충돌 후보는 미연결 유지 |
| P2 | Notion 수동 drift의 주기 감지 없음 | main push 사이에 미러가 수동 변경될 수 있음 | 반복 운영 가치가 확인되면 read-only 정기 검증 추가 |
| P2 | Android 실제 기기 미검증 | 모바일 패키지의 실제 상호작용 품질 미확인 | 대표 기기에서 설치·실행·핵심 flow smoke test |

OCR, 알림, 지도, 추가 가격 API는 위 P0/P1 위험을 줄이기 전에는 우선 구현하지
않습니다.

## 14. 배운 점과 재설계 방향

- **유지할 결정**: 원본 증거와 가변 상태 분리, 경계의 runtime 검증, provenance 보존, 사람 승인 가능한 상품 연결
- **강화할 결정**: 이름 유사도보다 exact variant 근거와 fingerprint를 실행 조건으로 두고 승인 뒤 결과를 재조회
- **운영 원칙**: 로컬 build, 원격 schema, 배포 UI, 실제 기기, Notion 미러를 서로 다른 검증 계층으로 보고 각각의 증거만 기록
- **추가 검증이 필요한 가설**: 사용자가 영수증 구매 관측과 공식 표시가의 차이를 이해하고 다음 장보기 비교에 반복 활용하는가

## 15. 관련 문서

- [Project Intro](./Project_Intro.md)
- [Operations Runbook](./OPERATIONS_RUNBOOK.md)
- [Official Product Discovery](./OFFICIAL_PRODUCT_DISCOVERY.md)
- [Product Nutrition Link](./integrations/product-nutrition-link.md)
- [프로젝트 문서 운영](./PROJECT_DOCS_OPERATIONS.md)
- [범용 Intro 템플릿](./templates/PROJECT_INTRO_TEMPLATE.md)
- [범용 Detail 템플릿](./templates/PROJECT_DETAIL_TEMPLATE.md)
