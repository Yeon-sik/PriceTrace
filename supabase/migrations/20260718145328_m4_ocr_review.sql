create table public.receipt_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_size integer not null check (file_size > 0),
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'review_required', 'verified', 'rejected')),
  raw_ocr_text text,
  ocr_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.ocr_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.receipt_documents(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  raw_text text not null,
  product_name text,
  store_product_code text,
  unit_price_krw integer check (unit_price_krw >= 0),
  purchased_quantity integer check (purchased_quantity > 0),
  total_price_krw integer check (total_price_krw >= 0),
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  review_status text not null default 'pending' check (review_status in ('pending', 'verified', 'rejected')),
  reviewed_at timestamptz,
  unique (document_id, line_number),
  foreign key (user_id, document_id) references public.receipt_documents(user_id, id) on delete cascade,
  check (total_price_krw is null or (unit_price_krw is not null and purchased_quantity is not null and total_price_krw = unit_price_krw * purchased_quantity))
);

alter table public.price_observations add column verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected'));
alter table public.price_observations add column verified_at timestamptz;

create index ocr_items_document_line_idx on public.ocr_items(user_id, document_id, line_number);
create index price_observations_verified_idx on public.price_observations(user_id, store_product_id, observed_at desc) where verification_status = 'verified';

alter table public.receipt_documents enable row level security;
alter table public.ocr_items enable row level security;
grant select, insert, update, delete on public.receipt_documents, public.ocr_items to authenticated;

create policy "receipt documents own rows" on public.receipt_documents for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "ocr items own rows" on public.ocr_items for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "receipt images insert own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "receipt images read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "receipt images delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
