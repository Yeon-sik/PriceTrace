import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// Connection keys stay in the ignored runtime file. Never print keys, tokens or private responses.
const file = process.argv[2];
if (!file) throw new Error("Pass the OCR runtime .env path");
const config = Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).flatMap(line => {
  const match = line.trim().match(/^([A-Z_]+)=(.*)$/);
  return match ? [[match[1], match[2].replace(/^(["'])(.*)\1$/, "$2")]] : [];
}));
const id = "00000000-0000-4000-8000-000000000001";
const cases = [
  { label: "PriceTrace", url: config.PRICETRACE_SUPABASE_URL, key: config.PRICETRACE_SUPABASE_PUBLISHABLE_KEY,
    rpc: "get_my_owner_confirmed_restaurants_v1", body: {} },
  { label: "Fitness", url: config.NUTRITION_SUPABASE_URL, key: config.NUTRITION_SUPABASE_ANON_KEY,
    rpc: "link_private_ocr_purchase_nutrition_v1", body: { p_canonical_import_id: id, p_nutrition_food_id: "missing-smoke-artifact",
      p_nutrition_client_key: "missing-smoke-artifact", p_purchase_record_client_key: "smoke", p_purchase_line_key: "smoke",
      p_purchase_source_id: id, p_restaurant_id: id, p_restaurant_location_id: id, p_restaurant_menu_id: id } },
];
let unavailable = false;
for (const entry of cases) {
  assert.ok(entry.url && entry.key, `${entry.label} connection missing`);
  const target = new URL(entry.url);
  assert.equal(target.protocol, "https:");
  assert.ok(target.hostname.endsWith(".supabase.co"));
  assert.ok(!entry.key.startsWith("sb_secret_"));
  if (entry.key.startsWith("eyJ")) assert.equal(JSON.parse(Buffer.from(entry.key.split(".")[1], "base64url")).role, "anon");
  const response = await fetch(`${entry.url.replace(/\/$/, "")}/rest/v1/rpc/${entry.rpc}`, {
    method: "POST", headers: { apikey: entry.key, "Content-Type": "application/json" }, body: JSON.stringify(entry.body),
  });
  const result = await response.json();
  const missing = response.status === 404 && result.code === "PGRST202";
  const denied = [401, 403].includes(response.status) && result.code === "42501";
  console.log(JSON.stringify({ project: entry.label, host: target.hostname, rpc: entry.rpc,
    status: response.status, code: result.code, result: missing ? "RPC_NOT_DEPLOYED" : denied ? "ANONYMOUS_EXECUTE_DENIED" : "UNEXPECTED" }));
  assert.ok(missing || denied, `${entry.label} private RPC unexpectedly accessible or probe failed`);
  unavailable ||= missing;
}
console.log(unavailable ? "HTTP_DEPLOYMENT_BLOCKED" : "HTTP_PRIVATE_RPC_ANONYMOUS_ACL_PASS");
console.log("AUTHENTICATED_OWNER_HTTP_UNVERIFIED: SQL role/claims fixtures do not prove signed owner JWT/session behavior.");
process.exitCode = unavailable ? 2 : 0;
