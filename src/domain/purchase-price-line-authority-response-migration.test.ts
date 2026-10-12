import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) =>
  readFileSync(new URL(`../../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const metadata = read("supabase/migrations/20261009040200_purchase_price_line_authority_response.sql");
const runtime = read("supabase/migrations/20261009040159_purchase_price_runtime_compatibility.sql");

describe("purchase line authority response contract", () => {
  it("adds metadata before checkpoint storage without introducing source writes or V5 parsing", () => {
    expect(metadata).toContain("private_purchase_price_line_response_v1(v_source_id, v_response)");
    expect(metadata).toContain("purchase_price_observation_ingestion_contents");
    expect(metadata).not.toMatch(/^\s*(?:create table|alter table|update public\.purchase_price|insert into public\.purchase_price)/im);
    expect(metadata).not.toContain("yeonsik-ocr.v5");
    for (const field of ["sourceAcceptanceStatus", "observationStatus", "reasonCode", "authorityStatus",
      "merchantResolutionStatus", "menuResolutionStatus", "authoritativeIds"]) {
      expect(metadata).toContain(`'${field}'`);
    }
  });

  it("keeps owner-scoped checkpoints and observation provenance under explicit ACLs", () => {
    expect(metadata).toContain("source.user_id = v_owner");
    expect(metadata).toContain("line.user_id = v_owner");
    expect(metadata).toContain("observation.created_by = v_owner");
    expect(metadata).toContain("observation.source_snapshot ->> 'purchaseSourceId'");
    expect(metadata).toContain("observation.source_snapshot ->> 'purchaseLineOrdinal'");
    expect(metadata).toContain("from public, anon, authenticated");
    expect(metadata).toContain("grant execute on function public.get_purchase_price_ingestion_response_v1(uuid) to authenticated");
    expect(metadata).toContain("set search_path = ''");
  });

  it("freezes replay metadata and refuses duplicate line keys or insufficient authority", () => {
    expect(metadata).toContain("p_base_response ->> 'lineAuthorityVersion' = 'purchase-line-authority.v1'");
    expect(metadata).toContain("'duplicate_line_key'");
    expect(metadata).toContain("'restaurant_menu_serving_label_missing'");
    expect(metadata).toContain("'restaurant_source_identity_conflict'");
    expect(metadata).toContain("'needs_review'");
    expect(metadata).toContain("item.value ->> 'lineKey' = v_line.source_line_key");
    expect(metadata).toContain("v_base_line ->> 'observationId' is distinct from");
  });

  it("repairs UUID aggregates through bounded forward anchors and keeps count checks", () => {
    for (const field of ["location.id", "location.restaurant_id", "menu.id", "menu.catalog_product_id",
      "store.id", "product.id", "store_product.id"]) {
      expect(runtime).toContain(`'${field}'`);
    }
    expect(runtime).toContain("::text)::uuid");
    expect(runtime).toContain("anchor is missing or ambiguous");
    expect(runtime).not.toContain("v_match_count = 1");
  });
});
