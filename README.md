# 로컬 물품 배분·정산 MVP

영수증에서 추출한 상품 관측가를 검색·비교하고, 수령자별 배분·정산까지 확장할 수 있는 브라우저 로컬 앱입니다. 가격은 현재가가 아닌 **영수증 관측가**입니다.

## 실행

```powershell
npm.cmd install
npm.cmd run dev
```

검증 명령:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

## GitHub Pages 배포

이 저장소는 `main`에 push하면 GitHub Actions가 Next.js 정적 산출물(`out/`)을 GitHub Pages에 배포합니다.

```powershell
git add next.config.ts .github/workflows/deploy-pages.yml README.md
git commit -m "chore: configure GitHub Pages deployment"
git push -u origin main
```

GitHub 저장소의 `Settings → Pages`에서 `Source`를 `GitHub Actions`로 선택한 뒤 Actions의 배포가 완료되면 다음 주소로 접속합니다.

<https://yeon-sik.github.io/PriceTrace/>

저장소가 `PriceTrace`라는 이름이므로 `next.config.ts`의 `basePath`도 `/PriceTrace`로 맞춰져 있습니다.

## 데이터 경계

- Git 추적 공개 관측: `data/public/product-observations.v1.json`
- 정산 테스트용 합성 fixture: `data/demo/receipt.sample.json`
- 실제 로컬 데이터: `private-data/` (Git 및 번들 제외)
- 앱의 변경 가능한 상태(수령자, 배분, 전달/입금 상태)는 localStorage에만 저장됩니다.
- JSON 복원은 전체 Zod 검증을 통과한 경우에만 상태를 바꿉니다.
- 공개 관측에는 판매 채널, 관측 월, 상품명, 상품코드, 관측가, 신뢰도만 저장합니다.
- 주소, 전화번호, 사업자번호, 거래·결제 정보, 구매 수량, 영수증 총액, 원본 참조는 공개 관측에 저장하지 않습니다.

공개 관측을 갱신하고 검증하는 명령:

```powershell
npm.cmd run sync:public-observations
npm.cmd run check:public-observations
```

`sync:public-observations`는 private 원본을 수정하지 않으며, 공개 내용이 같으면 파일을 다시 쓰지 않습니다. 생성 후에는 반드시 Git diff를 검토하고 의도한 파일만 선택해 커밋합니다.

### private 영수증 자동 인식

로컬 개발은 기본적으로 private 영수증 모드로 실행합니다.

```powershell
npm.cmd run dev
```

- `npm.cmd run dev:private`도 동일하게 사용할 수 있습니다.
- `private-data/`의 `receipt_*.json` 파일을 5초마다 다시 확인합니다.
- 파일 수정 시각과 크기가 바뀌지 않았다면 검증 결과를 재사용해 JSON을 반복 파싱하지 않습니다.
- `(1)`, `(2)`처럼 같은 파일의 수정본이 여러 개면 수정 시각이 가장 최신인 파일만 사용합니다.
- 사업자번호와 주소가 동일한 영수증은 같은 매장으로 묶되 원본 영수증 기록은 날짜별로 유지합니다.
- 최신 파일이 `ReceiptJsonSchema` 검증에 실패하면 이전 파일로 자동 복귀하지 않고 앱에 경고를 표시합니다.
- 앱에는 마트명, 발행일, 상품명, 상품코드, 수량, 관측가와 합계만 전달합니다.
- 주소, 전화번호, 거래번호, 결제정보, OCR 원문과 원본 이미지명은 전달하지 않습니다.
- private 서버나 파일을 사용할 수 없으면 앱은 Git에 추적된 공개 관측 데이터로 자동 대체합니다.
- 공개 데이터만 확인하려면 `npm.cmd run dev:demo`를 사용합니다. production build도 공개 관측 데이터만 사용합니다.

사전 검증만 실행하려면 다음 명령을 사용합니다.

```powershell
npm.cmd run validate:private-receipts -- receipt_YYYY-MM-DD_NNN.json
```

## 수동 확인

1. private 서버 없이 상품 목록과 마트별 공개 관측 기록이 표시되는지 확인합니다.
2. 수령자를 추가한 뒤 상품 행에서 수령자·양의 정수 수량을 선택해 담습니다.
3. 구매 수량보다 크게 입력하거나 0/소수를 입력했을 때 오류가 표시되는지 확인합니다.
4. 정산 카드에서 전달·입금 상태와 카카오톡 메시지 복사를 확인합니다.
5. 새로고침 뒤 상태가 유지되는지, JSON 내보내기/복원이 같은 상태를 되살리는지 확인합니다.

영수증에서 관측된 상품·가격·매장 정보를 축적하고, 친구별 물품 배분과 정산에서 출발해 장기적으로 가격 변화와 매장별 시세를 추적하는 시스템이다.

## 제품의 정확한 정의

이 서비스는 가게의 전체 재고나 현재 판매가를 보장하지 않는다. 사용자 영수증을 통해 실제 구매가 확인된 시점의 **관측 가격**과 **판매 이력**을 저장하고 분석한다.

## 현재 단계

Milestone 1은 JSON 기반 로컬 정적 웹앱이다.

- 물품 목록
- 검색·필터·정렬
- 친구 관리
- 친구별 담아보기/수량 배분
- 친구별 정산 금액
- 전달·입금 상태
- 전체 배분 현황
- localStorage 저장
- 정산 데이터 내보내기/불러오기
- 카카오톡용 정산 메시지 복사

DB, 로그인, OCR, 지도, 실시간 가격 API는 현재 범위가 아니다.

## 문서

- `GOAL.md`: 전체 목표와 제품 원칙
- `AGENTS.md`: Codex 작업 규칙
- `MILESTONES.md`: 전체 단계
- `TASKS.md`: Milestone 1 작업 순서
- `ACCEPTANCE_CRITERIA.md`: 완료 판정 기준
- `docs/ARCHITECTURE.md`: 구조와 기술 선택
- `docs/DOMAIN_MODEL.md`: 도메인 개념과 불변식
- `docs/DATA_POLICY.md`: 실제 데이터와 공개 데이터 분리
- `docs/Project_Intro.md`: 포트폴리오용 프로젝트 소개 원본
- `docs/Project_Detail.md`: 포트폴리오용 기술 상세 원본
- `docs/PROJECT_DOCS_OPERATIONS.md`: Git Markdown 검증과 승인형 Notion 발행 절차
- `CODEX_START_PROMPT.md`: Codex에 바로 전달할 구현 명령
- `CODEX_REVIEW_PROMPT.md`: 구현 후 리뷰 명령
