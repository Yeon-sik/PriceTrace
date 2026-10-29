import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260915104124_receipt_benefit_routing.sql"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("receipt benefit routing migration contract", () => {
  it("adds a nullable source-only benefit fact without rewriting history", () => {
    expect(migration).toContain("add column benefit_kind text");
    expect(migration).toContain("benefit_kind is null or benefit_kind in ('included', 'complimentary', 'review_event', 'promotion', 'other')");
    expect(migration).toContain("never inferred from a zero or nominal price");
    expect(migration).toContain("submit_verified_receipt_v2_legacy(text, jsonb)");
  });

  it("allows legacy omissions, validates the new enum, and gates only normal observations", () => {
    expect(migration).toContain("where field_name not in (''role'', ''applies_to_line_id'', ''benefit_kind'')");
    expect(migration).toContain("line -> ''food_service'' ? ''benefit_kind''");
    expect(migration).toContain("v_benefit_kind := nullif");
    expect(migration).toContain("if v_benefit_kind is null then");
    expect(migration).toContain("food_service_role, applies_to_source_line_id, benefit_kind");
    expect(migration).toContain("''sourceLineId'', v_line_id, ''benefitKind'', v_benefit_kind");
    expect(migration).toContain("''benefitKind'', source_line.benefit_kind");
  });

  it("keeps the public RPC wrapper and authenticated grants in place", () => {
    expect(migration).toContain("public.submit_verified_receipt_v2(");
    expect(migration).toContain("public.private_enrich_verified_receipt_ingestion_v2(v_base_response, p_receipt)");
    expect(migration).toContain("grant execute on function public.submit_verified_receipt_v2(text, jsonb)");
    expect(migration).toContain("from public, anon");
    expect(migration).toContain("get_authenticated_identity_detail_v1(uuid, uuid, uuid, uuid)");
  });
});
