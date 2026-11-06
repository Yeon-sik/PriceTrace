-- Forward-only strictness fix: reject duplicate decoded object member names
-- before jsonb validation or canonical fingerprinting can hide source values.
create or replace function public.pricetrace_information_canonical(p_value json, p_depth integer default 0)
returns text language plpgsql immutable set search_path = '' as $$
declare result text;
begin
  if p_depth >= 64 and json_typeof(p_value) in ('object','array') then raise exception 'JSON nesting exceeds 64 containers'; end if;
  case json_typeof(p_value)
    when 'object' then
      if exists(select 1 from json_each(p_value) group by key having count(*) > 1) then
        raise exception 'Duplicate JSON object member names are not permitted' using errcode = '22023';
      end if;
      select '{' || coalesce(string_agg(to_json(key)::text || ':' || public.pricetrace_information_canonical(value, p_depth + 1), ',' order by key collate "C"), '') || '}' into result from json_each(p_value);
    when 'array' then
      select '[' || coalesce(string_agg(public.pricetrace_information_canonical(value, p_depth + 1), ',' order by position), '') || ']' into result from json_array_elements(p_value) with ordinality as entry(value, position);
    when 'string' then result := to_json(p_value #>> '{}')::text;
    else result := btrim(p_value::text);
  end case;
  return result;
end $$;
