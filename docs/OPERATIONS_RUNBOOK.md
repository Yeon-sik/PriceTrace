# M6 운영 런북

## 현재 적용된 보호 장치

- `receipt_documents`에는 fingerprint, 품질 상태, 마스킹 메타데이터를 저장한다.
- `receipt_quality_flags`는 중복, 이상 가격, 개인정보, 정합성 문제를 기록한다.
- 품질 플래그와 감사 로그에는 RLS를 적용한다.
- 관리자 권한은 JWT의 `app_metadata.role=admin`으로만 판정한다.
- 카드번호·인증번호처럼 보이는 값은 원문 대신 마스킹 후 저장한다.

## 운영 절차

1. 업로드 시 fingerprint를 계산하고 사용자별 기존 fingerprint와 비교한다.
2. 중복·이상·개인정보·정합성 플래그가 있으면 `quality_status=pending`으로 둔다.
3. 관리자는 품질 플래그를 확인한 뒤 `accepted` 또는 `rejected`로 변경한다.
4. 상태 변경과 데이터 접근은 `audit_logs`에 기록한다.
5. 장애 시 먼저 Supabase Dashboard의 Database Backups에서 복구 지점을 확인하고, 복구 전 현재 상태와 영향 범위를 기록한다.

## 아직 별도 인프라가 필요한 항목

- 업로드 API의 IP·사용자별 rate limit
- 알림 연동과 지표 대시보드
- 정기 복구 리허설 자동화
- 관리자용 품질 검토 화면

이 항목들은 M6 데이터 모델과 연결 지점은 준비했지만, 운영 인프라를 추가하기 전에는 완료로 간주하지 않는다.
