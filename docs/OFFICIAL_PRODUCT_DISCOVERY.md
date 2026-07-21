# 공식 상품 자동 탐색

영수증 품목의 판매처 상품 코드와 상품명을 사용해 공식 상품 후보를 찾는다. 브라우저는 검색 API 키를 갖지 않으며, 검색 요청은 인증된 사용자만 Supabase Edge Function을 통해 실행한다.

## 동작 규칙

- 검증된 판매처 상품 코드가 있으면 즉시 자동 연결한다.
- 코드가 없거나 모르면 공식 웹 검색 결과를 `검토 필요` 후보로만 표시한다.
- 검색 결과는 공식 상품 확정이 아니다. 사용자가 URL과 용량·구성·브랜드를 확인한 뒤 연결해야 한다.
- API가 설정되지 않았거나 로그아웃 상태면 수동 확인 대기열을 유지한다.

## 배포 설정

1. Brave Search API 키를 발급한다.
2. Supabase 프로젝트에 비밀값을 설정한다. 키는 `NEXT_PUBLIC_` 환경 변수에 넣지 않는다.

```powershell
npx.cmd supabase secrets set BRAVE_SEARCH_API_KEY="발급받은-키"
npx.cmd supabase functions deploy official-product-search
```

3. 앱에서 로그인한 뒤 공식 상품 탭의 `자동 탐색`을 실행한다.

Brave Web Search API는 `X-Subscription-Token` 헤더로 서버 측 키를 전달한다. 검색 결과의 출처가 제조사·공식 스토어인지 최종 확인하는 책임은 사용자에게 남는다.
