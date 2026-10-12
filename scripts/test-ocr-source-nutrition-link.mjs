import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const sql = await readFile(process.argv[2], "utf8");
const readProjection = process.argv[3] ? await readFile(process.argv[3], "utf8") : null;
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create table public.nutrition_canonical_imports(id uuid primary key, owner_id text, user_verified boolean,
      nutrition_food_id text, input_contract text, source_document_ref text);
    create table public.nutrition_foods(id text primary key,owner_id text,name text,kind text,
      basis_amount numeric,basis_unit text,prep_state text,calories_kcal numeric,protein_grams numeric,
      carbs_grams numeric,fat_grams numeric,sodium_mg numeric,saturated_fat_grams numeric,sugars_grams numeric,
      fiber_grams numeric,added_sugars_grams numeric,trans_fat_grams numeric,cholesterol_mg numeric,
      source_type text,source_reference text,source_version text,revision integer,visibility text,
      deleted_at timestamptz,updated_at timestamptz);
    insert into public.nutrition_foods(id,owner_id,name,kind,basis_amount,basis_unit,prep_state,
      calories_kcal,source_type,source_reference,source_version,revision,visibility,updated_at)
      values('verified-food','11111111-1111-4111-8111-111111111111','Source food','external_menu',100,'g','unspecified',155,
      'product_label_ocr','{"source_reference":"label-source"}','label-v1',1,'private',now());
    insert into public.nutrition_canonical_imports values('22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',true,'verified-food','nutrition-label.v1','ocr-app://approved-label');`);
  await db.exec(sql);
  if (readProjection) {
    await db.exec(`create table public.nutrition_food_nutrients(food_id text,nutrient_code text,amount numeric,unit text,deleted_at timestamptz);
      insert into public.nutrition_food_nutrients values('verified-food','vitamin_c',12,'mg',null);`);
    const helper = await readFile(process.argv[4], "utf8");
    const start = helper.indexOf("create or replace function public.nutrition_read_v1_row(");
    const end = helper.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start);
    await db.exec(helper.slice(start, end + 3));
    await db.exec(readProjection);
  }
  const owner = "11111111-1111-4111-8111-111111111111";
  const identity = { schema_version: "verified-receipt-product.v1", namespace: "pricetrace",
    receipt_id: "33333333-3333-4333-8333-333333333333", store_id: "44444444-4444-4444-8444-444444444444",
    product_id: "55555555-5555-4555-8555-555555555555", store_product_id: "66666666-6666-4666-8666-666666666666",
    source_line_id: "line-1", receipt_item_id: "authority-receipt-item", binding_basis: "explicit_line" };
  const auth = async (id) => { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); };
  const attach = async (input = identity, verified = true, food = "verified-food") => (await db.query(
    "select public.attach_verified_receipt_product_nutrition_v1($1,$2,$3,$4) result",
    ["22222222-2222-4222-8222-222222222222", food, input, verified])).rows[0].result;
  await auth(""); await assert.rejects(attach, /authenticated owner/);
  await auth(owner); await assert.rejects(() => attach(identity, false), /verified receipt product/);
  await assert.rejects(() => attach(identity, true, "other-food"), /owner verified nutrition import/);
  await auth("77777777-7777-4777-8777-777777777777"); await assert.rejects(attach, /owner verified nutrition import/);
  await auth(owner);
  const first = await attach(); const replay = await attach();
  assert.equal(first.id, replay.id);
  const food = (await db.query("select revision,visibility,calories_kcal,source_reference from public.nutrition_foods where id='verified-food'")).rows[0];
  assert.equal(food.revision, 2); assert.equal(food.visibility, "private"); assert.equal(Number(food.calories_kcal), 155);
  assert.deepEqual(JSON.parse(food.source_reference).receipt_product_identity, identity);
  await assert.rejects(() => attach({ ...identity, receipt_id: "88888888-8888-4888-8888-888888888888" }), /identity conflict/);
  await assert.rejects(() => attach({ ...identity, standard_product_id: identity.product_id }), /verified receipt product/);
  await db.exec("set role authenticated");
  assert.equal((await db.query("select id from public.verified_receipt_product_nutrition_links")).rows.length, 1);
  await auth("77777777-7777-4777-8777-777777777777");
  assert.equal((await db.query("select id from public.verified_receipt_product_nutrition_links")).rows.length, 0);
  assert.deepEqual((await db.query("select public.get_verified_receipt_product_nutrition_v1($1) foods", [identity.store_product_id])).rows[0].foods, []);
  await auth(owner);
  const foods = (await db.query("select public.get_verified_receipt_product_nutrition_v1($1) foods", [identity.store_product_id])).rows[0].foods;
  assert.equal(foods.length, 1); assert.equal(foods[0].catalog_product_id, null);
  assert.equal(foods[0].nutrition_values.calories_kcal, 155);
  if (readProjection) assert.deepEqual(foods[0].micronutrients.vitamin_c, { amount: 12, unit: "mg" });
  console.log("OCR_VERIFIED_RECEIPT_NUTRITION_SQL_PASS: exact owner/source binding; no StandardProduct; replay; immutable conflict; private RLS; read projection");
} finally { await db.close(); }
