-- M7 foundation: purchase type is separate from the category tree.
create table public.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  purchase_type text not null check (purchase_type in ('retail_product', 'menu_item', 'raw_material', 'property', 'service')),
  parent_id uuid,
  slug text not null check (length(trim(slug)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  depth smallint not null default 0 check (depth >= 0),
  created_at timestamptz not null default now(),
  unique (purchase_type, slug),
  unique (id, purchase_type),
  foreign key (parent_id, purchase_type) references public.catalog_categories(id, purchase_type) on delete restrict
);

create index catalog_categories_parent_idx on public.catalog_categories(purchase_type, parent_id, depth);

alter table public.products
  add column purchase_type text not null default 'retail_product'
    check (purchase_type in ('retail_product', 'menu_item', 'raw_material', 'property', 'service')),
  add column category_id uuid references public.catalog_categories(id) on delete set null,
  add column category_tags text[] not null default '{}';

create index products_user_type_category_idx on public.products(user_id, purchase_type, category_id);

alter table public.price_observations
  add column measurement_unit text not null default 'each'
    check (length(trim(measurement_unit)) > 0),
  add column location_label text,
  add column attributes jsonb not null default '{}'::jsonb;

alter table public.catalog_categories enable row level security;
grant select on public.catalog_categories to anon, authenticated;
create policy "catalog categories are publicly readable"
  on public.catalog_categories for select to anon, authenticated
  using (true);

-- Initial retail taxonomy. The tree remains data-driven and can grow without schema changes.
insert into public.catalog_categories (purchase_type, slug, display_name, depth)
values
  ('retail_product', 'food', '식품', 0),
  ('retail_product', 'beauty', '뷰티', 0),
  ('retail_product', 'household', '생활용품', 0),
  ('retail_product', 'apparel', '의류', 0),
  ('retail_product', 'electronics', '전자제품', 0),
  ('retail_product', 'other', '기타', 0),
  ('retail_product', 'uncategorized', '미분류', 0)
on conflict (purchase_type, slug) do nothing;

insert into public.catalog_categories (purchase_type, parent_id, slug, display_name, depth)
select 'retail_product', id, child.slug, child.display_name, child.depth
from public.catalog_categories parent
cross join (values
  ('food', 'fresh-food', '신선식품', 1),
  ('food', 'processed-food', '가공식품', 1),
  ('food', 'livestock', '축산물', 1),
  ('beauty', 'cosmetics', '화장품', 1)
) as child(parent_slug, slug, display_name, depth)
where parent.purchase_type = 'retail_product' and parent.slug = child.parent_slug
on conflict (purchase_type, slug) do nothing;

insert into public.catalog_categories (purchase_type, parent_id, slug, display_name, depth)
select 'retail_product', parent.id, child.slug, child.display_name, child.depth
from public.catalog_categories parent
cross join (values
  ('fresh-food', 'fruit', '과일', 2),
  ('fresh-food', 'vegetables', '채소', 2),
  ('processed-food', 'frozen-food', '냉동식품', 2),
  ('processed-food', 'ready-meal', '간편식', 2),
  ('livestock', 'meat', '육류', 2),
  ('livestock', 'seafood', '수산물', 2)
) as child(parent_slug, slug, display_name, depth)
where parent.purchase_type = 'retail_product' and parent.slug = child.parent_slug
on conflict (purchase_type, slug) do nothing;
