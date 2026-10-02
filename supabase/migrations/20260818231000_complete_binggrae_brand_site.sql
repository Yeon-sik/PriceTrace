-- Complete the official site metadata for the existing Binggrae brand.

update public.brands
set
  official_site_url = 'https://www.bing.co.kr',
  updated_at = now()
where normalized_name = public.normalize_brand_name('빙그레')
  and official_site_url is null;
