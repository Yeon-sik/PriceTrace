-- 관리자만 품질 플래그의 검토 상태를 변경할 수 있다.
-- 역할은 user_metadata가 아니라 app_metadata의 role을 기준으로 판정한다.
create policy "admins update all quality flags"
  on public.receipt_quality_flags
  for update
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
