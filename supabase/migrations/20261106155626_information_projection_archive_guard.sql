-- Archived sources require explicit reopening before a new public projection.
-- Existing immutable receipts still replay. Prior deployed migrations and grants remain unchanged.
create or replace function pricetrace_private.preview_information_price(
  p_record_id uuid, p_expected_user_id uuid, p_source_fingerprint text, p_mapping jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); source public.pricetrace_information_inbox;
  prior public.pricetrace_information_projection_receipts;
  payload json; field json; price_field json; date_field json; kind text;
  product record; seller record; impact jsonb; normalized jsonb; digest text;
  observed date; amount integer; reason text; existing_id uuid; existing_status text; previous_count integer; previous_min integer;
  ancestor_id uuid; ancestor_text text; visited uuid[]:=array[p_record_id]; ancestor_count integer:=0; lineage uuid[];
begin
  if uid is null or uid is distinct from p_expected_user_id then raise exception 'Account changed' using errcode='42501'; end if;
  select * into source from public.pricetrace_information_inbox where user_id=uid and record_id=p_record_id;
  if not found then raise exception 'Owned source not found' using errcode='42501'; end if;
  if p_source_fingerprint is distinct from source.content_fingerprint then raise exception 'Source changed; preview again' using errcode='23505'; end if;
  select * into prior from public.pricetrace_information_projection_receipts where user_id=uid and record_id=p_record_id;
  if found then
    if prior.mapping is distinct from p_mapping then raise exception 'Already applied with different mapping' using errcode='23505'; end if;
    return prior.result || jsonb_build_object('status','applied','replayed',true);
  end if;
  if source.state='archived' then
    return jsonb_build_object('status','blocked','reason','보관한 자료는 검토 대기로 변경한 뒤 공개 반영하세요.','account_id',uid,'record_id',p_record_id,'source_fingerprint',source.content_fingerprint);
  end if;
  payload := source.payload_text::json;
  if p_mapping is null or jsonb_typeof(p_mapping)<>'object'
    or not p_mapping ?& array['catalog_product_id','store_id','price_field','date_field']
    or exists(select 1 from jsonb_object_keys(p_mapping) k where k not in ('catalog_product_id','store_id','price_field','date_field'))
    or exists(select 1 from jsonb_each(p_mapping) e where jsonb_typeof(e.value)<>'string') then
    reason := '상품·판매처·원문 가격 항목·관측일 항목을 모두 선택하세요.';
  end if;
  if reason is null then
    for field in select value from json_array_elements(payload->'fields') loop
      if field->>'key'='offering_kind' then kind:=field->>'value'; end if;
      if field->>'key'=p_mapping->>'price_field' then price_field:=field; end if;
      if field->>'key'=p_mapping->>'date_field' then date_field:=field; end if;
    end loop;
    -- A sibling/descendant already applied is also a correction, not a new fact.
    with recursive edges as (
      select record_id as child,(payload_text::json->>'supersedes_record_id')::uuid as parent
      from public.pricetrace_information_inbox where user_id=uid
    ), connected(id) as (
      select p_record_id
      union
      select case when e.child=c.id then e.parent else e.child end
      from connected c join edges e on (e.child=c.id and e.parent is not null) or e.parent=c.id
    ) select array_agg(id) into lineage from (select id from connected limit 66) bounded;
    if cardinality(lineage)>65 then reason:='연결된 정정 기록이 64개를 초과했습니다. 원문 관계를 확인하세요.';
    elsif exists(select 1 from public.pricetrace_information_projection_receipts where user_id=uid and record_id=any(lineage)) then
      reason:='연결된 정정 기록이 이미 반영되어 있습니다. 기존 공개 관측의 정정 절차를 이용하세요.';
    end if;
    if kind is not null and kind <> 'retail_product' then reason := '현재 공개 가격 반영은 상품만 지원합니다. 서비스·메뉴·기타 정보는 비공개 보관함에 유지됩니다.';
    elsif price_field is null or price_field->>'value_type'<>'decimal' or price_field->>'unit' is distinct from 'KRW'
      or price_field->>'value' !~ '^(0|[1-9][0-9]*)(\.0+)?$' then reason := '원문에 KRW 단위가 명시된 0 이상의 정수 가격이 필요합니다. 미상 값을 0으로 채우지 않습니다.';
    elsif length(price_field->>'value') > 128 or (price_field->>'value')::numeric > 2147483647 then reason := '지원 가능한 KRW 정수 범위를 초과했습니다.';
    else amount := (price_field->>'value')::numeric::integer;
    end if;
    begin
      if p_mapping->>'date_field'='$occurred_at' and payload->>'occurred_at' is not null then observed:=left(payload->>'occurred_at',10)::date;
      elsif date_field->>'value_type' in ('date','datetime') then observed:=left(date_field->>'value',10)::date;
      elsif reason is null then reason:='실제 관측일 또는 관측 시각 항목이 필요합니다. 캡처 시각은 대신 사용하지 않습니다.';
      end if;
    exception when datetime_field_overflow or invalid_datetime_format then reason:='공개 가격 저장소가 지원하지 않는 관측일입니다. 원문은 보관합니다.';
    end;
    ancestor_id:=(payload->>'supersedes_record_id')::uuid;
    while ancestor_id is not null loop
      if ancestor_id=any(visited) or ancestor_count>=64 then
        reason:='정정 관계에 순환이 있거나 64단계를 초과했습니다. 원문 관계를 확인하세요.'; exit;
      end if;
      visited:=array_append(visited,ancestor_id); ancestor_count:=ancestor_count+1;
      if exists(select 1 from public.pricetrace_information_projection_receipts where user_id=uid and record_id=ancestor_id) then
        reason:='이미 반영한 기록의 정정입니다. 가격을 다시 더하지 말고 기존 공개 관측의 정정 절차를 이용하세요.'; exit;
      end if;
      select payload_text into ancestor_text from public.pricetrace_information_inbox where user_id=uid and record_id=ancestor_id;
      if not found then reason:='정정 대상 원문을 확인하지 못했습니다. 원문 관계를 먼저 확인하세요.'; exit; end if;
      ancestor_id:=(ancestor_text::json->>'supersedes_record_id')::uuid;
    end loop;
    if p_mapping->>'catalog_product_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_mapping->>'store_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      reason:=coalesce(reason,'정확한 상품과 승인된 판매처를 선택하세요.');
    else
      select c.id, c.canonical_name, c.specification, s.canonical_name as standard_name into product
      from public.catalog_products c join public.standard_products s on s.id=c.standard_product_id
      where c.id=(p_mapping->>'catalog_product_id')::uuid and c.status='active' and c.verification_status='verified'
        and c.purchase_type='retail_product' and c.specification_status='verified'
        and s.status='active' and s.verification_status='verified' and s.purchase_type='retail_product' for share of c,s;
      if not found then reason:=coalesce(reason,'활성·검증된 상품과 포장 규격을 확인하지 못했습니다. 이름으로 자동 연결하지 않습니다.'); end if;
      select id, display_name, location_label into seller from public.price_observation_sources
        where id=(p_mapping->>'store_id')::uuid and status='active' and review_status='verified' for share;
      if not found then reason:=coalesce(reason,'승인된 판매처가 아닙니다. 미상 판매처는 보관함에 유지됩니다.'); end if;
    end if;
  end if;
  if reason is not null then return jsonb_build_object('status','blocked','reason',reason,'account_id',uid,'record_id',p_record_id,'source_fingerprint',source.content_fingerprint); end if;
  normalized:=jsonb_build_object('adapter','pricetrace.public_price.v1','account_id',uid,'record_id',p_record_id,
    'source_fingerprint',source.content_fingerprint,'mapping',p_mapping,
    'catalog_product_id',product.id,'product_name',product.canonical_name,'specification',product.specification,
    'store_id',seller.id,'store_name',seller.display_name,'location_label',seller.location_label,'observed_on',observed,'unit_price_krw',amount);
  digest:=encode(extensions.digest(normalized::text,'sha256'),'hex');
  select id,verification_status into existing_id,existing_status from public.public_price_observations where store_id=seller.id and catalog_product_id=product.id and observed_on=observed and unit_price_krw=amount for share;
  if existing_status='rejected' then return jsonb_build_object('status','blocked','reason','동일한 공개 관측이 거절된 상태입니다. 기존 관측의 정정 절차가 필요합니다.','account_id',uid,'record_id',p_record_id,'source_fingerprint',source.content_fingerprint); end if;
  select count(*)::integer,min(o.unit_price_krw) into previous_count,previous_min from public.public_price_observations o
    join public.price_observation_sources s on s.id=o.store_id where o.catalog_product_id=product.id and o.verification_status='user_verified' and s.status='active' and s.review_status='verified';
  impact:=normalized || jsonb_build_object('visibility','public','additional_observations',case when existing_id is null then 1 else 0 end,
    'observation_count_before',previous_count,'minimum_before',previous_min,'minimum_after',least(coalesce(previous_min,amount),amount),'existing_observation_id',existing_id);
  return jsonb_build_object('status','ready','account_id',uid,'record_id',p_record_id,'source_fingerprint',source.content_fingerprint,'mapping_digest',digest,'impact',impact);
end $$;
