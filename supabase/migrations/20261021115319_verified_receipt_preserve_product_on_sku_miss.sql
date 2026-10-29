-- Preserve the resolved private product when a merchant SKU has no mapping yet.
-- Patch the current body so source-fact, benefit, and identity handling survive.
begin;

do $migration$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.submit_verified_receipt_v2_legacy(text, jsonb)'::regprocedure)
    into v_definition;

  v_old := '  v_product_id uuid;';
  v_new := v_old || chr(10) || '  v_sku_product_id uuid;';
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'verified receipt product declaration patch target must occur exactly once';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$        if v_sku is not null then
          select id, product_id into v_store_product_id, v_product_id
          from public.store_products
          where user_id = v_user_id and store_id = v_store_id and store_product_code = v_sku
          limit 1;
        end if;$old$;
  v_new := $new$        if v_sku is not null then
          select id, product_id into v_store_product_id, v_sku_product_id
          from public.store_products
          where user_id = v_user_id and store_id = v_store_id and store_product_code = v_sku
          limit 1;
          if found then
            v_product_id := v_sku_product_id;
          end if;
        end if;$new$;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) <> length(v_old) then
    raise exception 'verified receipt SKU lookup patch target must occur exactly once';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end;
$migration$;

commit;
