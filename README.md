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

- Git 추적 공개 영수증: `data/public/receipts/YYYY-MM-DD_NNN.json` (영수증 건당 JSON 1개)
- 공개 영수증 인덱스: `data/public/receipts/index.v1.json` (파일명·개별 revision만 보관)
- 영수증 품목 연결 관측: `data/public/product-observations.v3.json`
- 정산 테스트용 합성 fixture: `data/demo/receipt.sample.json`
- 원본 이미지와 원본 JSON: `private-data/` (Git 및 번들 제외)
- 앱의 변경 가능한 상태(수령자, 배분, 전달/입금 상태)는 localStorage에만 저장됩니다.
- JSON 복원은 전체 Zod 검증을 통과한 경우에만 상태를 바꿉니다.
- 공개 영수증에는 실제 판매처명·지점명·주소·전화번호·사업자등록번호·발행일·품목·수량·금액·합계를 저장합니다.
- 공개 영수증의 ID와 파일명은 `YYYY-MM-DD_NNN` 및 `YYYY-MM-DD_NNN.json` 형식입니다. `YYYY-MM-DD`는 발행일, `NNN`은 해당 날짜의 영수증 순번이며 관리자 화면에서도 같은 키와 파일명을 표시합니다.
- 각 공개 상품 관측은 `receiptId`와 `receiptItemId`로 검증된 공개 영수증 품목에 연결됩니다.
- 거래번호, 결제·승인 정보, 고객 식별정보, OCR 원문, 원본 이미지 경로·파일명은 공개 JSON에 저장하지 않습니다. 검수 메모는 금지 값과 로컬 경로가 없을 때만 공개합니다.

공개 영수증과 연결 관측을 갱신하고 검증하는 명령:

```powershell
npm.cmd run sync:public-receipts
npm.cmd run check:public-receipts
```

`sync:public-receipts`는 private 원본을 수정하지 않습니다. private 파일명은 `receipt_YYYY-MM-DD_NNN.json` 형식이어야 하며, strict Zod 검증, 금지 필드 검사, 개별 영수증·인덱스 revision과 상품 관측 연결 검사를 모두 통과한 경우에만 공개 파일을 생성합니다. 생성 후에는 반드시 Git diff를 검토하고 의도한 파일만 선택해 커밋합니다.

### private 원본을 공개 영수증으로 반영

앱과 production build는 **항상 Git 추적 공개 영수증만 읽습니다**. `private-data/`는 화면에서 탐색하지 않으며, 새 공개 영수증을 수동 생성하는 로컬 입력 원천일 뿐입니다.

1. 기존 `receipt.v2` 템플릿으로 `private-data/receipt_YYYY-MM-DD_NNN.json`을 작성합니다.
2. 아래 검증 명령으로 원본의 스키마·KRW·총액·수량을 확인합니다. 이 명령은 원본과 공개 파일을 변경하지 않습니다.

```powershell
npm.cmd run validate:private-receipts -- receipt_YYYY-MM-DD_NNN.json
```

3. 검증이 끝나면 `npm.cmd run sync:public-receipts`를 실행합니다. 이 명령이 공개 영수증 JSON, 인덱스, 연결 관측을 함께 생성합니다.
4. `npm.cmd run check:public-receipts`로 생성 결과를 다시 검증하고 Git diff를 검토합니다.

`sync:public-receipts`는 private 원본에 경고가 하나라도 있으면 공개 파일을 갱신하지 않습니다. `(1)`, `(2)` 수정본이 있으면 같은 논리 파일명 중 가장 최근 파일만 반영합니다.

## 수동 확인

1. private 서버 없이 공개 영수증 기반 상품 목록과 마트별 관측 기록이 표시되는지 확인합니다.
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
