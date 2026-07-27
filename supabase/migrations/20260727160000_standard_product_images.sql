create table public.standard_product_images (
  standard_product_id uuid primary key references public.standard_products(id) on delete cascade,
  source_type text not null check (source_type in ('upload', 'external_url')),
  image_url text not null,
  storage_path text unique,
  mime_type text,
  file_size_bytes integer check (file_size_bytes is null or file_size_bytes > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (
      source_type = 'upload'
      and storage_path is not null
      and mime_type = 'image/webp'
      and file_size_bytes is not null
      and width is not null
      and height is not null
    )
    or
    (
      source_type = 'external_url'
      and storage_path is null
      and mime_type is null
      and file_size_bytes is null
      and width is null
      and height is null
    )
  ),
  check (
    image_url ~ '^https://'
    or (
      source_type = 'upload'
      and image_url ~ '^http://(127\.0\.0\.1|localhost)(:[0-9]+)?/'
    )
  )
);

alter table public.standard_product_images enable row level security;

grant select on public.standard_product_images to anon, authenticated;
grant insert, update, delete on public.standard_product_images to authenticated;

create policy "standard product images are publicly readable"
  on public.standard_product_images for select to anon, authenticated
  using (true);

create policy "admins manage standard product images"
  on public.standard_product_images for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  true,
  1048576,
  array['image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "product images are publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'product-images');

create policy "admins upload product images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy "admins replace product images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'product-images'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    bucket_id = 'product-images'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

create policy "admins delete product images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
