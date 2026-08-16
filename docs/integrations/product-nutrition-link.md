# PriceTrace ↔ Fitness Nutrition 연결 계약

## 소유권

- PriceTrace는 상품군, 정확한 판매 규격, 판매처 상품 매핑, 검증 가격 관측의 원본이다.
- Fitness Nutrition DB는 공개 영양과 승인된 상품-영양 링크, 링크/해제 제안의 원본이다.
- 어느 DB도 상대 시스템의 원본 행을 복제하거나 외래 키로 생존을 강제하지 않는다.
- PriceTrace에는 Nutrition 링크 테이블과 링크 localStorage를 만들지 않는다.

## PriceTrace 읽기 계약

Supabase RPC 함수는 `get_product_read_v1`이고 반환 JSON의 `schemaVersion`은
`product-read.v1`이다. 공개 호출은 publishable key를 사용한다.

입력:

- `p_catalog_product_id uuid | null`: 정확 규격 1건 조회
- `p_query text | null`: 상품군·정확 규격·브랜드 후보 검색
- `p_limit integer`: 1~100, 기본 50

반환:

- `namespace = pricetrace`
- payload 및 상품별 `sha256:*` revision
- `standardProduct`: 상품군 ID·이름·브랜드
- `catalogProduct`: 정확 규격 ID·이름·내용량·단위·패키지 수량
- `sellerProducts`: 검증된 `sourceLabel + sourceProductCode`
- `observations`: 정확 규격에 속한 판매처별 최신 검증 시장 관측

사용자 소유 `receipts`와 `price_observations`는 이 공개 계약에 포함하지 않는다.

## Nutrition 읽기·제안 계약

브라우저는 별도 `NEXT_PUBLIC_NUTRITION_SUPABASE_URL`과
`NEXT_PUBLIC_NUTRITION_SUPABASE_PUBLISHABLE_KEY`만 사용한다. service-role key는
브라우저나 저장소에 두지 않는다.

- 공개 영양 후보: Nutrition RPC `get_nutrition_read_v1`의 `nutrition-read.v1`
- 링크 상태: Nutrition RPC `get_product_nutrition_link_state_v1`
- 링크/해제 제안: Nutrition RPC `propose_product_nutrition_link_v1`
- 제안 결과는 항상 `pending`; 승인된 링크만 링크 상태에 반영한다.

링크 identity는 다음 세 값뿐이다.

```text
namespace + catalogProductId + nutritionFoodId
```

상품명과 영양명은 검색 후보 및 검토 근거일 뿐 identity가 아니다. 제안에는
PriceTrace 상품 revision과 Nutrition 계약·출처 revision·행 revision을 함께 보낸다.

## 장애 격리

- Nutrition 연결이 없거나 실패해도 PriceTrace 상품·판매처·가격 상세는 유지한다.
- `product-read.v1` revision을 확인하지 못하면 후보는 볼 수 있어도 제안은 차단한다.
- Nutrition 식품 행이 사라져도 승인 링크 identity와 감사 근거는 보존할 수 있다.
- 원격 migration 적용, 실제 Nutrition RPC 존재, 승인자 흐름은 각 DB에서 별도로 검증한다.
