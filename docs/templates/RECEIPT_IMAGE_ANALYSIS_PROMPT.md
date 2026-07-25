# 영수증 이미지 → `receipt.v2` JSON 추출 요청서

## 입력 계약

작업 요청에는 다음을 함께 제공한다.

1. 영수증, 청구서 또는 주문 확인 이미지
2. 최종 파일명 `output_filename`

`output_filename`은 반드시 `receipt_YYYY-MM-DD_NNN.json` 형식이다.

- `YYYY-MM-DD`: 영수증 발행일. 이미지에서 발행일을 읽을 수 없으면 호출자가 파일명 날짜를 별도로 지정한다. 이 파일명 날짜만으로 `document.issued_on`을 채우면 안 된다.
- `NNN`: 같은 날짜 안에서 `001`, `002`처럼 증가하는 세 자리 순번.
- 예시: `receipt_2026-07-25_001.json`
- 철자는 항상 `receipt`다. `recepit`, `recipt` 같은 변형은 사용하지 않는다.

## 기준 계약

- 기준 예시: [RECEIPT_V2_TEMPLATE.json](./RECEIPT_V2_TEMPLATE.json)
- 실제 검증기: `src/domain/receipt.ts`의 `ReceiptJsonSchema`
- 템플릿의 상호, 상품명, 금액, 날짜, 코드, 파일명은 예시이므로 복사하지 않는다.
- 모든 미확인 사실은 추정하지 않는다.

## 모델에 그대로 전달할 요청문

```text
첨부한 영수증 이미지를 분석해 receipt.v2 JSON 파일 하나를 만들어라.

반환 결과는 반드시 요청받은 output_filename 이름의 파일이어야 한다.
파일 내용은 JSON 객체 하나뿐이어야 하며, 파일명은 JSON 객체 안에 넣지 않는다.
파일 첨부를 지원하지 않는 환경에서는 JSON 객체 하나만 출력한다. 호출자가 그 결과를 output_filename으로 저장한다.

반드시 제공한 RECEIPT_V2_TEMPLATE.json의 모든 키, 중첩 구조, 필드 이름, 자료형을 따른다.
특히 line_items의 각 객체는 템플릿의 모든 필드를 빠짐없이 포함한다.

규칙:
1. 설명, Markdown, 코드 펜스, JSON 외의 텍스트를 반환하지 않는다.
2. 이미지에서 직접 읽을 수 있는 사실만 기록한다. 계산으로 보완하거나, 상품명·가격·매장·상품코드·시간을 추정하거나 외부 검색하지 않는다.
3. 확인할 수 없는 일반 문자열·금액·날짜·시간은 null, 확인할 수 없는 식별자 목록은 []로 둔다. 단, enum 필드는 null이 될 수 없다. document.status와 payments[].status는 확인할 수 없으면 unknown을 사용한다.
4. 모든 금액은 통화 최소 단위의 정수다. KRW 12,000원은 12000이다. 소수, 통화기호, 쉼표가 포함된 문자열을 넣지 않는다.
5. 상품 수량은 숫자가 아니라 반드시 {"value": 양의 숫자, "unit": "each"} 형식이다. 수량 또는 단위가 불명확하면 quantity는 null이다.
6. 상품 단가 필드명은 unit_price_amount_minor다. unit_price_minor, price, amount 등의 다른 키를 만들지 않는다.
7. 각 line_items 행에는 id, type, description, source_line_references, identifiers, quantity, unit_price_amount_minor, gross_amount_minor, discount_amount_minor, tax_amount_minor, net_amount_minor, confidence, tax_rate_percent를 모두 넣는다.
8. identifiers에는 실제로 인쇄된 SKU·바코드·제조사 코드만 {"scheme":"...","value":"..."}로 넣는다. 읽지 못했으면 []이며, 배열 안에 null을 넣지 않는다.
9. 인쇄된 상품, 서비스, 할인, 세금, 수수료, 팁, 환불, 반올림은 각각 별도 line_items 행으로 보존한다. 할인 행의 net_amount_minor는 음수일 수 있지만, discount_amount_minor와 totals.discount_amount_minor는 할인 절대값의 0 이상 정수다.
10. gross_amount_minor, discount_amount_minor, tax_amount_minor, tax_rate_percent를 이미지에서 확인할 수 없으면 null로 둔다. 모든 금액 분해값을 확인한 경우에만 항목 합계와 totals를 일치시킨다.
11. issued_on은 YYYY-MM-DD다. 시각과 시간대가 인쇄된 경우에만 issued_at에 ISO 8601 오프셋 형식(예: 2026-01-15T14:30:00+09:00)을 넣고, 그렇지 않으면 null이다.
12. retail_channel은 이미지 또는 사용자가 명시적으로 확인한 경우만 px 또는 regular로 설정한다. 그렇지 않으면 unknown이다. catalog_namespace는 확인 전까지 null이다.
13. source_images에는 제공된 이미지 파일명 또는 식별자만 넣는다. 이미지 자체, base64, 외부 URL, 카드번호·승인번호 같은 민감한 결제 참조값은 넣지 않는다.
14. confidence는 이미지 판독 신뢰도다. high, medium, low 중 하나를 사용하고, 사람이 확인·수정한 값만 user_verified를 사용한다.
15. 반환 파일명은 반드시 요청받은 output_filename이며 receipt_YYYY-MM-DD_NNN.json 형식을 만족해야 한다. 예: receipt_2026-07-25_001.json. 파일명은 JSON 본문에 추가하지 않는다.

반환 전 자체 점검:
- line_items의 모든 행에 필수 키가 있는가?
- quantity가 객체 또는 null인가?
- identifiers에 null이 없는가?
- discount_amount_minor가 음수가 아닌가?
- 모든 금액이 정수 또는 null인가?
- 확실하지 않은 값을 추정하지 않았는가?
- 반환 파일명이 output_filename과 정확히 일치하는가?
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
   ```

5. 원본 이미지와 추출 JSON은 `private-data/`에만 보관한다. 실제 영수증을 `data/demo/`나 공개 번들에 복사하지 않는다.

## 사람 검토가 필요한 경우

- 상품명, 수량, 단가, 할인 또는 총액이 흐리거나 일부 잘린 경우
- 할인·쿠폰·포인트·환불의 적용 대상이 불명확한 경우
- 여러 결제수단 합계가 총액과 맞지 않는 경우
- PX 여부, 매장 지점, 상품 SKU를 이미지에서 확인할 수 없는 경우

이 경우 값을 만들어 내지 말고 `null`, `[]`, `unknown`, 낮은 `confidence`를 사용하고 `document.source.notes`에 판독 한계를 기록한다.
