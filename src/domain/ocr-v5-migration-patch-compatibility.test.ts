import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const identityMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260927090000_ocr_v5_identity_authority.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const standaloneMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260928041336_ocr_v5_standalone_and_menu_authority.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const standaloneUuidAggregateMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261002090000_fix_standalone_uuid_aggregates.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const legacyRestaurantReceiptMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261002100000_restore_legacy_restaurant_receipt_v1_store_insert.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const legacyRestaurantReceiptProductMigration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261002110000_fix_legacy_restaurant_receipt_product_insert.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const sqlFixtures = readFileSync(
  path.join(process.cwd(), "supabase/tests/ocr_v5_migration_patch_compatibility.sql"),
  "utf8",
).replace(/\r\n/g, "\n");

function anchorHelper(source: string): string {
  return source.match(/create or replace function pg_temp\.ocr_v5_anchor_span\([\s\S]*?\$function\$;/)?.[0] ?? "";
}

function flexibleAnchorPattern(anchor: string): RegExp {
  const escaped = anchor.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped.replace(/\s+/g, "\\s+"), "g");
}

function findUniqueAnchor(source: string, anchor: string, label: string): RegExpMatchArray {
  const matches = [...source.matchAll(flexibleAnchorPattern(anchor))];
  if (matches.length !== 1 || matches[0].index === undefined) {
    throw new Error(`${label} matched ${matches.length} times`);
  }
  return matches[0];
}

function patchReceiptLink(source: string): string {
  const receiptId = findUniqueAnchor(source, "returning id into v_receipt_id;", "receipt id token");
  const sourceInsert = findUniqueAnchor(source, "insert into public.verified_receipt_sources", "source insert token");
  const receiptIdEnd = receiptId.index! + receiptId[0].length;
  const sourceInsertEnd = sourceInsert.index! + sourceInsert[0].length;
  const gap = source.slice(receiptIdEnd, sourceInsert.index);

  if (sourceInsert.index! <= receiptIdEnd || !/^\s*$/.test(gap) || !/^\s*\(/.test(source.slice(sourceInsertEnd))) {
    throw new Error("receipt link semantic anchors are not adjacent");
  }

  const link = "  if v_candidate_id is not null then\n    update public.merchant_identity_candidates set receipt_id = v_receipt_id;\n  end if;";
  return `${source.slice(0, receiptIdEnd)}\n${link}${gap}${source.slice(sourceInsert.index!)}`;
}

describe("OCR V5 migration text patch compatibility", () => {
  it("uses unique whitespace-flexible anchors for all function-definition patches", () => {
    for (const migration of [identityMigration, standaloneMigration]) {
      expect(migration).toContain("pg_temp.ocr_v5_anchor_span");
      expect(migration).toContain("regexp_count(p_definition, v_pattern)");
      expect(migration).toContain("regexp_instr(p_definition, v_pattern, 1, 1, 0)");
      expect(migration).toContain("drop function pg_temp.ocr_v5_anchor_span(text, text, text)");
      expect(migration).not.toMatch(/strpos\(v_definition, v_old\)/);
      expect(migration).not.toMatch(/replace\(v_definition, v_old, v_new\)/);
    }

    expect(anchorHelper(identityMigration)).not.toBe("");
    expect(anchorHelper(standaloneMigration)).toBe(anchorHelper(identityMigration));
    expect(anchorHelper(sqlFixtures)).toBe(anchorHelper(identityMigration));

    expect(identityMigration).toContain("receipt merchant identity branch start");
    expect(identityMigration).toContain("receipt candidate receipt-link semantic anchors are not adjacent");
    expect(identityMigration).not.toContain("insert into public.verified_receipt_sources('");
  });

  it.each([
    ["blank lines and whitespace before the opening parenthesis", "returning id into v_receipt_id;\n\n  insert into public.verified_receipt_sources (\n"],
    ["one-line spacing before the opening parenthesis", "returning id into v_receipt_id;\n  insert into public.verified_receipt_sources (\n"],
    ["CRLF function source", "returning id into v_receipt_id;\r\n\r\n  insert into public.verified_receipt_sources(\r\n"],
    ["normal compact formatting", "returning id into v_receipt_id;\n  insert into public.verified_receipt_sources(\n"],
  ])("patches %s", (_label, source) => {
    const prefix = "begin\n  ";
    const suffix = "receipt_id, user_id);\nend;";
    const definition = `${prefix}${source}${suffix}`;
    const patched = patchReceiptLink(definition);

    expect(patched).toContain("if v_candidate_id is not null then");
    expect(patched).toContain("insert into public.verified_receipt_sources");
    expect(patched.slice(0, patched.indexOf("returning id"))).toBe(definition.slice(0, definition.indexOf("returning id")));
    expect(patched.endsWith(suffix)).toBe(true);
  });

  it("fails closed when a semantic token is missing", () => {
    expect(() => patchReceiptLink("returning id into v_receipt_id;\n-- source insert omitted")).toThrow(/source insert token matched 0 times/);
  });

  it("fails closed when a semantic token is duplicated", () => {
    const definition = [
      "returning id into v_receipt_id;",
      "insert into public.verified_receipt_sources (receipt_id);",
      "returning id into v_receipt_id;",
      "insert into public.verified_receipt_sources (receipt_id);",
    ].join("\n");

    expect(() => patchReceiptLink(definition)).toThrow(/receipt id token matched 2 times/);
  });

  it("loads restaurant location and restaurant rowtypes with separate SELECT INTO targets", () => {
    for (const migration of [identityMigration, standaloneMigration]) {
      expect(migration).not.toMatch(/select\s+location\s*,\s*restaurant\s+into\s+v_location\s*,\s*v_restaurant/i);
      expect(migration).toMatch(/select\s+location\.\*\s+into\s+v_location/i);
      expect(migration).toMatch(/select\s+restaurant\.\*\s+into\s+v_restaurant/i);
    }
  });

  it("patches each unsupported standalone UUID minimum exactly once", () => {
    for (const [anchor, replacement] of [
      ["min(store.id)", "min(store.id::text)::uuid"],
      ["min(product.id)", "min(product.id::text)::uuid"],
      ["min(store_product.id)", "min(store_product.id::text)::uuid"],
    ]) {
      expect(standaloneUuidAggregateMigration.split(anchor)).toHaveLength(3);
      expect(standaloneUuidAggregateMigration).toContain(replacement);
    }
    expect(standaloneUuidAggregateMigration).toContain("standalone UUID aggregate anchor is missing or ambiguous");
  });

  it("keeps legacy restaurant receipt writes compatible without name-only store upserts", () => {
    expect(legacyRestaurantReceiptMigration).toContain("on conflict (user_id, name) do update set");
    expect(legacyRestaurantReceiptMigration).toContain("branch_name = coalesce(excluded.branch_name, public.stores.branch_name)");
    expect(legacyRestaurantReceiptMigration).toContain("legacy restaurant receipt store upsert anchor is missing or ambiguous");
    expect(legacyRestaurantReceiptMigration).toMatch(/v_new := '  returning id into v_store_id;';/);
  });

  it("keeps legacy receipt lines on the product row inserted for that line", () => {
    expect(legacyRestaurantReceiptProductMigration).toContain("on conflict (user_id, name) do update set");
    expect(legacyRestaurantReceiptProductMigration).toContain("legacy restaurant receipt product upsert anchor is missing or ambiguous");
    expect(legacyRestaurantReceiptProductMigration).toContain("returning id into v_product_id;");
    expect(legacyRestaurantReceiptProductMigration).toContain("where user_id = v_user_id and name = btrim(v_item.description);");
  });
});
