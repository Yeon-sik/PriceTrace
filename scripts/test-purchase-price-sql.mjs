import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { verifyOcrComponentContract } from "./verify-ocr-component-contract.mjs";
import { verifyArDemoBarcodeRegistration } from "./verify-ar-demo-barcode-registration.mjs";
import { verifyInformationInbox } from "./verify-information-inbox.mjs";
import { verifyInformationProjection } from "./verify-information-projection.mjs";
import { verifyInformationSellerReview } from "./verify-information-seller-review.mjs";

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
  let candidateDefinition;
  let v1ResolutionDefinitions;
  const v1ResolutionContracts = () => db.query("select proname, pg_get_functiondef(oid) as definition from pg_proc where oid in ('public.set_product_candidate_brand_resolution_v1(text,text,text,uuid,boolean)'::regprocedure,'public.get_product_candidate_brand_resolutions_v1(text)'::regprocedure,'public.submit_product_candidate_v1(text,jsonb)'::regprocedure) order by proname");
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
    if (file.endsWith("product_candidate_brand_resolution_v2.sql")) v1ResolutionDefinitions = await v1ResolutionContracts();
    if (file.endsWith("product_candidate_brand_resolution.sql")) candidateDefinition = await db.query("select pg_get_functiondef('public.submit_product_candidate_v1(text,jsonb)'::regprocedure) as definition");
    if (file.endsWith("brand_hierarchy_public_catalog.sql")) {
      brandCompatibilitySnapshot = await legacyCatalogDefinitions();
      brandIdentitySnapshot = await legacyBrandIdentities();
    }
    if (file.endsWith("verified_receipt_preserve_product_on_sku_miss.sql")) {
      await assert.rejects(() => db.exec(readSql("tests", "verified_receipt_sku_identity.sql")),
        error => error.code === "23502" && error.message.includes('"product_id"'));
      await db.exec("rollback");
      console.log("BASELINE_RECEIPT_NEW_SKU_PRODUCT_NULL_REPRODUCED");
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
  await verifyInformationInbox(db, root);
  await verifyInformationProjection(db, root);
  await verifyInformationSellerReview(db, root);
  assert.deepEqual(await v1ResolutionContracts(), v1ResolutionDefinitions);
  console.log("BRAND_RESOLUTION_V1_AND_INGEST_DEFINITIONS_UNCHANGED_PASS");
  assert.deepEqual(await db.query("select pg_get_functiondef('public.submit_product_candidate_v1(text,jsonb)'::regprocedure) as definition"), candidateDefinition);
  console.log("PRODUCT_CANDIDATE_INGEST_V1_DEFINITION_UNCHANGED_PASS");
  assert.deepEqual(await legacyCatalogDefinitions(), brandCompatibilitySnapshot);
  assert.deepEqual(await legacyBrandIdentities(), brandIdentitySnapshot);
  console.log("BRAND_LEGACY_V1_V4_DEFINITIONS_UNCHANGED_PASS");
  console.log(`MIGRATION_BOOTSTRAP_WITH_DOCUMENTED_ACCOMMODATIONS_PASS ${migrations.length}`);
