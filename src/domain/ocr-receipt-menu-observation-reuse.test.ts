import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261004002338_ocr_receipt_menu_observation_reuse.sql"),
  "utf8",
);
const originalObservationMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260812110235_restaurant_menu_price_tracking.sql"),
  "utf8",
);
// Execute the deployed table constraints and append-only trigger, rather than a
// permissive mock of the relation that produced the production 23505 failure.
const observationTable = originalObservationMigration.slice(
  originalObservationMigration.indexOf("create table public.restaurant_menu_receipt_observations ("),
  originalObservationMigration.indexOf("comment on table public.restaurant_menu_receipt_observations"),
);
const appendOnlyTrigger = originalObservationMigration.slice(
  originalObservationMigration.indexOf("create function public.reject_restaurant_menu_append_only_mutation()"),
  originalObservationMigration.indexOf("create trigger restaurant_menu_registration_executions_append_only"),
);

const ids = {
  owner: "10000000-0000-0000-0000-000000000001",
  otherOwner: "10000000-0000-0000-0000-000000000002",
  receipt: "20000000-0000-0000-0000-000000000001",
  restaurant: "30000000-0000-0000-0000-000000000001",
  location: "40000000-0000-0000-0000-000000000001",
  otherLocation: "40000000-0000-0000-0000-000000000002",
  menu: "50000000-0000-0000-0000-000000000001",
  secondMenu: "50000000-0000-0000-0000-000000000002",
  catalog: "60000000-0000-0000-0000-000000000001",
  secondCatalog: "60000000-0000-0000-0000-000000000002",
  price: "70000000-0000-0000-0000-000000000001",
  secondPrice: "70000000-0000-0000-0000-000000000002",
  legacyObservation: "80000000-0000-0000-0000-000000000001",
  resolution: "90000000-0000-0000-0000-000000000001",
};
const itemId = (sourceLineId: string) => createHash("sha256").update(`${ids.receipt}:${sourceLineId}`).digest("hex");
const line = (sourceLineId = "meal-1", menuId = ids.menu, catalogId = ids.catalog) => ({
  sourceLineId,
  receiptItemId: itemId(sourceLineId),
  resolutionStatus: "resolved",
  restaurantMenuId: menuId,
  catalogProductId: catalogId,
  observationId: sourceLineId === "meal-1" ? ids.price : ids.secondPrice,
});
const response = (lines = [line()]) => ({
  receiptId: ids.receipt,
  restaurantId: ids.restaurant,
  restaurantLocationId: ids.location,
  merchantResolutionStatus: "exact",
  lines,
});
const sourceReceipt = { merchant: { catalog_namespace: "verified-source", merchant_id: "branch-1" } };

// Auth and the two upstream identity resolvers are explicit fixtures. The new
// migration's helper and owner-authenticated merchant RPC execute unchanged in
// PostgreSQL. The enricher invokes the actual helper exactly as the deployed
// September 28 enricher does; merchant lookup itself is outside this repair.
const fixtureSchema = `
  create role authenticated;
  create role anon;
  create schema auth;
  create schema extensions;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$;
  grant usage on schema public, auth to authenticated, anon;
  create function extensions.digest(p_data text, p_algorithm text) returns bytea
    language sql immutable strict as $$ select pg_catalog.sha256(pg_catalog.convert_to(p_data, 'UTF8')); $$;
  create table public.catalog_products(id uuid primary key, status text not null default 'active',
    purchase_type text not null default 'menu_item', verification_status text not null default 'verified');
  create table public.restaurants(id uuid primary key, status text not null default 'active',
    review_status text not null default 'verified', verification_status text not null default 'verified');
  create table public.restaurant_locations(
    id uuid primary key, restaurant_id uuid not null references public.restaurants(id),
    review_status text not null default 'verified', verification_status text not null default 'verified',
    unique(restaurant_id, id)
  );
  create table public.restaurant_menus(
    id uuid primary key, restaurant_id uuid not null references public.restaurants(id),
    catalog_product_id uuid not null references public.catalog_products(id), status text not null default 'active',
    review_status text not null default 'verified', verification_status text not null default 'verified',
    unique(restaurant_id, id)
  );
  create table public.restaurant_menu_source_mappings(
    id uuid primary key, restaurant_id uuid, restaurant_location_id uuid, restaurant_menu_id uuid,
    source_product_code_namespace text, source_product_code text, review_status text, verification_status text,
    unique(restaurant_id, restaurant_location_id, restaurant_menu_id, id)
  );
  create table public.receipts(
    id uuid primary key, user_id uuid not null references auth.users(id),
    purchased_at date not null, unique(user_id, id)
  );
  create table public.receipt_items(
    id text primary key, user_id uuid not null references auth.users(id), receipt_id uuid not null,
    unit_price_krw integer not null check(unit_price_krw >= 0),
    purchased_quantity integer not null check(purchased_quantity > 0),
    total_price_krw integer not null check(total_price_krw = unit_price_krw * purchased_quantity),
    unique(user_id, id), foreign key(user_id, receipt_id) references public.receipts(user_id, id)
  );
  create table public.price_observations(
    id uuid primary key, user_id uuid not null references auth.users(id), receipt_item_id text not null,
    observed_at date not null, unit_price_krw integer not null check(unit_price_krw >= 0),
    quantity integer not null check(quantity > 0), catalog_product_id uuid references public.catalog_products(id),
    attributes jsonb not null default '{}', verification_status text not null default 'verified',
    unique(user_id, id), unique(user_id, receipt_item_id),
    foreign key(user_id, receipt_item_id) references public.receipt_items(user_id, id)
  );
  create table public.verified_receipt_sources(
    receipt_id uuid primary key, user_id uuid not null, issued_on date, issued_at timestamptz,
    transcription_status text not null, foreign key(user_id, receipt_id) references public.receipts(user_id, id)
  );
  create table public.verified_receipt_source_lines(
    receipt_id uuid not null, user_id uuid not null, source_line_id text not null, line_ordinal integer,
    line_type text not null, description text, source_line_references text[] not null,
    merchant_sku text, benefit_kind text, catalog_product_id uuid, restaurant_menu_id uuid,
    quantity_value numeric, quantity_unit text, unit_price_amount_minor integer,
    gross_amount_minor integer, discount_amount_minor integer, tax_amount_minor integer, net_amount_minor integer,
    primary key(receipt_id, source_line_id),
    foreign key(user_id, receipt_id) references public.receipts(user_id, id)
  );
  create table public.merchant_identity_candidates(
    id uuid primary key, user_id uuid not null, origin text not null, review_status text not null,
    receipt_id uuid, source_fingerprint text not null, idempotency_key text
  );
  create table public.verified_receipt_ingestion_contents(
    user_id uuid not null, request_fingerprint text not null, receipt_id uuid not null, response jsonb not null,
    primary key(user_id, request_fingerprint)
  );
  create table public.verified_receipt_ingestion_requests(
    user_id uuid not null, idempotency_key text not null, receipt_id uuid not null, response jsonb not null,
    primary key(user_id, idempotency_key)
  );
  create table public.test_merchant_identity(identity jsonb not null);
  create function public.private_resolve_verified_receipt_merchant_v2(
    p_user_id uuid, p_source_fingerprint text, p_idempotency_key text, p_merchant jsonb, p_resolution_id uuid
  ) returns jsonb language sql security definer set search_path = '' as $$
    select identity from public.test_merchant_identity;
  $$;
  create function public.private_enrich_verified_receipt_ingestion_v2(p_base_response jsonb, p_receipt jsonb)
    returns jsonb language plpgsql security definer set search_path = '' as $$
    begin return public.private_record_ocr_receipt_menu_observations_v1(p_base_response, p_receipt); end;
  $$;
`;

describe("receipt menu observation reuse in PostgreSQL", () => {
  let db: PGlite;

  beforeAll(async () => {
    expect(migration.trim()).not.toBe("");
    db = new PGlite();
    await db.exec(fixtureSchema + observationTable + appendOnlyTrigger);
    await db.exec(migration);
    // A forward repair must tolerate reapplication without changing its grants.
    await db.exec(migration);
  }, 30_000);

  afterAll(async () => { await db?.close(); });

  beforeEach(async () => {
    await db.exec(`reset role; truncate auth.users, public.restaurants, public.catalog_products,
      public.receipts, public.merchant_identity_candidates, public.verified_receipt_ingestion_contents,
      public.verified_receipt_ingestion_requests, public.test_merchant_identity cascade;
      select set_config('request.jwt.claim.sub', '${ids.owner}', false);
      insert into auth.users values('${ids.owner}'), ('${ids.otherOwner}');
      insert into public.catalog_products(id) values('${ids.catalog}'), ('${ids.secondCatalog}');
      insert into public.restaurants(id) values('${ids.restaurant}');
      insert into public.restaurant_locations(id,restaurant_id) values('${ids.location}', '${ids.restaurant}'),
        ('${ids.otherLocation}', '${ids.restaurant}');
      insert into public.restaurant_menus(id,restaurant_id,catalog_product_id) values('${ids.menu}', '${ids.restaurant}', '${ids.catalog}'),
        ('${ids.secondMenu}', '${ids.restaurant}', '${ids.secondCatalog}');
      insert into public.receipts values('${ids.receipt}', '${ids.owner}', '2026-09-25');
      insert into public.verified_receipt_sources values('${ids.receipt}', '${ids.owner}',
        '2026-09-25', null, 'user_verified');
      insert into public.merchant_identity_candidates values('${ids.resolution}', '${ids.owner}',
        'receipt_ingestion', 'needs_ocr_resolution', '${ids.receipt}', '${"a".repeat(64)}', 'original-key');`);
    await addSourceLine("meal-1", ids.menu, ids.catalog, ids.price, 1);
    await db.query("insert into public.test_merchant_identity values($1::jsonb)", [JSON.stringify({
      status: "exact", restaurantId: ids.restaurant, restaurantLocationId: ids.location,
    })]);
    await saveResponse(response());
  });

  async function addSourceLine(sourceLineId: string, menuId: string, catalogId: string, priceId: string, ordinal: number) {
    await db.query(`insert into public.receipt_items values($1, $2::uuid, $3::uuid, 12000, 2, 24000)`,
      [itemId(sourceLineId), ids.owner, ids.receipt]);
    await db.query(`insert into public.price_observations(id,user_id,receipt_item_id,observed_at,
      unit_price_krw,quantity,catalog_product_id,attributes) values($1::uuid,$2::uuid,$3,'2026-09-25',12000,2,$4::uuid,$5::jsonb)`,
      [priceId, ids.owner, itemId(sourceLineId), catalogId, JSON.stringify({ schemaVersion: "receipt.v2", sourceLineId })]);
    await db.query(`insert into public.verified_receipt_source_lines values(
      $1::uuid,$2::uuid,$3,$4,'product','Verified menu',array[$3],null,null,$5::uuid,$6::uuid,
      2,'each',12000,24000,0,0,24000)`, [ids.receipt, ids.owner, sourceLineId, ordinal, catalogId, menuId]);
  }

  async function saveResponse(savedResponse: unknown) {
    await db.query(`insert into public.verified_receipt_ingestion_contents values($1::uuid,$2,$3::uuid,$4::jsonb)
      on conflict(user_id,request_fingerprint) do update set response=excluded.response`,
      [ids.owner, "a".repeat(64), ids.receipt, JSON.stringify(savedResponse)]);
    await db.query(`insert into public.verified_receipt_ingestion_requests values($1::uuid,'original-key',$2::uuid,$3::jsonb)
      on conflict(user_id,idempotency_key) do update set response=excluded.response`,
      [ids.owner, ids.receipt, JSON.stringify(savedResponse)]);
  }

  async function insertLegacy(overrides: {
    menuId?: string; locationId?: string; snapshot?: Record<string, unknown>; observedOn?: string; unitPrice?: number;
  } = {}) {
    await db.query(`insert into public.restaurant_menu_receipt_observations(
      id,restaurant_id,restaurant_location_id,restaurant_menu_id,owner_user_id,price_observation_id,
      receipt_id,receipt_item_id,observed_on,unit_price_krw,quantity,total_price_krw,evidence_snapshot,
      evidence_fingerprint,verified_by) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,
      $7::uuid,$8,$9::date,$10,2,$11,$12::jsonb,$13,$5::uuid)`,
      [ids.legacyObservation, ids.restaurant, overrides.locationId ?? ids.location, overrides.menuId ?? ids.menu,
        ids.owner, ids.price, ids.receipt, itemId("meal-1"), overrides.observedOn ?? "2026-09-25",
        overrides.unitPrice ?? 12000, (overrides.unitPrice ?? 12000) * 2,
        JSON.stringify(overrides.snapshot ?? { schemaVersion: "receipt.v1", receiptId: ids.receipt }),
        `sha256:${"b".repeat(64)}`]);
  }

  async function record(currentResponse: unknown = response()) {
    const result = await db.query<{ value: ReturnType<typeof response> }>(
      "select public.private_record_ocr_receipt_menu_observations_v1($1::jsonb,$2::jsonb) as value",
      [JSON.stringify(currentResponse), JSON.stringify(sourceReceipt)],
    );
    return result.rows[0].value;
  }

  async function observations() {
    return (await db.query<Record<string, unknown>>(
      "select * from public.restaurant_menu_receipt_observations order by id",
    )).rows;
  }

  async function rejectUnchanged(operation: () => Promise<unknown>, code: string) {
    const before = await observations();
    const pricesBefore = (await db.query("select * from public.price_observations order by id")).rows;
    await expect(operation()).rejects.toMatchObject({ code });
    expect(await observations()).toEqual(before);
    expect((await db.query("select * from public.price_observations order by id")).rows).toEqual(pricesBefore);
  }

  it("reuses an immutable legacy observation despite missing sourceLineId and a different fingerprint", async () => {
    await insertLegacy();
    const before = await observations();
    const result = await record();
    expect(result.lines[0]).toMatchObject({ sourceLineId: "meal-1", restaurantObservationId: ids.legacyObservation });
    expect(await observations()).toEqual(before);
    expect((await db.query("select count(*)::int as count from public.price_observations")).rows[0]).toEqual({ count: 1 });
    expect(await record()).toEqual(result);
    expect(await observations()).toEqual(before);
  });

  it("creates one new observation and replays the same server ID without a duplicate", async () => {
    const first = await record();
    const second = await record();
    expect(first.lines[0]).toHaveProperty("restaurantObservationId", expect.any(String));
    expect(second).toEqual(first);
    expect(await observations()).toHaveLength(1);
  });

  it("resolves and persists the merchant RPC response while retaining the original observation", async () => {
    await insertLegacy();
    const before = await observations();
    await saveResponse({ ...response(), merchantResolutionStatus: "needs_ocr_resolution" });
    await db.exec("set role authenticated");
    let resolved;
    try {
      resolved = (await db.query<{ value: ReturnType<typeof response> }>(
        "select public.resolve_ocr_merchant_identity_v1($1::uuid,$2::jsonb,true) as value",
        [ids.resolution, JSON.stringify(sourceReceipt.merchant)],
      )).rows[0].value;
    } finally { await db.exec("reset role"); }
    expect(resolved).toMatchObject({ merchantResolutionStatus: "exact", ocrResolution: { status: "resolved" } });
    expect(resolved.lines[0]).toMatchObject({ restaurantObservationId: ids.legacyObservation });
    expect(await observations()).toEqual(before);
    const saved = await db.query<{ response: unknown }>("select response from public.verified_receipt_ingestion_contents");
    expect(saved.rows[0].response).toEqual(resolved);
    const replay = await db.query<{ response: unknown }>("select response from public.verified_receipt_ingestion_requests");
    expect(replay.rows[0].response).toEqual(resolved);
  });

  it("requires explicit human source verification in the owner merchant RPC", async () => {
    await rejectUnchanged(() => db.query("select public.resolve_ocr_merchant_identity_v1($1::uuid,$2::jsonb,false)",
      [ids.resolution, JSON.stringify(sourceReceipt.merchant)]), "22023");
  });

  it("rejects duplicate accepted responses instead of selecting one arbitrarily", async () => {
    await db.query("insert into public.verified_receipt_ingestion_contents values($1::uuid,$2,$3::uuid,$4::jsonb)",
      [ids.owner, "c".repeat(64), ids.receipt, JSON.stringify(response())]);
    await rejectUnchanged(() => db.query("select public.resolve_ocr_merchant_identity_v1($1::uuid,$2::jsonb,true)",
      [ids.resolution, JSON.stringify(sourceReceipt.merchant)]), "21000");
  });

  it("retains an unresolved merchant RPC response and its OCR review requirements without observations", async () => {
    await db.query("update public.test_merchant_identity set identity=$1::jsonb", [JSON.stringify({
      status: "needs_ocr_resolution", restaurantId: ids.restaurant, restaurantLocationId: ids.location,
      reasonCode: "exact_source_required", requiredSourceFacts: ["business_registration_number"],
    })]);
    const result = await db.query<{ value: unknown }>(
      "select public.resolve_ocr_merchant_identity_v1($1::uuid,$2::jsonb,true) as value",
      [ids.resolution, JSON.stringify(sourceReceipt.merchant)],
    );
    expect(result.rows[0].value).toMatchObject({
      merchantResolutionStatus: "needs_ocr_resolution",
      ocrResolution: { status: "needs_ocr_resolution", resolutionId: ids.resolution,
        reasonCode: "exact_source_required", requiredSourceFacts: ["business_registration_number"] },
    });
    expect(await observations()).toHaveLength(0);
  });

  it("maps multiple receipt lines by exact sourceLineId even when response order is reversed", async () => {
    await addSourceLine("meal-2", ids.secondMenu, ids.secondCatalog, ids.secondPrice, 2);
    const result = await record(response([line("meal-2", ids.secondMenu, ids.secondCatalog), line()]));
    const saved = await observations();
    expect(saved).toHaveLength(2);
    for (const returned of result.lines) {
      expect(saved.find((row) => row.id === (returned as unknown as { restaurantObservationId: string }).restaurantObservationId))
        .toMatchObject({ receipt_item_id: itemId(returned.sourceLineId), restaurant_menu_id: returned.restaurantMenuId });
    }
    expect(result.lines.map((entry) => entry.sourceLineId)).toEqual(["meal-2", "meal-1"]);
  });

  it.each([
    ["another menu", { menuId: ids.secondMenu }],
    ["another location", { locationId: ids.otherLocation }],
    ["conflicting present sourceLineId", { snapshot: { sourceLineId: "different-line" } }],
    ["different observed date", { observedOn: "2026-09-24" }],
    ["different observed price", { unitPrice: 10000 }],
  ])("rejects an existing observation with %s without changing immutable rows", async (_description, override) => {
    await insertLegacy(override);
    await rejectUnchanged(() => record(), "23514");
  });

  it("rejects a response menu/catalog contradiction before recording a link", async () => {
    await rejectUnchanged(() => record(response([line("meal-1", ids.menu, ids.secondCatalog)])), "23514");
  });

  it.each([
    "update public.restaurants set review_status='unverified'",
    "update public.restaurant_locations set verification_status='unverified'",
    "update public.restaurant_menus set status='inactive'",
    "update public.catalog_products set verification_status='unverified'",
    "update public.catalog_products set purchase_type='packaged_product'",
  ])("rejects unverified or incompatible server authority: %s", async (invalidateAuthority) => {
    await db.exec(invalidateAuthority);
    await rejectUnchanged(() => record(), "23514");
  });

  it("rejects receiptItemId substitution instead of using a positional or name fallback", async () => {
    await rejectUnchanged(() => record(response([{ ...line(), receiptItemId: itemId("other-line") }])), "23514");
  });

  it("rejects duplicate sourceLineId response rows", async () => {
    await rejectUnchanged(() => record(response([line(), line()])), "23514");
  });

  it("rejects a conflicting price observation sourceLineId", async () => {
    await db.query("update public.price_observations set attributes=$1::jsonb", [JSON.stringify({ sourceLineId: "meal-2" })]);
    await rejectUnchanged(() => record(), "23514");
  });

  it("rejects a foreign receipt owner without returning their observation identity", async () => {
    await insertLegacy();
    await db.exec(`select set_config('request.jwt.claim.sub','${ids.otherOwner}',false)`);
    await rejectUnchanged(() => record(), "42501");
    await expect(db.query("select public.resolve_ocr_merchant_identity_v1($1::uuid,$2::jsonb,true)",
      [ids.resolution, JSON.stringify(sourceReceipt.merchant)])).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects a missing authenticated identity", async () => {
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    await rejectUnchanged(() => record(), "42501");
  });

  it.each([undefined, null, "unknown", "pending", "unverified", "ambiguous", "needs_ocr_resolution"])(
    "does not publish or create a link with merchant status %s", async (status) => {
      const pending = { ...response(), merchantResolutionStatus: status };
      expect(await record(pending)).toEqual(pending);
      expect(await observations()).toHaveLength(0);
    },
  );

  it.each([undefined, null, "unknown", "pending", "unverified", "ambiguous", "needs_ocr_resolution"])(
    "does not create a menu observation with line resolution status %s", async (status) => {
      await record(response([{ ...line(), resolutionStatus: status } as ReturnType<typeof line>]));
      expect(await observations()).toHaveLength(0);
    },
  );

  it("does not create or disclose a legacy observation while menu resolution remains ambiguous", async () => {
    await insertLegacy();
    const pendingLine = { ...line(), resolutionStatus: "needs_ocr_resolution" };
    const result = await record(response([pendingLine]));
    expect(result.lines[0]).toHaveProperty("restaurantObservationId", null);
    expect(await observations()).toHaveLength(1);
  });

  it("fails closed when the verified source has no observed date", async () => {
    await db.exec("update public.verified_receipt_sources set issued_on=null, issued_at=null");
    await rejectUnchanged(() => record(), "23514");
  });

  it("retains authenticated-only merchant RPC execution and excludes private-helper/anon execution", async () => {
    const grants = await db.query<{ helper_authenticated: boolean; helper_anon: boolean; rpc_authenticated: boolean; rpc_anon: boolean }>(`
      select has_function_privilege('authenticated','public.private_record_ocr_receipt_menu_observations_v1(jsonb,jsonb)','execute') as helper_authenticated,
        has_function_privilege('anon','public.private_record_ocr_receipt_menu_observations_v1(jsonb,jsonb)','execute') as helper_anon,
        has_function_privilege('authenticated','public.resolve_ocr_merchant_identity_v1(uuid,jsonb,boolean)','execute') as rpc_authenticated,
        has_function_privilege('anon','public.resolve_ocr_merchant_identity_v1(uuid,jsonb,boolean)','execute') as rpc_anon`);
    expect(grants.rows[0]).toEqual({ helper_authenticated: false, helper_anon: false, rpc_authenticated: true, rpc_anon: false });
    await db.exec("set role anon");
    try {
      await expect(db.query("select public.resolve_ocr_merchant_identity_v1($1::uuid,$2::jsonb,true)",
        [ids.resolution, JSON.stringify(sourceReceipt.merchant)])).rejects.toMatchObject({ code: "42501" });
    } finally { await db.exec("reset role"); }
  });
});
