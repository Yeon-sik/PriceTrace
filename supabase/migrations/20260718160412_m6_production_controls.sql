alter table public.profiles add column role text not null default 'user' check (role in ('user', 'admin'));
alter table public.receipt_documents add column fingerprint text;
alter table public.receipt_documents add column duplicate_of_document_id uuid references public.receipt_documents(id) on delete set null;
alter table public.receipt_documents add column quality_status text not null default 'pending' check (quality_status in ('pending', 'accepted', 'rejected'));
alter table public.receipt_documents add column masked_metadata jsonb not null default '{}'::jsonb;

create table public.receipt_quality_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.receipt_documents(id) on delete cascade,
  flag_type text not null check (flag_type in ('duplicate', 'anomaly', 'pii', 'reconciliation')),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (user_id, document_id) references public.receipt_documents(user_id, id) on delete cascade
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null check (length(trim(action)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index receipt_documents_fingerprint_idx on public.receipt_documents(user_id, fingerprint) where fingerprint is not null;
create index quality_flags_status_idx on public.receipt_quality_flags(status, severity, created_at desc);
create index audit_logs_target_created_idx on public.audit_logs(target_user_id, created_at desc);

alter table public.receipt_quality_flags enable row level security;
alter table public.audit_logs enable row level security;
grant select, insert, update on public.receipt_quality_flags to authenticated;
grant select, insert on public.audit_logs to authenticated;

create policy "users manage own quality flags" on public.receipt_quality_flags for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "admins review all quality flags" on public.receipt_quality_flags for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
create policy "users write own audit logs" on public.audit_logs for insert to authenticated
  with check ((select auth.uid()) = actor_user_id);
create policy "users read own audit logs" on public.audit_logs for select to authenticated
  using ((select auth.uid()) = actor_user_id or (select auth.uid()) = target_user_id);
create policy "admins read all audit logs" on public.audit_logs for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'admin');
