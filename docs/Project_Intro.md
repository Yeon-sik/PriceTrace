# PriceTrace | 출처·시점·상품 identity가 있는 가격 관측 플랫폼

영수증 구매 관측과 공식 판매채널 등재를 출처·관측일과 함께 탐색하는 Next.js 웹·Capacitor 앱이다. 표준 상품군·정확 규격·브랜드·판매처·식당·메뉴 identity와 관리자 검토 authority를 소유한다.

| 항목 | 내용 |
| --- | --- |
| 문서 갱신 | 2026-10-30 (Asia/Seoul) |
| 기준 소스 | [main@ba55e17](https://github.com/Yeon-sik/PriceTrace/tree/ba55e17cd36366d9f67abc40f222288125f770b2) |
| 저장소 | [Yeon-sik/PriceTrace](https://github.com/Yeon-sik/PriceTrace) |
| 범위 | 2026-10-30 감사 시점에 병합된 main source와 저장소에 남은 검증 근거. 개발 branch·미커밋 작업은 제외. |

## 1. 30초 요약

PriceTrace는 가격 숫자만 저장하는 앱이 아니라 상품·브랜드·판매처·식당 identity와 관측 근거를 분리해 관리하는 가격 관측 플랫폼이다.

- 10월 main에는 브랜드 hierarchy/public catalog, packaged-product candidate의 브랜드 resolution, shared identity connection이 추가됐다.
- 공개 barcode lookup은 verified conflict를 별도 표현하고, AR 데모 등록과 downstream consumer가 잘못된 단일 identity를 강제하지 않도록 계약을 갖는다.
- OCR 구매 경로는 owner-confirmed restaurant, restaurant component identity, purchase-price response/recovery 계약을 확장했다.
- 웹에는 Brand Hall·identity connections·owner-confirmed restaurants·order capture·observation instrument와 관련 E2E가 추가됐다.

## 2. 문제와 해결

**문제**: 이름이 비슷한 상품·브랜드·매장·메뉴를 같은 identity로 확정하면 가격 비교와 OCR·Fitness·AR 연결이 잘못된다. 응답 유실이나 과거 관측 재사용 과정에서 새 identity를 임의 생성해도 데이터 계보가 깨진다.

**해결**: 사실·관측·상품군·정확 규격·브랜드·판매처 identity를 별도 계약으로 보존한다. 검수된 source와 owner checkpoint를 기반으로 exact/resolved 결과만 연결하고, ambiguity·conflict는 fail closed한다.

## 3. 핵심 기능과 결과

| 영역 | 현재 source에서 확인한 범위 |
| --- | --- |
| 탐색 | 공개 영수증·관측, 공식 채널 snapshot, 상품·브랜드·매장·식당 검색·필터·가격 이력과 장바구니. |
| 상품·브랜드 identity | standard/catalog product, brand hierarchy, seller mapping, packaged-product candidate resolution과 public barcode lookup. |
| OCR 구매 authority | verified receipt, purchase observation, owner-confirmed restaurant, restaurant component·purchase option identity와 saved-response 복구. |
| 연결 계약 | shared identity connections, exact product/nutrition link, AR barcode consumer용 public lookup 계약. |
| 검토 UI | Brand Hall, admin brand/merchant candidate, owner-confirmed restaurant, identity connection, order capture/observation instrument. |
| 불변 관측 | exact receipt/menu 관측 재사용, immutable fingerprint 충돌 차단, forward-only migration. |

## 4. 검증 현황

| 항목 | 상태 | 근거와 한계 |
| --- | --- | --- |
| 최신 main source | 저장소 검증 | `main@ba55e17`까지 domain/repository, migration, SQL test fixture, E2E와 cloud-readiness 설정을 대조했다. |
| 이전 Pages/project-docs 실행 | 통과 기록 | 기존 workflow 성공 기록은 존재하지만 최신 HEAD의 운영 RPC·RLS·브라우저 전체를 새로 실행한 증거로 확대하지 않는다. |
| 운영 RPC/RLS·사용자 흐름 | 미검증 | 최신 migration의 실제 Supabase 적용, owner/foreign/anon 권한, barcode conflict, OCR downstream, 모바일 runtime은 이번 갱신에서 실행하지 않았다. |

## 5. 현재 한계와 다음 단계

- migration 파일과 SQL fixture 존재는 운영 DB 적용 완료를 의미하지 않는다.
- public barcode lookup의 conflict/unknown과 브랜드 hierarchy는 소비 앱에서도 같은 의미로 처리해야 한다.
- 다음 우선 검증은 owner checkpoint·brand/product conflict·restaurant component·barcode lookup을 실제 운영 권한과 승인 fixture로 종단 확인하는 것이다.

## 6. 관련 문서

- [프로젝트 상세](./Project_Detail.md)
- [README](../README.md)
- [Public barcode contract](contracts/PUBLIC_BARCODE_LOOKUP_V1.md)
- [Brand catalog](contracts/BRAND_CATALOG_V1.md)

Git Markdown이 원본이며 Notion은 생성 미러다. main 병합 후 설정된 project-docs 정책에 따라 검증·발행한다.
