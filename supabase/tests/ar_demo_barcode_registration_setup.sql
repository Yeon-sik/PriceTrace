-- Synthetic operator-procedure fixture in the disposable local test DB only.
insert into public.standard_products(id, purchase_type, canonical_name) values
  ('8510a217-fe6c-473b-8c14-2cba4a301e40', 'retail_product', '더단백 크런치바 초코'),
  ('f927e84d-9b57-4c6f-b1dc-80710c63f307', 'retail_product', '테아닌과 밀크씨슬 활력솔루션');
insert into public.catalog_products(id, standard_product_id, purchase_type, canonical_name,
  specification_status, content_amount, content_unit, package_count, reference_unit, listing_reference_url)
values ('1516c3eb-3dfb-4e11-8040-d23fadcdaad0', '8510a217-fe6c-473b-8c14-2cba4a301e40',
  'retail_product', '__ar_demo_fixture_bar', 'verified', 40, 'g', 1, 100, 'https://example.com/ar-demo-bar'),
  ('18e83c5c-86a4-4e95-a131-411381789687', 'f927e84d-9b57-4c6f-b1dc-80710c63f307',
  'retail_product', '__ar_demo_fixture_tablets', 'verified', 60, 'g', 1, 100, 'https://example.com/ar-demo-tablets');
