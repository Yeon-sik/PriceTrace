import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { verifyOcrComponentContract } from "./verify-ocr-component-contract.mjs";
import { verifyArDemoBarcodeRegistration } from "./verify-ar-demo-barcode-registration.mjs";

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
    create table auth.users(id uuid primary key, created_at timestamptz default now(), email text,
      aud text, role text, encrypted_password text, raw_app_meta_data jsonb, raw_user_meta_data jsonb, updated_at timestamptz);
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
  let brandCompatibilitySnapshot;
  let brandIdentitySnapshot;
  const legacyBrandIdentities = async () => ({
    brands: await db.query("select id, canonical_name from public.brands order by id"),
    products: await db.query("select id, brand_id, brand from public.standard_products order by id"),
  });
  const legacyCatalogDefinitions = () => db.query(`select proname, pg_get_functiondef(oid) as definition
    from pg_proc where pronamespace = 'public'::regnamespace and proname in (
      'get_public_standard_product_catalog', 'get_public_exact_standard_product_catalog',
      'get_public_exact_standard_product_catalog_v1', 'get_public_exact_standard_product_catalog_v2',
      'get_public_exact_standard_product_catalog_v3', 'get_public_exact_standard_product_catalog_v4'
    ) order by proname`);
  for (const file of migrations) {
    if (file.endsWith("public_barcode_verified_conflicts.sql")) {
      await assert.rejects(() => db.exec(readSql("tests", "public_product_by_barcode_v1.sql")),
        error => error.message.includes("archived verified conflict remains conflict without candidates"));
      await db.exec("rollback");
      console.log("BASELINE_BARCODE_HIDDEN_CONFLICT_MATCHED_FAILURE_REPRODUCED");
    }
    if (file.endsWith("brand_hierarchy_public_catalog.sql")) {
      brandCompatibilitySnapshot = await legacyCatalogDefinitions();
      brandIdentitySnapshot = await legacyBrandIdentities();
    }
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
  assert.deepEqual(await legacyCatalogDefinitions(), brandCompatibilitySnapshot);
  assert.deepEqual(await legacyBrandIdentities(), brandIdentitySnapshot);
  console.log("BRAND_LEGACY_V1_V4_DEFINITIONS_UNCHANGED_PASS");
  console.log(`MIGRATION_BOOTSTRAP_WITH_DOCUMENTED_ACCOMMODATIONS_PASS ${migrations.length}`);
  for (const file of ["public_product_by_barcode_v1.sql", "brand_hierarchy_public_catalog.sql", "purchase_price_observation_v4.sql", "purchase_price_line_authority_response.sql", "purchase_restaurant_identity_recovery.sql", "user_confirmed_purchase_restaurants.sql", "owner_confirmed_cross_purchase.sql", "restaurant_component_parent_reads.sql", "restaurant_component_identity_resolution.sql", "purchase_public_identity_search.sql", "verified_receipt_ingestion_v2.sql"]) {
    try {
      const result = await db.exec(readSql("tests", file));
      console.log(`SQL_FIXTURE_PASS ${file}`, result.flatMap(r => r.rows).filter(r => r.result));
    } catch (error) {
      throw new Error(`Fixture ${file}: ${error.code} ${error.message} ${error.where ?? ""}`);
    }
  }
  // Optional read-only deployed definition snapshot. Re-run the same fixtures
  // after forward patches against that exact body, without contacting Supabase.
  const componentArgument = process.argv.indexOf("--ocr-component");
  if (componentArgument !== -1) {
    assert.ok(process.argv[componentArgument + 1], "--ocr-component requires the OCR-generated artifact path");
    await verifyOcrComponentContract(db, process.argv[componentArgument + 1]);
  }
  if (process.argv[3] && !process.argv[3].startsWith("--")) {
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
  const barcodePublicReadArgument = process.argv.indexOf("--barcode-public-read");
  if (barcodePublicReadArgument !== -1) {
    const snapshot = JSON.parse(readFileSync(process.argv[barcodePublicReadArgument + 1], "utf8"));
    assert.ok(snapshot.public_read_definition?.startsWith("CREATE OR REPLACE FUNCTION public.get_product_read_v1("));
    await db.exec(snapshot.public_read_definition);
    const results = await db.exec(readSql("tests", "public_product_by_barcode_v1.sql"));
    console.log("DEPLOYED_PUBLIC_READ_BARCODE_FIXTURE_PASS", results.flatMap(result => result.rows).filter(row => row.result));
  }
  await verifyArDemoBarcodeRegistration(db, readSql);
} finally {
  await db.close();
}
