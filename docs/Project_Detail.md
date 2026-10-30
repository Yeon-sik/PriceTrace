# PriceTrace | Project Detail

2026-10-30 (Asia/Seoul) 갱신. Primary source boundary는 [main@ba55e17](https://github.com/Yeon-sik/PriceTrace/tree/ba55e17cd36366d9f67abc40f222288125f770b2)이다. source 설명과 실제 검증 결과를 구분한다. [빠른 소개](./Project_Intro.md)를 참고한다.

## 1. 문서 목적과 범위

영수증 구매 관측과 공식 판매채널 등재를 출처·관측일과 함께 탐색하는 Next.js 웹·Capacitor 앱이다. 표준 상품군·정확 규격·브랜드·판매처·식당·메뉴 identity와 관리자 검토 authority를 소유한다.

사실·관측·상품군·규격·브랜드·판매처 identity를 별도 계약으로 보존한다. OCR source review 후 서버가 exact/resolved 결과를 반환하고 owner checkpoint와 기존 관측을 안전하게 재사용한다.

2026-10-05 이후 main에는 brand hierarchy/public catalog, packaged-product brand resolution, public barcode lookup와 verified-conflict 처리, shared identity connections, owner-confirmed restaurant/component identity, order capture·observation instrument, AR demo barcode 등록 계약이 추가됐다.

미병합 branch, 사용자 미커밋 작업과 명시하지 않은 운영 검증은 기능 완료 근거에 포함하지 않는다.

## 2. 시스템 아키텍처

```text
Next.js App Router / feature hooks -> repository / mapper
  -> Zod/domain contracts -> public files 또는 Auth Supabase RPC
private source -> validate -> sanitized public projection
OCR reviewed facts -> receipt / purchase / candidate contracts
  -> merchant/menu/component authority -> owner checkpoint / exact reuse
product group -> exact variant -> brand hierarchy -> seller mapping -> observed price
public barcode lookup -> verified identity | conflict | missing
Nutrition / Fitness / AR -> 명시된 consumer contract
static export -> GitHub Pages / Capacitor Android
```

## 3. 데이터 모델과 불변식

- 가격은 관측가다. 실시간 가격·현재가·특정 지점 재고를 보장하지 않는다.
- 이름 유사도는 candidate 탐색에만 쓴다. 상품군·정확 규격·브랜드·판매처 상품을 한 ID로 취급하지 않는다.
- PriceTrace는 Product/Brand/Restaurant/Menu identity authority다. OCR은 source 사실과 사용자 검수만 제공한다.
- public barcode lookup은 검증된 단일 identity, conflict, missing을 구분한다. conflict를 임의의 첫 상품으로 축약하지 않는다.
- accepted receipt/menu 관측은 exact identity와 원본 근거가 일치할 때만 재사용한다. 다른 사실·identity는 충돌로 막는다.
- legacy/owner recovery는 owner response와 verified binding을 증명한 경우에만 허용하며 경쟁 identity는 fail closed 한다.
- restaurant component와 purchase option은 parent restaurant/menu/source scope를 보존한다.
- 공개 projection은 allowlist만 포함한다. private 원본·인증·개인 식별자를 Git·미러 문서에 노출하지 않는다.
- Nutrition 영양과 CashOS 원장은 각 서비스가 소유한다. 공유 DB라도 migration authority는 같지 않다.

## 4. 핵심 기술 의사결정

### 결정 1. 검수와 authority 분리
OCR에서 원본 사실을 확인하고 PriceTrace 서버가 canonical identity를 결정한다.

### 결정 2. conflict를 값으로 보존
브랜드·barcode·restaurant component가 단일 exact identity로 수렴하지 않으면 conflict/unknown 상태를 유지하고 downstream이 임의 확정하지 못하게 한다.

### 결정 3. checkpoint 재조회와 immutable reuse
응답 유실·legacy 상태에서 accepted 기록을 재생성하지 않고 owner response/fingerprint로 기존 관측을 복구한다.

### 결정 4. forward-only migration
schema drift와 계약 확장은 새 migration으로 해결하고 적용 이력과 원본 관측을 재작성하지 않는다.

## 5. 테스트와 검증 전략

| 검사 | 결과 | 근거·환경과 한계 |
| --- | --- | --- |
| 최신 main source 감사 | 저장소 검증 | `main@ba55e17`까지 domain/repository, migration, SQL fixture, Playwright E2E, cloud scripts를 확인했다. 실행 검증은 아니다. |
| 이전 Pages/project-docs workflow | 통과 기록 | 기존 Actions 성공은 보존하되 최신 HEAD의 모든 RPC/RLS/UI를 재실행한 증거로 사용하지 않는다. |
| 운영 RPC/RLS·사용자 흐름 | 미검증 | 최신 migration 적용, owner/foreign/anon, barcode conflict, OCR/Fitness/AR downstream과 Capacitor runtime은 별도 실환경 검증이 필요하다. |

문서 validator와 render-only dry run은 문서 구조·링크·렌더링 검증이며 운영 데이터 경로를 검증하지 않는다.

## 6. 배포·운영·복구

- 기본 품질 gate와 public-data/privacy 검사는 저장소의 현재 CI 계약을 따른다.
- private-data는 원본 경계다. 공개 projection은 생성기·schema·privacy 검사로만 갱신한다.
- DB는 append-only migration과 대상 프로젝트를 확인한다. owner checkpoint 복구 시 selector와 immutable fingerprint를 보존한다.
- 공개 barcode/brand 계약 변경은 OCR·Fitness·AR 소비자 호환성을 함께 검토한다.

**문서 발행**: Git Markdown이 canonical이다. main 병합 후 project-docs workflow가 검증·발행하며 Notion은 read-only mirror다.

## 7. 한계, 기술 부채, 다음 단계

- 최신 migration의 실제 Supabase 적용 상태를 이번 작업에서 새로 검증하지 않았다.
- Pages/CI 성공을 로그인·관리자 승인·모바일·운영 RLS 정상으로 확대 해석하지 않는다.
- 다음 우선 작업은 owner checkpoint, product/brand/barcode conflict, restaurant component와 OCR downstream을 승인 fixture와 운영 권한으로 종단 검증하는 것이다.

## 8. 근거와 관련 문서

- [기준 source revision](https://github.com/Yeon-sik/PriceTrace/tree/ba55e17cd36366d9f67abc40f222288125f770b2)
- [Project Intro](./Project_Intro.md)
- [README](../README.md)
- [Public barcode lookup](contracts/PUBLIC_BARCODE_LOOKUP_V1.md)
- [Brand catalog](contracts/BRAND_CATALOG_V1.md)
- [Shared identity connections](contracts/SHARED_IDENTITY_CONNECTIONS_V1.md)
- [Restaurant component identity](contracts/RESTAURANT_COMPONENT_IDENTITY_RESOLUTION.md)
