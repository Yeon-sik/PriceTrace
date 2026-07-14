# 로컬 물품 배분·정산 MVP

95개 영수증 품목을 검색하고, 수령자별로 배분·정산하는 브라우저 로컬 앱입니다. 가격은 현재가가 아닌 **영수증 관측가**입니다.

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

## 데이터 경계

- 공개 샘플: `data/demo/receipt.sample.json`
- 실제 로컬 데이터: `private-data/` (Git 및 번들 제외)
- 앱의 변경 가능한 상태(수령자, 배분, 전달/입금 상태)는 localStorage에만 저장됩니다.
- JSON 복원은 전체 Zod 검증을 통과한 경우에만 상태를 바꿉니다.

## 수동 확인

1. `/`에서 품목 수가 `95/95`이고 총액이 `737,790원`인지 확인합니다.
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
- `CODEX_START_PROMPT.md`: Codex에 바로 전달할 구현 명령
- `CODEX_REVIEW_PROMPT.md`: 구현 후 리뷰 명령
