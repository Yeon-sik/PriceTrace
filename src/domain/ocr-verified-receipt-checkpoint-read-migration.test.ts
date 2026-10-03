import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261003161207_ocr_verified_receipt_checkpoint_read.sql"),
  "utf8",
).replace(/\r\n/g, "\n");
const body = migration.split("as $function$")[1].split("$function$;")[0];
const contract = readFileSync(
  path.join(process.cwd(), "docs/contracts/VERIFIED_RECEIPT_INGESTION_V2.md"),
  "utf8",
).replace(/\r\n/g, "\n");
const smoke = readFileSync(
  path.join(process.cwd(), "supabase/tests/ocr_verified_receipt_checkpoint_read.sql"),
  "utf8",
);

describe("owner-only OCR receipt checkpoint read", () => {
  it("adds a stable read with a single exact server receipt ID selector", () => {
    expect(migration).toMatch(/create or replace function public\.get_verified_receipt_ingestion_response_v1\(\s*p_receipt_id uuid\s*\)/);
    expect(migration).toMatch(/returns jsonb\s+language plpgsql\s+stable\s+security definer\s+set search_path = ''/);
    expect(body).toContain("server-issued receipt ID is required");
    expect(body).toContain("errcode = '22023'");
  });

  it("requires an authenticated owner and separately verifies receipt ownership", () => {
    expect(body).toContain("v_user_id uuid := (select auth.uid())");
    expect(body).toContain("if v_user_id is null then");
    expect(body).toContain("errcode = '42501'");
    expect(body).toContain("receipt.id = p_receipt_id and receipt.user_id = v_user_id");
  });

  it("reads only that owner's content and fails closed for missing or duplicate records", () => {
    expect(body.match(/content\.user_id = v_user_id and content\.receipt_id = p_receipt_id/g)).toHaveLength(2);
    expect(body).toContain("select pg_catalog.count(*) into v_response_count");
    expect(body).toContain("if v_response_count = 0 then");
    expect(body.match(/errcode = 'P0002'/g)).toHaveLength(2);
    expect(body).toContain("if v_response_count <> 1 then");
    expect(body).toContain("errcode = '21000'");
    expect(body).not.toMatch(/limit\s+1/i);
  });

  it("returns the saved sanitized response unchanged without writes or reconstruction", () => {
    expect(body).toContain("select content.response into v_response");
    expect(body).toContain("return v_response;");
    expect(body).not.toMatch(/\b(insert|update|delete|jsonb_build_object|jsonb_set|submit_verified_receipt_v2)\b/i);
    expect(migration).not.toMatch(/alter table|create policy|grant select|disable row level security/i);
  });

  it("revokes all other API-role execution and grants only authenticated execution", () => {
    expect(migration).toMatch(/revoke all on function public\.get_verified_receipt_ingestion_response_v1\(uuid\)\s+from public, anon, authenticated;/);
    expect(migration).toMatch(/grant execute on function public\.get_verified_receipt_ingestion_response_v1\(uuid\)\s+to authenticated;/);
    expect(migration).not.toMatch(/to anon|service_role/i);
  });

  it("documents legacy fingerprint and response-loss recovery without a new ingestion", () => {
    expect(contract).toContain("get_verified_receipt_ingestion_response_v1(p_receipt_id: uuid)");
    expect(contract).toContain("Reconstructing a legacy");
    expect(contract).toContain("does not\ngrant publication intent");
    expect(contract).toContain("lost, the saved response can already be exact");
  });

  it("provides a read-only database smoke for owner, foreign owner, missing user, and anon", () => {
    expect(smoke).toContain("begin transaction read only;");
    expect(smoke).toContain("set local role authenticated;");
    expect(smoke).toContain("set local role anon;");
    expect(smoke).toContain("exception when no_data_found then");
    expect(smoke).toContain("exception when insufficient_privilege then");
    expect(smoke).toContain("rollback;");
    expect(smoke).not.toMatch(/\b(insert into|update public|delete from)\b/i);
  });
});
