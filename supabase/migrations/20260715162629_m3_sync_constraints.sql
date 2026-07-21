alter table public.stores add constraint stores_user_name_key unique (user_id, name);
alter table public.products add constraint products_user_name_key unique (user_id, name);
