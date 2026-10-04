import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { RestaurantMenuCandidateSchema, ResolveRestaurantMenuCandidateSchema } from "./restaurant-menu-proposal";

const read = (name: string) => readFileSync(new URL(`../../supabase/${name}`, import.meta.url), "utf8");
const migration = read("migrations/20261004131440_restaurant_menu_identity_candidates.sql");
const canonical = read("migrations/20260812110235_restaurant_menu_price_tracking.sql");
const merchant = read("migrations/20260827090000_verified_receipt_ingestion_v2.sql");
const table = (sql: string, name: string) => sql.slice(sql.indexOf(`create table public.${name} (`), sql.indexOf(`comment on table public.${name}`));
const fn = (name: string) => {
  const start = merchant.indexOf(`create or replace function public.${name}(`);
  return merchant.slice(start, merchant.indexOf("$function$;", start) + "$function$;".length);
};
const id = "11111111-1111-4111-8111-111111111111";
const pending = {
  schemaVersion: "restaurant-menu-candidate.v1", candidateId: id, reviewStatus: "pending",
  resolutionStatus: "unresolved", restaurantId: null, restaurantLocationId: null,
  restaurantMenuId: null, catalogProductId: null, proposedRestaurantId: id,
  proposedRestaurantLocationId: id, merchantCandidateId: null, menuName: "메뉴", metadata: {},
  reviewNote: null, createdAt: "2026-10-04T01:00:00+00:00", updatedAt: "2026-10-04T01:00:00+00:00",
};

describe("private restaurant menu proposals", () => {
  it("requires approval and all four exact server IDs", () => {
    expect(RestaurantMenuCandidateSchema.parse(pending).catalogProductId).toBeNull();
    expect(RestaurantMenuCandidateSchema.safeParse({ ...pending, resolutionStatus: "exact", catalogProductId: id }).success).toBe(false);
    expect(RestaurantMenuCandidateSchema.safeParse({ ...pending, reviewStatus: "accepted", resolutionStatus: "exact",
      restaurantId: id, restaurantLocationId: id, restaurantMenuId: id, catalogProductId: id }).success).toBe(true);
    expect(RestaurantMenuCandidateSchema.safeParse({ ...pending, reviewStatus: "rejected", restaurantId: id }).success).toBe(false);
  });
  it("keeps approved but archived identity unresolved", () => {
    expect(RestaurantMenuCandidateSchema.safeParse({ ...pending, reviewStatus: "accepted" }).success).toBe(true);
  });
  it("requires exactly one restaurant selector", () => {
    expect(RestaurantMenuCandidateSchema.safeParse({ ...pending, merchantCandidateId: id }).success).toBe(false);
    expect(RestaurantMenuCandidateSchema.safeParse({ ...pending, proposedRestaurantId: null,
      proposedRestaurantLocationId: null, merchantCandidateId: id }).success).toBe(true);
  });
  it("rejects identity on rejection and incomplete acceptance", () => {
    expect(ResolveRestaurantMenuCandidateSchema.safeParse({ candidateId: id, decision: "reject", restaurantId: id }).success).toBe(false);
    expect(ResolveRestaurantMenuCandidateSchema.safeParse({ candidateId: id, decision: "accept" }).success).toBe(false);
  });
  it("has owner RLS, least privilege, and no canonical registration or Nutrition writes", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("using (user_id = (select auth.uid()))");
    expect(migration).toContain("'app_metadata' ->> 'role'");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toMatch(/insert into public\.(restaurant_menus|catalog_products|standard_products|restaurants)\s*\(/);
    expect(migration).not.toContain("publish_dining");
  });
  it("executes submission, RLS, idempotency and admin resolution in PostgreSQL", async () => {
    // Real upstream restaurant/merchant constraints and unchanged merchant RPCs are executed.
    // Auth JWTs and upstream catalog rows are fixtures. pgcrypto's SHA-256 overloads use
    // PostgreSQL's equivalent built-in sha256; Docker/Supabase services are not simulated.
    const db = new PGlite();
    async function execute(label: string, sql: string) {
      try { await db.exec(sql); }
      catch (reason) {
        const error = reason as { message: string; position?: string; internalPosition?: string; internalQuery?: string };
        const source = error.internalQuery ?? sql;
        const position = Number(error.internalPosition ?? error.position ?? 1) - 1;
        throw new Error(`${label}: ${error.message}; near ${source.slice(Math.max(0, position - 120), position + 120)}`);
      }
    }
    try {
      await execute("upstream fixtures", `create role authenticated; create role anon;
        create schema auth; create schema extensions;
        create table auth.users(id uuid primary key, aud text, role text, email text,
          raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz);
        create function auth.uid() returns uuid language sql stable as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
        create function auth.jwt() returns jsonb language sql stable as $$
          select nullif(current_setting('request.jwt.claims', true), '')::jsonb; $$;
        grant usage on schema public, auth to authenticated, anon;
        create function extensions.digest(data bytea, algorithm text) returns bytea language sql immutable strict
          as $$ select pg_catalog.sha256(data); $$;
        create function extensions.digest(data text, algorithm text) returns bytea language sql immutable strict
          as $$ select pg_catalog.sha256(convert_to(data,'UTF8')); $$;
        create table public.brands(id uuid primary key);
        create table public.standard_products(id uuid primary key default gen_random_uuid(), purchase_type text,
          canonical_name text, created_by uuid, status text not null default 'active');
        create table public.catalog_products(id uuid primary key default gen_random_uuid(), purchase_type text,
          standard_product_id uuid references public.standard_products(id), canonical_name text,
          created_by uuid, status text not null default 'active');
      ` + table(canonical, "restaurants") + table(canonical, "restaurant_locations")
        + table(canonical, "restaurant_menus") + table(merchant, "merchant_identity_candidates") + `
        alter table public.restaurant_locations add column address text;
        alter table public.restaurant_locations add column phone text;
        alter table public.restaurant_locations add column business_registration_number text;
        create unique index merchant_identity_candidates_idempotency_key_idx
          on public.merchant_identity_candidates(user_id, origin, idempotency_key) where idempotency_key is not null;
        alter table public.merchant_identity_candidates enable row level security;
        revoke all on public.merchant_identity_candidates from public, anon, authenticated;
      ` + fn("submit_merchant_identity_candidate_v1") + fn("admin_resolve_merchant_identity_candidate_v1"));
      await execute("proposal migration", migration);
      await execute("existing merchant resolution repair", read("migrations/20261004134439_merchant_resolution_column_qualification.sql"));
      await execute("SQL contract test", read("tests/restaurant_menu_identity_candidates.sql"));
      const { rows } = await db.query<{ count: number }>("select count(*)::int as count from public.restaurant_menu_identity_candidates");
      expect(rows[0].count).toBe(0); // SQL test rolled back every fixture.
    } finally { await db.close(); }
  }, 60_000);
});
