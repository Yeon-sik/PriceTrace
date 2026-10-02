create or replace function pg_temp.ocr_v5_anchor_span(
  p_definition text,
  p_anchor text,
  p_context text
)
returns integer[]
language plpgsql
as $function$
declare
  v_pattern text := pg_catalog.btrim(p_anchor);
  v_meta text;
  v_match_count integer;
  v_start integer;
  v_end integer;
begin
  if v_pattern is null or v_pattern = '' then
    raise exception 'OCR V5 patch anchor % is empty', p_context;
  end if;

  v_pattern := pg_catalog.replace(v_pattern, pg_catalog.chr(92), pg_catalog.chr(92) || pg_catalog.chr(92));
  foreach v_meta in array array['.', '^', '$', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}'] loop
    v_pattern := pg_catalog.replace(v_pattern, v_meta, pg_catalog.chr(92) || v_meta);
  end loop;
  v_pattern := pg_catalog.regexp_replace(v_pattern, '[[:space:]]+', '[[:space:]]+', 'g');

  v_match_count := pg_catalog.regexp_count(p_definition, v_pattern);
  if v_match_count <> 1 then
    raise exception 'OCR V5 patch anchor % matched % times', p_context, v_match_count;
  end if;

  v_start := pg_catalog.regexp_instr(p_definition, v_pattern, 1, 1, 0);
  v_end := pg_catalog.regexp_instr(p_definition, v_pattern, 1, 1, 1);
  return array[v_start, v_end];
end;
$function$;

do $test$
declare
  v_definition text;
  v_start integer[];
  v_end integer[];
  v_gap text;
  v_suffix text;
begin
  foreach v_definition in array array[
    'returning id into v_receipt_id;' || pg_catalog.chr(10) || pg_catalog.chr(10) || '  insert into public.verified_receipt_sources (receipt_id);',
    'returning   id into v_receipt_id;' || pg_catalog.chr(10) || '  insert into public.verified_receipt_sources (receipt_id);',
    'returning id into v_receipt_id;' || pg_catalog.chr(13) || pg_catalog.chr(10) || pg_catalog.chr(13) || pg_catalog.chr(10) || '  insert into public.verified_receipt_sources(' || pg_catalog.chr(13) || pg_catalog.chr(10) || '    receipt_id);',
    'returning id into v_receipt_id;' || pg_catalog.chr(10) || '  insert into public.verified_receipt_sources(' || pg_catalog.chr(10) || '    receipt_id);'
  ] loop
    v_start := pg_temp.ocr_v5_anchor_span(v_definition, 'returning id into v_receipt_id;', 'fixture receipt id token');
    v_end := pg_temp.ocr_v5_anchor_span(v_definition, 'insert into public.verified_receipt_sources', 'fixture source insert token');
    if v_end[1] <= v_start[2] then
      raise exception 'fixture anchors are out of order';
    end if;
    v_gap := pg_catalog.substr(v_definition, v_start[2], v_end[1] - v_start[2]);
    v_suffix := pg_catalog.substr(v_definition, v_end[2]);
    if v_gap !~ '^[[:space:]]*$' or v_suffix !~ '^[[:space:]]*[(]' then
      raise exception 'fixture semantic gap or parenthesis check failed';
    end if;
  end loop;

  begin
    perform pg_temp.ocr_v5_anchor_span(
      'returning id into v_receipt_id;',
      'insert into public.verified_receipt_sources',
      'missing fixture anchor'
    );
    raise exception 'missing fixture anchor was accepted';
  exception when raise_exception then
    if sqlerrm = 'missing fixture anchor was accepted' or sqlerrm not like '%matched 0 times' then
      raise;
    end if;
  end;

  begin
    perform pg_temp.ocr_v5_anchor_span(
      'insert into public.verified_receipt_sources; insert into public.verified_receipt_sources',
      'insert into public.verified_receipt_sources',
      'ambiguous fixture anchor'
    );
    raise exception 'ambiguous fixture anchor was accepted';
  exception when raise_exception then
    if sqlerrm = 'ambiguous fixture anchor was accepted' or sqlerrm not like '%matched 2 times' then
      raise;
    end if;
  end;
end;
$test$;

drop function pg_temp.ocr_v5_anchor_span(text, text, text);
