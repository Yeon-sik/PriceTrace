# 내 브랜드·가게·식당 연결 v1

## 범위와 진실 원천

로그인한 사용자가 자신이 입력한 브랜드·가게·식당 이름을 기존 항목에 명시적으로 연결한다. 연결은 `owner_identity_connections`에 계정별로 저장하며 OCR 후보, 영수증, 구매 행, 가격 관측, 전역 상품 검증 상태를 덮어쓰지 않는다.

- 브랜드: 내 `product_identity_candidates`의 브랜드 입력 → 활성 `brands` 항목.
- 가게: 내 `stores` 입력 → 같은 계정의 기존 가게. 지점·사업자번호 등 알려진 식별 필드가 충돌하는 후보는 제외한다.
- 식당: 내 확인 식당 → 같은 계정의 기존 확인 식당. 지점·출처·확정된 식당 식별자가 충돌하는 후보는 제외한다.

이름 유사도 0.85 이상은 검색 후보 근거다. 동일 항목이라는 승인이나 자동 병합을 뜻하지 않는다. 후보 선택 후 **같은 항목으로 확인하고 연결** 버튼을 눌러야 저장된다. 검색어를 변경하면 이전 선택과 확인 버튼을 해제한다.

## RPC와 접근 제어

| RPC | 계약 | 용도 |
| --- | --- | --- |
| `get_my_identity_connection_sources_v1(uuid[])` | `identity-connections.v1` | 내 원래 입력과 선택된 연결 조회. 기본 최근 200개, 초과 시 `truncated: true`. |
| `search_my_identity_connections_v1(text, uuid, text)` | `identity-search.v1` | 정확한 입력 ID와 검색어에 묶인 후보 최대 20개 조회. |
| `connect_my_identity_v1(text, uuid, uuid, text, boolean)` | `identity-connections.v1` | 소유권·후보 유효성·명시적 확인을 재검증한 뒤 연결. |
| `get_my_owner_confirmed_restaurants_v3()` | `owner-restaurant-read.v3` | 확인한 연결을 반영한 내 식당 조회. |

`anon`은 연결 테이블 조회와 RPC 실행을 할 수 없다. `authenticated`의 직접 테이블 조회는 RLS로 본인 행만 허용하며, 직접 쓰기는 허용하지 않는다. 계정이 바뀌면 웹의 이전 조회 결과와 진행 중 요청을 폐기한다. RPC 결과는 Zod로 검증하고 계정·입력·검색어·저장 대상이 요청과 맞는지 확인한다.

같은 연결 재요청은 멱등적이다. 연결 대상 변경, 순환 연결, 다른 입력들이 참조하는 대상을 다시 연결하는 요청은 차단한다. 연결 해제·재지정 UI는 이번 범위에 없다.

## 표시와 호환성

- 가게 연결은 내 상품 목록의 판매처 표시와 판매처 identity에 반영한다. 공개 홈의 관측 수·영수증 수·판매처 수·최근 기록에는 개인 구매 데이터가 섞이지 않는다.
- 식당 v3는 명시적으로 연결한 식당을 묶되 기존 메뉴·가격 관측 ID와 구매 사실을 보존한다. v3가 없는 서버에서만 v2, v1 순서로 조회한다.
- 기존 v1/v2 식당 계약은 유지한다. FitnessApp 코드·배포·데이터는 변경 대상이 아니다.
- 브랜드 연결은 사용자 입력에 대한 선택 기록이며 전역 표준 상품의 브랜드를 변경하지 않는다.
- 웹과 OCR이 공유하는 서버 계약이다. 이번 마무리는 PriceTrace 웹에 한정하며 OCR 저장소는 변경하지 않는다.

## 통합과 검증 기록

`feat/finish-identity-connections`에서 기존 미완료 변경을 보존한 뒤 `origin/main`의 `ad93811fa95a05e296470d1906dda97c14caab14`와 통합했다. 최신 main의 관리자 화면 진입 조건과 브랜드 SQL 회귀 시험을 유지했다.

기존 실패 두 건은 통합 후 수정 전 재실행에서도 통과했다. 실제 개인정보 누출이나 URL 라우팅 결함이 재현되었다고 보지 않는다. 시험의 화면 준비 기준을 명확히 하고 기존 검증을 유지했다.

- 개인 구매의 공개 홈 제외: 인증과 활성 메뉴를 기다린 뒤 공개 통계·최근 기록 및 개인 상품·판매처 비노출을 확인.
- 공유 URL/뒤로가기: URL에서 활성 상품 메뉴가 복원된 뒤 화면을 확인하고 새로고침 및 브라우저 이력도 검증.
- 추가 E2E: 브랜드 연결의 명시적 승인과 재조회, 가게 연결 후 판매처 필터 갱신, 식당 검색 변경 시 선택 해제와 명시적 승인.
- SQL 회귀: 소유권·RLS·직접 쓰기 차단·명시적 승인·중복 요청·순환/재지정 차단·원본 보존·메뉴/가격 ID 보존·v2 호환성을 실제 로컬 PostgreSQL 역할로 검증.

`20261018130323_shared_identity_connections.sql`은 기존 원격 적용 이력이다. 이번 작업에서 내용을 재작성하거나 원격 DB에 다시 적용하지 않는다. SQL 시험은 PGlite의 임시 DB에서 실행하고, E2E는 모의 Supabase 응답을 사용한다. 실제 사용자 계정으로 원격 연결을 생성하는 시험이나 물리 Android 기기 시험은 별도 증거가 필요하다.

2026-10-28 KST 마무리 검증:

| 명령 | 결과 |
| --- | --- |
| `npm.cmd run lint` | 통과 |
| `npm.cmd run typecheck` | 통과 |
| `npm.cmd run test` | 79개 파일, 625개 시험 통과 |
| `npm.cmd run test:purchase-sql` | 11개 SQL fixture 통과. 기존 시험기의 명시된 과거 SQL 구문 보정을 포함해 migration 107개 부트스트랩. |
| `npm.cmd run build` | 정적 프로덕션 빌드 통과 |
| `npm.cmd run test:e2e -- --workers=1` | 43개 통과. 기존 실패 두 건 포함. |
| `npm.cmd run android:debug` | 글자색 보완 후 웹 재빌드·Capacitor sync·Gradle `assembleDebug` 통과. 기기 설치는 하지 않음. |
| `npm.cmd run test:e2e -- e2e/identity-connections.spec.ts e2e/owner-confirmed-restaurants.spec.ts e2e/shopping.spec.ts --workers=1 --grep '명시적 확정\|브랜드 연결\|가게 연결\|개인 구매 상품\|공유 URL과'` | 글자색 보완 후 핵심 5개 재검증 통과 |

데스크톱·390px 모바일 화면을 확인하고 후보 이름에 전역 `strong` 색상이 적용되어 대비가 낮아지는 문제를 해당 패널에서만 보완했다. 디자인 기계 검사에는 입력 16px·보조 14px의 타입 크기 권고 2건이 남았으며, 입력 가독성을 유지하기 위해 채택하지 않았다. 도구의 기존 메타데이터 불일치(웹/Android 맥락, 디자인 sidecar, buildPath)도 기능 범위 밖으로 기록하고 유지했다. 공개 영수증·공식 카탈로그 JSON은 변경하지 않았다.
