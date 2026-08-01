-- Keep the approval-gated registration path aligned with the family-owned
-- Coupang observation model restored in 20260801120000. Exact catalog variants
-- remain required for receipt and official-source identity, but price rows no
-- longer acquire that variant as artificial provenance.

do $migration$
declare
  v_core_signature regprocedure :=
    'public.register_standard_product_link_strict(text,text,text,text,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_replay_signature regprocedure :=
    'public.register_standard_product_link_strict_v2(text,text,text,text,text,text,timestamptz,uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,integer,integer,text,text[],text,integer,integer,numeric,text,integer,integer)'::regprocedure;
  v_core_definition text;
  v_core_updated text;
  v_replay_definition text;
  v_replay_updated text;
  v_core_old text := $fragment$
  values (
    v_standard_product_id,
    v_catalog_product_id,
    v_execution_id,
$fragment$;
  v_core_new text := $fragment$
  values (
    v_standard_product_id,
    null,
    v_execution_id,
$fragment$;
  v_replay_old text := $fragment$
      and price.catalog_product_id = v_registered.catalog_product_id
$fragment$;
  v_replay_new text := $fragment$
      and (
        price.catalog_product_id is null
        or (
          v_registered.replayed
          and price.catalog_product_id = v_registered.catalog_product_id
        )
      )
$fragment$;
begin
  select pg_catalog.pg_get_functiondef(v_core_signature)
  into v_core_definition;

  if pg_catalog.strpos(v_core_definition, v_core_old) = 0
  then
    raise exception 'Unexpected strict core Coupang insert contract.';
  end if;

  v_core_updated := pg_catalog.replace(
    v_core_definition,
    v_core_old,
    v_core_new
  );

  if v_core_updated = v_core_definition
    or pg_catalog.strpos(v_core_updated, v_core_old) > 0
    or pg_catalog.strpos(v_core_updated, v_core_new) = 0
  then
    raise exception 'The strict core family-owned price patch was not applied.';
  end if;

  execute v_core_updated;

  select pg_catalog.pg_get_functiondef(v_replay_signature)
  into v_replay_definition;

  if pg_catalog.strpos(v_replay_definition, v_replay_old) = 0
  then
    raise exception 'Unexpected strict V2 Coupang replay contract.';
  end if;

  v_replay_updated := pg_catalog.replace(
    v_replay_definition,
    v_replay_old,
    v_replay_new
  );

  if v_replay_updated = v_replay_definition
    or pg_catalog.strpos(v_replay_updated, v_replay_old) > 0
    or pg_catalog.strpos(v_replay_updated, v_replay_new) = 0
  then
    raise exception 'The strict V2 family-owned replay patch was not applied.';
  end if;

  execute v_replay_updated;
end;
$migration$;

comment on function public.register_standard_product_link_strict(
  text, text, text, text, uuid, uuid, text, text, text, text, text, text, text,
  text, text, numeric, text, integer, integer, text, text[], text, integer,
  integer, numeric, text, integer, integer
) is
  'Atomically creates or reuses one exact catalog variant and source mapping while recording its Coupang offer on the standard-product family.';

comment on function public.register_standard_product_link_strict_v2(
  text, text, text, text, text, text, timestamptz, uuid, uuid, text, text, text,
  text, text, text, text, text, text, numeric, text, integer, integer, text,
  text[], text, integer, integer, numeric, text, integer, integer
) is
  'Freezes one receipt item and exact identity target, then verifies a family-owned Coupang observation; legacy exact-variant price rows remain replayable.';
