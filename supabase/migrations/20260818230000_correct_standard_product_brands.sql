-- Correct manufacturer-level canonical brands for existing standard products.
-- Product names and sellable variants remain unchanged; only brand identity and
-- its official provenance are corrected.

begin;
insert into public.brands (canonical_name, official_site_url)
values
  ('남양', 'https://company.namyangi.com'),
  ('동아제약', 'https://www.dapharm.com')
on conflict (normalized_name) do update
set official_site_url = coalesce(public.brands.official_site_url, excluded.official_site_url),
    updated_at = now();
insert into public.standard_product_brand_evidence (
  standard_product_id,
  brand_id,
  observed_name,
  source_type,
  source_label,
  source_url
)
select
  standard.id,
  brand.id,
  evidence.observed_name,
  'official_store',
  evidence.source_label,
  evidence.source_url
from public.standard_products as standard
inner join public.brands as brand
  on brand.normalized_name = public.normalize_brand_name(
    case
      when standard.canonical_name like '테이크핏 맥스%' then '남양'
      when standard.canonical_name = '박카스 F' then '동아제약'
      when standard.canonical_name like '더단백%' then '빙그레'
      else ''
    end
  )
cross join lateral (
  select
    case
      when standard.canonical_name like '테이크핏 맥스%' then '남양유업'
      when standard.canonical_name = '박카스 F' then '동아제약'
      else '빙그레'
    end as observed_name,
    case
      when standard.canonical_name like '테이크핏 맥스%' then '남양유업 공식 기업 사이트'
      when standard.canonical_name = '박카스 F' then '동아제약 공식몰 Dmall'
      else '빙그레 공식 기업 사이트'
    end as source_label,
    case
      when standard.canonical_name like '테이크핏 맥스%' then 'https://company.namyangi.com/ko/promotion/board/report/detail?bbsSn=787'
      when standard.canonical_name = '박카스 F' then 'https://dmall.co.kr/brands/bacchus/product.html'
      when standard.canonical_name like '더단백 워터%' then 'https://www.bing.co.kr/news/news_announced_view?anno_idx=264'
      else 'https://www.bing.co.kr/news/news_announced_view?anno_idx=149'
    end as source_url
) as evidence
where standard.status = 'active'
  and (
    standard.canonical_name like '테이크핏 맥스%'
    or standard.canonical_name = '박카스 F'
    or standard.canonical_name like '더단백%'
  )
on conflict do nothing;
update public.standard_products as standard
set
  brand_id = brand.id,
  brand = brand.canonical_name,
  updated_at = now()
from public.brands as brand
where standard.status = 'active'
  and (
    standard.canonical_name like '테이크핏 맥스%'
    or standard.canonical_name = '박카스 F'
    or standard.canonical_name like '더단백%'
  )
  and brand.normalized_name = public.normalize_brand_name(
    case
      when standard.canonical_name like '테이크핏 맥스%' then '남양'
      when standard.canonical_name = '박카스 F' then '동아제약'
      else '빙그레'
    end
  );
commit;
