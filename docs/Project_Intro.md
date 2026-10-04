# PriceTrace | 출처·시점·상품 identity가 있는 가격 관측 플랫폼

영수증 구매 관측과 공식 판매채널 등재를 출처·관측일과 함께 탐색하는 Next.js 웹·Capacitor 앱이다. 표준 상품군·정확 규격·판매처·식당·메뉴 identity와 관리자 검토 authority를 소유한다.

| 항목 | 내용 |
| --- | --- |
| 문서 갱신 | 2026-10-05 (Asia/Seoul) |
| 기준 소스 | [main@bb6bf82](https://github.com/Yeon-sik/PriceTrace/tree/bb6bf825e9ae4c385f5e1b597aa6d68b1d73079c) |
| 저장소 | [Yeon-sik/PriceTrace](https://github.com/Yeon-sik/PriceTrace) |
| 범위 | 병합된 main의 source와 명시한 검증 근거. 개발 branch·미커밋 작업은 제외. |

## 1. 30초 요약

영수증 구매 관측과 공식 판매채널 등재를 출처·관측일과 함께 탐색하는 Next.js 웹·Capacitor 앱이다. 표준 상품군·정확 규격·판매처·식당·메뉴 identity와 관리자 검토 authority를 소유한다.

- 최근 main에는 OCR V5 merchant/menu authority, 적용 migration 정합, owner saved-response 복구, 동일 menu observation 재사용과 legacy store identity 호환 복구가 포함된다.

## 2. 문제와 해결

**문제**: 이름이 비슷한 상품이나 플랫폼을 같은 상품·매장으로 확정하면 가격 비교와 downstream 연결이 잘못된다. 기존 관측을 새 identity로 재생성하면 불변 revision과 충돌한다.

**해결**: 사실·관측·상품군·규격·판매처 identity를 별도 계약으로 보존한다. OCR source review 후 서버가 exact/resolved 결과를 반환하고 owner checkpoint와 동일 관측을 안전하게 재사용한다.

## 3. 핵심 기능과 결과

| 영역 | 현재 source에서 확인한 범위 |
| --- | --- |
| 탐색 | 공개 영수증·관측, 공식 채널 snapshot, 상품·매장·식당 검색·필터·가격 이력과 장바구니. |
| 상품 identity | standard_products 상품군, catalog_products 정확 규격, 판매처 mapping과 승인 제안·product-read.v1. |
| 검증 입력 | verified receipt v2, standalone price v3, purchase observation v4와 packaged-product candidate 독립 계약. |
| OCR V5 authority | merchant source review·restaurant/menu resolution, pending reason·required facts·exact ID, owner saved response와 legacy binding 복구. |
| 불변 관측 | exact receipt/menu 관측 재사용과 source fingerprint 충돌 차단. 기존 정산 도메인은 보존. |

## 4. 검증 현황

| 항목 | 상태 | 근거와 한계 |
| --- | --- | --- |
| 현재 main Pages workflow | 통과 | [Deploy static site](https://github.com/Yeon-sik/PriceTrace/actions/runs/37195087129): 정적 배포 job. 관리자·운영 RPC smoke와 구분한다. |
| 기준 source 문서 workflow | 통과 | [Project docs](https://github.com/Yeon-sik/PriceTrace/actions/runs/37195087123): 이전 문서의 검증·게시이며 이번 Intro/Detail revision을 대신하지 않는다. |
| 운영 RPC/RLS·사용자 흐름 | 이번 갱신에서 미실행 | migration/test source 확인. 현재 owner/foreign/anon·exact identity·OCR downstream runtime은 별도 검증이 필요하다. |

위 결과는 연결한 기준 source revision의 증거다. 이번 변경은 문서·게시 설정만 갱신하며 제품 runtime을 새로 검증한 작업으로 설명하지 않는다. 문서 validator, tracked path·link 검사와 Notion render-only dry run을 수행한다. 병합 뒤 반영은 별도 게시 workflow와 source fingerprint로 확인한다.

## 5. 현재 한계와 다음 단계

- 이번 갱신에서 최근 migration의 실제 Supabase 적용 상태를 새로 검증하지 않았다.
- Pages job 성공을 UI·로그인·관리자 승인·모바일 전체의 정상 증거로 확대하지 않는다.
- 다음 우선 작업은 owner checkpoint·legacy identity·동일 menu observation 재시도를 승인 fixture로 검증하는 것이다.

## 6. 관련 문서

- [프로젝트 상세](./Project_Detail.md)
- [README](../README.md)

Git Markdown이 원본이며 Notion은 생성 미러다. 검토한 문서를 main에 병합하면 on-main-push workflow가 발행한다. 개인 원본과 인증 정보는 게시하지 않는다.
