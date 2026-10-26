import assert from "node:assert/strict";

// Read-only HTTPS smoke test. Supply runtime secrets through the environment;
// never echo headers, environment values, or raw transport exceptions.
const url = process.env.PRICETRACE_URL;
const key = process.env.PRICETRACE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith("sb_publishable_")) {
  console.error("Supply PRICETRACE_URL and a modern PRICETRACE_PUBLISHABLE_KEY at runtime.");
  process.exit(1);
}
const endpoint = new URL(url);
assert.equal(endpoint.protocol, "https:");
const headers = { apikey: key, "Content-Type": "application/json" }; // No Authorization/session.
const cases = [
  ["8801104671507", "matched", "1516c3eb-3dfb-4e11-8040-d23fadcdaad0"],
  ["8809375984692", "matched", "18e83c5c-86a4-4e95-a131-411381789687"],
  ["2000000000992", "not_linked", null],
  ["8801104671508", "invalid", null],
];

try {
  const results = [];
  for (const [barcode, status, catalogId] of cases) {
    const response = await fetch(new URL("/rest/v1/rpc/get_public_product_by_barcode_v1", endpoint), {
      method: "POST", headers, body: JSON.stringify({ p_barcode: barcode }), signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, `RPC HTTP status for ${barcode}`);
    const payload = await response.json();
    assert.deepEqual(Object.keys(payload).sort(), ["barcode", "checkedAt", "contractVersion", "matches", "status"]);
    assert.equal(payload.contractVersion, "pricetrace-barcode-lookup.v1");
    assert.equal(payload.barcode, barcode);
    assert.equal(payload.status, status);
    assert.ok(Number.isFinite(Date.parse(payload.checkedAt)));
    assert.equal(payload.matches.length, catalogId ? 1 : 0);
    if (catalogId) {
      const item = payload.matches[0];
      assert.equal(item.catalogProductId, catalogId);
      assert.deepEqual(Object.keys(item).sort(), ["brand", "catalogProductId", "categoryName", "contentAmount", "contentUnit",
        "latestPublicPrice", "name", "packageCount", "specificationLabel", "standardProductId"]);
      if (item.latestPublicPrice !== null) {
        assert.deepEqual(Object.keys(item.latestPublicPrice).sort(), ["amountKrw", "kind", "observedAt", "seller", "sourceLabel"]);
        assert.ok(Number.isInteger(item.latestPublicPrice.amountKrw));
        assert.equal(item.latestPublicPrice.kind, "listed");
      }
    }
    results.push(payload);
  }
  const tableResponse = await fetch(new URL("/rest/v1/catalog_product_identifiers?select=catalog_product_id&limit=1", endpoint), {
    headers, signal: AbortSignal.timeout(15000),
  });
  assert.ok([401, 403].includes(tableResponse.status), "anon direct identifier table SELECT must be denied");
  console.log(JSON.stringify({ result: "PUBLIC_BARCODE_ANON_HTTP_PASS", rpcCases: cases.length,
    directTableHttpStatus: tableResponse.status, results }, null, 2));
} catch (error) {
  // Assertion messages are controlled strings above; fetch errors might contain
  // request internals, so transport error details are deliberately not printed.
  console.error(error?.code === "ERR_ASSERTION" ? `Barcode smoke assertion failed: ${error.message}` : "Barcode smoke request failed.");
  process.exitCode = 1;
}
