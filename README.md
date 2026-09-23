# PriceTrace

PriceTrace는 영수증에 남은 구매 가격과 공식 판매채널의 등재 정보를 **출처, 관측 시점, 상품 식별 근거**와 함께 탐색하는 웹 앱입니다. 영수증 관측가는 현재 판매가가 아니며, 공식 등재는 특정 지점의 재고나 실제 구매를 뜻하지 않습니다.

> 문서 기준: 공개 `main@85730cc` (2026-09-24). 아래의 “구현”은 저장소 코드·테스트·migration 기준이며, 원격 DB 적용이나 배포된 화면의 정상 동작을 뜻하지 않습니다.

## 현재 구현

- 공개 영수증과 상품 관측, PX 공식 판매채널 snapshot을 분리해 읽고 상품·매장·식당 화면에서 검색·필터·가격 기록을 탐색합니다.
- 표준 상품군, 정확한 판매 규격, 판매처 상품과 원본 관측을 별도 식별자로 다룹니다. 상품명 유사도만으로 동일 상품을 확정하지 않고, 관리자 검토와 승인 경계를 둡니다.
- 영수증 관측 상품과 공식 등재 상품을 출처가 표시된 장바구니에 담고 수량을 관리합니다. 장바구니 상태는 브라우저 `localStorage`에 저장됩니다.
- 인증·관리자 화면과 소유자 범위의 상세 식별자 조회 경로가 코드에 있습니다. 검증된 영수증, 단독 가격 관측, 구매·결제 이력 관측의 입력 계약과 migration도 저장소에 있습니다. 개별 RPC의 실제 운영 적용·권한·기기 연동은 별도 검증 대상입니다.
- 기존 물품 배분·정산 도메인 코드는 보존되어 있지만 현재 공개 메인 화면의 주요 흐름은 상품 탐색과 장바구니입니다.

## 실행과 검사

Node.js 환경에서:

```powershell
npm.cmd install
npm.cmd run dev
```

저장소 검사 명령:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run check:public-receipts
npm.cmd run check:public-official-catalog
npm.cmd run build
npm.cmd run test:e2e
```

`test:e2e`에는 실행 가능한 브라우저 환경이 필요합니다. 위 명령이 존재한다는 사실만으로 이 문서 기준 커밋에서 모두 통과했다고 주장하지 않습니다.

## 데이터와 권한 경계

- 공개 영수증은 `data/public/receipts/`, 연결 관측은 `data/public/product-observations.v3.json`, 공식 판매채널 snapshot은 `data/public/official-channel-catalog/`에서 읽습니다.
- 원본 이미지와 원본 JSON은 `private-data/`에 두며 Git과 공개 번들에서 제외합니다. 공개 projection은 스키마·연결·금지 필드 검사를 통과해야 합니다.
- 공개 영수증을 갱신할 때는 `npm.cmd run sync:public-receipts` 후 `npm.cmd run check:public-receipts`를 실행하고 생성된 diff를 검토합니다. 공식 카탈로그에도 별도의 sync/check 명령이 있습니다.
- OCR 또는 AI가 제안한 이름·상품 identity는 확정 근거가 아닙니다. 미확정 후보와 정확한 서버 식별자를 구분하고, 사용자 소유 데이터는 인증·RLS 경계 안에 둡니다.
- 가격은 관측 시점과 출처가 있는 기록입니다. 실시간 가격, 현재 재고, 자동 상품 일치를 보장하지 않습니다.

## 배포와 검증 범위

`main` push 시 GitHub Actions가 Next.js 정적 산출물을 [GitHub Pages](https://yeon-sik.github.io/PriceTrace/)에 배포하도록 설정되어 있습니다. 정적 공개 데이터 화면과 Supabase가 필요한 인증·관리자·비공개 조회는 검증 경계가 다릅니다. 로컬 build, migration 파일, 또는 과거 배포 이력만으로 현재 원격 RPC·RLS·관리자 흐름이 검증되었다고 보지 않습니다.

## 관련 문서

- [GOAL.md](GOAL.md): 제품 방향과 데이터 모델 원칙
- [verified receipt ingestion v2](docs/contracts/VERIFIED_RECEIPT_INGESTION_V2.md), [standalone price observation v3](docs/contracts/STANDALONE_PRICE_OBSERVATION_V3.md), [purchase price observation v4](docs/contracts/PURCHASE_PRICE_OBSERVATION_V4.md): 입력 계약
- [Project Intro](docs/Project_Intro.md), [Project Detail](docs/Project_Detail.md): 해당 문서에 표시된 기준 커밋의 상세 기록
