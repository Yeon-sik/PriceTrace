# PriceTrace merchant profile v1

`merchant-profile.v1`은 영수증 없이 사용자가 “가게 + 상호명”으로 시작한 **검증 전 판매처 source fact 초안**이다. PriceTrace UUID, SKU, 표준 상품, 브랜드, 카탈로그 연결은 포함하지 않는다. 통합 OCR의 표준 ChatGPT 출력은 이 standalone draft를 직접 반환하지 않고 `yeonsik-ocr.v1`의 `merchant_candidate`에 담는다.

## Canonical JSON

실제 Zod 계약은 `src/domain/merchant-profile.ts`의 `MerchantProfileV1Schema`이며, 예시는 `docs/templates/MERCHANT_PROFILE_V1_TEMPLATE.json`이다.

```json
{
  "schema_version": "merchant-profile.v1",
  "merchant": {
    "merchant_name": "예시 가게",
    "branch_name": null,
    "business_kind": "unknown",
    "business_registration_number": null,
    "address": null,
    "phone": null,
    "source_namespace": null,
    "source_location_code": null
  }
}
```

`merchant_name`과 `business_kind`만 필수다. 나머지는 근거가 없으면 `null`이며, `source_namespace`와 `source_location_code`는 실제 source identity가 확인됐을 때만 함께 채운다. 사업자번호, 주소, 전화번호, SKU를 상호명이나 외부 추정만으로 만들지 않는다.

## Handoff

standalone merchant-profile.v1을 사용하는 legacy/manual 흐름에서는 ChatGPT Project가 이 draft만 만든다. 통합 OCR에서는 `mode="merchant"`인 `yeonsik-ocr.v1` envelope의 `merchant_candidate`를 사용한다. 어느 흐름이든 OCR App 또는 관리 UI가 사용자의 확인을 마친 뒤에만 다음 RPC의 `p_merchant`로 전달할 수 있다.

```text
submit_merchant_identity_candidate_v1(
  p_idempotency_key: string,
  p_merchant: merchant-profile.v1.merchant,
  p_user_verified: true
)
```

이 RPC도 canonical restaurant/location을 자동 생성하거나 client UUID를 받지 않는다. PriceTrace 서버가 정확한 기존 identity를 resolve하거나, `merchant_identity_candidate`를 반환한다.
