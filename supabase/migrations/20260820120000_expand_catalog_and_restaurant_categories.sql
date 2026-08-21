-- Expand the retail taxonomy into user-facing leaf categories and place every
-- verified standard product that existed on 2026-08-20 into an exact leaf.
-- Restaurant categories are intentionally seeded without assigning any
-- restaurant. Restaurant/category linking remains an explicit user action.

insert into public.catalog_categories (purchase_type, slug, display_name, depth)
values
  ('retail_product', 'food', '식품', 0),
  ('retail_product', 'beauty', '뷰티', 0),
  ('retail_product', 'household', '생활용품', 0),
  ('retail_product', 'kitchen', '주방용품', 0),
  ('retail_product', 'apparel', '의류·패션', 0),
  ('retail_product', 'sports-leisure', '스포츠·레저', 0),
  ('retail_product', 'automotive', '자동차용품', 0),
  ('retail_product', 'electronics', '전자제품', 0),
  ('retail_product', 'other', '기타', 0),
  ('retail_product', 'uncategorized', '미분류', 0)
on conflict (purchase_type, slug) do update
set display_name = excluded.display_name,
    parent_id = null,
    depth = excluded.depth;

with definitions(parent_slug, slug, display_name, depth) as (
  values
    ('food', 'fresh-food', '신선식품', 1),
    ('food', 'processed-food', '가공식품', 1),
    ('food', 'livestock', '축산·수산', 1),
    ('food', 'beverages', '음료', 1),
    ('food', 'snacks-desserts', '간식·디저트', 1),
    ('food', 'health-food', '건강식품', 1),
    ('beauty', 'skincare', '스킨케어', 1),
    ('beauty', 'hair-body', '헤어·바디', 1),
    ('beauty', 'shaving-grooming', '면도·그루밍', 1),
    ('household', 'laundry-cleaning', '세탁·청소', 1),
    ('household', 'paper-disposables', '종이·일회용품', 1),
    ('household', 'health-hygiene', '건강·위생용품', 1),
    ('kitchen', 'cookware', '조리도구', 1),
    ('kitchen', 'tableware-storage', '식기·보관용기', 1),
    ('apparel', 'clothing', '의류', 1),
    ('apparel', 'underwear', '속옷', 1),
    ('apparel', 'fashion-accessories', '패션잡화', 1),
    ('sports-leisure', 'sports-equipment', '스포츠용품', 1),
    ('sports-leisure', 'outdoor-leisure', '아웃도어·레저', 1),
    ('automotive', 'car-care', '자동차 관리용품', 1),
    ('electronics', 'digital-devices', '디지털기기', 1),
    ('electronics', 'home-appliances', '생활가전', 1)
)
insert into public.catalog_categories (
  purchase_type, parent_id, slug, display_name, depth
)
select 'retail_product', parent.id, definition.slug,
  definition.display_name, definition.depth
from definitions as definition
join public.catalog_categories as parent
  on parent.purchase_type = 'retail_product'
 and parent.slug = definition.parent_slug
on conflict (purchase_type, slug) do update
set parent_id = excluded.parent_id,
    display_name = excluded.display_name,
    depth = excluded.depth;

with definitions(parent_slug, slug, display_name, depth) as (
  values
    ('fresh-food', 'fruit', '과일', 2),
    ('fresh-food', 'vegetables', '채소', 2),
    ('fresh-food', 'tofu-eggs', '두부·달걀', 2),
    ('livestock', 'meat', '육류', 2),
    ('livestock', 'seafood', '수산물', 2),
    ('processed-food', 'instant-noodles', '즉석면·떡국', 2),
    ('processed-food', 'noodles-pasta', '국수·파스타·당면', 2),
    ('processed-food', 'ready-meal', '간편식·냉동식품', 2),
    ('processed-food', 'bakery', '빵·베이커리', 2),
    ('processed-food', 'side-dishes-canned', '반찬·김·통조림', 2),
    ('processed-food', 'seasonings-sauces', '조미료·소스', 2),
    ('processed-food', 'flour-grains', '쌀·가루류', 2),
    ('processed-food', 'processed-meat-seafood', '육가공·어묵', 2),
    ('beverages', 'coffee-tea', '커피·차', 2),
    ('beverages', 'juice-fermented', '주스·유산균음료', 2),
    ('beverages', 'protein-drinks', '단백질음료', 2),
    ('beverages', 'health-energy-drinks', '건강·에너지음료', 2),
    ('beverages', 'alcohol', '주류', 2),
    ('snacks-desserts', 'chips-snacks', '스낵·과자', 2),
    ('snacks-desserts', 'ice-cream', '아이스크림', 2),
    ('snacks-desserts', 'chocolate-dessert', '초콜릿·디저트', 2),
    ('snacks-desserts', 'jerky-protein-snacks', '육포·단백질간식', 2),
    ('health-food', 'supplements', '건강기능식품', 2),
    ('skincare', 'face-moisturizer', '로션·크림', 2),
    ('skincare', 'sun-care', '선케어', 2),
    ('skincare', 'skin-treatment', '피부관리', 2),
    ('hair-body', 'hair-cleansing', '샴푸·헤어케어', 2),
    ('hair-body', 'body-care', '바디케어', 2),
    ('shaving-grooming', 'shaving', '면도용품', 2)
)
insert into public.catalog_categories (
  purchase_type, parent_id, slug, display_name, depth
)
select 'retail_product', parent.id, definition.slug,
  definition.display_name, definition.depth
from definitions as definition
join public.catalog_categories as parent
  on parent.purchase_type = 'retail_product'
 and parent.slug = definition.parent_slug
on conflict (purchase_type, slug) do update
set parent_id = excluded.parent_id,
    display_name = excluded.display_name,
    depth = excluded.depth;

-- Keep retail category placement available outside the production UUID
-- snapshot. Exact curated assignments below still win, while this function
-- covers other environments and standards created after this migration.
create function public.retail_standard_category_slug(p_canonical_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_canonical_name, '')));
begin
  if v_name ~ '세탁세제|세탁 ?세제|비트 트리플|섬유유연제|표백제|청소포|세정제' then return 'laundry-cleaning'; end if;
  if v_name ~ '종량제 ?봉투|재사용 ?봉투|키친타월|화장지|티슈|일회용' then return 'paper-disposables'; end if;
  if v_name ~ '마스크팩|시트 ?마스크|앰플 ?마스크|겔 ?마스크|진정 ?마스크|수딩 ?패드|스팟패드|클리어크림|연고' then return 'skin-treatment'; end if;
  if v_name ~ '쿨파스|파스($|[ (])|밴드|보건용 ?마스크|미세먼지.*마스크|kf ?[0-9]+ ?마스크|위생|소독' then return 'health-hygiene'; end if;
  if v_name ~ '프라이팬|후라이팬|냄비|도마|주방 ?가위|식도|과도|수세미|국자|뒤집개|주걱' then return 'cookware'; end if;
  if v_name ~ '젓가락|수저|밀폐용기|보관용기|찬통|반찬통|텀블러|식기|접시' then return 'tableware-storage'; end if;
  if v_name ~ '런닝|드로우|팬티|브라' then return 'underwear'; end if;
  if v_name ~ '반바지|긴바지|티셔츠|셔츠|재킷|자켓|의류' then return 'clothing'; end if;
  if v_name ~ '라켓|리스트 ?랩|보호대|덤벨|운동용품' then return 'sports-equipment'; end if;
  if v_name ~ '쿨토시|캠핑|등산|아웃도어' then return 'outdoor-leisure'; end if;
  if v_name ~ 'rainok|와이퍼|카샴푸|자동차' then return 'car-care'; end if;
  if v_name ~ '이어폰|충전기|보조배터리|스마트워치|태블릿' then return 'digital-devices'; end if;
  if v_name ~ '전기포트|선풍기|청소기|가습기' then return 'home-appliances'; end if;
  if v_name ~ '면도날|면도기|쉐이빙|질레트' then return 'shaving'; end if;
  if v_name ~ '샴푸|트리트먼트|컨디셔너|헤어' then return 'hair-cleansing'; end if;
  if v_name ~ '바디워시|바디 ?바|바디 .* 바|바디로션' then return 'body-care'; end if;
  if v_name ~ '선크림|선스틱|선로션|자외선' then return 'sun-care'; end if;
  if v_name ~ '로션|수분 ?크림|스네일 ?크림|보습 ?크림' then return 'face-moisturizer'; end if;

  if v_name ~ '테이크핏|더단백.*(워터|드링크)|프로틴 ?드링크|단백질 ?음료' then return 'protein-drinks'; end if;
  if v_name ~ '크리스피크림|도넛|글레이즈드|식빵|빵$|베이커리' then return 'bakery'; end if;
  if v_name ~ '초코볼|초콜릿볼|치즈케이크 ?큐브|스트로베리 ?큐브|베리베리.*큐브' then return 'chocolate-dessert'; end if;
  if v_name ~ '프리팩|prepack|모리팩|샤베트|아이스크림|미니컵|월드콘|더위사냥|모나카|싸만코|수박바|참외콘|요맘때|배스킨라빈스|베스킨라빈스|나뚜루' then return 'ice-cream'; end if;
  if v_name ~ '육포|프로틴바|크런치바|단백질바|하이프로틴바|순살바' then return 'jerky-protein-snacks'; end if;
  if v_name ~ '새우깡|포카칩|팝콘|감자칩|스낵|과자' then return 'chips-snacks'; end if;
  if v_name ~ '초코|초콜릿|케이크|쿠키|캔디|젤리' then return 'chocolate-dessert'; end if;
  if v_name ~ '발렌타인|조니워커|위스키|소주|맥주|와인|막걸리' then return 'alcohol'; end if;
  if v_name ~ '아임리얼|주스|쥬스|에이드|프로젝트 ?윌|요구르트|유산균 ?음료' then return 'juice-fermented'; end if;
  if v_name ~ '박카스|모닝이즈백|에너지 ?드링크|자양강장' then return 'health-energy-drinks'; end if;
  if v_name ~ '커피|카누|맥심|옥수수수염차|녹차|홍차|보리차|티백' then return 'coffee-tea'; end if;

  if v_name ~ '볶음밥|황금밥알|햇반|컵피자|라자냐|폭립|곰탕|누룽지탕|투움바|부옴바|citydeli|용두동.*쭈꾸미|크림우동|즉석 해물 칼국수' then return 'ready-meal'; end if;
  if v_name ~ '정어리튀김' then return 'processed-meat-seafood'; end if;
  if v_name ~ '급냉삼겹|대패 ?삼겹|삼겹살|한돈|소고기|한우|목살' then return 'meat'; end if;
  if v_name ~ '냉동.*관자|키조개|손질바지락|냉동새우살|씨푸드믹스|생선|수산' then return 'seafood'; end if;
  if v_name ~ '샤인머스켓|애플망고|사과|배($|[ (])|딸기|바나나' then return 'fruit'; end if;
  if v_name ~ '시금치|표고버섯|찐고구마|고구마' then return 'vegetables'; end if;
  if v_name ~ '순두부|두부|달걀|계란' then return 'tofu-eggs'; end if;
  if v_name ~ '라면|사발면|컵누들|짜왕|카구리|큰컵|팔도 ?도시락|진짜장|생생우동|세이면|멸치맛쌀국수|고추짜장면|햅쌀 ?떡국|불닭볶음면|간짬뽕|야키소바' then return 'instant-noodles'; end if;
  if v_name ~ '링귀니|스파게티|파스타면|옛날당면|국수면|건면' then return 'noodles-pasta'; end if;
  if v_name ~ '도시락김|곱창김|골뱅이|참치|통조림' then return 'side-dishes-canned'; end if;
  if v_name ~ '쌈장|초장|케찹|케첩|솔트|양념|소스|후추|된장' then return 'seasonings-sauces'; end if;
  if v_name ~ '부침가루|튀김가루|밀가루|쌀가루' then return 'flour-grains'; end if;
  if v_name ~ '닭가슴살|소시지|프랑크|로스트비프|어묵' then return 'processed-meat-seafood'; end if;
  if v_name ~ '밀크씨슬|테아닌|비타민|오메가|유산균|영양제' then return 'supplements'; end if;

  return 'uncategorized';
end;
$$;

revoke all on function public.retail_standard_category_slug(text)
  from public, anon, authenticated;

with inferred as (
  select standard_product.id, inferred_category.id as category_id
  from public.standard_products as standard_product
  left join public.catalog_categories as current_category
    on current_category.id = standard_product.category_id
  join public.catalog_categories as inferred_category
    on inferred_category.purchase_type = 'retail_product'
   and inferred_category.slug = public.retail_standard_category_slug(
     standard_product.canonical_name
   )
  where standard_product.purchase_type = 'retail_product'
    and (
      standard_product.category_id is null
      or current_category.purchase_type is distinct from 'retail_product'
      or current_category.depth < 2
    )
)
update public.standard_products as standard_product
set category_id = inferred.category_id,
    updated_at = now()
from inferred
where standard_product.id = inferred.id
  and standard_product.category_id is distinct from inferred.category_id;

-- UUIDs are exact production identities, not name guesses. This mapping covers
-- all 99 verified standard-product families returned by product-read.v1 on
-- 2026-08-20. Rows outside this snapshot keep a valid existing category, or
-- fall back to 미분류 when they have no category yet.
with assignments(standard_product_id, category_slug) as (
  values
    ('0307bd19-1a8c-40dd-8706-73475c0ea9e3'::uuid, 'bakery'),
    ('213617f8-691e-4b61-ae2b-18624b313f51'::uuid, 'meat'),
    ('ba2f830a-c2c0-4114-b95b-25ba2a6003b0'::uuid, 'instant-noodles'),
    ('956979f9-a354-44fc-aa13-d961456c7586'::uuid, 'instant-noodles'),
    ('1c406966-1945-491a-a4d5-2b8b43dc8b59'::uuid, 'coffee-tea'),
    ('c37c2767-9154-4c3e-b125-9c67c69363ba'::uuid, 'hair-cleansing'),
    ('78dd4b28-74c5-4f17-b5a3-760dfe7d963f'::uuid, 'ice-cream'),
    ('a7340cb1-9046-45e8-9e7d-e5a37e9b2a97'::uuid, 'clothing'),
    ('10d38c8f-9be0-47d9-998c-a892582feac9'::uuid, 'chips-snacks'),
    ('84eea8a2-b645-4951-9873-34fd366e2d20'::uuid, 'instant-noodles'),
    ('09bb69ef-32f3-4ab8-8ca5-0477ee8f6a92'::uuid, 'instant-noodles'),
    ('4e9f1f62-bb0c-400d-9f93-b22f4b59c008'::uuid, 'instant-noodles'),
    ('76edaa13-5e02-4853-bcd2-709f601b1133'::uuid, 'instant-noodles'),
    ('007aa68d-df6a-443c-9b84-804b2bd2646e'::uuid, 'shaving'),
    ('fe23601e-1fe1-483f-a3cd-aedbc3065fc2'::uuid, 'seasonings-sauces'),
    ('8093a9b0-d811-485d-b4f0-9f45b8556935'::uuid, 'face-moisturizer'),
    ('f246781a-7c31-4e83-92c8-fd2e311b3d67'::uuid, 'side-dishes-canned'),
    ('50ef0619-3552-4040-b6c1-065fc6b7024f'::uuid, 'side-dishes-canned'),
    ('0e41acec-8c17-4247-86bf-306487621f41'::uuid, 'protein-drinks'),
    ('8510a217-fe6c-473b-8c14-2cba4a301e40'::uuid, 'jerky-protein-snacks'),
    ('fe7c21f7-6da9-463c-a31b-4146a769b924'::uuid, 'ice-cream'),
    ('7431dd50-0d83-42de-848d-f6442a5ea082'::uuid, 'noodles-pasta'),
    ('a2f6eceb-3fb1-435f-950d-90cd7bdb9e74'::uuid, 'processed-meat-seafood'),
    ('9b5c57da-197f-4b35-b16c-93a3e36f3806'::uuid, 'side-dishes-canned'),
    ('ab8968db-7a87-4215-82b6-818506efd7f7'::uuid, 'side-dishes-canned'),
    ('d9c3a1b3-fbf3-4abf-877f-ae4c2f9ae216'::uuid, 'side-dishes-canned'),
    ('bf999144-ac05-4699-9265-cc43f9a65320'::uuid, 'ice-cream'),
    ('24b79329-de3c-450e-bc4c-1e776a996a7f'::uuid, 'ice-cream'),
    ('29d898f5-87ea-4ba8-831e-e8f267439622'::uuid, 'face-moisturizer'),
    ('66edf194-470e-41f4-9756-ad34b9cbaada'::uuid, 'sun-care'),
    ('926fd5c7-e0e6-44bd-b367-6c6e96c78037'::uuid, 'chocolate-dessert'),
    ('748f52b2-50c6-4e98-b879-0cded25ddf78'::uuid, 'coffee-tea'),
    ('5cece5e8-ca44-42d5-a06e-3ae6562e3bcf'::uuid, 'coffee-tea'),
    ('cf542b77-93dc-49a0-8faa-8d4b1665c7d5'::uuid, 'health-energy-drinks'),
    ('556d2934-6ec7-4e07-99cc-9262d1e88638'::uuid, 'health-energy-drinks'),
    ('7fae00be-6e0d-46eb-a167-9c47416e95f0'::uuid, 'alcohol'),
    ('6823849f-6bff-4a5d-b9fe-610728cf845e'::uuid, 'ice-cream'),
    ('050519bf-22c1-4896-b311-298168fe190d'::uuid, 'ice-cream'),
    ('5335be81-d85e-420c-9e07-220a66f237c2'::uuid, 'ice-cream'),
    ('db93be24-f163-4d5b-974a-e37aead7ee35'::uuid, 'chocolate-dessert'),
    ('90b801a6-b391-424e-b911-8eceb0d98ab6'::uuid, 'flour-grains'),
    ('6ab5f144-5c35-461d-b2cd-d00b1d212a44'::uuid, 'seasonings-sauces'),
    ('cf7c0efc-74a7-4caf-a1f8-622912ca884c'::uuid, 'instant-noodles'),
    ('49236876-d128-4ffc-b82b-0c4aecb7bf88'::uuid, 'chocolate-dessert'),
    ('edf3469d-9889-421e-a986-402f6cc599a5'::uuid, 'chocolate-dessert'),
    ('177d5c17-2fd8-4229-8f40-64f0c779a610'::uuid, 'seafood'),
    ('4f4291fd-1346-4874-8cc6-aabac5a3d266'::uuid, 'instant-noodles'),
    ('74fb7bb5-fb02-4431-aab6-10d1fc932078'::uuid, 'ready-meal'),
    ('c3db57d3-b8c3-42dc-bda1-6fc37d46ca1f'::uuid, 'laundry-cleaning'),
    ('1521ae35-971e-4e41-afe0-9c17fe128753'::uuid, 'ready-meal'),
    ('6dfadc66-fe4a-4c18-99ab-3c80073a1dd8'::uuid, 'ready-meal'),
    ('3d85d2c7-3e66-46ea-9036-5e555eefecc8'::uuid, 'ice-cream'),
    ('a5833485-e511-40ba-b5bb-b78f5afcc01e'::uuid, 'instant-noodles'),
    ('9dc81f64-6b13-4801-a961-4230cf71d5f9'::uuid, 'bakery'),
    ('0dab5387-35a0-4cc2-9b13-07134b1162d2'::uuid, 'instant-noodles'),
    ('3e4ba81a-efe7-40df-8c50-b575d3ed5bdd'::uuid, 'skin-treatment'),
    ('9a05846b-242a-4905-982c-885ff19aee5a'::uuid, 'chips-snacks'),
    ('3f9662b2-6334-4e32-b9e3-c93003c9abd2'::uuid, 'juice-fermented'),
    ('917beb5c-6ac5-4118-9fc4-d607fb913879'::uuid, 'processed-meat-seafood'),
    ('ca4137c8-6acc-41bf-a7c6-1775882dcde0'::uuid, 'instant-noodles'),
    ('63c652f7-c13f-481c-b3c2-a7890c82c1e3'::uuid, 'processed-meat-seafood'),
    ('8ada054a-0677-48d7-8735-9f7787f78a16'::uuid, 'ready-meal'),
    ('2de19747-dd95-4112-a296-3a31adea385b'::uuid, 'chips-snacks'),
    ('582b13ec-7d94-4912-a301-8b4639f52f8e'::uuid, 'noodles-pasta'),
    ('1db283d3-7a6c-4080-89bb-1f505c292b43'::uuid, 'instant-noodles'),
    ('67e6c173-ce12-4236-8b2d-8116876181e2'::uuid, 'instant-noodles'),
    ('955e73e0-9ac6-4f10-ad1d-780be92392d0'::uuid, 'ready-meal'),
    ('a492230e-b2bb-4fcd-9516-f187e8601f33'::uuid, 'instant-noodles'),
    ('e02916e8-5da7-4f4e-a373-39df9510098e'::uuid, 'seasonings-sauces'),
    ('ec4e25f2-b17f-4144-93f9-117871a74b9a'::uuid, 'ice-cream'),
    ('e0411821-7e04-47ce-8f76-00acdf383627'::uuid, 'alcohol'),
    ('fb055cad-a9f5-4f00-aacc-787363429c68'::uuid, 'jerky-protein-snacks'),
    ('0d3f3e93-65de-402a-81a3-5795094fc87e'::uuid, 'shaving'),
    ('d010a16d-f591-4ec9-b9a5-704ccc21b1e3'::uuid, 'instant-noodles'),
    ('1dfeb2be-689a-4d76-bdb2-f1f4ab5ecb34'::uuid, 'jerky-protein-snacks'),
    ('119cd5c9-28ab-4cd4-89ca-7f023fafaa53'::uuid, 'jerky-protein-snacks'),
    ('d7e78c9f-48bf-4a62-b660-0a796570fffc'::uuid, 'bakery'),
    ('bf4127c2-3af1-48d5-bbbb-6a2b49f4f80a'::uuid, 'ready-meal'),
    ('f927e84d-9b57-4c6f-b1dc-80710c63f307'::uuid, 'supplements'),
    ('68675144-666b-41e1-afd4-15f141854fe3'::uuid, 'protein-drinks'),
    ('96300321-9e47-4312-ade6-9ec45c4ef0d5'::uuid, 'protein-drinks'),
    ('5e52f011-29c4-48a7-81dd-ea61a95a5151'::uuid, 'seasonings-sauces'),
    ('b391df99-24f7-4feb-a4f4-bf772fb35b9c'::uuid, 'instant-noodles'),
    ('349360c8-4b23-491b-8a58-48fd00773987'::uuid, 'chips-snacks'),
    ('d29db210-0438-47db-9439-978fe41c0dd2'::uuid, 'tofu-eggs'),
    ('cf92f389-0d8d-4e5a-92b5-4f59232fdca3'::uuid, 'ready-meal'),
    ('c8a077aa-b198-4d94-9f61-9fff6a146d55'::uuid, 'ready-meal'),
    ('363641ad-8f17-4448-b37f-ecda7273c193'::uuid, 'ready-meal'),
    ('4982ceee-9f96-4d84-9fbd-dbdcf5308452'::uuid, 'ready-meal'),
    ('6efcbfbc-cbd0-4c91-8d4f-69f6862d25ac'::uuid, 'jerky-protein-snacks'),
    ('c4d484a0-2160-4c92-96c5-5114759671c3'::uuid, 'jerky-protein-snacks'),
    ('e30000d6-8bbd-4615-bed2-c6fec7fd7bde'::uuid, 'vegetables'),
    ('a5582cab-1efe-4a24-80ec-21190ae36398'::uuid, 'seasonings-sauces'),
    ('6addb760-457f-42cb-a544-a3c63b971af7'::uuid, 'processed-meat-seafood'),
    ('58c45b36-5f85-47f7-9c42-c0d8509cff84'::uuid, 'tofu-eggs'),
    ('a7655965-206a-4c98-a36e-e37c3cba2cc9'::uuid, 'juice-fermented'),
    ('c01203a6-0968-4e6f-a282-4f2d8d882109'::uuid, 'ready-meal'),
    ('a5dd638b-caf5-4069-92db-42d8c0b8dd11'::uuid, 'ready-meal'),
    ('ed747cc0-f033-4e4e-8964-f3f1a2e95591'::uuid, 'ready-meal')
)
update public.standard_products as standard_product
set category_id = category.id,
    updated_at = now()
from assignments as assignment
join public.catalog_categories as category
  on category.purchase_type = 'retail_product'
 and category.slug = assignment.category_slug
where standard_product.id = assignment.standard_product_id
  and standard_product.purchase_type = 'retail_product';

update public.standard_products as standard_product
set category_id = category.id,
    updated_at = now()
from public.catalog_categories as category
where standard_product.purchase_type = 'retail_product'
  and standard_product.category_id is null
  and category.purchase_type = 'retail_product'
  and category.slug = 'uncategorized';

-- A sellable variant inherits its standard-product family category. This keeps
-- legacy category readers consistent with the standard-product list.
update public.catalog_products as catalog_product
set category_id = standard_product.category_id,
    updated_at = now()
from public.standard_products as standard_product
where catalog_product.standard_product_id = standard_product.id
  and catalog_product.purchase_type = 'retail_product'
  and catalog_product.category_id is distinct from standard_product.category_id;

create function public.ensure_retail_standard_product_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category_purchase_type text;
  v_category_is_leaf boolean;
begin
  if new.purchase_type <> 'retail_product' then
    return new;
  end if;

  if new.category_id is null then
    select category.id
    into new.category_id
    from public.catalog_categories as category
    where category.purchase_type = 'retail_product'
      and category.slug = public.retail_standard_category_slug(new.canonical_name);
  else
    select
      category.purchase_type,
      not exists (
        select 1
        from public.catalog_categories as child
        where child.parent_id = category.id
          and child.purchase_type = category.purchase_type
      )
    into v_category_purchase_type, v_category_is_leaf
    from public.catalog_categories as category
    where category.id = new.category_id;
    if v_category_purchase_type is distinct from 'retail_product'
      or v_category_is_leaf is distinct from true
    then
      raise exception 'Retail standard products require a retail leaf category.'
        using errcode = '23514';
    end if;
  end if;

  if new.category_id is null then
    raise exception 'Retail standard-product category resolution failed.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger standard_products_require_retail_category
before insert or update of purchase_type, canonical_name, category_id
on public.standard_products
for each row execute function public.ensure_retail_standard_product_category();

alter table public.standard_products
  add constraint retail_standard_products_require_category
  check (purchase_type <> 'retail_product' or category_id is not null)
  not valid;
alter table public.standard_products
  validate constraint retail_standard_products_require_category;

create function public.inherit_retail_catalog_product_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purchase_type = 'retail_product' then
    select standard_product.category_id
    into new.category_id
    from public.standard_products as standard_product
    where standard_product.id = new.standard_product_id
      and standard_product.purchase_type = 'retail_product';
    if not found or new.category_id is null then
      raise exception 'Retail catalog variants require a categorized retail standard product.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger catalog_products_inherit_retail_category
before insert or update of standard_product_id, purchase_type, category_id
on public.catalog_products
for each row execute function public.inherit_retail_catalog_product_category();

create function public.propagate_retail_standard_product_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purchase_type = 'retail_product'
    and new.category_id is distinct from old.category_id
  then
    update public.catalog_products as catalog_product
    set category_id = new.category_id,
        updated_at = now()
    where catalog_product.standard_product_id = new.id
      and catalog_product.purchase_type = 'retail_product'
      and catalog_product.category_id is distinct from new.category_id;
  end if;
  return new;
end;
$$;

create trigger standard_products_propagate_retail_category
after update of category_id on public.standard_products
for each row execute function public.propagate_retail_standard_product_category();

revoke all on function public.ensure_retail_standard_product_category()
  from public, anon, authenticated;
revoke all on function public.inherit_retail_catalog_product_category()
  from public, anon, authenticated;
revoke all on function public.propagate_retail_standard_product_category()
  from public, anon, authenticated;

create function public.get_public_exact_standard_product_catalog_v4()
returns table (
  source_label text,
  source_product_code text,
  catalog_product_id uuid,
  standard_product_id uuid,
  standard_name text,
  brand_name text,
  standard_category_id uuid,
  standard_category_slug text,
  standard_category_name text,
  content_amount numeric,
  content_unit text,
  package_count integer,
  reference_unit integer,
  coupang_listed_price_krw integer,
  coupang_quantity integer,
  coupang_content_amount numeric,
  coupang_content_unit text,
  coupang_max_bundle_quantity integer,
  coupang_max_bundle_listed_price_krw integer,
  coupang_product_url text,
  coupang_observed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    catalog.source_label,
    catalog.source_product_code,
    catalog.catalog_product_id,
    catalog.standard_product_id,
    catalog.standard_name,
    catalog.brand_name,
    category.id,
    category.slug,
    category.display_name,
    catalog.content_amount,
    catalog.content_unit,
    catalog.package_count,
    catalog.reference_unit,
    catalog.coupang_listed_price_krw,
    catalog.coupang_quantity,
    catalog.coupang_content_amount,
    catalog.coupang_content_unit,
    catalog.coupang_max_bundle_quantity,
    catalog.coupang_max_bundle_listed_price_krw,
    catalog.coupang_product_url,
    catalog.coupang_observed_at
  from public.get_public_exact_standard_product_catalog_v3() as catalog
  inner join public.standard_products as standard_product
    on standard_product.id = catalog.standard_product_id
  inner join public.catalog_categories as category
    on category.id = standard_product.category_id
   and category.purchase_type = 'retail_product'
  order by catalog.standard_name, catalog.source_label, catalog.source_product_code;
$$;

comment on function public.get_public_exact_standard_product_catalog_v4() is
  'Returns exact public retail variants with the persisted standard-product category identity.';
revoke all on function public.get_public_exact_standard_product_catalog_v4()
  from public;
grant execute on function public.get_public_exact_standard_product_catalog_v4()
  to anon, authenticated;

create table public.restaurant_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.restaurant_categories(id) on delete restrict,
  slug text not null unique check (length(btrim(slug)) > 0),
  display_name text not null check (length(btrim(display_name)) > 0),
  depth smallint not null default 0 check (depth between 0 and 2),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create index restaurant_categories_parent_idx
  on public.restaurant_categories(parent_id, sort_order, display_name);

insert into public.restaurant_categories (
  slug, display_name, depth, sort_order
)
values
  ('korean', '한식', 0, 10),
  ('chinese', '중식', 0, 20),
  ('japanese', '일식', 0, 30),
  ('western', '양식', 0, 40),
  ('asian-world', '아시아·세계음식', 0, 50),
  ('cafe-dessert', '카페·디저트', 0, 60),
  ('quick-service', '패스트푸드·간편식', 0, 70),
  ('pub-bar', '주점·바', 0, 80),
  ('other', '기타 음식점', 0, 90)
on conflict (slug) do update
set display_name = excluded.display_name,
    parent_id = null,
    depth = excluded.depth,
    sort_order = excluded.sort_order;

with definitions(parent_slug, slug, display_name, sort_order) as (
  values
    ('korean', 'korean-home-style', '백반·가정식', 11),
    ('korean', 'korean-soup-stew', '국밥·탕·찌개', 12),
    ('korean', 'korean-grill', '고기·구이', 13),
    ('korean', 'korean-noodles', '면·국수', 14),
    ('korean', 'jokbal-bossam', '족발·보쌈', 15),
    ('korean', 'bunsik', '분식', 16),
    ('korean', 'chicken', '치킨', 17),
    ('chinese', 'chinese-general', '중화요리', 21),
    ('chinese', 'mala-hotpot', '마라·훠궈', 22),
    ('japanese', 'sushi-sashimi', '초밥·회', 31),
    ('japanese', 'ramen-udon', '라멘·우동', 32),
    ('japanese', 'tonkatsu', '돈카츠', 33),
    ('japanese', 'izakaya', '이자카야', 34),
    ('western', 'pasta-pizza', '파스타·피자', 41),
    ('western', 'steak-grill', '스테이크·그릴', 42),
    ('western', 'salad-healthy', '샐러드·건강식', 43),
    ('asian-world', 'southeast-asian', '동남아 음식', 51),
    ('asian-world', 'indian-middle-eastern', '인도·중동 음식', 52),
    ('asian-world', 'mexican-latin', '멕시코·중남미 음식', 53),
    ('asian-world', 'world-other', '기타 세계음식', 54),
    ('cafe-dessert', 'coffee-cafe', '카페·커피', 61),
    ('cafe-dessert', 'bakery-cafe', '베이커리', 62),
    ('cafe-dessert', 'dessert-icecream', '디저트·아이스크림', 63),
    ('quick-service', 'burger', '햄버거', 71),
    ('quick-service', 'sandwich', '샌드위치', 72),
    ('quick-service', 'dosirak', '도시락·간편식', 73),
    ('quick-service', 'delivery-only', '배달·포장 전문', 74),
    ('quick-service', 'fastfood-other', '기타 패스트푸드', 75),
    ('pub-bar', 'hof-pub', '호프·펍', 81),
    ('pub-bar', 'bar-wine', '바·와인', 82),
    ('pub-bar', 'pocha', '포장마차', 83),
    ('other', 'cafeteria', '구내식당·급식', 91),
    ('other', 'restaurant-other', '기타', 99)
)
insert into public.restaurant_categories (
  parent_id, slug, display_name, depth, sort_order
)
select parent.id, definition.slug, definition.display_name, 1,
  definition.sort_order
from definitions as definition
join public.restaurant_categories as parent
  on parent.slug = definition.parent_slug
on conflict (slug) do update
set parent_id = excluded.parent_id,
    display_name = excluded.display_name,
    depth = excluded.depth,
    sort_order = excluded.sort_order;

alter table public.restaurants
  add column category_id uuid
    references public.restaurant_categories(id) on delete set null;

create index restaurants_category_idx
  on public.restaurants(category_id, status, review_status, canonical_name);

comment on table public.restaurant_categories is
  'User-facing hierarchical cuisine taxonomy. Category rows are seeded centrally; assigning a restaurant remains an explicit user action.';
comment on column public.restaurants.category_id is
  'Optional user-selected restaurant category. Existing restaurants are deliberately left unassigned by the taxonomy migration.';

create or replace function public.sync_restaurant_cuisine_type_from_category()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.category_id is not null then
    select category.display_name
    into new.cuisine_type
    from public.restaurant_categories as category
    where category.id = new.category_id;
  elsif tg_op = 'UPDATE' and old.category_id is not null then
    new.cuisine_type := null;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_restaurant_cuisine_type_from_category()
  from public, anon, authenticated;

create trigger restaurants_sync_cuisine_category
before insert or update of category_id, cuisine_type on public.restaurants
for each row execute function public.sync_restaurant_cuisine_type_from_category();

alter table public.restaurant_categories enable row level security;
grant select on public.restaurant_categories to anon, authenticated;
create policy "restaurant categories are publicly readable"
  on public.restaurant_categories for select to anon, authenticated
  using (true);

create function public.restaurant_category_document(p_category_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with recursive category_path as (
    select
      category.id,
      category.parent_id,
      category.slug,
      category.display_name,
      0 as distance
    from public.restaurant_categories as category
    where category.id = p_category_id

    union all

    select
      parent.id,
      parent.parent_id,
      parent.slug,
      parent.display_name,
      child.distance + 1
    from category_path as child
    inner join public.restaurant_categories as parent
      on parent.id = child.parent_id
    where child.distance < 2
  ),
  selected_category as (
    select category.id, category.slug, category.display_name
    from public.restaurant_categories as category
    where category.id = p_category_id
  )
  select jsonb_build_object(
    'id', selected_category.id,
    'slug', selected_category.slug,
    'name', selected_category.display_name,
    'path', (
      select jsonb_agg(
        jsonb_build_object(
          'id', path.id,
          'slug', path.slug,
          'name', path.display_name
        )
        order by path.distance desc
      )
      from category_path as path
    )
  )
  from selected_category;
$$;

revoke all on function public.restaurant_category_document(uuid)
  from public, anon, authenticated;

-- v2 keeps the verified v1 projection intact and enriches only its public
-- restaurant profile with the persisted category identity and ancestry.
create function public.get_restaurant_directory_v2(
  p_query text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with legacy as (
    select public.get_restaurant_directory_v1(null, 200) as payload
  ),
  enriched as (
    select
      entry.ordinality,
      restaurant.id as restaurant_id,
      jsonb_set(
        entry.document - 'revision',
        '{restaurant,category}',
        coalesce(
          public.restaurant_category_document(restaurant.category_id),
          'null'::jsonb
        ),
        true
      ) as document
    from legacy
    cross join lateral jsonb_array_elements(legacy.payload -> 'restaurants')
      with ordinality as entry(document, ordinality)
    inner join public.restaurants as restaurant
      on restaurant.id = (entry.document -> 'restaurant' ->> 'id')::uuid
  ),
  filtered as (
    select enriched.*
    from enriched
    where nullif(pg_catalog.btrim(p_query), '') is null
      or coalesce(enriched.document -> 'restaurant' ->> 'brand', '')
        ilike '%' || pg_catalog.btrim(p_query) || '%'
      or coalesce(enriched.document -> 'restaurant' ->> 'legalName', '')
        ilike '%' || pg_catalog.btrim(p_query) || '%'
      or coalesce(enriched.document -> 'restaurant' ->> 'cuisineType', '')
        ilike '%' || pg_catalog.btrim(p_query) || '%'
      or exists (
        select 1
        from jsonb_array_elements(coalesce(
          enriched.document -> 'restaurant' -> 'category' -> 'path',
          '[]'::jsonb
        )) as category_node(document)
        where coalesce(category_node.document ->> 'name', '')
          ilike '%' || pg_catalog.btrim(p_query) || '%'
      )
      or exists (
        select 1
        from jsonb_array_elements(coalesce(
          enriched.document -> 'locations',
          '[]'::jsonb
        )) as location(document)
        where coalesce(location.document ->> 'locationLabel', '')
            ilike '%' || pg_catalog.btrim(p_query) || '%'
          or coalesce(location.document ->> 'sourceLabel', '')
            ilike '%' || pg_catalog.btrim(p_query) || '%'
      )
      or exists (
        select 1
        from public.restaurant_menus as search_menu
        where search_menu.restaurant_id = enriched.restaurant_id
          and search_menu.status = 'active'
          and search_menu.review_status = 'verified'
          and (
            search_menu.canonical_name ilike '%' || pg_catalog.btrim(p_query) || '%'
            or coalesce(search_menu.category_label, '')
              ilike '%' || pg_catalog.btrim(p_query) || '%'
          )
      )
    order by enriched.document -> 'restaurant' ->> 'brand', enriched.ordinality
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  ),
  versioned as (
    select
      filtered.ordinality,
      jsonb_set(
        filtered.document,
        '{revision}',
        to_jsonb(
          'sha256:' || encode(
            extensions.digest(
              pg_catalog.convert_to(filtered.document::text, 'UTF8'),
              'sha256'
            ),
            'hex'
          )
        ),
        true
      ) as document
    from filtered
  ),
  directory as (
    select coalesce(
      jsonb_agg(versioned.document order by versioned.ordinality),
      '[]'::jsonb
    ) as documents
    from versioned
  )
  select jsonb_build_object(
    'schemaVersion', 'restaurant-directory.v2',
    'namespace', 'pricetrace',
    'revision', 'sha256:' || encode(
      extensions.digest(
        pg_catalog.convert_to(directory.documents::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'restaurants', directory.documents
  )
  from directory;
$$;

comment on function public.get_restaurant_directory_v2(text, integer) is
  'restaurant-directory.v2: verified restaurant directory with persisted category identity and root-to-leaf path.';
revoke all on function public.get_restaurant_directory_v2(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_directory_v2(text, integer)
  to anon, authenticated;

create function public.get_restaurant_detail_v2(p_restaurant_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with legacy as (
    select public.get_restaurant_detail_v1(p_restaurant_id) as payload
  ),
  enriched as (
    select jsonb_set(
      legacy.payload - 'schemaVersion' - 'namespace' - 'revision',
      '{restaurant,category}',
      coalesce(
        public.restaurant_category_document(restaurant.category_id),
        'null'::jsonb
      ),
      true
    ) as document
    from legacy
    inner join public.restaurants as restaurant
      on restaurant.id = p_restaurant_id
    where legacy.payload is not null
  )
  select jsonb_build_object(
    'schemaVersion', 'restaurant-detail.v2',
    'namespace', 'pricetrace',
    'revision', 'sha256:' || encode(
      extensions.digest(
        pg_catalog.convert_to(enriched.document::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'restaurant', enriched.document -> 'restaurant',
    'locations', enriched.document -> 'locations',
    'menus', enriched.document -> 'menus'
  )
  from enriched;
$$;

comment on function public.get_restaurant_detail_v2(uuid) is
  'restaurant-detail.v2: one verified restaurant with persisted category identity and root-to-leaf path.';
revoke all on function public.get_restaurant_detail_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_detail_v2(uuid)
  to anon, authenticated;

create function public.admin_set_restaurant_category_v1(
  p_restaurant_id uuid,
  p_category_id uuid
)
returns table (
  restaurant_id uuid,
  category_id uuid,
  category_slug text,
  category_display_name text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid;
  v_category_id uuid;
  v_category_slug text;
  v_category_display_name text;
begin
  if auth.uid() is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  select restaurant.id
  into v_restaurant_id
  from public.restaurants as restaurant
  where restaurant.id = p_restaurant_id
    and restaurant.status = 'active'
  for update;
  if not found then
    raise exception 'The active restaurant does not exist.' using errcode = '23503';
  end if;

  if p_category_id is not null then
    select category.id, category.slug, category.display_name
    into v_category_id, v_category_slug, v_category_display_name
    from public.restaurant_categories as category
    where category.id = p_category_id
      and not exists (
        select 1
        from public.restaurant_categories as child
        where child.parent_id = category.id
      );
    if not found then
      raise exception 'A leaf restaurant category is required.' using errcode = '23514';
    end if;
  end if;

  update public.restaurants as restaurant
  set category_id = v_category_id,
      updated_at = now()
  where restaurant.id = v_restaurant_id;

  return query
  select v_restaurant_id, v_category_id, v_category_slug, v_category_display_name;
end;
$$;

comment on function public.admin_set_restaurant_category_v1(uuid, uuid) is
  'Explicitly links or unlinks one active restaurant to a leaf category after an administrator action.';
revoke all on function public.admin_set_restaurant_category_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_restaurant_category_v1(uuid, uuid)
  to authenticated;
