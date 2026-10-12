import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;
    create table public.restaurant_menu_manual_observations(id int primary key,created_by uuid,verification_status text,observation_kind text);
    alter table public.restaurant_menu_manual_observations enable row level security;
    grant select on public.restaurant_menu_manual_observations to anon,authenticated;
    insert into public.restaurant_menu_manual_observations values
      (1,'11111111-1111-4111-8111-111111111111','verified','standalone_purchase'),
      (2,'22222222-2222-4222-8222-222222222222','verified','standalone_purchase'),
      (3,'11111111-1111-4111-8111-111111111111','unverified','standalone_purchase'),
      (4,'11111111-1111-4111-8111-111111111111','verified','manual_menu');`);
  await db.exec(await readFile(process.argv[2], "utf8"));
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);`);
  assert.deepEqual((await db.query("select id from public.restaurant_menu_manual_observations")).rows, [{ id: 1 }]);
  await db.exec(`select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);`);
  assert.deepEqual((await db.query("select id from public.restaurant_menu_manual_observations")).rows, [{ id: 2 }]);
  await db.exec("set role anon;");
  assert.deepEqual((await db.query("select id from public.restaurant_menu_manual_observations")).rows, []);
  assert.equal((await db.query("select has_table_privilege('authenticated','public.restaurant_menu_manual_observations','INSERT') as writable")).rows[0].writable, false);
  console.log("OCR_RESTAURANT_PURCHASE_READS_PASS: owner-only verified purchases; other owner, unverified, other source and anonymous rows excluded; no writes granted");
} finally { await db.close(); }
