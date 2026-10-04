# PriceTrace | Project Detail

2026-10-05 (Asia/Seoul) 갱신. Primary source boundary는 [main@bb6bf82](https://github.com/Yeon-sik/PriceTrace/tree/bb6bf825e9ae4c385f5e1b597aa6d68b1d73079c)이다. source 설명과 실제 검증 결과를 구분한다. [빠른 소개](./Project_Intro.md)를 참고한다.

## 1. 문서 목적과 범위

영수증 구매 관측과 공식 판매채널 등재를 출처·관측일과 함께 탐색하는 Next.js 웹·Capacitor 앱이다. 표준 상품군·정확 규격·판매처·식당·메뉴 identity와 관리자 검토 authority를 소유한다.

사실·관측·상품군·규격·판매처 identity를 별도 계약으로 보존한다. OCR source review 후 서버가 exact/resolved 결과를 반환하고 owner checkpoint와 동일 관측을 안전하게 재사용한다.

- 최근 main에는 OCR V5 merchant/menu authority, 적용 migration 정합, owner saved-response 복구, 동일 menu observation 재사용과 legacy store identity 호환 복구가 포함된다.

미병합 branch, 사용자 미커밋 작업과 명시하지 않은 운영 검증은 기능 완료 근거에 포함하지 않는다.

## 2. 시스템 아키텍처

```text
Next.js App Router / feature hooks -> repository / mapper
  -> Zod schemas / selectors -> public files 또는 Auth Supabase RPC
private source -> validate -> sanitized public projection
OCR reviewed facts -> receipt / standalone / purchase contract
  -> merchant/menu authority -> saved owner response / exact reuse
  -> downstream exact IDs
product group -> exact variant -> seller mapping -> observed price
Nutrition -> 별도 영양·연결 authority
static export -> GitHub Pages / Capacitor Android
```

## 3. 데이터 모델과 불변식

- 가격은 관측가다. 실시간 가격·현재가·특정 지점 재고를 보장하지 않는다.
- 이름 유사도는 candidate 탐색에만 쓴다. 상품군·정확 규격·판매처 상품을 한 ID로 취급하지 않는다.
- PriceTrace는 Product/Restaurant/Menu UUID authority다. OCR은 source 사실과 사용자 검수만 제공한다.
- accepted receipt/menu 관측은 exact identity와 원본 근거가 일치할 때만 재사용한다. 다른 사실·identity는 충돌로 막는다.
- legacy 복구는 owner response와 verified binding을 증명한 경우에만 허용하며 경쟁 identity는 fail closed 한다.
- 공개 파일은 allowlist projection만 포함한다. private 원본·인증·개인 식별자를 Git·미러 문서에 노출하지 않는다.
- Nutrition 영양과 CashOS 원장은 각 서비스가 소유한다. 공유 DB라도 migration authority는 같지 않다.

## 4. 핵심 기술 의사결정

### 결정 1. 검수와 authority 분리

OCR에서 원본 사실을 확인하고 PriceTrace 서버가 canonical identity를 결정한다.

### 결정 2. checkpoint 재조회

응답 유실·legacy 상태에서 accepted 기록을 재생성하지 않고 owner response로 안정된 selector를 복구한다.

### 결정 3. forward-only migration

실제 schema drift는 새 호환 migration으로 해결하고 원본 관측과 적용 이력을 보존한다.


## 5. 테스트와 검증 전략

| 검사 | 결과 | 근거·환경과 한계 |
| --- | --- | --- |
| 현재 main Pages workflow | 통과 | [Deploy static site](https://github.com/Yeon-sik/PriceTrace/actions/runs/37195087129): 정적 배포 job. 관리자·운영 RPC smoke와 구분한다. |
| 기준 source 문서 workflow | 통과 | [Project docs](https://github.com/Yeon-sik/PriceTrace/actions/runs/37195087123): 이전 문서의 검증·게시이며 이번 Intro/Detail revision을 대신하지 않는다. |
| 운영 RPC/RLS·사용자 흐름 | 이번 갱신에서 미실행 | migration/test source 확인. 현재 owner/foreign/anon·exact identity·OCR downstream runtime은 별도 검증이 필요하다. |

이번 문서 변경의 순차 검증 명령은 다음과 같다.

```text
node .github/project-docs/validate-project-docs.mjs --config project-docs.config.json --require-tracked
node .github/project-docs/sync-project-docs-to-notion.mjs --config project-docs.config.json
```

두 번째 명령은 render-only dry run이다. source·required sections·Git tracked links와 렌더링을 검증하며 Notion에 쓰지 않는다. 과거 테스트 수와 운영 상태를 현재 revision의 성공 수치로 재사용하지 않는다. 실제 기기·원격 권한·사용자 흐름은 표에 명시한 환경에서 따로 확인한다.

## 6. 배포·운영·복구

- 기본 gate는 npm run lint -> typecheck -> test -> build다. 공개 데이터는 receipt/catalog check, 사용자 흐름은 Playwright로 검증한다.
- private-data는 원본 경계다. 공개 projection은 생성기·Zod·privacy/link 검사로만 갱신한다.
- DB는 append-only migration과 대상 프로젝트를 확인한다. owner checkpoint 복구 시 selector와 immutable fingerprint를 보존한다.

**문서 발행**: 검토한 문서를 main에 병합하면 on-main-push workflow가 발행한다. GitHub Environment는 notion-production이고 canonical branch는 main이다. 발행용 token과 page map은 Environment secret으로 관리하고 Git에 넣지 않는다. 신규 연결은 dedicated mirror를 만들고 본문 갱신은 설정된 GitHub Actions 정책을 따른다.

발행은 모든 페이지 preflight 뒤 configured Intro·Detail만 교체한다. 동일 source SHA·fingerprint면 skip하고 일부 실패는 같은 revision을 재실행해 수렴시킨다. 수동 메모와 원본 데이터는 미러 밖에 둔다.

## 7. 한계, 기술 부채, 다음 단계

- 이번 갱신에서 최근 migration의 실제 Supabase 적용 상태를 새로 검증하지 않았다.
- Pages job 성공을 UI·로그인·관리자 승인·모바일 전체의 정상 증거로 확대하지 않는다.
- 다음 우선 작업은 owner checkpoint·legacy identity·동일 menu observation 재시도를 승인 fixture로 검증하는 것이다.

## 8. 근거와 관련 문서

- [기준 source revision](https://github.com/Yeon-sik/PriceTrace/tree/bb6bf825e9ae4c385f5e1b597aa6d68b1d73079c)
- [Project Intro](./Project_Intro.md)
- [README](../README.md)
- [verified receipt v2](contracts/VERIFIED_RECEIPT_INGESTION_V2.md)
- [standalone price v3](contracts/STANDALONE_PRICE_OBSERVATION_V3.md)
- [purchase observation v4](contracts/PURCHASE_PRICE_OBSERVATION_V4.md)
