begin;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000011","app_metadata":{"role":"admin"}}', true);

do $$
declare
  root uuid := gen_random_uuid(); child uuid := gen_random_uuid(); leaf uuid := gen_random_uuid();
  other uuid := gen_random_uuid(); archived uuid := gen_random_uuid();
  standard uuid := gen_random_uuid(); catalog uuid := gen_random_uuid(); category uuid;
  result jsonb; legacy jsonb; row_count integer; original_ids uuid[];
begin
  select array_agg(id order by id) into original_ids from public.brands;
  if exists(select 1 from public.brands where parent_brand_id is not null) then raise exception 'migration inferred existing parents'; end if;
  insert into public.brands(id,canonical_name) values(root,'PT Fixture Root'),(other,'PT Fixture Other');
  insert into public.brands(id,canonical_name,parent_brand_id) values(child,'PT Fixture Child',root),(leaf,'PT Fixture Leaf',child);
  insert into public.brands(id,canonical_name,status) values(archived,'PT Fixture Archived','archived');
  if (select parent_brand_id from public.brands where id = child) <> root then raise exception 'valid hierarchy failed'; end if;
  begin update public.brands set parent_brand_id = id where id = root;
    raise exception 'self cycle allowed'; exception when check_violation then null; end;
  begin update public.brands set parent_brand_id = leaf where id = root;
    raise exception 'indirect cycle allowed'; exception when check_violation then null; end;
  begin update public.brands set parent_brand_id = child where id = child;
    raise exception 'child self cycle allowed'; exception when check_violation then null; end;
  begin delete from public.brands where id = root;
    raise exception 'parent hard delete allowed'; exception when foreign_key_violation or restrict_violation then null; end;
  update public.brands set parent_brand_id = other where id = child;
  update public.brands set parent_brand_id = root where id = child;
  -- A multirow write must not evade the row trigger.
  begin update public.brands set parent_brand_id = case id when root then other else root end where id in(root,other);
    raise exception 'multirow cycle allowed'; exception when check_violation then null; end;
  insert into public.brand_aliases(brand_id,alias_name) values(child,'PT Fixture Alias'),(child,'PT Fixture Child Extra');
  select count(*) into row_count from public.get_public_brand_catalog_v1('PT Fixture Child');
  if row_count <> 1 then raise exception 'canonical/alias deduplication failed'; end if;
  if (select brand_id from public.get_public_brand_catalog_v1('pt fixture alias')) <> child then raise exception 'alias identity mismatch'; end if;
  if (select match_kind from public.get_public_brand_catalog_v1('pt fixture alias')) <> 'alias' then raise exception 'alias match metadata missing'; end if;
  if (select brand_id from public.get_public_brand_catalog_v1('  PT   FIXTURE  CHILD ')) <> child then raise exception 'normalization changed'; end if;
  if exists(select 1 from public.get_public_brand_catalog_v1('PT Fixture Archived')) then raise exception 'archived brand leaked'; end if;
  if (select count(*) from public.get_public_brand_catalog_v1('PT Fixture',0,-5)) <> 1 then raise exception 'pagination lower bound failed'; end if;
  if exists(select 1 from public.get_public_brand_catalog_v1('PT Fixture',200,1000001)) then raise exception 'offset clamp failed'; end if;
  begin insert into public.brand_aliases(brand_id,alias_name) values(other,'PT Fixture Child');
    raise exception 'canonical/alias collision allowed'; exception when unique_violation then null; end;

  select id into category from public.catalog_categories where purchase_type = 'retail_product' and slug = 'protein-drinks';
  insert into public.standard_products(id,purchase_type,canonical_name,brand_id,category_id)
    values(standard,'retail_product','PT Fixture Drink',child,category);
  insert into public.catalog_products(id,standard_product_id,purchase_type,canonical_name,specification,
    content_amount,content_unit,package_count,reference_unit,specification_status,listing_reference_url)
    values(catalog,standard,'retail_product','PT Fixture Drink','250ml',250,'ml',1,100,'verified','https://example.invalid/fixture-drink');
  insert into public.source_product_mappings(source_label,source_product_code,catalog_product_id,review_status)
    values('PT Fixture Seller','pt-fixture-code',catalog,'verified');
  if (select brand from public.standard_products where id = standard) <> 'PT Fixture Child' then raise exception 'legacy shadow broken'; end if;
  update public.brands set canonical_name = 'PT Fixture Renamed' where id = child;
  if (select brand from public.standard_products where id = standard) <> 'PT Fixture Renamed'
    or (select brand_id from public.standard_products where id = standard) <> child then raise exception 'rename propagation/identity broken'; end if;

  select to_jsonb(v4) into legacy from public.get_public_exact_standard_product_catalog_v4() v4 where catalog_product_id = catalog;
  select to_jsonb(v5) into result from public.get_public_exact_standard_product_catalog_v5() v5 where catalog_product_id = catalog;
  if result is null or legacy is null then raise exception 'verified product missing'; end if;
  if result - array['brand_id','parent_brand_id','parent_brand_name'] is distinct from legacy then raise exception 'v5 is not an exact v4 superset'; end if;
  if exists (
    (select to_jsonb(v5) - array['brand_id','parent_brand_id','parent_brand_name'] from public.get_public_exact_standard_product_catalog_v5() v5
     except all select to_jsonb(v4) from public.get_public_exact_standard_product_catalog_v4() v4)
    union all
    (select to_jsonb(v4) from public.get_public_exact_standard_product_catalog_v4() v4
     except all select to_jsonb(v5) - array['brand_id','parent_brand_id','parent_brand_name'] from public.get_public_exact_standard_product_catalog_v5() v5)
  ) then raise exception 'v5 common projection differs from v4'; end if;
  if result->>'brand_id' <> child::text or result->>'brand_name' <> 'PT Fixture Renamed'
    or result->>'parent_brand_id' <> root::text or result->>'parent_brand_name' <> 'PT Fixture Root'
    or result->>'standard_category_id' <> category::text or result->>'standard_category_slug' <> 'protein-drinks' then raise exception 'v5 brand/category fields incorrect'; end if;
  if exists(select 1 from public.get_public_exact_standard_product_catalog_v3() v3 where catalog_product_id = catalog and brand_name <> 'PT Fixture Renamed') then raise exception 'v3 brand semantics changed'; end if;
  update public.standard_products set brand_id = leaf where id = standard;
  if (select parent_brand_id from public.get_public_exact_standard_product_catalog_v5() where catalog_product_id = catalog) <> child then raise exception 'v5 flattened ancestry instead of direct parent'; end if;
  update public.standard_products set brand_id = child where id = standard;
  -- Archive visibility must never turn an existing parent edge into root-null.
  update public.brands set status = 'archived' where id = root;
  select to_jsonb(v5) into result from public.get_public_exact_standard_product_catalog_v5() v5 where catalog_product_id = catalog;
  if result->>'parent_brand_id' is distinct from root::text or result->>'parent_brand_name' is not null then
    raise exception 'v5 lost archived parent identity or exposed archived name'; end if;
  update public.brands set status = 'archived' where id = child;
  select to_jsonb(v5) into result from public.get_public_exact_standard_product_catalog_v5() v5 where catalog_product_id = catalog;
  if result->>'brand_id' is distinct from child::text or result->>'parent_brand_id' is distinct from root::text
    or result->>'parent_brand_name' is not null then raise exception 'v5 archived brand became a root'; end if;
  update public.brands set status = 'active' where id = root;
  -- An archived direct brand's parent name stays private; its identity remains known.
  if (select parent_brand_id from public.get_public_exact_standard_product_catalog_v5() where catalog_product_id = catalog) is distinct from root then
    raise exception 'v5 archived brand parent identity missing'; end if;
  update public.brands set status = 'active' where id = child;
  update public.standard_products set brand_id = null where id = standard;
  if (select brand_id from public.get_public_exact_standard_product_catalog_v5() where catalog_product_id = catalog) is not null then
    raise exception 'v5 inferred unassigned identity'; end if;
  update public.standard_products set brand_id = child where id = standard;
  update public.brands set parent_brand_id = archived where id = root;
  if (select parent_brand_id from public.get_public_brand_catalog_v1('PT Fixture Root')) <> archived
    or (select parent_canonical_name from public.get_public_brand_catalog_v1('PT Fixture Root')) is not null then raise exception 'missing public parent changed to root or leaked archived name'; end if;
  update public.brands set parent_brand_id = null where id = root;
  update public.catalog_products set specification_status = 'placeholder', content_amount = null, content_unit = null where id = catalog;
  if exists(select 1 from public.get_public_exact_standard_product_catalog_v5() where catalog_product_id = catalog) then raise exception 'v5 exposed unverified specification'; end if;
  update public.catalog_products set specification_status = 'verified', content_amount = 250, content_unit = 'ml' where id = catalog;
  if not original_ids <@ (select array_agg(id) from public.brands) then raise exception 'existing identities lost'; end if;

  execute 'set local role anon';
  if not exists(select 1 from public.get_public_brand_catalog_v1('PT Fixture')) then raise exception 'anonymous brand read failed'; end if;
  if not exists(select 1 from public.get_public_exact_standard_product_catalog_v5() where catalog_product_id = catalog) then raise exception 'anonymous v5 read failed'; end if;
  begin insert into public.brands(canonical_name) values('PT Forbidden Anon');
    raise exception 'anon brand write allowed'; exception when insufficient_privilege then null; end;
  begin select count(*) into row_count from public.brand_hierarchy_write_guard;
    raise exception 'mutex publicly readable'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000022","app_metadata":{}}',true);
  execute 'set local role authenticated';
  begin insert into public.brands(canonical_name) values('PT Forbidden Member');
    raise exception 'nonadmin brand write allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.brand_aliases(brand_id,alias_name) values(root,'PT Forbidden Alias');
    raise exception 'nonadmin alias write allowed'; exception when insufficient_privilege then null; end;
  begin update public.brands set parent_brand_id = other where id = child;
    raise exception 'nonadmin hierarchy update allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_save_brand_v1(child,'PT Forbidden',other,null,null);
    raise exception 'nonadmin brand RPC allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_add_brand_alias_v1(child,'PT Forbidden RPC Alias');
    raise exception 'nonadmin alias RPC allowed'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.brand_admin_actions) then raise exception 'nonadmin audit read allowed'; end if;
  execute 'reset role';
end;
$$;

-- Rank each match class and retain the canonical identity only once.
do $$
declare ids uuid[]; a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  d uuid := gen_random_uuid(); e uuid := gen_random_uuid(); f uuid := gen_random_uuid();
begin
  insert into public.brands(id,canonical_name) values(a,'PTQZ'),(b,'PTQZ prefix'),(c,'ZZ Prefix'),(d,'xxPTQZxx'),(e,'ZZ Contains'),(f,'ZZ Exact');
  insert into public.brand_aliases(brand_id,alias_name) values(a,'PTQZ duplicate'),(c,'PTQZ alias'),(e,'xxPTQZ alias'),(f,'PT Exact Alias');
  select array_agg(brand_id) into ids from public.get_public_brand_catalog_v1('PTQZ');
  if ids <> array[a,b,c,d,e] then raise exception 'search priority incorrect: %',ids; end if;
  if (select brand_id from public.get_public_brand_catalog_v1('PT Exact Alias')) <> f then raise exception 'exact alias missing'; end if;
end;
$$;

do $$
begin
  insert into public.brands(canonical_name) select 'PT Paging ' || lpad(n::text, 3, '0') from generate_series(1,205) n;
  if (select count(*) from public.get_public_brand_catalog_v1('PT Paging',2147483647,0)) <> 200
    or (select count(*) from public.get_public_brand_catalog_v1('PT Paging',200,200)) <> 5
    or (select count(*) from public.get_public_brand_catalog_v1('PT Paging',null,null)) <> 50 then
    raise exception 'public pagination upper/default bounds or offset failed'; end if;
end;
$$;
do $$
declare root uuid; child uuid; alias_id uuid; rows_before integer;
begin
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000011","app_metadata":{"role":"admin"}}',true);
  execute 'set local role authenticated';
  select count(*) into rows_before from public.brand_admin_actions;
  root := public.admin_save_brand_v1(null,'PT Admin Root',null,null,'https://example.invalid');
  child := public.admin_save_brand_v1(null,'PT Admin Child',root,null,null);
  perform public.admin_save_brand_v1(child,'PT Admin Renamed',root,null,null);
  alias_id := public.admin_add_brand_alias_v1(child,'PT Admin Alias');
  if (select brand_id from public.get_public_brand_catalog_v1('PT Admin Alias')) <> child then raise exception 'admin alias did not preserve identity'; end if;
  begin perform public.admin_save_brand_v1(root,'PT Admin Root',child,null,null);
    raise exception 'admin RPC cycle allowed'; exception when check_violation then null; end;
  begin perform public.admin_delete_brand_alias_v1(root,alias_id);
    raise exception 'alias deletion crossed brand identity'; exception when foreign_key_violation then null; end;
  perform public.admin_delete_brand_alias_v1(child,alias_id);
  if exists(select 1 from public.get_public_brand_catalog_v1('PT Admin Alias')) then raise exception 'alias deletion failed'; end if;
  if (select count(*) from public.brand_admin_actions) <> rows_before + 5 then raise exception 'admin actions missing or failed mutation audit leaked'; end if;
  begin update public.brands set canonical_name = 'PT Direct Admin' where id = child;
    raise exception 'direct admin write permission reopened'; exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$$;
select 'BRAND_HIERARCHY_SEARCH_V5_COMPATIBILITY_RLS_PASS' as result;
rollback;
