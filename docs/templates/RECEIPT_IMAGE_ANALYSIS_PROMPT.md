# 영수증 이미지 → `receipt.v2` JSON 추출 요청서

## 입력 계약

작업 요청에는 영수증, 청구서 또는 주문 확인 이미지 하나 이상을 제공한다.

## 기준 계약

- 기준 예시: [RECEIPT_V2_TEMPLATE.json](./RECEIPT_V2_TEMPLATE.json)
- 실제 검증기: `src/domain/receipt.ts`의 `ReceiptJsonSchema`
- 템플릿의 상호, 상품명, 금액, 날짜, 코드, 파일명은 예시이므로 복사하지 않는다.
- 모든 미확인 사실은 추정하지 않는다.

## 모델에 그대로 전달할 요청문

```text
첨부한 영수증 이미지를 분석해 완성된 receipt.v2 JSON 객체 하나를 반환하라.

다운로드 파일을 만들거나 첨부하지 말고, JSON 본문만 채팅 응답으로 출력한다.
파일명·원본 경로·이미지 데이터는 JSON 객체 안에 넣지 않는다. 호출자가 검증 후 원하는 파일명으로 저장한다.

반드시 제공한 RECEIPT_V2_TEMPLATE.json의 모든 키, 중첩 구조, 필드 이름, 자료형을 따른다.
특히 line_items의 각 객체는 템플릿의 모든 필드를 빠짐없이 포함한다.

규칙:
1. 설명, Markdown, 코드 펜스, JSON 외의 텍스트를 반환하지 않는다.
2. 이미지에서 직접 읽을 수 있는 사실만 기록한다. 계산으로 보완하거나, 상품명·가격·매장·상품코드·시간을 추정하거나 외부 검색하지 않는다.
3. 확인할 수 없는 일반 문자열·금액·날짜·시간은 null, 확인할 수 없는 식별자 목록은 []로 둔다. 단, enum 필드는 null이 될 수 없다. document.status와 payments[].status는 확인할 수 없으면 unknown을 사용한다.
4. 모든 금액은 통화 최소 단위의 정수다. KRW 12,000원은 12000이다. 소수, 통화기호, 쉼표가 포함된 문자열을 넣지 않는다.
5. 상품 수량은 숫자가 아니라 반드시 {"value": 양의 숫자, "unit": "each"} 형식이다. 수량 또는 단위가 불명확하면 quantity는 null이다.
6. 상품 단가 필드명은 unit_price_amount_minor다. unit_price_minor, price, amount 등의 다른 키를 만들지 않는다.
7. 각 line_items 행에는 id, type, description, source_line_references, identifiers, quantity, unit_price_amount_minor, gross_amount_minor, discount_amount_minor, tax_amount_minor, net_amount_minor, confidence, tax_rate_percent, food_service를 모두 넣는다.
8. 통합 OCR → PriceTrace 흐름에서는 실제로 인쇄된 판매처 SKU만 {"scheme":"merchant_sku","value":"..."}로 넣는다. SKU가 없거나 barcode·제조사 코드뿐이면 []로 두며, 배열 안에 null을 넣지 않는다. 상품명으로 표준 상품·브랜드·카탈로그 연결을 만들지 않는다.
9. 인쇄된 상품, 서비스, 할인, 세금, 수수료, 팁, 환불, 반올림은 각각 별도 line_items 행으로 보존한다. 할인 행의 net_amount_minor는 음수일 수 있지만, discount_amount_minor와 totals.discount_amount_minor는 할인 절대값의 0 이상 정수다.
10. gross_amount_minor, discount_amount_minor, tax_amount_minor, tax_rate_percent를 이미지에서 확인할 수 없으면 null로 둔다. 모든 금액 분해값을 확인한 경우에만 항목 합계와 totals를 일치시킨다.
11. issued_on은 YYYY-MM-DD다. 시각과 시간대가 인쇄된 경우에만 issued_at에 ISO 8601 오프셋 형식(예: 2026-01-15T14:30:00+09:00)을 넣고, 그렇지 않으면 null이다.
12. document.id는 영수증에 실제로 인쇄된 고유 문서 식별자가 있을 때만 넣고, 없으면 null이다. OCR App의 localDocumentId는 별도 로컬 상태이며 receipt.v2에 넣지 않는다.
13. retail_channel은 이미지 또는 사용자가 명시적으로 확인한 경우만 px 또는 regular로 설정한다. 그렇지 않으면 unknown이다. catalog_namespace는 확인 전까지 null이다.
14. ChatGPT Project 출력의 source_images는 항상 []다. OCR App이 원본 이미지와 자체 localDocumentId를 로컬에서 보관하며, 파일명·경로·이미지 데이터·base64·외부 URL은 receipt.v2에 넣지 않는다. 카드번호·승인번호 같은 민감한 결제 참조값도 넣지 않는다.
15. confidence는 이미지 판독 신뢰도다. high, medium, low 중 하나를 사용하고, 사람이 확인·수정한 값만 user_verified를 사용한다.
16. 음식점 영수증의 document.fulfillment.type은 영수증에 배달·포장·매장(홀) 이용이 직접 인쇄된 경우에만 각각 delivery, takeout, dine_in으로 쓴다. 배달료·포장 할인·메뉴명만으로 이용 방식을 추정하지 않는다. 확인할 수 없으면 unknown이다.
17. 이용 방식이 영수증에 직접 인쇄돼 확인되면 evidence는 printed다. 사용자가 이미지와 함께 이용 방식을 명시한 경우에만 user_confirmed다. 둘 다 아니면 type과 evidence 모두 unknown이다.
18. 식당 영수증의 product 행은 메뉴 역할을 직접 확인할 수 있을 때만 food_service를 기록한다. 기본 메뉴는 {"role":"main","applies_to_line_id":null}, 별도 사이드는 {"role":"side","applies_to_line_id":null}이다. “면 추가”, “토핑 추가”처럼 추가 옵션으로 명확한 행은 {"role":"option","applies_to_line_id":"기본메뉴 line id"}로 쓴다. 부모 메뉴는 영수증에 직접 표시됐거나 같은 영수증에 기본 메뉴가 정확히 하나여서 유일하게 결정될 때만 연결한다. 그 외, 또는 일반 소매 영수증은 food_service를 null로 둔다.
19. 옵션과 사이드는 항상 별도 product 행과 자체 금액으로 보존한다. 옵션 금액을 기본 메뉴의 금액에 더하거나, 사이드를 옵션으로 연결하지 않는다. 예: 라면 line-001, 면추가 line-002, 교자 line-003이면 line-001은 main, line-002는 option → line-001, line-003은 side다.
반환 전 자체 점검:
- line_items의 모든 행에 필수 키가 있는가?
- quantity가 객체 또는 null인가?
- identifiers에 null이 없는가?
- discount_amount_minor가 음수가 아닌가?
- 모든 금액이 정수 또는 null인가?
- 확실하지 않은 값을 추정하지 않았는가?
- fulfillment.type과 fulfillment.evidence가 영수증 또는 사용자 명시 근거와 일치하는가?
- 식당 옵션이 유일하게 확인되는 기본 메뉴에만 연결됐고, 옵션·사이드 금액이 별도 행으로 남아 있는가?
```

## 추출 후 검증

1. JSON 문법을 확인한다.
2. `ReceiptJsonSchema` 검증을 통과해야 한다.
3. `product` 행을 가격 관측·배분에 사용하려면 `description`이 있고, `quantity.unit`이 `each`이며, 수량이 양의 정수이고, `net_amount_minor`가 수량으로 나누어떨어져야 한다.
4. 모든 금액 분해값과 totals가 채워진 경우에만 다음 식을 검증한다.

   ```text
   grand_total_amount_minor = items_gross_amount_minor
                              - discount_amount_minor
                              + tax_amount_minor
                              + fee_amount_minor
                              + tip_amount_minor
                              + rounding_amount_minor
                              + sum(refund line_items.net_amount_minor)
   ```

5. 원본 이미지와 추출 JSON은 `private-data/`에만 보관한다. 실제 영수증을 `data/demo/`나 공개 번들에 복사하지 않는다.

## 사람 검토가 필요한 경우

- 상품명, 수량, 단가, 할인 또는 총액이 흐리거나 일부 잘린 경우
- 할인·쿠폰·포인트·환불의 적용 대상이 불명확한 경우
- 여러 결제수단 합계가 총액과 맞지 않는 경우
- PX 여부, 매장 지점, 상품 SKU를 이미지에서 확인할 수 없는 경우

이 경우 값을 만들어 내지 말고 `null`, `[]`, `unknown`, 낮은 `confidence`를 사용하고 `document.source.notes`에 판독 한계를 기록한다.
