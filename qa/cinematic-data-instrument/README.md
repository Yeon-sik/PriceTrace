# Cinematic Data Instrument — 구현 및 검증

## 범위와 보존

- 작업 위치: `.worktrees/cinematic-data-instrument`, branch `feat/cinematic-data-instrument`.
- 시작 HEAD `1086f76`: 기존 카탈로그 전체 페이지 조회 수정 포함. 작업 시작 시 `origin/main`은 `df8bd63`이며 이 branch는 main보다 1개 커밋 앞서 있었다.
- 원래 `recovery/ocr-v5-migration-history` 작업 디렉터리의 AndroidManifest 및 10개 launcher 이미지 보존. Manifest SHA-256 `EAA7218B3F0B246F7E2D6F28526E933BFF87818D2EF0862D60AB8F5EDFE18937` 재확인.
- 기존 Next.js 15.3 / React 19 / TypeScript strict / CSS Modules / query-string navigation / repository·hook 경계 유지.
- Supabase migration, DB schema, 공개 데이터 원본, 상품·판매처 identity, 가격 계산, RLS, 영양 계약, package.json/lock 변경 없음. 원격 DB write 없음. 구현 단계 이후의 커밋 검증은 아래 후속 기록에 남긴다.

## 구현

| 영역 | 변경 |
|---|---|
| 홈 | 기존 영수증 기록을 직접 탐색하는 SVG 관측 구조와 native range. 날짜·판매처·가격은 HTML로 표시. 같은 날짜의 별도 관측도 유지하며 가격 변화를 만들지 않음. |
| 앱 셸 | 정리된 단일 데스크톱 내비게이션, 모바일 하단 내비게이션, 본문 건너뛰기, 로그인과 장바구니 동작 유지. |
| 시각 체계 | mineral-black 표면, 제한된 녹색, 자체 제공 SUIT Variable, Solar Linear 아이콘, tabular numerals, 작은 radius와 얇은 구분선. |
| 상품 탐색 | 모바일 필터·정렬 접기/펼치기와 선택 조건 요약. 검색은 항상 표시. 사진 없는 상품의 대체 영역 축소. 공식 등재의 지점 재고 비보장 문구 유지. |
| 보조 화면 | 상품·음식점·판매처·장바구니·인증·상세 모달의 색상/대비/간격 통일. 음식점 안내에서 구현 용어 제거. |
| 로딩 비용 | 관리자 UI를 dynamic import로 분리하고 로딩 상태 제공. 애니메이션 라이브러리 추가 없음. |

핵심 구현 파일:

- `src/app/globals.css`, `layout.tsx`, `page.tsx`, `page.module.css`
- `src/app/ProductBrowser.tsx`, `ProductImage.tsx`, `MarketBrowser.tsx`, `RestaurantBrowser.tsx`, `AuthPanel.tsx`
- `src/components/Icon.tsx`
- `src/features/observation-instrument/ObservationHome.tsx`, `ObservationInstrument.tsx`, `observation-selector.ts`, `use-observation-motion.ts`, `observation-instrument.module.css`
- 회귀: `observation-selector.test.ts`, `e2e/observation-instrument.spec.ts`, `e2e/shopping.spec.ts`의 장식 화살표에 의존하던 접근성 선택자

## Skill 적용

- Impeccable 공식 project installer 성공: skill 4.5.0, engine 0.1.11. context 실행 성공. 자동 hooks 설치 없음. SKILL.md/reference를 직접 읽고 적용.
- MengTo 요청한 8개 skill을 선택 설치하고 각각 SKILL.md를 읽음.
- Three.js / R3F / GSAP / ScrollTrigger / Lenis는 runtime에 추가하지 않음. 현재 관계 시각화는 SVG와 native range로 구현할 수 있으며, 본 작업 화면의 native scroll 및 로딩 비용을 유지하기 위해 선택.
- `impeccable_finish_reviewer`, `impeccable_documenter` 전용 role은 현재 harness에 없어 새 문맥의 일반 agent를 독립 리뷰와 문서화에 사용. 전용 role이 실행됐다고 주장하지 않음.
- Impeccable detector 1회: 12건의 경고. 장식 테두리 선언 10곳을 1px로 수정. 영양성분표의 큰 구분선 3건은 정보 구조에 필요해 유지. 검사 재실행으로 무경고를 주장하지 않음. 원본과 disposition은 `.impeccable/review/detector*.json`에 보존.

## 실행 검증

| 검사 | 결과 |
|---|---|
| `npm.cmd run lint` | 통과 |
| `npm.cmd run typecheck` | 통과 |
| `npm.cmd run test` | 53 files / 536 tests 통과 |
| `NEXT_DIST_DIR=.next-production npm.cmd run build` | 정적 export 통과 |
| `npm.cmd run test:e2e -- --workers=1` | 29개 통과 (3.6분, source 고정, workers=1) |
| `git diff --check` | 통과 (EOF 공백 정리) |

추가 단위 회귀: 실제 관측 정렬, 동률 ID 정렬, 입력 비변경, 상품/판매처 identity 보존, 날짜-only 사실, 빈 데이터, 대표 대상 개수 제한.
추가 브라우저 회귀: 키보드 시점 선택/기록 열기, reduced motion, 화면 밖 모션 중지/재진입, 모바일 필터 상태 유지. 기존 카탈로그 중간 실패·재시도·계정 변경, 로그인 focus, 장바구니, 음식점, 영양 흐름도 포함.

초기 테스트 실패는 신규 fixture의 기존 그룹 규칙 가정, 테스트 import 경로, 모바일 초기 렌더 대기와 중복 정렬 선택자를 수정해 해결했다. 이후 한 E2E 실행에서 개발 서버 갱신과 겹쳐 탐색 후 홈 화면을 보는 대기 실패가 발생했다. 기존 assertion은 완화하지 않고 소스를 고정한 전체 순차 재실행에서 29개 모두 통과했다.

## 실제 화면 / 성능

- 최종 화면: 프로덕션 정적 export, Chromium 1440×1000 및 390×844. 홈·상품·판매처·음식점·빈 장바구니, 로그인/가격 기록 모달 캡처. 상품·음식점은 실제 공개 RPC 결과가 완료된 뒤 캡처. 상품 이미지는 viewport 내 load 완료까지 대기.
- 320 / 390 / 768 / 1024 / 1440 CSS px에서 page overflow 없음.
- reduced motion + WebGL unavailable 조건의 홈과 상품 탐색 확인. WebGL 자체를 요구하지 않음.
- settled 화면 10개에서 실행 중 애니메이션 0, pageerror 0. 포인터 반응은 최대 1개 pending RAF만 사용하며 이벤트가 없으면 실행하지 않음. 화면 밖/hidden/reduced motion/터치에서는 정적 표시.
- First Load JS: **540 kB → 498 kB** (Next build 보고, 약 7.8% 감소).
- SUIT WOFF2: 624,536 bytes. 첫 방문 비용에 포함되며 자체 제공/cache 가능. 폰트 교체 전 system fallback으로 텍스트 표시.
- 로컬 gzip 정적 서버, 새 Chromium context 1회 측정: subresources 10개 / transfer 1,162,740 bytes / decoded 3,868,136 bytes, navigation 1,850ms, LCP 128ms. 로컬 측정이며 실제 네트워크/Core Web Vitals 성능 보장은 아님. font bytes는 위 transfer에 포함.
- 원격 배포, Safari/iOS 실기기, Android 기기, 스크린리더 수동 검증은 수행하지 않음. Android 패키징은 아래 후속 검증에서 확인했다.

## 디자인 평가

각 기준 0–2점: 사실/정보 위계, 시각적 고유성, 타이포/대비, 반응형/접근성, 절제/성능. 점수는 판단값이며 외부 인증이 아님.

| 평가 시점 | 홈 | 카탈로그 | 보조 화면 |
|---|---:|---:|---:|
| 기존 화면 자기평가 | 5 | 6 | 6 |
| 첫 독립 리뷰 | 7.5 | 6.5 | 7.5 |
| 수정 후 독립 판정 | 8.5 | 8 | 8 |

첫 리뷰의 5개 항목을 수정: 모바일 상품명·가격 노출, 모바일 최근 관측 날짜, 음식점 구현 용어, 첫 화면의 시점 선택 노출, 판매처 카드 정보 순서/이동 단서.

최종 독립 판정은 **`ship`**. 검토 범위는 제공된 최종 데스크톱·모바일 캡처와 위 5개 수정 항목이며 모두 해결됐다는 판정을 받았다. 음식점 상세가 로딩 중이던 캡처는 실제 식당 이름과 메뉴가 표시된 후 다시 확보해 최종 판정에 사용했다. 작은 보조문구와 상품별 정보 밀도 편차는 남아 있으며, 이번 검토에서 차단 사유로 판단하지 않았다.

위 5개 평가 기준에서 각 화면 8점 이상이라는 목표를 충족했다. 독립 점수는 해당 화면과 수정 범위의 디자인 판단이며 전체 제품의 보안·접근성·배포 인증을 의미하지 않는다.

## 증거 위치

- `.impeccable/review/before-*.png`: 변경 전.
- `.impeccable/review/review-*.png`: 최종 화면으로 갱신된 독립 리뷰 입력.
- `.impeccable/review/final-*-home-viewport.png`: 첫 viewport.
- `.impeccable/review/final-*-trend.png`, `final-*-login.png`, `final-*-restaurant-detail.png`.
- `.impeccable/review/final-metrics.json`, `production-performance.json`, `detector.json`, `detector-disposition.json`.
- `DESIGN.md` / `.impeccable/design.json`: 실제 코드에서 추출한 디자인 규칙.
- `ASSET_SOURCES.md`: 폰트/아이콘 출처 및 라이선스.

검증 스크립트와 screenshot은 local tooling으로 `.gitignore`에 제외했다. 실제 source와 회귀 테스트, 디자인 문서는 저장소에서 검토 가능하다.

## 후속 커밋 검증 (2026-10-11)

- `npm.cmd run lint`, `npm.cmd run typecheck`: 통과.
- `npm.cmd run test`: 53 files / 536 tests 통과. 기반 카탈로그 페이지 조회의 19개 단위 회귀 포함.
- `NEXT_DIST_DIR=.next-production npm.cmd run build`: 정적 export 통과.
- `npm.cmd run test:e2e -- --workers=1`: 29개 통과 (3.4분). 카탈로그 중간 실패·재시도·계정 변경·로그아웃 회귀 포함.
- `npm.cmd run android:debug`: `NEXT_DIST_DIR`를 설정하지 않은 표준 `out` 경로에서 APK 빌드 통과. 최초 검증에서 임시 production 경로를 사용해 Capacitor가 `out`을 찾지 못한 뒤, 코드 변경 없이 표준 경로로 재실행했다.
- 커밋 범위: 런타임 소스, 회귀 테스트, 폰트와 라이선스, 디자인 문서, 이 QA 기록. 설치된 skill 디렉터리와 생성된 검토 자료는 로컬에 보존한다.

## 미병합 작업 통합 검증 (2026-10-14)

통합 branch: `feat/merge-pending-commits-20261014`, PR #63. 기반 main은 `d85a72f44072fec3e517a2c717489b94c3a24b1e`다.

| 원래 branch | 통합한 HEAD |
|---|---|
| `feat/pricetrace-app-icons` | `e523e429` |
| `feat/catalog-complete-pagination` | `1086f766` |
| `feat/cinematic-data-instrument` | `93545c66` |
| `feat/fitness-dining-proposals` | `d16b67f0` |
| `feat/price-observation-submit-v1` | `4ec3c50c` |
| `feat/verified-receipt-source-facts` | `594adcf7` |

- 현재 OCR 구매 행 검수·identity·사용자 확인 식당·영양 계약을 기준으로 충돌을 해결했다. 이미 squash 병합된 branch는 현재 내용의 동등성을 확인한 뒤 원래 커밋의 ancestry를 기록했다. 기존 migration 파일은 수정하지 않았다.
- nullable 영수증 원본 사실과 `observationCreated`/`observationStatus`를 현재 계약에 추가하고, ChatGPT 계약 소스팩을 기존 생성기로 갱신했다. legacy pending 후보와 OCR 추가 검수 후보를 구분하며 owner/admin/anonymous 권한 회귀를 유지했다.
- 개인 구매가 공개 홈의 관측 수·판매처 수·최근 관측에 포함되는 통합 오류를 실패 테스트로 재현한 뒤, 홈은 검증된 공개 영수증에서 만든 그룹만 사용하도록 수정했다. 상품 목록에서는 기존 owner 구매 조회를 유지한다.
- 비동기 카탈로그·owner 구매 조회를 E2E가 응답 완료 후 검증하도록 동기화했다. 이미 main에서 `1회분`으로 수정된 영양 열 제목에 맞춰 과거 `100serving` 기대값을 갱신했다. 가격·영양 환산과 계정 격리 assertion은 유지한다.

| 검사 | 결과 |
|---|---|
| `npm.cmd run lint` | 통과 |
| `npm.cmd run typecheck` | 통과 |
| `npm.cmd run test` | 74 files / 603 tests 통과. 재제출 SQL fixture를 실행하는 PGlite 회귀 포함. |
| `npm.cmd run test:purchase-sql` | 101개 migration을 문서화된 역사적 bootstrap 보정과 함께 로컬 메모리 DB에 적용한 뒤 구매·영수증·owner 권한 fixture 6개 통과. 실제 Supabase 서비스/JWT 검증은 아님. |
| `npm.cmd run build` | production 정적 export 통과. First Load JS 503 kB. |
| production export의 전체 Playwright 회귀 | 36개 통과 (6.1분, workers=1). |
| `npm.cmd run android:debug` | 표준 `out` 경로에서 Capacitor 동기화와 `assembleDebug` 통과. 기기 설치 없음. |

브라우저 검증은 개발 서버의 compile/HMR 대기를 배제하기 위해 synthetic API fixture 환경으로 production export를 만든 뒤, 임시 loopback 정적 서버와 기존 Playwright 설정을 상속한 임시 config로 수행했다. 실제 실행 명령은 `npm.cmd run test:e2e -- --config=.merge-playwright.config.ts --workers=1 --timeout=90000`이다. 전체 test 시간 예산만 늘렸으며 5초 assertion과 데이터·권한 검증은 완화하지 않았다. 임시 서버/config는 검증 후 제거했다. 처음 production 실행은 과거 `100serving` 기대값에서 1개 실패했고, 현재 표시 계약을 반영한 전체 재실행에서 36개 모두 통과했다.

원격 migration 이력은 읽기 전용으로 확인했다. 가격 관측 제출 v1과 nullable 영수증 source facts migration은 원격에 적용되어 있으나, `20261005010000_rejected_dining_proposal_resubmission.sql`은 미적용이다. 기존의 다른 local/remote 이력 차이를 자동 복구하거나 production DB에 쓰지 않았다. Git 통합과 실제 재제출 RPC의 원격 동작은 별도의 완료 상태다.

주문 캡처 worktree의 미커밋 17개 변경, stash 4개, 다른 worktree의 로컬 skill·생성 자료를 보존했다. 실제 원격 사용자 세션과 Android 실기기 동작은 검증하지 않았다.
