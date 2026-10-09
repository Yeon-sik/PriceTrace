import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// Optional test-only runtime, supplied externally. Never contacts a remote DB.
const runtime = process.argv[2];
if (!runtime) throw new Error("Usage: node scripts/test-purchase-price-sql.mjs <@electric-sql/pglite package directory>");
const { PGlite } = await import(pathToFileURL(join(resolve(runtime), "dist/index.js")).href);
const { pgcrypto } = await import(pathToFileURL(join(resolve(runtime), "dist/contrib/pgcrypto.js")).href);
const db = new PGlite({ extensions: { pgcrypto } });
const root = resolve(import.meta.dirname, "..");
const readSql = (folder, file) => readFileSync(join(root, "supabase", folder, file), "utf8").replace(/\r\n/g, "\n");

try {
  // Auth/Storage service bootstrap stubs. Ownership and SQL roles/RLS are real;
  // this harness does not validate HTTP JWT signatures or Supabase services.
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users(id uuid primary key, created_at timestamptz default now(), email text);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt()->>'sub', '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
    insert into auth.users(id) values ('00000000-0000-4000-8000-000000000011'), ('00000000-0000-4000-8000-000000000022');
  `);

  const migrations = readdirSync(join(root, "supabase/migrations")).filter(f => f.endsWith(".sql")).sort();
  let baselineChecked = false;
  for (const file of migrations) {
    if (file.endsWith("purchase_price_runtime_compatibility.sql")) {
      await assert.rejects(() => db.exec(readSql("tests", "purchase_price_observation_v4.sql")),
        error => error.code === "42601" && error.internalQuery?.includes("v_legacy_kind is distinct from case v_purchase_kind"));
      await db.exec("rollback");
      console.log("BASELINE_V4_CASE_FAILURE_REPRODUCED");
      await assert.rejects(() => db.query("select min(id) from public.restaurant_locations"),
        error => error.code === "42883" && error.message.includes("min(uuid)"));
      console.log("BASELINE_V4_UUID_AGGREGATE_REPRODUCED");
      baselineChecked = true;
    }
    let sql = readSql("migrations", file);
    if (file === "20260911160000_product_candidate_order_history_ocr_fields.sql") {
      // The historical qualified POSITION syntax is invalid PostgreSQL.
      // Accommodate it only in this in-memory bootstrap, never in source files.
      assert.ok(sql.includes("pg_catalog.position("));
      console.log("HISTORICAL_POSITION_BOOTSTRAP_ACCOMMODATION", file);
      sql = sql.replace("pg_catalog.position(", "position(");
    }
    try {
      await db.exec(sql);
    } catch (error) {
      if (file !== "20260911140000_purchase_price_observation_v4.sql" || error.code !== "42601") {
        throw new Error(`Migration ${file}: ${error.code} ${error.message}`);
      }
      console.log("HISTORICAL_V4_INSTALL_SYNTAX_FAILURE_REPRODUCED");
      // Preserve the historical body until its new forward repair runs.
      await db.exec("set check_function_bodies = off");
      try { await db.exec(sql); } finally { await db.exec("set check_function_bodies = on"); }
    }
  }
  assert.ok(baselineChecked);
  console.log(`MIGRATION_BOOTSTRAP_WITH_DOCUMENTED_ACCOMMODATIONS_PASS ${migrations.length}`);
  for (const file of ["purchase_price_observation_v4.sql", "purchase_price_line_authority_response.sql"]) {
    try {
      const result = await db.exec(readSql("tests", file));
      console.log(`SQL_FIXTURE_PASS ${file}`, result.flatMap(r => r.rows).filter(r => r.result));
    } catch (error) {
      throw new Error(`Fixture ${file}: ${error.code} ${error.message} ${error.where ?? ""}`);
    }
  }
  // Optional read-only deployed definition snapshot. Re-run the same fixtures
  // after forward patches against that exact body, without contacting Supabase.
  if (process.argv[3]) {
    const snapshot = JSON.parse(readFileSync(process.argv[3], "utf8"));
    const deployed = snapshot.rows?.[0]?.purchase_function;
    assert.equal(typeof deployed, "string");
    assert.ok(deployed.startsWith("CREATE OR REPLACE FUNCTION public.ingest_verified_purchase_price_observation_v1("));
    await db.exec(deployed.replace(/\r\n/g, "\n"));
    try {
      await db.exec(readSql("tests", "purchase_price_observation_v4.sql"));
      throw new Error("Expected deployed V4 UUID aggregate failure");
    } catch (error) {
      if (error.code !== "42883" || !error.message.includes("min(uuid)")) {
        throw new Error(`Unexpected deployed baseline: ${error.code} ${error.message}`);
      }
      await db.exec("rollback");
      console.log("DEPLOYED_V4_UUID_AGGREGATE_FAILURE_REPRODUCED");
    }
    await db.exec(readSql("migrations", "20261009040159_purchase_price_runtime_compatibility.sql"));
    const metadataMigration = readSql("migrations", "20261009040200_purchase_price_line_authority_response.sql");
    const patches = metadataMigration.match(/do \$migration\$[\s\S]*?\$migration\$;/g);
    assert.equal(patches?.length, 1);
    // Helpers/getter are already installed from their unmodified migration.
    // Only reapply the checked ingest-definition patch to the deployed body.
    await db.exec(patches[0]);
    for (const file of ["purchase_price_observation_v4.sql", "purchase_price_line_authority_response.sql"]) {
      try {
        await db.exec(readSql("tests", file));
        console.log(`DEPLOYED_DEFINITION_FIXTURE_PASS ${file}`);
      } catch (error) {
        throw new Error(`Deployed fixture ${file}: ${error.code} ${error.message} ${error.where ?? ""}`);
      }
    }
  }
} finally {
  await db.close();
}
