# ChatGPT 영수증 프로젝트 소스 동기화 의무

PriceTrace의 ChatGPT 영수증 프로젝트는 `chatgpt-project-sources/`에 복사된 계약 파일을 사용한다. 이 파일들은 실시간 참조가 아닌 업로드용 스냅샷이다.

## Migration 변경 시 반드시 판단할 것

`supabase/migrations/`에 migration을 추가·수정하기 전 또는 같은 변경 묶음에서, 다음 질문에 답한다.

> 이 migration 또는 함께 변경한 애플리케이션 코드가 영수증 입력 JSON, 허용 값, 판매처/식당 분류, 저장 전 검증, 공개 투영에 영향을 주는가?

영향이 있으면 아래를 **같은 변경 묶음**에 포함한다.

1. `src/domain/receipt.ts`와 `docs/templates/RECEIPT_V2_TEMPLATE.json`을 실제 계약에 맞춘다.
2. 필요하면 `scripts/validate-private-receipts.ts`, `scripts/private-receipt-source.ts`와 `chatgpt-project-sources/GOAL.md`, `PROJECT_INSTRUCTIONS.md`를 갱신한다.
3. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-chatgpt-receipt-project-pack.ps1`로 복사본과 ZIP을 재생성한다.
4. 새 ZIP의 파일 목록을 확인하고, ChatGPT 프로젝트의 기존 업로드 파일을 교체한다.
5. `npm.cmd run validate:private-receipts`를 실행한다. 공개 투영 계약에도 영향이 있으면 `sync:public-receipts`와 `check:public-receipts`를 추가 실행한다.

영향이 없으면 migration 설명 또는 PR 설명에 `ChatGPT 영수증 프로젝트 소스 영향 없음`이라고 명시한다.

## 영향을 주는 대표 사례

- `receipt.v2` 필드·enum·nullable 규칙 변경
- 식당 이용 방식(`document.fulfillment`)처럼 영수증 근거가 PT 공개 식당 정보에 반영되는 규칙 변경
- 금액·수량·총액 검증식 변경
- 마트/식당의 `business_kind` 또는 채널 분류 규칙 변경
- 판매처 상품코드·원본 행 참조·공개 투영의 identity 규칙 변경
- private 영수증 파일명·선택·중복 처리 규칙 변경

원격 테이블만 추가하고 영수증 입력 계약·검증·투영에 영향이 없을 때에는 업로드 ZIP을 갱신하지 않아도 된다. 단, 위 판단을 생략해서는 안 된다.
