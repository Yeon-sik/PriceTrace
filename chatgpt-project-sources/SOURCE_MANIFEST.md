# 업로드 소스 목록

이 폴더의 파일을 모두 압축한 `chatgpt-receipt-project-sources.zip`을 제공한다. ChatGPT 프로젝트에는 ZIP을 풀어 아래 파일을 개별 업로드하고, `PROJECT_INSTRUCTIONS.md` 본문을 Project instructions에 붙여 넣는다.

| 업로드 파일 | 저장소의 원본 | 용도 |
|---|---|---|
| `receipt-contract/receipt.ts` | `src/domain/receipt.ts` | `receipt.v2`의 실제 Zod 계약 |
| `merchant-profile/merchant-profile.ts` | `src/domain/merchant-profile.ts` | `merchant-profile.v1`의 실제 Zod 계약 |
| `integration/VERIFIED_RECEIPT_INGESTION_V2.md` | `docs/contracts/VERIFIED_RECEIPT_INGESTION_V2.md` | 사용자 검증 후 PriceTrace 서버 projection 순서·privacy·identity 응답 계약 |
| `merchant-profile/MERCHANT_PROFILE_V1.md` | `docs/contracts/MERCHANT_PROFILE_V1.md` | 영수증 없는 판매처 source fact 초안·검증·등록 경계 |
| `receipt-contract/RECEIPT_V2_TEMPLATE.json` | `docs/templates/RECEIPT_V2_TEMPLATE.json` | 반환 JSON의 완성 예시 |
| `merchant-profile/MERCHANT_PROFILE_V1_TEMPLATE.json` | `docs/templates/MERCHANT_PROFILE_V1_TEMPLATE.json` | 가게명 입력용 최소 canonical JSON 예시 |
| `receipt-contract/RECEIPT_IMAGE_ANALYSIS_PROMPT.md` | `docs/templates/RECEIPT_IMAGE_ANALYSIS_PROMPT.md` | 사진 판독 및 이용 방식 근거 규칙 |
| `validation/validate-private-receipts.ts` | `scripts/validate-private-receipts.ts` | 저장 전 검증·총액 무결성 규칙 |
| `validation/private-receipt-source.ts` | `scripts/private-receipt-source.ts` | 파일명 및 private 영수증 선택 규칙 |
| `reference/existing-public-receipt-index.v1.json` | `data/public/receipts/index.v1.json` | 공개된 기존 영수증의 중복 참고 목록 |
| `GOAL.md` | 이 폴더 | 목적·운영 절차 |
| `PROJECT_INSTRUCTIONS.md` | 이 폴더 | 전체 운영 지침 |
| `PASTE_TO_PROJECT_SETTINGS.md` | 이 폴더 | Project settings에 반드시 붙여 넣을 강제 JSON 지침과 적용 확인 |
| `supabase/CHATGPT_PROJECT_SOURCE_SYNC.md` | `supabase/CHATGPT_PROJECT_SOURCE_SYNC.md` | migration 변경 시 동기화 의무 |

## 의도적으로 제외한 파일

- `private-data/**`: 원본 영수증·개인 구매 이력은 프로젝트 지식 파일로 일괄 업로드하지 않는다.
- `data/curation/receipt-merchant-catalog-profiles.v1.json`: 판매처의 민감 식별 정보가 포함될 수 있다.
- `data/curation/px-receipt-product-name-reviews.v1.json`, `data/public/official-channel-catalog/**`: 영수증 사실 추출이 상품 자동 연결로 변질되는 것을 막기 위해 제외한다.
