-- Private review inbox. No native catalog, price, receipt or finance projections.
create or replace function public.pricetrace_information_canonical(p_value json, p_depth integer default 0)
returns text language plpgsql immutable set search_path = '' as $$
declare result text;
begin
  if p_depth >= 64 and json_typeof(p_value) in ('object','array') then raise exception 'JSON nesting exceeds 64 containers'; end if;
  case json_typeof(p_value)
    when 'object' then
      select '{' || coalesce(string_agg(to_json(key)::text || ':' || public.pricetrace_information_canonical(value, p_depth + 1), ',' order by key collate "C"), '') || '}' into result from json_each(p_value);
    when 'array' then
      select '[' || coalesce(string_agg(public.pricetrace_information_canonical(value, p_depth + 1), ',' order by position), '') || ']' into result from json_array_elements(p_value) with ordinality as entry(value, position);
    when 'string' then result := to_json(p_value #>> '{}')::text;
    else result := btrim(p_value::text);
  end case;
  return result;
end $$;

create or replace function public.pricetrace_information_date_valid(p_value text, p_datetime boolean default false)
returns boolean language plpgsql immutable set search_path = '' as $$
declare d text; year_number integer; month_number integer; day_number integer; max_day integer;
begin
  if p_value is null then return false; end if;
  if p_datetime then
    if p_value !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' then return false; end if;
  elsif p_value !~ '^\d{4}-\d{2}-\d{2}$' then return false;
  end if;
  d := left(p_value, 10); year_number := left(d, 4)::integer; month_number := substring(d from 6 for 2)::integer; day_number := right(d, 2)::integer;
  if month_number not between 1 and 12 then return false; end if;
  max_day := case when month_number = 2 then case when year_number % 400 = 0 or year_number % 4 = 0 and year_number % 100 <> 0 then 29 else 28 end when month_number in (4,6,9,11) then 30 else 31 end;
  return day_number between 1 and max_day;
exception when others then return false;
end $$;

create or replace function public.pricetrace_information_uri_valid(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_value) = 'string' and length(p_value #>> '{}') <= 2048
    and (p_value #>> '{}') ~* '^https?://[^/@\s?#]+(:[0-9]+)?([/?#][^\s]*)?$'
    and (p_value #>> '{}') !~ '^https?://[^/]*@'
$$;

create or replace function public.pricetrace_information_record_valid(p_text text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare p jsonb; original json; entry record; field_entry json; normalized_fields jsonb := '[]'; normalized_field jsonb;
  s jsonb; f jsonb; r jsonb; k text; v text; typ text;
  owner text; ids text[] := '{}'; keys text[] := '{}'; refs text[]; optional_key text;
begin
  if p_text is null or octet_length(p_text) > 1048576 then return false; end if;
  -- Validate envelopes with JSONB, but never cast arbitrary JSON fact values to
  -- numeric. JSON permits numbers outside JavaScript/PostgreSQL numeric ranges.
  original := p_text::json;
  perform public.pricetrace_information_canonical(original);
  if json_typeof(original) <> 'object' then return false; end if;
  p := '{}';
  for entry in select * from json_each(original) loop
    if entry.key <> 'fields' then p := p || jsonb_build_object(entry.key, entry.value::jsonb); end if;
  end loop;
  if json_typeof(original->'fields') = 'array' then
    for field_entry in select value from json_array_elements(original->'fields') loop
      if json_typeof(field_entry) = 'object' and field_entry->>'value_type' = 'json' then
        normalized_field := '{}';
        for entry in select * from json_each(field_entry) loop
          normalized_field := normalized_field || jsonb_build_object(entry.key, case when entry.key = 'value' then 'null'::jsonb else entry.value::jsonb end);
        end loop;
      else normalized_field := field_entry::jsonb;
      end if;
      normalized_fields := normalized_fields || jsonb_build_array(normalized_field);
    end loop;
    p := p || jsonb_build_object('fields', normalized_fields);
  elsif original->'fields' is not null then p := p || jsonb_build_object('fields', original->'fields');
  end if;
  if jsonb_typeof(p) <> 'object' or not p ?& array['schema_version','record_id','owner_app','record_type','title','captured_at','sources','fields','references']
    or exists(select 1 from jsonb_object_keys(p) x where x not in ('schema_version','record_id','owner_app','record_type','title','captured_at','occurred_at','supersedes_record_id','sources','fields','references'))
    or p->>'schema_version' <> 'information-record.v1' or p->>'owner_app' <> 'pricetrace' then return false; end if;
  owner := p->>'owner_app';
  foreach k in array array['schema_version','record_id','owner_app','record_type','title','captured_at'] loop
    if jsonb_typeof(p->k) <> 'string' then return false; end if;
  end loop;
  if p->>'record_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p->>'record_type' !~ '^pricetrace\.[a-z][a-z0-9_.-]*$' or length(p->>'record_type') > 100
    or length(btrim(p->>'title')) = 0 or length(p->>'title') > 200
    or not public.pricetrace_information_date_valid(p->>'captured_at', true) then return false; end if;
  if p ? 'occurred_at' and (jsonb_typeof(p->'occurred_at') <> 'string' or not public.pricetrace_information_date_valid(p->>'occurred_at', true)) then return false; end if;
  if p ? 'supersedes_record_id' and (jsonb_typeof(p->'supersedes_record_id') <> 'string' or p->>'supersedes_record_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p->>'supersedes_record_id' = p->>'record_id') then return false; end if;
  if jsonb_typeof(p->'sources') <> 'array' or jsonb_array_length(p->'sources') not between 1 and 32
    or jsonb_typeof(p->'fields') <> 'array' or jsonb_array_length(p->'fields') not between 1 and 128
    or jsonb_typeof(p->'references') <> 'array' or jsonb_array_length(p->'references') > 64 then return false; end if;
  for s in select value from jsonb_array_elements(p->'sources') loop
    if jsonb_typeof(s) <> 'object' or not s ?& array['source_id','kind']
      or exists(select 1 from jsonb_object_keys(s) x where x not in ('source_id','kind','text','uri','sha256','name','media_type')) then return false; end if;
    if jsonb_typeof(s->'source_id') <> 'string' or length(btrim(s->>'source_id')) = 0 or length(s->>'source_id') > 128
      or s->>'source_id' = any(ids) or jsonb_typeof(s->'kind') <> 'string' or s->>'kind' not in ('manual','text','file','url','device') then return false; end if;
    ids := array_append(ids, s->>'source_id');
    foreach optional_key in array array['text','uri','sha256','name','media_type'] loop
      if s ? optional_key and jsonb_typeof(s->optional_key) <> 'string' then return false; end if;
    end loop;
    if s ? 'text' and length(s->>'text') > 100000 or s ? 'uri' and not public.pricetrace_information_uri_valid(s->'uri')
      or s ? 'sha256' and s->>'sha256' !~ '^[0-9a-f]{64}$'
      or s ? 'name' and (length(btrim(s->>'name')) = 0 or length(s->>'name') > 255)
      or s ? 'media_type' and (length(btrim(s->>'media_type')) = 0 or length(s->>'media_type') > 127)
      or s->>'kind' = 'text' and coalesce(length(btrim(s->>'text')), 0) = 0
      or s->>'kind' = 'url' and not s ? 'uri'
      or s->>'kind' = 'file' and not s ?& array['name','sha256'] then return false; end if;
  end loop;
  for f in select value from jsonb_array_elements(p->'fields') loop
    if jsonb_typeof(f) <> 'object' or not f ?& array['key','value_type','value']
      or exists(select 1 from jsonb_object_keys(f) x where x not in ('key','value_type','value','label','unit','confidence','source_ids')) then return false; end if;
    k := f->>'key'; typ := f->>'value_type'; v := f->>'value';
    if jsonb_typeof(f->'key') <> 'string' or k !~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$' or k = any(keys)
      or split_part(k, '.', 1) in ('fitness','cashos','healthtrace') or jsonb_typeof(f->'value_type') <> 'string'
      or typ not in ('text','decimal','boolean','date','datetime','json') then return false; end if;
    keys := array_append(keys, k);
    if typ in ('text','decimal','date','datetime') and jsonb_typeof(f->'value') <> 'string'
      or typ = 'text' and length(v) > 100000
      or typ = 'decimal' and (length(v) > 128 or v !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$')
      or typ = 'boolean' and jsonb_typeof(f->'value') <> 'boolean'
      or typ = 'date' and not public.pricetrace_information_date_valid(v)
      or typ = 'datetime' and not public.pricetrace_information_date_valid(v, true) then return false; end if;
    foreach optional_key in array array['label','unit'] loop
      if f ? optional_key and (jsonb_typeof(f->optional_key) <> 'string' or length(btrim(f->>optional_key)) = 0
        or length(f->>optional_key) > case when optional_key = 'label' then 120 else 64 end) then return false; end if;
    end loop;
    if f ? 'unit' and typ <> 'decimal' then return false; end if;
    if f ? 'confidence' and (jsonb_typeof(f->'confidence') <> 'number' or (f->>'confidence')::numeric not between 0 and 1) then return false; end if;
    if f ? 'source_ids' then
      if jsonb_typeof(f->'source_ids') <> 'array' or jsonb_array_length(f->'source_ids') > 32 then return false; end if;
      refs := '{}';
      for r in select value from jsonb_array_elements(f->'source_ids') loop
        v := r #>> '{}';
        if jsonb_typeof(r) <> 'string' or not v = any(ids) or v = any(refs) then return false; end if;
        refs := array_append(refs, v);
      end loop;
    end if;
  end loop;
  for r in select value from jsonb_array_elements(p->'references') loop
    if jsonb_typeof(r) <> 'object' or not r ?& array['owner_app','record_id','relation']
      or exists(select 1 from jsonb_object_keys(r) x where x not in ('owner_app','record_id','relation','record_type','project','uri'))
      or r->>'owner_app' not in ('fitness','cashos','pricetrace','healthtrace') then return false; end if;
    for k in select jsonb_object_keys(r) loop
      if jsonb_typeof(r->k) <> 'string' or length(btrim(r->>k)) = 0 then return false; end if;
    end loop;
    if length(r->>'record_id') > 200 or length(r->>'relation') > 80 or length(r->>'record_type') > 100 or length(r->>'project') > 200
      or r ? 'uri' and not public.pricetrace_information_uri_valid(r->'uri') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create table public.pricetrace_information_inbox (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  payload_text text not null check (public.pricetrace_information_record_valid(payload_text)),
  content_fingerprint text generated always as (encode(extensions.digest(public.pricetrace_information_canonical(payload_text::json), 'sha256'), 'hex')) stored,
  state text not null default 'pending' check (state in ('pending','reviewed','archived')),
  received_at timestamptz not null default now(),
  primary key (user_id, record_id),
  check (record_id::text = payload_text::json->>'record_id')
);
alter table public.pricetrace_information_inbox enable row level security;
create index pricetrace_information_inbox_received on public.pricetrace_information_inbox(user_id, received_at desc, record_id);
revoke all on public.pricetrace_information_inbox from public, anon, authenticated;
grant select on public.pricetrace_information_inbox to authenticated;
grant insert(user_id, record_id, payload_text) on public.pricetrace_information_inbox to authenticated;
grant update(state) on public.pricetrace_information_inbox to authenticated;
create policy pricetrace_information_read on public.pricetrace_information_inbox for select to authenticated using (user_id = (select auth.uid()));
create policy pricetrace_information_insert on public.pricetrace_information_inbox for insert to authenticated with check (user_id = (select auth.uid()));
create policy pricetrace_information_state on public.pricetrace_information_inbox for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create or replace function public.ingest_pricetrace_information_record_v1(p_payload_text text, p_expected_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); rid uuid; existing public.pricetrace_information_inbox; inserted integer;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if uid is distinct from p_expected_user_id then raise exception 'Account changed before submission' using errcode = '42501'; end if;
  if not public.pricetrace_information_record_valid(p_payload_text) then raise exception 'Invalid information-record.v1 PriceTrace payload' using errcode = '22023'; end if;
  rid := (p_payload_text::json->>'record_id')::uuid;
  insert into public.pricetrace_information_inbox(user_id, record_id, payload_text) values(uid, rid, p_payload_text) on conflict do nothing;
  get diagnostics inserted = row_count;
  select * into strict existing from public.pricetrace_information_inbox where user_id = uid and record_id = rid;
  if public.pricetrace_information_canonical(existing.payload_text::json) <> public.pricetrace_information_canonical(p_payload_text::json) then raise exception 'Record ID conflict: create a new correction record' using errcode = '23505'; end if;
  return jsonb_build_object('record_id', rid, 'duplicate', inserted = 0, 'content_fingerprint', existing.content_fingerprint);
end $$;
revoke all on function public.ingest_pricetrace_information_record_v1(text, uuid) from public, anon;
grant execute on function public.ingest_pricetrace_information_record_v1(text, uuid) to authenticated;
revoke all on function public.pricetrace_information_canonical(json, integer), public.pricetrace_information_date_valid(text, boolean), public.pricetrace_information_uri_valid(jsonb), public.pricetrace_information_record_valid(text) from public, anon;
grant execute on function public.pricetrace_information_canonical(json, integer), public.pricetrace_information_date_valid(text, boolean), public.pricetrace_information_uri_valid(jsonb), public.pricetrace_information_record_valid(text) to authenticated;
