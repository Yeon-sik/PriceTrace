import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260810193000_remove_unused_receipt_name_variable.sql"),
  "utf8",
);

describe("strict standard product lint migration", () => {
  it("removes only the confirmed unused declaration from the current function definition", () => {
    expect(migration).toContain("pg_catalog.pg_get_functiondef(v_signature)");
    expect(migration).toContain("v_unused_declaration_pattern");
    expect(migration).toContain("v_normalized_receipt_name[ \\t]+text");
    expect(migration).toContain("pg_catalog.regexp_replace(");
    expect(migration).toContain("Unexpected strict core receipt-name declaration.");
    expect(migration).not.toMatch(/drop\s+function/i);
    expect(migration).not.toMatch(/drop\s+table/i);
  });
});
