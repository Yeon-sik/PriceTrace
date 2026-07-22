-- Admin receipt history is read-only. Authorization is based on trusted JWT app_metadata.
create policy "admins read all stores"
  on public.stores for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins read all products"
  on public.products for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins read all store products"
  on public.store_products for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins read all receipts"
  on public.receipts for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "admins read all receipt items"
  on public.receipt_items for select to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
